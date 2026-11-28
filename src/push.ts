/**
 * Pushes a finished PDF's rows straight into the dashboard's ERoll store, so nobody has to
 * upload the CSV by hand. Uses the dashboard's staged ingest API (/api/eroll/upload) with a
 * bearer token (EROLL_INGEST_TOKEN on the dashboard = DASHBOARD_INGEST_TOKEN here):
 *
 *   begin-part  clears the rows this PDF produced last time (same part + source), nothing else
 *   parts       the part's cover metadata (main roll only; a supplement knows little about its part)
 *   chunk ...   the voters, 5,000 per request
 *   finish      recomputes the roll's summary counts
 *
 * `run --push-bulk` sends a whole folder as ONE upload instead (pushRoll): begin (replaces the
 * whole roll), parts, chunks, then a finish the dashboard queues, polled with "status" until done.
 *
 * One PDF = one "source" ("main", or "supplement-2"), so a supplement pushed later never wipes the
 * main roll and a re-OCR of the main roll never wipes the supplements. Pushed PDFs are remembered
 * in data/pushed.json (per dashboard URL + PDF hash + rows hash); an unchanged PDF is not re-sent
 * unless --force-push.
 */
import fs from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import type { Logger } from "./logger.js";
import type { ConstituencyInfo, OutputRow, PdfResult } from "./types.js";
import { errMsg, sleep } from "./util.js";

export interface PushConfig {
  url: string; // dashboard origin, e.g. https://brahmastra.example.com
  token: string;
  /** Rows per chunk request (the dashboard caps a request at 10,000 rows / ~4.5 MB). */
  batchRows: number;
  timeoutMs: number;
  retries: number;
  /** Re-send PDFs already recorded as pushed. */
  force: boolean;
  /** Where pushed hashes are remembered. */
  ledgerFile: string;
}

export function pushConfigFromEnv(projectRoot: string, o: { push?: boolean; forcePush?: boolean } = {}): PushConfig | null {
  const on = o.push || ["1", "true", "yes", "on"].includes((process.env.OCR_PUSH ?? "").trim().toLowerCase());
  if (!on) return null;
  const url = (process.env.DASHBOARD_URL ?? "").trim().replace(/\/+$/, "");
  const token = (process.env.DASHBOARD_INGEST_TOKEN ?? "").trim();
  if (!url) throw new Error("push requested but DASHBOARD_URL is not set (e.g. https://your-dashboard.vercel.app)");
  if (!token) throw new Error("push requested but DASHBOARD_INGEST_TOKEN is not set (the dashboard's EROLL_INGEST_TOKEN)");
  const num = (k: string, d: number) => (process.env[k] && Number.isFinite(Number(process.env[k])) ? Number(process.env[k]) : d);
  return {
    url, token,
    batchRows: Math.max(100, Math.min(10_000, num("DASHBOARD_PUSH_BATCH", 5000))),
    timeoutMs: num("DASHBOARD_PUSH_TIMEOUT_MS", 120_000),
    retries: num("DASHBOARD_PUSH_RETRIES", 4),
    force: Boolean(o.forcePush),
    ledgerFile: process.env.OCR_PUSH_LEDGER ? path.resolve(process.env.OCR_PUSH_LEDGER) : path.join(projectRoot, "data", "pushed.json"),
  };
}

/** The voter shape the dashboard's ingest coerces (see Brahmastra_Dashboard/src/lib/eroll-parse.ts coerceVoter). */
export interface DashboardVoter {
  partNo: string; epicNo: string; nameEg: string; nameHi: string;
  relationTypeEg: string; relationTypeHi: string; relationNameEg: string; relationNameHi: string;
  houseNo: string; age: number | null; gender: "M" | "F" | "O" | "";
  psNameEg: string; psNameHi: string; rollMobile: string;
  serialNo: number | null; pageNo: number | null;
  sectionNo: string; sectionName: string; actionStatus: string; actionReason: string; supplementNo: string; source: string;
}

