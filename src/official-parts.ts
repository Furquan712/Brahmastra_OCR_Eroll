/**
 * Official polling-station names from the ECI portal's part list (data/parts/<STATE>-<AC>.json,
 * written by ../eci_parts.py). The cover prints the station name in Hindi and the pipeline
 * transliterates it; when the portal's English name for the part is on file it wins, so the
 * dashboard shows "I.T.I. BHAWAN SECTOR-11 NOIDA ROOM NO 1" rather than a transliteration guess.
 *
 * A list that is not on file is fetched from the portal before a folder is OCR'd (ensureOfficialParts);
 * its public list endpoints work from the servers too, only the PDF CDN blocks them. If the portal
 * cannot be reached the run goes on with the names read off the covers.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CoverInfo } from "./types.js";
import type { Logger } from "./logger.js";

export const PARTS_DIR = process.env.OCR_PARTS_DIR
  ? path.resolve(process.env.OCR_PARTS_DIR)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "data", "parts");

const GATEWAY = "https://gateway-voters.eci.gov.in/api/v1";
const GATEWAY_HEADERS = {
  "Content-Type": "application/json",
  applicationName: "VSP",
  Origin: "https://voters.eci.gov.in",
  Referer: "https://voters.eci.gov.in/",
  "User-Agent": "Mozilla/5.0 (eroll-ocr part-list fetcher)",
};
/** After a failed fetch, wait this long before asking the portal again (a watcher runs for days). */
const RETRY_AFTER_MS = 10 * 60 * 1000;

interface PartsFile { acName?: string; districtCd?: string; count: number; maxPart: number; parts: { partNumber: number; partName: string }[] }

// Only lists that were found are remembered: a watcher has to notice a list that arrives later.
const loaded = new Map<string, Map<string, string>>();
const failedAt = new Map<string, number>();

function partsId(stateCode: string, acNo: string): string | null {
  if (!stateCode || !acNo || !Number(acNo)) return null;
  return `${stateCode.toUpperCase()}-${Number(acNo)}`;
}

function readFile(id: string): PartsFile | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(PARTS_DIR, `${id}.json`), "utf8")) as PartsFile;
  } catch {
    return null;
  }
}

function table(stateCode: string, acNo: string): Map<string, string> | null {
  const id = partsId(stateCode, acNo);
  if (!id) return null;
  const hit = loaded.get(id);
  if (hit) return hit;
  const f = readFile(id);
  if (!f) return null;
  const t = new Map(f.parts.filter((p) => p.partName).map((p) => [String(p.partNumber), p.partName.replace(/\s+/g, " ").trim()]));
  loaded.set(id, t);
  return t;
}

