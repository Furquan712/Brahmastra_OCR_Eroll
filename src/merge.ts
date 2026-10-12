import type { Config } from "./config.js";
import type { Logger } from "./logger.js";
import type { Template } from "./templates.js";
import type { ConstituencyInfo, OutputRow, PageResult, PdfResult } from "./types.js";
import { VOTER_PAGE_TYPES } from "./types.js";
import { cardFlags } from "./validate.js";

export interface MergeStats {
  rowsIn: number;
  rowsOut: number;
  duplicatesReplaced: number;
  flagged: number;
  flagCounts: Record<string, number>;
  warnings: string[];
}

export interface MergeOutput {
  rows: OutputRow[];
  stats: MergeStats;
}

function num(s: string): string {
  return s.replace(/\D/g, "");
}

/** Compare the folder-name metadata with what was OCR'd off the cover page; returns warnings. */
export function crossCheckCover(c: ConstituencyInfo, r: PdfResult): string[] {
  const w: string[] = [];
  const cv = r.cover;
  if (!cv) return [`${r.file}: no cover page info extracted; cannot cross-check folder name`];
  if (c.parsed) {
    if (cv.acNo && num(cv.acNo) !== num(c.acNo)) w.push(`${r.file}: cover AC no "${cv.acNo}" != folder AC no "${c.acNo}"`);
    if (cv.revisionYear && cv.revisionYear !== c.year) w.push(`${r.file}: cover year "${cv.revisionYear}" != folder year "${c.year}"`);
    if (cv.revisionType !== "Unknown" && cv.revisionType !== c.type) w.push(`${r.file}: cover revision type "${cv.revisionType}" != folder type "${c.type}"`);
    const fs = c.state.toLowerCase().replace(/[^a-z]/g, "");
    const cs = cv.stateEn.toLowerCase().replace(/[^a-z]/g, "");
    if (cs && fs && cs !== fs) w.push(`${r.file}: cover state "${cv.stateEn}" != folder state "${c.state}"`);
  }
  if (!cv.psNameHi) w.push(`${r.file}: polling station name not read from cover`);
  return w;
}

/**
 * Flattens all PDFs' cards into CSV rows, in read order (PDFs as given, pages ascending,
 * cards in reading order). Rows with the same EPIC: the LATER-read row replaces the
 * earlier one (same rule as the XLSX upload path); the earlier slot is kept so the
 * order stays stable. Rows with no EPIC are never deduped.
 */
export function mergeResults(
  results: PdfResult[], c: ConstituencyInfo, tpl: Template, cfg: Config, log: Logger,
): MergeOutput {
  const rows: OutputRow[] = [];
  const byEpic = new Map<string, number>();
  const stats: MergeStats = { rowsIn: 0, rowsOut: 0, duplicatesReplaced: 0, flagged: 0, flagCounts: {}, warnings: [] };

  for (const r of results) {
    if (r.status !== "ok") continue;
    stats.warnings.push(...crossCheckCover(c, r));
    const cover = r.cover;
    const psEn = cover?.psNameEn ?? "";
    const psHi = cover?.psNameHi ?? "";
    const pdfPart = r.partNo;
    let prevSerial: number | null = null;
    let prevSection: PageResult["section"] | null = null;
    let mainCount = 0;

    for (const pg of r.pages) {
      if (!VOTER_PAGE_TYPES.has(pg.pageType)) continue;
      if (pg.section !== prevSection) {
        prevSerial = null; // serial continuity restarts per section
        prevSection = pg.section;
      }
      const pagePart = pg.partNo || pdfPart;
      const partNoMismatch = Boolean(pg.partNo && pdfPart && pg.partNo !== pdfPart);
      if (partNoMismatch) stats.warnings.push(`${r.file} p${pg.page}: page part no ${pg.partNo} != cover part no ${pdfPart}`);
      const rawEpics = pg.rawEpics ?? [];
      for (const [i, card] of pg.cards.entries()) {
        stats.rowsIn++;
        if (pg.section === "main") mainCount++;
        const flags = cardFlags({
          card, rawEpic: rawEpics[i] ?? card.epicNo, tpl,
          confidenceThreshold: cfg.confidenceThreshold,
          prevSerial, partNoMismatch, partNoMissing: !pagePart,
        });
        if (card.serial !== null) prevSerial = card.serial;
        for (const f of card.extraFlags ?? []) if (!flags.includes(f)) flags.push(f);
        const row: OutputRow = {
          PS_name_eg: psEn,
          PS_name_hi: psHi,
          Part_no: pagePart,
          Epic_no: card.epicNo,
          Name_eg: card.nameEn,
          Name_hi: card.nameHi,
          Relation_type_eg: card.relationType,
          Relation_type_hi: card.relationTypeHi,
          Relation_name_eg: card.relationNameEn,
          Relation_name_hi: card.relationNameHi,
          house_no: card.houseNo,
          age: card.age === null ? "" : String(card.age),
          Gender_eg: card.genderEn,
          Gender_hi: card.genderHi,
          _source_pdf: r.file,
          _page: String(pg.page),
          _serial: card.serial === null ? "" : String(card.serial),
          _section: pg.section,
          _ocr_confidence: card.confidence.toFixed(2),
          _ocr_engine: card.engine ? (card.engine === "llm" && card.escalated?.length ? `llm(${card.escalated.join("|")})` : card.engine) : "llm",
          _flag_reason: flags.join(";"),
        };
        const key = card.epicNo;
        if (key && byEpic.has(key)) {
          const idx = byEpic.get(key)!;
          const prev = rows[idx];
          stats.duplicatesReplaced++;
          const f = new Set(row._flag_reason ? row._flag_reason.split(";") : []);
          f.add("dup_epic_replaced_earlier");
          row._flag_reason = [...f].join(";");
          log.debug("merge", `EPIC ${key}: ${prev._source_pdf} p${prev._page} #${prev._serial} replaced by ${row._source_pdf} p${row._page} #${row._serial}`);
          rows[idx] = row;
        } else {
          if (key) byEpic.set(key, rows.length);
          rows.push(row);
        }
      }
    }
    if (cover?.serialTo && mainCount && cover.serialTo !== mainCount) {
      stats.warnings.push(`${r.file}: main roll has ${mainCount} cards but cover says last serial is ${cover.serialTo}`);
    }
  }

  for (const row of rows) {
    if (row._flag_reason) {
      stats.flagged++;
      for (const f of row._flag_reason.split(";")) stats.flagCounts[f] = (stats.flagCounts[f] ?? 0) + 1;
    }
  }
  stats.rowsOut = rows.length;
  return { rows, stats };
}
