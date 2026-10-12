import fs from "node:fs";
import { CSV_COLUMNS, type OutputRow } from "./types.js";

export function csvEscape(v: string): string {
  if (v === "") return "";
  // Quote when the value contains a delimiter, quote, newline, or leading/trailing space.
  if (/[",\r\n]/.test(v) || v !== v.trim()) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

export function rowToCsv(row: OutputRow): string {
  return CSV_COLUMNS.map((c) => csvEscape(row[c] ?? "")).join(",");
}

export function csvHeader(): string {
  return CSV_COLUMNS.join(",");
}

/** Writes UTF-8 CSV (optionally with BOM for Excel). Atomic via temp file + rename. */
export function writeCsv(file: string, rows: OutputRow[], opts: { bom?: boolean } = {}): void {
  const lines = [csvHeader(), ...rows.map(rowToCsv)];
  const body = (opts.bom ? "﻿" : "") + lines.join("\n") + "\n";
  fs.writeFileSync(file + ".tmp", body, { encoding: "utf8" });
  fs.renameSync(file + ".tmp", file);
}
