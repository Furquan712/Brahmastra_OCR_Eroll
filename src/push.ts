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
      if (res.status === 401 || res.status === 403 || res.status === 400 || res.status === 413) throw new Error(`${what}: ${msg}`);
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
    await post(cfg, { phase: "begin-part", ...meta, partNo, source }, log, "begin-part");
    if (parts.some((p) => p.sections.length || Object.values(p).some((v) => typeof v === "string" && v && v !== p.partNo))) {
      await post(cfg, { phase: "parts", ...meta, parts }, log, "parts");
    }
    for (let i = 0; i < voters.length; i += cfg.batchRows) {
      const batch = voters.slice(i, i + cfg.batchRows);
      await post(cfg, { phase: "chunk", ...meta, voters: batch }, log, `chunk ${i / cfg.batchRows + 1}`);
    }
    const fin = await post(cfg, { phase: "finish", ...meta }, log, "finish");
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
