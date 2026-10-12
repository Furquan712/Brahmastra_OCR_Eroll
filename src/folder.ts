import path from "node:path";
import type { ConstituencyInfo } from "./types.js";

/** Parses "<AC No>-<AC Name>-<Year>-<Draft|Final>" with the parent dir as the state. */
export function parseConstituencyFolder(folder: string): ConstituencyInfo {
  const abs = path.resolve(folder);
  const name = path.basename(abs);
  const state = path.basename(path.dirname(abs));
  const m = /^(\d+)-(.+?)-(\d{4})-(Draft|Final)$/i.exec(name);
  if (!m) {
    return { folder: abs, state, acNo: "", acName: name, year: "", type: "", parsed: false };
  }
  const type = m[4].toLowerCase() === "draft" ? "Draft" : "Final";
  return { folder: abs, state, acNo: m[1], acName: m[2].trim(), year: m[3], type, parsed: true };
}

export function outputCsvName(c: ConstituencyInfo): string {
  if (!c.parsed) return `${c.state}-${c.acName}.csv`;
  return `${c.state}-${c.acNo}-${c.acName}-${c.year}-${c.type}.csv`;
}

/** Per-constituency output directory: <out>/<State>/<AC No>-<AC Name>-<Year>. */
export function outputDirName(c: ConstituencyInfo): string {
  if (!c.parsed) return c.acName;
  return `${c.acNo}-${c.acName}-${c.year}`;
}

/** Characters that are unsafe in file names on common file systems. */
function safe(s: string): string {
  return s.replace(/[\\/:*?"<>|]/g, "_").trim();
}

/**
 * Per-part CSV name: <State>-<AC No>-<AC Name>-<Year>-<Draft|Final><part no>.csv
 * (the part number follows the revision type directly, exactly as specified).
 */
export function partCsvName(c: ConstituencyInfo, partNo: string): string {
  const part = safe(partNo) || "unknown";
  if (!c.parsed) return `${safe(c.state)}-${safe(c.acName)}${part}.csv`;
  return `${safe(c.state)}-${c.acNo}-${safe(c.acName)}-${c.year}-${c.type}${part}.csv`;
}