export interface DashboardPart {
  partNo: string; psNameEg: string; psNameHi: string; psAddressEg: string; psAddressHi: string;
  mainTownVillageEg: string; mainTownVillageHi: string; wardEg: string; wardHi: string; postOfficeEg: string; postOfficeHi: string;
  policeStationEg: string; policeStationHi: string; panchayatEg: string; panchayatHi: string; blockEg: string; blockHi: string;
  tehsilEg: string; tehsilHi: string; districtEg: string; districtHi: string; pinCode: string;
  sections: { no: string; name: string }[];
}

export interface DashboardMeta { stateName: string; acNo: string; acName: string; year: string; type: string; fileName: string }

const genderCode = (eg: string): DashboardVoter["gender"] => (/^m/i.test(eg) ? "M" : /^f/i.test(eg) ? "F" : eg ? "O" : "");
const int = (s: string): number | null => (/^\d+$/.test(s) ? Number(s) : null);

/** Source label of a PDF: "main" for the roll, "supplement-<n>" for a separately published supplement. */
export function sourceOf(r: PdfResult, c: ConstituencyInfo): string {
  const n = r.cover?.supplementNo || c.supplementNo || "";
  return n ? `supplement-${n}` : "main";
}

export function toDashboardVoters(rows: OutputRow[], source: string): DashboardVoter[] {
  return rows.map((r) => ({
    partNo: r.Part_no, epicNo: r.Epic_no, nameEg: r.Name_eg, nameHi: r.Name_hi,
    relationTypeEg: r.Relation_type_eg, relationTypeHi: r.Relation_type_hi, relationNameEg: r.Relation_name_eg, relationNameHi: r.Relation_name_hi,
    houseNo: r.house_no, age: int(r.age), gender: genderCode(r.Gender_eg),
    psNameEg: r.PS_name_eg, psNameHi: r.PS_name_hi, rollMobile: "",
    serialNo: int(r.Serial_no), pageNo: int(r.Page_no),
    sectionNo: r.Section_no, sectionName: r.Section_name_eg || r.Section_name_hi, actionStatus: r.Action_status, actionReason: r.Action_reason,
    supplementNo: r.Supplement_no, source,
  }));
}

/** One part record per part number in the rows: the cover metadata (identical on every row) plus the sections seen. */
export function toDashboardParts(rows: OutputRow[], r: PdfResult): DashboardPart[] {
  const byPart = new Map<string, DashboardPart>();
  for (const row of rows) {
    if (!row.Part_no) continue;
    let p = byPart.get(row.Part_no);
    if (!p) {
      p = {
        partNo: row.Part_no, psNameEg: row.PS_name_eg, psNameHi: row.PS_name_hi, psAddressEg: row.PS_address_eg, psAddressHi: row.PS_address_hi,
        mainTownVillageEg: row.Main_town_village_eg, mainTownVillageHi: row.Main_town_village_hi, wardEg: row.Ward_eg, wardHi: row.Ward_hi,
        postOfficeEg: row.Post_office_eg, postOfficeHi: row.Post_office_hi, policeStationEg: row.Police_station_eg, policeStationHi: row.Police_station_hi,
        panchayatEg: row.Panchayat_eg, panchayatHi: row.Panchayat_hi, blockEg: row.Block_eg, blockHi: row.Block_hi,
        tehsilEg: row.Tehsil_eg, tehsilHi: row.Tehsil_hi, districtEg: row.District_eg, districtHi: row.District_hi, pinCode: row.Pin_code,
        sections: (r.cover?.sections ?? []).map((s) => ({ no: s.no, name: s.nameEn || s.name })),
      };
      byPart.set(row.Part_no, p);
    }
    const name = row.Section_name_eg || row.Section_name_hi;
    if (row.Section_no && name && !p.sections.some((s) => s.no === row.Section_no)) p.sections.push({ no: row.Section_no, name });
  }
  for (const p of byPart.values()) p.sections.sort((a, b) => Number(a.no) - Number(b.no));
  return [...byPart.values()];
}