async function gateway<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(`${GATEWAY}${url}`, {
    method: body ? "POST" : "GET",
    headers: GATEWAY_HEADERS,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

// AC number -> district, per state. One scan of a state answers for all of its ACs.
const directory = new Map<string, Map<number, { districtCd: string; acName: string }>>();

/** The portal's record of an AC. `hint` is the district on file, which saves scanning the state. */
async function findAc(state: string, ac: number, hint?: string): Promise<{ districtCd: string; acName: string } | null> {
  const dir = directory.get(state) ?? new Map<number, { districtCd: string; acName: string }>();
  directory.set(state, dir);
  const add = async (districtCd: string) => {
    for (const a of await gateway<{ asmblyNo: number; asmblyName: string }[]>(`/common/acs/${districtCd}`)) {
      dir.set(Number(a.asmblyNo), { districtCd, acName: a.asmblyName.trim() });
    }
  };
  if (!dir.has(ac) && hint) await add(hint);
  if (!dir.has(ac)) {
    const districts = await gateway<{ districtCd: string }[]>(`/common/districts/${state}`);
    for (let i = 0; i < districts.length; i += 8) await Promise.all(districts.slice(i, i + 8).map((d) => add(d.districtCd)));
  }
  return dir.get(ac) ?? null;
}

/** Downloads the AC's part list from the portal and writes data/parts/<STATE>-<AC>.json. */
async function fetchPartsFile(state: string, ac: number, id: string, hint?: string): Promise<PartsFile> {
  const hit = await findAc(state, ac, hint);
  if (!hit) throw new Error(`AC ${ac} is not in any district of ${state}`);
  const list = await gateway<{ payload?: { partNumber: number | string; partName?: string; partId?: unknown }[] }>(
    "/printing-publish/get-part-list", { stateCd: state, districtCd: hit.districtCd, acNumber: ac });
  const parts = (list.payload ?? [])
    .map((p) => ({ partNumber: Number(p.partNumber), partName: (p.partName ?? "").trim(), partId: p.partId }))
    .sort((a, b) => a.partNumber - b.partNumber);
  if (!parts.length) throw new Error(`portal listed no parts for ${id}`);
  const nums = new Set(parts.map((p) => p.partNumber));
  const maxPart = parts[parts.length - 1].partNumber;
  const gaps = Array.from({ length: maxPart }, (_, i) => i + 1).filter((n) => !nums.has(n));
  const file = {
    stateCd: state, districtCd: hit.districtCd, acNumber: ac, acName: hit.acName,
    fetchedAt: new Date().toISOString(), source: `${GATEWAY}/printing-publish/get-part-list`,
    count: parts.length, maxPart, gaps, parts,
  };
  fs.mkdirSync(PARTS_DIR, { recursive: true });
  const out = path.join(PARTS_DIR, `${id}.json`);
  const tmp = `${out}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(file, null, 1), "utf8");
  fs.renameSync(tmp, out);
  return file;
}

/**
 * Makes sure the AC's official list is on file, fetching it when it is missing or predates the
 * acName field. Never throws: returns what is on file (possibly nothing) when the portal fails.
 */
export async function ensureOfficialParts(stateCode: string, acNo: string, log: Logger): Promise<PartsFile | null> {
  const id = partsId(stateCode, acNo);
  if (!id) return null;
  const onFile = readFile(id);
  if (onFile?.acName) return onFile;
  const last = failedAt.get(id);
  if (last !== undefined && Date.now() - last < RETRY_AFTER_MS) return onFile;
  try {
    const f = await fetchPartsFile(stateCode.toUpperCase(), Number(acNo), id, onFile?.districtCd);
    loaded.delete(id);
    failedAt.delete(id);
    const unnamed = f.parts.filter((p) => !p.partName).length;
    log.info("parts", `${id}: official list fetched from the ECI portal: ${f.acName}, ${f.count} parts${unnamed ? `, ${unnamed} without a name` : ""}`);
    return f;
  } catch (e) {
    failedAt.set(id, Date.now());
    log.warn("parts", `${id}: could not fetch the official part list (${e instanceof Error ? e.message : String(e)}); using ${onFile ? "the list on file" : "names read off the covers"}`);
    return onFile;
  }
}

function editDistance(a: string, b: string): number {
  let row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    row = next;
  }
  return row[b.length];
}

/** Do two spellings name the same AC? Reservation suffixes and punctuation aside, and allowing for
 *  transliteration ("Goverdhan" / "Govardhan", "Bishwavnathganj" / "Vishwanath Ganj"): at least 80%
 *  of the letters must agree, which still tells "Agra North" from "Agra South". Keep in step with
 *  same_ac_name in ../eci_parts.py. */
export function sameAcName(a: string, b: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/\((sc|st)\)/g, "").replace(/[^a-z]/g, "");
  const x = norm(a), y = norm(b);
  if (!x || !y || x === y) return true;
  return 1 - editDistance(x, y) / Math.max(x.length, y.length) >= 0.8;
}

/** Official English name of a part, or null when no list is on file for the AC. */
export function officialPartName(stateCode: string, acNo: string, partNo: string): string | null {
  return table(stateCode, acNo)?.get(String(Number(partNo))) ?? null;
}

/** Number of parts the portal lists for the AC, or null. */
export function officialPartCount(stateCode: string, acNo: string): number | null {
  const t = table(stateCode, acNo);
  return t ? t.size : null;
}

/** Overwrites cover.psNameEn with the official name when one is on file. Returns true if applied. */
export function applyOfficialPartName(cover: CoverInfo | null, stateCode: string, log: Logger, file: string): boolean {
  if (!cover) return false;
  const name = officialPartName(stateCode, cover.acNo, cover.partNo);
  if (!name) return false;
  if (cover.psNameEn !== name) {
    log.debug("cover", `${file}: polling station "${cover.psNameEn || "(unread)"}" -> official "${name}"`);
    cover.psNameEn = name;
  }
  return true;
}
