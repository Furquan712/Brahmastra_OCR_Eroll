import type { Config } from "./config.js";
import type { Logger } from "./logger.js";
import type { Template } from "./templates.js";
import { DELETION_REASONS } from "./normalize.js";
import type { ActionStatus, ConstituencyInfo, CoverInfo, OutputRow, PageResult, PdfResult, VoterCard } from "./types.js";
import { VOTER_PAGE_TYPES } from "./types.js";
import { cardFlags } from "./validate.js";

/** What the list a card was printed in (and its DELETED stamp / serial marker) says about the voter. */
export function actionOf(section: PageResult["section"], card: VoterCard): { status: ActionStatus; reason: string } {
  const marker = (card.marker ?? "").toUpperCase();
  const reason = marker && marker !== "#" ? (DELETION_REASONS[marker] ?? "") : "";
  if (section === "deletion" || card.deleted) return { status: "deleted", reason };
  if (section === "modification") return { status: "modified", reason: "" };
  if (section === "supplement") return { status: "added", reason: "" };
  // "#" before a main-roll serial: modified as per a supplement (the footer legend "#/#1 Modified as per supplement").
  if (marker === "#") return { status: "modified", reason: "" };
  return { status: "existing", reason: "" };
}

/** A printed value split by script: Devanagari stays Hindi (+ English given), Latin is English only. */
function byScript(printed: string, en: string): { hi: string; eg: string } {
  if (!printed) return { hi: "", eg: en };
  return /[ऀ-ॿ]/.test(printed) ? { hi: printed, eg: en } : { hi: "", eg: en || printed };
}

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
    const latin = tpl.script === "latin";
    const sectionsByNo = new Map((cover?.sections ?? []).map((s) => [s.no, s]));
    const cv = (k: keyof CoverInfo): string => {
      const v = cover?.[k];
      return v === null || v === undefined ? "" : String(v);
    };
    // Repeated on every row so a CSV stays self-describing when rows are filtered or merged.
    const meta = {
      State: cv("stateEn") || c.state,
      AC_no: cv("acNo") || c.acNo,
      AC_name_eg: cv("acNameEn") || c.acName,
      AC_name_hi: cv("acNameHi"),
      Main_town_village_eg: cv("mainTownVillageEn"), Main_town_village_hi: cv("mainTownVillageHi"),
      Ward_eg: cv("wardEn"), Ward_hi: cv("wardHi"),
      Post_office_eg: cv("postOfficeEn"), Post_office_hi: cv("postOfficeHi"),
      Police_station_eg: cv("policeStationEn"), Police_station_hi: cv("policeStationHi"),
      Panchayat_eg: cv("panchayatEn"), Panchayat_hi: cv("panchayatHi"),
      Block_eg: cv("blockEn"), Block_hi: cv("blockHi"),
      Tehsil_eg: cv("tehsilEn"), Tehsil_hi: cv("tehsilHi"),
      District_eg: cv("districtEn"), District_hi: cv("districtHi"),
      Pin_code: cv("pinCode"),
      PS_address_eg: cv("psAddressEn"), PS_address_hi: cv("psAddressHi"),
      Roll_type: (cover && cover.revisionType !== "Unknown" ? cover.revisionType : "") || c.type,
      Roll_year: cv("revisionYear") || c.year,
    };
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
      // Deletion / modification lists print the voters' original serials: never consecutive.
      const consecutive = pg.section === "main" || pg.section === "supplement";
      const pageSupplement = pg.supplementNo || cover?.supplementNo || c.supplementNo || "";
      // Printed page number: trusted when it agrees with the PDF index or the printed total
      // matches the PDF's page count (so the footer read is known to be good); else the PDF index.
      const printed = pg.printedPage ?? null;
      const footerOk = printed !== null && printed > 0 && (printed === pg.page || pg.printedTotal === r.pageCount);
      const pageNo = footerOk ? printed! : pg.page;
      const pageNoMismatch = footerOk && printed !== pg.page;
      if (printed !== null && !footerOk) stats.warnings.push(`${r.file} p${pg.page}: footer page number ${printed} (of ${pg.printedTotal ?? "?"}) not trusted; Page_no uses the PDF page index`);
      for (const [i, card] of pg.cards.entries()) {
        stats.rowsIn++;
        if (pg.section === "main") mainCount++;
        const flags = cardFlags({
          card, rawEpic: rawEpics[i] ?? card.epicNo, tpl,
          confidenceThreshold: cfg.confidenceThreshold,
          prevSerial: consecutive ? prevSerial : null, partNoMismatch, partNoMissing: !pagePart,
        });
        if (card.serial !== null) prevSerial = card.serial;
        const action = actionOf(pg.section, card);
        // Section: the card's own box (supplement / deletion / modification cards) or the page
        // header (main roll); the name from the cover's list when the number is listed there.
        const sectionNo = pg.section === "main" ? (pg.sectionNo || "") : (card.sectionNo || pg.sectionNo || "");
        const listed = sectionNo ? sectionsByNo.get(sectionNo) : undefined;
        const sectionName = listed
          ? byScript(listed.name, listed.nameEn)
          : sectionNo && sectionNo === pg.sectionNo && pg.sectionName
            ? byScript(pg.sectionName, /[ऀ-ॿ]/.test(pg.sectionName) ? "" : pg.sectionName)
            : { hi: "", eg: "" };
        if (sectionName.hi && !sectionName.eg) sectionName.eg = ""; // Hindi header name without a cover entry: no English spelling
        for (const f of card.extraFlags ?? []) if (!flags.includes(f)) flags.push(f);
        if (pageNoMismatch) flags.push("page_no_mismatch");
        const row: OutputRow = {
          PS_name_eg: psEn,
          PS_name_hi: psHi,
          Part_no: pagePart,
          Epic_no: card.epicNo,
          Name_eg: card.nameEn,
          Name_hi: latin ? "" : card.nameHi,
          Relation_type_eg: card.relationType,
          Relation_type_hi: latin ? "" : card.relationTypeHi,
          Relation_name_eg: card.relationNameEn,
          Relation_name_hi: latin ? "" : card.relationNameHi,
          house_no: card.houseNo,
          age: card.age === null ? "" : String(card.age),
          Gender_eg: card.genderEn,
          Gender_hi: latin ? "" : card.genderHi,
          Serial_no: card.serial === null ? "" : String(card.serial),
          Page_no: String(pageNo),
          Action_status: action.status,
          Action_reason: action.reason,
          Section_no: sectionNo,
          Section_name_eg: sectionName.eg,
          Section_name_hi: sectionName.hi,
          Supplement_no: action.status === "existing" ? "" : (card.markerSupplementNo || pageSupplement),
          ...meta,
          _source_pdf: r.file,
          _page: String(pg.page),
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
          log.debug("merge", `EPIC ${key}: ${prev._source_pdf} p${prev._page} #${prev.Serial_no} replaced by ${row._source_pdf} p${row._page} #${row.Serial_no}`);
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