export function dashboardMeta(c: ConstituencyInfo, r: PdfResult): DashboardMeta {
  const cv = r.cover;
  return {
    stateName: c.state || cv?.stateEn || "",
    acNo: c.acNo || cv?.acNo || "",
    acName: c.acName || cv?.acNameEn || "",
    year: c.year || cv?.revisionYear || "",
    type: c.type || (cv && cv.revisionType !== "Unknown" ? cv.revisionType : "Final"),
    fileName: r.file,
  };
}

/* ---------- ledger ---------- */

interface Ledger { [key: string]: { rowsHash: string; at: string; rows: number } }

function loadLedger(file: string): Ledger {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as Ledger;
  } catch {
    return {};
  }
}

function saveLedger(file: string, l: Ledger): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file + ".tmp", JSON.stringify(l, null, 1));
  fs.renameSync(file + ".tmp", file);
}

function rowsHash(voters: DashboardVoter[], parts: DashboardPart[]): string {
  return createHash("sha256").update(JSON.stringify([voters, parts])).digest("hex").slice(0, 24);
}

/* ---------- HTTP ---------- */

async function post(cfg: PushConfig, body: Record<string, unknown>, log: Logger, what: string): Promise<Record<string, unknown>> {
  let lastErr = "";
  for (let attempt = 0; attempt <= cfg.retries; attempt++) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), cfg.timeoutMs);
    try {
      const res = await fetch(`${cfg.url}/api/eroll/upload`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.token}` },
        body: JSON.stringify(body),
        signal: ctl.signal,
      });
      const text = await res.text();
      let json: Record<string, unknown> = {};
      try {
        json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
      } catch {
        json = { raw: text.slice(0, 200) };
      }
      if (res.ok) return json;
      const msg = `${res.status} ${String(json.error ?? json.raw ?? res.statusText)}`;
      // Auth / validation errors will not fix themselves; server errors and rate limits may.
      if (res.status === 401 || res.status === 403 || res.status === 400 || res.status === 413 || /^404 Upload session not found/.test(msg)) throw new Error(`${what}: ${msg}`);
      lastErr = msg;
    } catch (e) {
      if (e instanceof Error && /^(?:begin|begin-part|parts|chunk|finish)/.test(e.message)) throw e;
      lastErr = errMsg(e);
    } finally {
      clearTimeout(timer);
    }
    if (attempt < cfg.retries) {
      const wait = Math.min(30_000, 1000 * 2 ** attempt);
      log.warn("push", `${what}: ${lastErr}; retry ${attempt + 1}/${cfg.retries} in ${wait / 1000}s`);
      await sleep(wait);
    }
  }
  throw new Error(`${what}: ${lastErr}`);
}

export interface PushOutcome { pushed: boolean; rows: number; reason: string }

/** Wait time for one PDF's queued finish; OCR_PUSH_QUEUE_WAIT_S overrides (default 20 min). */
const QUEUE_WAIT_MS = (Number(process.env.OCR_PUSH_QUEUE_WAIT_S) || 1200) * 1000;
const QUEUE_POLL_MS = 15_000;

/** Polls "status" until the dashboard's queue has finished this upload. Throws when it does not. */
async function awaitQueuedFinish(cfg: PushConfig, meta: DashboardMeta, uploadId: string, log: Logger, label: string): Promise<Record<string, unknown>> {
  const t0 = Date.now();
  log.info("push", `${label}: rows received; waiting for the dashboard's queue to finish them`);
  for (;;) {
    if (Date.now() - t0 > QUEUE_WAIT_MS) throw new Error(`finish: still queued on the dashboard after ${Math.round((Date.now() - t0) / 1000)}s (upload ${uploadId}); it keeps working on it`);
    await sleep(QUEUE_POLL_MS);
    let st: Record<string, unknown>;
    try {
      st = await post(cfg, { phase: "status", ...meta, uploadId }, log, "status");
    } catch (e) {
      if (/\b404 Upload session not found/.test(errMsg(e))) throw new Error(`finish: ${errMsg(e)}`);
      log.warn("push", `${label}: ${errMsg(e)}`);
      continue;
    }
    if (st.state === "done") {
      if (!st.upload) throw new Error(`finish: the dashboard finished with no roll: ${String(st.outcome ?? "")}`);
      log.info("push", `${label}: finished by the queue after ${Math.round((Date.now() - t0) / 1000)}s`);
      return st;
    }
    if (st.state !== "finishing") throw new Error(`finish: upload ${String(st.state)}: ${String(st.outcome ?? "")}`);
  }
}

