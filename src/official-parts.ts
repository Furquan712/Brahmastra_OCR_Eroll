/**
 * Official polling-station names from the ECI portal's part list (data/parts/<STATE>-<AC>.json,
 * written by ../eci_parts.py). The cover prints the station name in Hindi and the pipeline
 * transliterates it; when the portal's English name for the part is on file it wins, so the
 * dashboard shows "I.T.I. BHAWAN SECTOR-11 NOIDA ROOM NO 1" rather than a transliteration guess.
 * Missing file = no change.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CoverInfo } from "./types.js";
import type { Logger } from "./logger.js";

export const PARTS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "data", "parts");

interface PartsFile { count: number; maxPart: number; parts: { partNumber: number; partName: string }[] }

const loaded = new Map<string, Map<string, string> | null>();

function table(stateCode: string, acNo: string): Map<string, string> | null {
  const id = `${stateCode.toUpperCase()}-${Number(acNo)}`;
  if (!stateCode || !acNo || !Number(acNo)) return null;
  if (loaded.has(id)) return loaded.get(id)!;
  let t: Map<string, string> | null = null;
  try {
    const f = JSON.parse(fs.readFileSync(path.join(PARTS_DIR, `${id}.json`), "utf8")) as PartsFile;
    t = new Map(f.parts.filter((p) => p.partName).map((p) => [String(p.partNumber), p.partName.replace(/\s+/g, " ").trim()]));
  } catch {
    t = null;
  }
  loaded.set(id, t);
  return t;
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
