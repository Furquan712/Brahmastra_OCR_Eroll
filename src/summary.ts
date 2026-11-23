import fs from "node:fs";
import type { MergeStats } from "./merge.js";
import type { ConstituencyInfo, PdfResult } from "./types.js";
import { fmtDuration } from "./util.js";

export interface RunSummary {
  constituency: ConstituencyInfo;
  csvFile: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  provider: string;
  model: string;
  template: string;
  pdfs: { total: number; ok: number; cached: number; failed: number };
  pages: number;
  pagesPerSec: number;
  rows: number;
  rowsBeforeDedupe: number;
  duplicatesReplaced: number;
  flaggedRows: number;
  flagCounts: Record<string, number>;
  usage: { calls: number; inputTokens: number; outputTokens: number };
  failures: { file: string; error: string }[];
  warnings: string[];
  perPdf: { file: string; status: string; partNo: string; pages: number; cards: number; psNameHi: string; serialTo: number | null }[];
}

export function buildSummary(
  c: ConstituencyInfo, csvFile: string, results: PdfResult[], cachedFiles: Set<string>, stats: MergeStats,
  startedAt: Date, meta: { provider: string; model: string; template: string },
): RunSummary {
  const finished = new Date();
  const ok = results.filter((r) => r.status === "ok");
  const failed = results.filter((r) => r.status !== "ok");
  const freshPages = ok.filter((r) => !cachedFiles.has(r.file)).reduce((n, r) => n + r.pages.length, 0);
  const usage = results.reduce(
    (u, r) => ({ calls: u.calls + r.usage.calls, inputTokens: u.inputTokens + r.usage.inputTokens, outputTokens: u.outputTokens + r.usage.outputTokens }),
    { calls: 0, inputTokens: 0, outputTokens: 0 },
  );
  const durationMs = finished.getTime() - startedAt.getTime();
  const pageWarnings = ok.flatMap((r) => r.pages.flatMap((p) => p.warnings.map((w) => `${r.file} p${p.page}: ${w}`)));
  return {
    constituency: c,
    csvFile,
    startedAt: startedAt.toISOString(),
    finishedAt: finished.toISOString(),
    durationMs,
    ...meta,
    pdfs: { total: results.length, ok: ok.length, cached: cachedFiles.size, failed: failed.length },
    pages: ok.reduce((n, r) => n + r.pages.length, 0),
    pagesPerSec: freshPages ? Number((freshPages / (durationMs / 1000)).toFixed(3)) : 0,
    rows: stats.rowsOut,
    rowsBeforeDedupe: stats.rowsIn,
    duplicatesReplaced: stats.duplicatesReplaced,
    flaggedRows: stats.flagged,
    flagCounts: stats.flagCounts,
    usage,
    failures: failed.map((r) => ({ file: r.file, error: r.error ?? "unknown" })),
    warnings: [...stats.warnings, ...pageWarnings],
    perPdf: results.map((r) => ({
      file: r.file, status: r.status, partNo: r.partNo, pages: r.pages.length,
      cards: r.pages.reduce((n, p) => n + p.cards.length, 0), psNameHi: r.cover?.psNameHi ?? "",
      serialTo: r.cover?.serialTo ?? null,
    })),
  };
}

export function summaryText(s: RunSummary): string {
  const L: string[] = [];
  L.push(`eRoll OCR summary - ${s.constituency.state} / ${s.constituency.acNo}-${s.constituency.acName}-${s.constituency.year}-${s.constituency.type}`);
  L.push(`CSVs (one per part): ${s.csvFile}`);
  L.push(`Run: ${s.startedAt} -> ${s.finishedAt} (${fmtDuration(s.durationMs)}), ${s.provider}/${s.model}, template ${s.template}`);
  L.push(`PDFs: ${s.pdfs.total} total, ${s.pdfs.ok} ok (${s.pdfs.cached} from cache), ${s.pdfs.failed} failed`);
  L.push(`Pages: ${s.pages}, throughput ${s.pagesPerSec} pages/s (freshly OCR'd pages only)`);
  L.push(`Rows: ${s.rows} written (${s.rowsBeforeDedupe} read, ${s.duplicatesReplaced} duplicate EPICs replaced by later rows)`);
  L.push(`Flagged rows: ${s.flaggedRows}`);
  for (const [k, v] of Object.entries(s.flagCounts).sort((a, b) => b[1] - a[1])) L.push(`  ${k}: ${v}`);
  L.push(`Model calls: ${s.usage.calls}, tokens in/out: ${s.usage.inputTokens}/${s.usage.outputTokens}`);
  L.push("");
  L.push("Per PDF:");
  for (const p of s.perPdf) L.push(`  ${p.status.padEnd(6)} part ${p.partNo || "?"}  ${String(p.cards).padStart(5)} cards  ${String(p.pages).padStart(3)} pages  ${p.file}  ${p.psNameHi}`);
  if (s.failures.length) {
    L.push("");
    L.push("FAILURES:");
    for (const f of s.failures) L.push(`  ${f.file}: ${f.error}`);
  }
  if (s.warnings.length) {
    L.push("");
    L.push(`Warnings (${s.warnings.length}):`);
    for (const w of s.warnings.slice(0, 200)) L.push(`  ${w}`);
    if (s.warnings.length > 200) L.push(`  ... ${s.warnings.length - 200} more in the log`);
  }
  return L.join("\n") + "\n";
}

export function writeSummary(base: string, s: RunSummary): void {
  fs.writeFileSync(`${base}.summary.json`, JSON.stringify(s, null, 2));
  fs.writeFileSync(`${base}.summary.txt`, summaryText(s));
}