/**
 * Pushes one PDF's merged rows. Never throws: a failure is logged and reported so the CSV run
 * goes on (the rows are still on disk; the next run retries, since the ledger is only written
 * after "finish").
 */
export async function pushPdf(cfg: PushConfig, c: ConstituencyInfo, r: PdfResult, rows: OutputRow[], log: Logger): Promise<PushOutcome> {
  const meta = dashboardMeta(c, r);
  const source = sourceOf(r, c);
  const partNo = r.partNo || rows[0]?.Part_no || "";
  const label = `${r.file} (part ${partNo || "?"}, ${source})`;
  if (!meta.stateName || !meta.acNo || !meta.acName || !/^\d{4}$/.test(meta.year)) {
    return { pushed: false, rows: 0, reason: `${label}: state / AC / year unknown (folder name or cover) - not pushed` };
  }
  if (!partNo) return { pushed: false, rows: 0, reason: `${label}: part number unknown - not pushed` };
  if (rows.length === 0) return { pushed: false, rows: 0, reason: `${label}: no rows - not pushed` };
  const voters = toDashboardVoters(rows, source);
  const parts = source === "main" ? toDashboardParts(rows, r) : toDashboardParts(rows, r).map((p) => ({ partNo: p.partNo, sections: p.sections } as DashboardPart));
  const ledger = loadLedger(cfg.ledgerFile);
  const key = `${cfg.url}|${r.hash || r.file}|${partNo}|${source}`;
  const h = rowsHash(voters, parts);
  if (!cfg.force && ledger[key]?.rowsHash === h) return { pushed: false, rows: rows.length, reason: `${label}: already pushed (unchanged) - skipped` };

  const t0 = Date.now();
  try {
    // Naming the upload keeps a retried finish from being matched to another part's upload.
    const begun = await post(cfg, { phase: "begin-part", ...meta, partNo, source }, log, "begin-part");
    const id = typeof begun.uploadId === "string" ? { uploadId: begun.uploadId } : {};
    if (parts.some((p) => p.sections.length || Object.values(p).some((v) => typeof v === "string" && v && v !== p.partNo))) {
      await post(cfg, { phase: "parts", ...meta, ...id, parts }, log, "parts");
    }
    for (let i = 0; i < voters.length; i += cfg.batchRows) {
      const batch = voters.slice(i, i + cfg.batchRows);
      await post(cfg, { phase: "chunk", ...meta, ...id, voters: batch }, log, `chunk ${i / cfg.batchRows + 1}`);
    }
    let fin: Record<string, unknown>;
    try {
      fin = await post(cfg, { phase: "finish", ...meta, ...id }, log, "finish");
    } catch (e) {
      // The dashboard has the rows and finishes them from its queue: wait for that, rather than
      // calling the part failed and sending it all again on the next run.
      if (!id.uploadId || !/\b409 The rows are received/.test(errMsg(e))) throw e;
      fin = await awaitQueuedFinish(cfg, meta, id.uploadId, log, label);
    }
    const up = (fin.upload ?? {}) as Record<string, unknown>;
    ledger[key] = { rowsHash: h, at: new Date().toISOString(), rows: rows.length };
    saveLedger(cfg.ledgerFile, ledger);
    log.info("push", `${label}: ${rows.length} rows -> ${cfg.url} (${meta.stateName} / AC ${meta.acNo} ${meta.acName} / ${meta.year} ${meta.type}; roll now ${String(up.rowCount ?? "?")} voters, ${String(up.deletedCount ?? 0)} deleted) in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    return { pushed: true, rows: rows.length, reason: "" };
  } catch (e) {
    const reason = `${label}: push failed - ${errMsg(e)}`;
    log.error("push", reason);
    return { pushed: false, rows: rows.length, reason };
  }
}

/* ---------- whole folder as one upload ---------- */

export interface RollItem { result: PdfResult; rows: OutputRow[] }

export interface RollOutcome { ok: boolean; pushed: number; skipped: number; reason: string }

const PART_BATCH = 500;

/** One part record per part number across the PDFs: the main roll's cover first, section lists unioned. */
export function mergeRollParts(lists: { source: string; parts: DashboardPart[] }[]): DashboardPart[] {
  const byPart = new Map<string, DashboardPart>();
  for (const { parts } of [...lists].sort((a, b) => Number(b.source === "main") - Number(a.source === "main"))) {
    for (const p of parts) {
      const have = byPart.get(p.partNo);
      if (!have) byPart.set(p.partNo, { ...p, sections: [...p.sections] });
      else for (const s of p.sections) if (!have.sections.some((x) => x.no === s.no)) have.sections.push(s);
    }
  }
  for (const p of byPart.values()) p.sections.sort((a, b) => Number(a.no) - Number(b.no));
  return [...byPart.values()];
}

async function queueSupported(cfg: PushConfig, meta: DashboardMeta): Promise<boolean> {
  try {
    await post(cfg, { phase: "status", ...meta, uploadId: "probe" }, { warn: () => {} } as unknown as Logger, "status");
    return true;
  } catch (e) {
    // A dashboard with the queue does not know this upload (404); an older one does not know the phase.
    const msg = errMsg(e);
    if (/\b404 Upload session not found/.test(msg)) return true;
    if (/Unknown phase/.test(msg)) return false;
    throw e;
  }
}

/**
 * Replaces a whole roll with the folder's PDFs in one upload. The dashboard receives every row,
 * checks the count, and does the swap from its queue; this waits for it. Never throws. Everything
 * the roll holds that is not in `items` goes, so the caller passes the complete folder.
 */
export async function pushRoll(cfg: PushConfig, c: ConstituencyInfo, items: RollItem[], log: Logger, o: { pollMs?: number; waitMs?: number } = {}): Promise<RollOutcome> {
  const fail = (reason: string): RollOutcome => {
    log.error("push", `whole-roll push failed - ${reason}`);
    return { ok: false, pushed: 0, skipped: 0, reason };
  };
  if (!items.length) return fail("no PDFs");

  const prepared = items.map(({ result: r, rows }) => {
    const meta = dashboardMeta(c, r);
    const source = sourceOf(r, c);
    const partNo = r.partNo || rows[0]?.Part_no || "";
    const voters = toDashboardVoters(rows, source);
    const parts = source === "main" ? toDashboardParts(rows, r) : toDashboardParts(rows, r).map((p) => ({ partNo: p.partNo, sections: p.sections } as DashboardPart));
    return { r, meta, source, partNo, voters, parts };
  });
  const meta = prepared[0].meta;
  if (!meta.stateName || !meta.acNo || !meta.acName || !/^\d{4}$/.test(meta.year)) return fail("state / AC / year unknown (folder name or cover)");
  const seat = (m: DashboardMeta) => `${m.stateName}|${m.acNo}|${m.year}|${m.type}`;
  const other = prepared.find((p) => seat(p.meta) !== seat(meta));
  if (other) return fail(`${other.r.file} belongs to ${seat(other.meta)}, not ${seat(meta)}`);
  const empty = prepared.find((p) => !p.partNo || !p.voters.length);
  if (empty) return fail(`${empty.r.file}: ${empty.partNo ? "no rows" : "part number unknown"}`);
  const seen = new Set<string>();
  for (const p of prepared) {
    const k = `${p.partNo}|${p.source}`;
    if (seen.has(k)) return fail(`two PDFs are part ${p.partNo} (${p.source})`);
    seen.add(k);
  }

  const ledger = loadLedger(cfg.ledgerFile);
  const entries = prepared.map((p) => ({ key: `${cfg.url}|${p.r.hash || p.r.file}|${p.partNo}|${p.source}`, hash: rowsHash(p.voters, p.parts), rows: p.voters.length }));
  if (!cfg.force && entries.every((e) => ledger[e.key]?.rowsHash === e.hash)) return { ok: true, pushed: 0, skipped: items.length, reason: "" };

  // Rows are stored in the order sent, which is the roll order the dashboard pages through.
  prepared.sort((a, b) => Number(a.partNo) - Number(b.partNo) || a.source.localeCompare(b.source));
  const voters = prepared.flatMap((p) => p.voters);
  const parts = mergeRollParts(prepared);
  const t0 = Date.now();
  const secs = () => ((Date.now() - t0) / 1000).toFixed(0);
  try {
    if (!(await queueSupported(cfg, meta))) return fail("this dashboard has no upload queue yet; push without --push-bulk");
    const begun = await post(cfg, { phase: "begin", ...meta }, log, "begin");
    const uploadId = String(begun.uploadId ?? "");
    if (!uploadId) return fail("begin returned no uploadId");
    for (let i = 0; i < parts.length; i += PART_BATCH) await post(cfg, { phase: "parts", ...meta, uploadId, parts: parts.slice(i, i + PART_BATCH) }, log, "parts");
    const chunks = Math.ceil(voters.length / cfg.batchRows);
    for (let i = 0; i < chunks; i++) {
      await post(cfg, { phase: "chunk", ...meta, uploadId, voters: voters.slice(i * cfg.batchRows, (i + 1) * cfg.batchRows) }, log, `chunk ${i + 1}`);
      if ((i + 1) % 10 === 0 || i + 1 === chunks) log.info("push", `sent ${i + 1}/${chunks} batches (${secs()}s)`);
    }
    let fin = await post(cfg, { phase: "finish", ...meta, uploadId, queue: true, expectRows: voters.length }, log, "finish");
    log.info("push", `${voters.length} rows of ${parts.length} parts received; the dashboard is finishing the upload`);
    const until = Date.now() + (o.waitMs ?? 90 * 60_000);
    let last = "";
    while (!fin.upload) {
      if (Date.now() > until) return fail(`still not finished after ${secs()}s (upload ${uploadId}); the dashboard keeps working on it`);
      await sleep(o.pollMs ?? 10_000);
      try {
        const st = await post(cfg, { phase: "status", ...meta, uploadId }, log, "status");
        if (st.state === "done") {
          if (!st.upload) return fail(`the dashboard finished with no roll: ${String(st.outcome ?? "")}`);
          fin = st;
        } else if (st.state !== "finishing") return fail(`upload ${String(st.state)}: ${String(st.outcome ?? "")}`);
        else if (st.error && st.error !== last) log.warn("push", `dashboard reports: ${(last = String(st.error))}`);
      } catch (e) {
        // The swap carries on whether or not this question got through.
        log.warn("push", errMsg(e));
      }
    }
    const up = fin.upload as Record<string, unknown>;
    const now = new Date().toISOString();
    const saved = loadLedger(cfg.ledgerFile);
    for (const e of entries) saved[e.key] = { rowsHash: e.hash, at: now, rows: e.rows };
    saveLedger(cfg.ledgerFile, saved);
    log.info("push", `whole roll: ${items.length} PDFs, ${voters.length} rows -> ${cfg.url} (${meta.stateName} / AC ${meta.acNo} ${meta.acName} / ${meta.year} ${meta.type}; roll now ${String(up.rowCount ?? "?")} voters, ${String(up.deletedCount ?? 0)} deleted) in ${secs()}s`);
    return { ok: true, pushed: items.length, skipped: 0, reason: "" };
  } catch (e) {
    return fail(errMsg(e));
  }
}
