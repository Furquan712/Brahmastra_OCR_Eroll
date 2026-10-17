import fs from "node:fs";
import path from "node:path";
import { RESULT_SCHEMA_VERSION, type ResultCache } from "./cache.js";
import type { Config } from "./config.js";
import { correctNames } from "./consensus.js";
import { applyCoverMeta, buildCover, COVER_SCHEMA, CoverModelZ, coverPrompt, parseCoverText, parseErollFilename, readCoverPage, type CoverModelOut } from "./cover.js";
import {
  cropBand, cropRect, detectColumnBands, detectRowBands, downscaleForClassification,
  imageDims, isBlank, templateRowBands, type Band, type Dims,
} from "./image.js";
import { cardRects, classifyHeader, localReadCards, readHeaderText, readPrintedPage, type FooterRead, type LocalCard, type Rect } from "./local.js";
import type { Logger } from "./logger.js";
import { cleanNameHi, mapGender, mapRelation, normalizeCard } from "./normalize.js";
import { pdfPageCount, removeQuiet, renderPage } from "./pdf.js";
import { classifyPrompt, extractPrompt, systemPrompt } from "./prompts.js";
import { CLASSIFY_JSON_SCHEMA, ClassifyZ, EXTRACT_JSON_SCHEMA, ExtractZ, type CardOut } from "./schemas.js";
import type { Template } from "./templates.js";
import type { CoverInfo, PageResult, PageType, PdfResult, Usage, VoterCard } from "./types.js";
import { VOTER_PAGE_TYPES } from "./types.js";
import { errMsg, Semaphore, sha256File } from "./util.js";
import type { NameMemory } from "./name-memory.js";
import type { Transliterator } from "./translit.js";
import type { VisionClient } from "./vision/index.js";

export interface PdfContext {
  cfg: Config;
  log: Logger;
  tpl: Template;
  /** null for the local engine: nothing may call a model. */
  client: VisionClient | null;
  cache: ResultCache;
  translit: Transliterator;
  /** Shared limit on pages being OCR'd at once across all PDFs; defaults to a per-PDF one of cfg.pageConcurrency. */
  pageSem?: Semaphore;
  /** Cross-PDF Hindi name memory; its trusted tokens join the lexicon for name consensus. */
  names?: NameMemory;
}

/** Tokens name consensus may repair towards: transliteration lexicon + overrides + learned names. */
function knownNames(ctx: PdfContext): Set<string> {
  const known = ctx.translit.knownDevanagari();
  if (ctx.names) for (const t of ctx.names.learned()) known.add(t);
  return known;
}

function requireClient(ctx: PdfContext): VisionClient {
  if (!ctx.client) throw new Error(`engine "${ctx.cfg.engine}" tried to call a model`);
  return ctx.client;
}

const zeroUsage = (): Usage => ({ inputTokens: 0, outputTokens: 0, calls: 0 });
const addUsage = (a: Usage, b: Usage): void => {
  a.inputTokens += b.inputTokens;
  a.outputTokens += b.outputTokens;
  a.calls += b.calls;
};

function sectionOf(pt: PageType): PageResult["section"] {
  switch (pt) {
    case "voter_grid": return "main";
    case "supplement_grid": return "supplement";
    case "modification_grid": return "modification";
    case "deletion_grid": return "deletion";
    default: return "none";
  }
}

function toCover(c: NonNullable<ReturnType<typeof ClassifyZ.parse>["cover"]>): CoverInfo {
  const num = (s: string): number | null => (/\d/.test(s) ? Number(s.replace(/\D/g, "")) : null);
  return {
    stateHi: c.stateHi, stateEn: c.stateEn,
    acNo: c.acNo.replace(/\D/g, ""), acNameHi: c.acNameHi, acNameEn: c.acNameEn,
    partNo: c.partNo.replace(/\D/g, ""),
    psNoAndNameHi: c.psNoAndNameHi, psNameHi: c.psNameHi, psNameEn: c.psNameEn, psAddressHi: c.psAddressHi, psAddressEn: "",
    mainTownVillageHi: "", mainTownVillageEn: "", wardHi: "", wardEn: "", postOfficeHi: "", postOfficeEn: "",
    policeStationHi: "", policeStationEn: "", panchayatHi: "", panchayatEn: "", blockHi: "", blockEn: "",
    tehsilHi: "", tehsilEn: "", districtHi: "", districtEn: "", pinCode: "",
    revisionType: c.revisionType, revisionYear: c.revisionYear.replace(/\D/g, "").slice(0, 4),
    qualifyingDate: c.qualifyingDate, publicationDate: c.publicationDate,
    serialFrom: num(c.serialFrom), serialTo: num(c.serialTo), totalElectors: num(c.totalElectors),
  };
}

/** Wraps a VisionClient call and accounts its token usage onto `usage`. */
async function tracked<T>(ctx: PdfContext, usage: Usage, fn: () => Promise<T>): Promise<T> {
  const client = requireClient(ctx);
  const before = { ...client.stats };
  const r = await fn();
  const after = client.stats;
  usage.inputTokens += after.inputTokens - before.inputTokens;
  usage.outputTokens += after.outputTokens - before.outputTokens;
  usage.calls += after.calls - before.calls;
  return r;
}

/** English names always come from the local transliterator, whichever engine read the Devanagari. */
function fillEnglish(cards: VoterCard[], translit: Transliterator): void {
  for (const c of cards) {
    c.nameEn = translit.name(c.nameHi);
    c.relationNameEn = translit.name(c.relationNameHi);
  }
}

/** Cached results keep their OCR but get fresh name cleaning + English, so edits to overrides/model apply without re-OCR. */
function refreshEnglish(pages: PageResult[], translit: Transliterator): void {
  const en = (hi: string | undefined): string => (hi ? translit.name(hi) : "");
  for (const pg of pages) {
    for (const c of pg.cards) {
      c.nameHi = cleanNameHi(c.nameHi);
      c.relationNameHi = cleanNameHi(c.relationNameHi);
    }
    fillEnglish(pg.cards, translit);
    const cv = pg.cover;
    if (cv) {
      cv.acNameEn = en(cv.acNameHi);
      cv.psNameEn = en(cv.psNameHi);
      cv.psAddressEn = en(cv.psAddressHi);
      cv.mainTownVillageEn = en(cv.mainTownVillageHi);
      cv.wardEn = en(cv.wardHi);
      cv.postOfficeEn = en(cv.postOfficeHi);
      cv.policeStationEn = en(cv.policeStationHi);
      cv.panchayatEn = en(cv.panchayatHi);
      cv.blockEn = en(cv.blockHi);
      cv.tehsilEn = en(cv.tehsilHi);
      cv.districtEn = en(cv.districtHi);
    }
  }
}

/**
 * Footer page number for a voter page. Never throws: an unreadable footer leaves both null and
 * the CSV falls back to the PDF page index.
 */
async function footerOf(ctx: PdfContext, pngPath: string, dims: Dims, workDir: string, pageNo: number, label: string, warnings: string[]): Promise<FooterRead> {
  let fr: FooterRead = { page: null, total: null, text: "" };
  try {
    fr = await readPrintedPage(pngPath, dims, ctx.tpl, workDir);
  } catch (e) {
    ctx.log.debug("page", `${label}: footer read failed (${errMsg(e)})`);
  }
  if (fr.page === null) warnings.push("footer page number not read; Page_no uses the PDF page index");
  else if (fr.page !== pageNo) warnings.push(`footer says page ${fr.page} but this is PDF page ${pageNo}`);
  return fr;
}

/**
 * Cover page: tesseract text -> regex fields; with OCR_COVER_LLM (default when OPENROUTER=true)
 * the same text also goes to the model, whose AC / part / station reads win when plausible.
 * The file name fills anything still missing. Never throws: a model failure falls back to text.
 */
async function extractCover(
  ctx: PdfContext, pdfFile: string, pngPath: string, workDir: string, usage: Usage, label: string,
): Promise<{ cover: CoverInfo; warnings: string[]; source: string }> {
  const { cfg, tpl, translit, log } = ctx;
  const read = await readCoverPage(pngPath, tpl, workDir);
  const text = read.text;
  const regex = applyCoverMeta(parseCoverText(text), read);
  if (!read.metaText) log.debug("cover", `${label}: section-2 box not located; metadata from the whole-page text`);
  let model: CoverModelOut | null = null;
  let source = "tesseract";
  if (cfg.coverViaModel) {
    try {
      model = await tracked(ctx, usage, () =>
        requireClient(ctx).callJson(
          {
            images: [],
            system: "You extract structured fields from OCR text of Indian electoral rolls (Hindi). You answer with a single JSON object and nothing else.",
            prompt: coverPrompt(text), schema: COVER_SCHEMA, schemaName: "cover_text", maxTokens: 1500,
          },
          CoverModelZ,
          `${label} cover`,
        ),
      );
      source = "tesseract+model";
    } catch (e) {
      log.warn("cover", `${label}: model cover extraction failed (${errMsg(e)}); using text parse only`);
    }
  }
  const out = buildCover(regex, model, parseErollFilename(pdfFile), translit, path.basename(pdfFile));
  if (regex.missing.length) log.debug("cover", `${label}: text parse missed ${regex.missing.join(", ")}`);
  return { ...out, source };
}

/** Processes a single page: classify, then (if a voter grid) extract cards. */
export async function processPage(ctx: PdfContext, pdfFile: string, pageNo: number, pngPath: string): Promise<PageResult> {
  if (ctx.cfg.engine === "llm") return processPageLlm(ctx, pdfFile, pageNo, pngPath);
  return processPageHybrid(ctx, pdfFile, pageNo, pngPath);
}

async function processPageLlm(ctx: PdfContext, pdfFile: string, pageNo: number, pngPath: string): Promise<PageResult> {
  const { cfg, tpl, log } = ctx;
  const client = requireClient(ctx);
  const t0 = Date.now();
  const usage = zeroUsage();
  const warnings: string[] = [];
  const base = path.basename(pdfFile);
  const label = `${base} p${pageNo}`;
  const system = systemPrompt(tpl);

  // 1. Classification on a downscaled page (cheap).
  const small = await downscaleForClassification(pngPath, tpl.classify.longEdgePx);
  const cls = await tracked(ctx, usage, () =>
    client.callJson(
      { images: [small], system, prompt: classifyPrompt(tpl), schema: CLASSIFY_JSON_SCHEMA, schemaName: "page_classification", maxTokens: 4000 },
      ClassifyZ,
      `${label} classify`,
    ),
  );
  let pageType = cls.pageType;
  if (pageNo === 1 && pageType !== "cover") {
    warnings.push(`page 1 classified as ${pageType}, expected cover`);
  }
  const cover = pageType === "cover" && cls.cover?.present ? toCover(cls.cover) : null;
  if (pageType === "cover" && !cover) warnings.push("cover page detected but cover fields not returned");

  // Section header hints can override a shaky classification between grid kinds.
  const hdr = cls.sectionHeader;
  if (hdr && VOTER_PAGE_TYPES.has(pageType) || pageType === "deletion_grid") {
    const hit = (keys: string[]) => keys.some((k) => hdr.includes(k));
    if (hit(tpl.sectionHints.deletion ?? [])) pageType = "deletion_grid";
    else if (hit(tpl.sectionHints.modification ?? [])) pageType = "modification_grid";
    else if (hit(tpl.sectionHints.supplement ?? [])) pageType = "supplement_grid";
    else if (hit(tpl.sectionHints.main ?? [])) pageType = "voter_grid";
  }

  const result: PageResult = {
    page: pageNo,
    pageType,
    partNo: cls.partNo.replace(/\D/g, ""),
    sectionHeader: cls.sectionHeader,
    section: sectionOf(pageType),
    cards: [],
    cover,
    warnings,
    usage,
    durationMs: 0,
  };

  if (pageType === "deletion_grid") {
    log.info("page", `${label}: deletion list (${cls.cardCount} cards) - skipped, not voters`);
    result.durationMs = Date.now() - t0;
    return result;
  }
  if (!VOTER_PAGE_TYPES.has(pageType)) {
    log.info("page", `${label}: ${pageType}`);
    result.durationMs = Date.now() - t0;
    return result;
  }

  // 2. Card extraction.
  const dims = await imageDims(pngPath);
  const footer = await footerOf(ctx, pngPath, dims, path.dirname(pngPath), pageNo, label, warnings);
  result.printedPage = footer.page;
  result.printedTotal = footer.total;
  const rawCards: CardOut[] = await extractCards(ctx, pngPath, dims, cls.gridRowsFilled, label, usage, warnings);

  // 3. Normalize + order by serial where available (keeps reading order otherwise).
  const cards: VoterCard[] = rawCards.map((c) => ({ ...normalizeCard(c, tpl), engine: "llm" as const }));
  fillEnglish(cards, ctx.translit);
  result.rawEpics = rawCards.map((c) => c.epicNo);
  result.cards = cards;

  const expected = cls.cardCount || (cls.gridRowsFilled ? Math.min(cls.gridRowsFilled * tpl.grid.cols, tpl.grid.cols * tpl.grid.rows) : 0);
  if (expected && cards.length !== expected) {
    warnings.push(`card count ${cards.length} != classifier estimate ${expected}`);
  }
  const serials = cards.map((c) => c.serial).filter((s): s is number => s !== null);
  const dupSerials = serials.filter((s, i) => serials.indexOf(s) !== i);
  if (dupSerials.length) warnings.push(`duplicate serials on page: ${[...new Set(dupSerials)].join(",")}`);

  log.info("page", `${label}: ${pageType} "${cls.sectionHeader.slice(0, 40)}" -> ${cards.length} cards (${usage.calls} calls, ${Date.now() - t0}ms)${warnings.length ? " WARN: " + warnings.join(" | ") : ""}`);
  result.durationMs = Date.now() - t0;
  return result;
}

async function extractCards(
  ctx: PdfContext, pngPath: string, dims: Dims, rowsFilled: number, label: string, usage: Usage, warnings: string[],
): Promise<CardOut[]> {
  const { cfg, tpl, log } = ctx;
  const client = requireClient(ctx);
  const system = systemPrompt(tpl);

  if (cfg.mode === "page") {
    const png = fs.readFileSync(pngPath);
    const out = await tracked(ctx, usage, () =>
      client.callJson(
        { images: [png], system, prompt: extractPrompt(tpl, { rows: tpl.grid.rows, cols: tpl.grid.cols, what: "page" }), schema: EXTRACT_JSON_SCHEMA, schemaName: "cards", maxTokens: 16000 },
        ExtractZ,
        `${label} extract`,
      ),
    );
    return out.cards;
  }

  // strip / card modes need row bands.
  let bands: Band[] | null = await detectRowBands(pngPath, dims, tpl);
  let source = "detected";
  if (!bands) {
    bands = templateRowBands(dims, tpl, rowsFilled);
    source = "template-fallback";
    warnings.push("row detection failed; used template geometry");
  } else if (rowsFilled && bands.length < rowsFilled) {
    warnings.push(`detected ${bands.length} card rows but classifier saw ${rowsFilled}`);
  }
  log.debug("page", `${label}: ${bands.length} row bands (${source})`);

  if (cfg.mode === "card") {
    const jobs: Promise<CardOut[]>[] = [];
    let idx = 0;
    for (const band of bands) {
      const cols = await detectColumnBands(pngPath, dims, band, tpl);
      for (const col of cols) {
        const n = ++idx;
        jobs.push(
          (async () => {
            const png = await cropRect(pngPath, {
              left: Math.max(0, col.left - tpl.strips.padPx), top: Math.max(0, band.top - tpl.strips.padPx),
              width: Math.min(dims.width, col.right + tpl.strips.padPx) - Math.max(0, col.left - tpl.strips.padPx),
              height: Math.min(dims.height, band.bottom + tpl.strips.padPx) - Math.max(0, band.top - tpl.strips.padPx),
            });
            if (await isBlank(png)) return [];
            const out = await tracked(ctx, usage, () =>
              client.callJson(
                { images: [png], system, prompt: extractPrompt(tpl, { rows: 1, cols: 1, what: "card" }), schema: EXTRACT_JSON_SCHEMA, schemaName: "cards", maxTokens: 3000 },
                ExtractZ,
                `${label} card ${n}`,
              ),
            );
            return out.cards.slice(0, 1);
          })(),
        );
      }
    }
    return (await Promise.all(jobs)).flat();
  }

  // strip mode (default): N card rows per call, full width, native resolution.
  const per = Math.max(1, tpl.strips.rowsPerStrip);
  const groups: Band[] = [];
  for (let i = 0; i < bands.length; i += per) {
    const g = bands.slice(i, i + per);
    groups.push({ top: g[0].top, bottom: g[g.length - 1].bottom });
  }
  const jobs = groups.map((g, i) =>
    (async () => {
      const png = await cropBand(pngPath, dims, g, tpl.strips.padPx);
      if (await isBlank(png)) return [] as CardOut[];
      const out = await tracked(ctx, usage, () =>
        client.callJson(
          { images: [png], system, prompt: extractPrompt(tpl, { rows: per, cols: tpl.grid.cols, what: "strip" }), schema: EXTRACT_JSON_SCHEMA, schemaName: "cards", maxTokens: 8000 },
          ExtractZ,
          `${label} strip ${i + 1}/${groups.length}`,
        ),
      );
      return out.cards;
    })(),
  );
  return (await Promise.all(jobs)).flat();
}


/* ======================= hybrid engine ======================= */

/**
 * Cards sit in a strict grid, so serials are consecutive in reading order. The serial box
 * read is noisy (supplement pages glue the supplement number onto it), so derive the page's
 * base serial from the most common (read - index) offset and assign base + index to all.
 */
export function fixSerials(reads: (number | null)[]): { serials: (number | null)[]; corrected: number[] } {
  const offsets = new Map<number, number>();
  reads.forEach((r, i) => {
    if (r === null || r <= 0) return;
    offsets.set(r - i, (offsets.get(r - i) ?? 0) + 1);
  });
  let best: number | null = null;
  let bestN = 0;
  for (const [off, n] of offsets) if (n > bestN || (n === bestN && best !== null && off < best)) { best = off; bestN = n; }
  if (best === null || bestN < Math.max(2, Math.ceil(reads.length * 0.3))) {
    return { serials: reads, corrected: [] }; // not enough agreement: keep raw reads
  }
  const corrected: number[] = [];
  const serials = reads.map((r, i) => {
    const want = best! + i;
    if (r !== want) corrected.push(i);
    return want;
  });
  return { serials, corrected };
}

function localToVoterCard(c: LocalCard, serial: number | null, tpl: Template): VoterCard {
  return {
    serial,
    epicNo: c.epicNo,
    nameHi: cleanNameHi(c.nameHi),
    nameEn: "",
    relationTypeHi: c.relationTypeHi,
    relationType: mapRelation(c.relationTypeHi, tpl),
    relationNameHi: cleanNameHi(c.relationNameHi),
    relationNameEn: "",
    houseNo: c.houseNo,
    age: c.age,
    genderHi: c.genderHi,
    genderEn: mapGender(c.genderHi, tpl),
    confidence: Number(c.confidence.toFixed(2)),
    notes: "",
    deleted: c.deleted,
    engine: "tesseract",
    extraFlags: [],
    fieldConf: { name: c.nameConf / 100, relationName: c.relationConf / 100 },
  };
}

async function processPageHybrid(ctx: PdfContext, pdfFile: string, pageNo: number, pngPath: string): Promise<PageResult> {
  const { cfg, tpl, log, translit } = ctx;
  const local = cfg.engine === "local";
  const t0 = Date.now();
  const usage = zeroUsage();
  const warnings: string[] = [];
  const base = path.basename(pdfFile);
  const label = `${base} p${pageNo}`;
  const system = systemPrompt(tpl);
  const workDir = path.dirname(pngPath);

  const dims = await imageDims(pngPath);
  const bands = await detectRowBands(pngPath, dims, tpl);

  // 1. Classification: page 1 is the cover and is parsed from its tesseract text (see
  //    extractCover); other pages are classified from the tesseract read of the header strip,
  //    with the model as fallback when the header is unrecognisable.
  let pageType: PageType;
  let partNo = "";
  let sectionHeader = "";
  let cover: CoverInfo | null = null;
  let classifierCards = 0;
  let classifierRows = 0;
  let headerSource = "tesseract";
  const hdr = pageNo === 1 ? null : classifyHeader(await readHeaderText(pngPath, dims, tpl, workDir), !!bands, pageNo, tpl);
  if (pageNo === 1) {
    const cv = await extractCover(ctx, pdfFile, pngPath, workDir, usage, label);
    pageType = "cover";
    cover = cv.cover;
    partNo = cv.cover.partNo;
    headerSource = cv.source;
    warnings.push(...cv.warnings);
  } else if (hdr?.pageType && hdr.pageType !== "cover") {
    pageType = hdr.pageType;
    partNo = hdr.partNo;
    sectionHeader = hdr.sectionHeader;
  } else if (local) {
    // No model to ask: a page with a card grid is treated as main roll and flagged for review.
    pageType = bands ? "voter_grid" : "other";
    partNo = hdr?.partNo ?? "";
    sectionHeader = hdr?.sectionHeader ?? "";
    headerSource = "assumed";
    warnings.push(bands ? "header unreadable; assumed a main-roll grid (check the section)" : "header unreadable and no card grid found; page skipped");
  } else {
    headerSource = "model";
    const small = await downscaleForClassification(pngPath, tpl.classify.longEdgePx);
    const cls = await tracked(ctx, usage, () =>
      requireClient(ctx).callJson(
        { images: [small], system, prompt: classifyPrompt(tpl), schema: CLASSIFY_JSON_SCHEMA, schemaName: "page_classification", maxTokens: 4000 },
        ClassifyZ,
        `${label} classify`,
      ),
    );
    pageType = cls.pageType;
    partNo = cls.partNo.replace(/\D/g, "") || hdr?.partNo || "";
    sectionHeader = cls.sectionHeader;
    classifierCards = cls.cardCount;
    classifierRows = cls.gridRowsFilled;
    cover = pageType === "cover" && cls.cover?.present ? toCover(cls.cover) : null;
    if (pageNo === 1 && pageType !== "cover") warnings.push(`page 1 classified as ${pageType}, expected cover`);
    if (pageType === "cover" && !cover) warnings.push("cover page detected but cover fields not returned");
    // Section hints override shaky grid-kind classification.
    if (sectionHeader && (VOTER_PAGE_TYPES.has(pageType) || pageType === "deletion_grid")) {
      const hit = (keys: string[]) => keys.some((k) => sectionHeader.includes(k));
      if (hit(tpl.sectionHints.deletion ?? [])) pageType = "deletion_grid";
      else if (hit(tpl.sectionHints.modification ?? [])) pageType = "modification_grid";
      else if (hit(tpl.sectionHints.supplement ?? [])) pageType = "supplement_grid";
      else if (hit(tpl.sectionHints.main ?? [])) pageType = "voter_grid";
    }
  }

  const result: PageResult = {
    page: pageNo, pageType, partNo, sectionHeader, section: sectionOf(pageType),
    cards: [], cover, warnings, usage, durationMs: 0,
  };
  if (pageType === "deletion_grid") {
    log.info("page", `${label}: deletion list - skipped, not voters`);
    result.durationMs = Date.now() - t0;
    return result;
  }
  if (!VOTER_PAGE_TYPES.has(pageType)) {
    log.info("page", `${label}: ${pageType} (${headerSource})`);
    result.durationMs = Date.now() - t0;
    return result;
  }

  // 2. Footer page number, then the local read of every card.
  const footer = await footerOf(ctx, pngPath, dims, workDir, pageNo, label, warnings);
  result.printedPage = footer.page;
  result.printedTotal = footer.total;
  let rects: Rect[];
  if (bands) {
    rects = await cardRects(pngPath, dims, bands, tpl);
  } else {
    warnings.push("row detection failed; used template geometry");
    rects = await cardRects(pngPath, dims, templateRowBands(dims, tpl, classifierRows || tpl.grid.rows), tpl);
  }
  // Drop blank cells (the last row of a page is usually partial).
  const kept: Rect[] = [];
  for (const r of rects) {
    const png = await cropRect(pngPath, r);
    if (!(await isBlank(png))) kept.push(r);
  }
  rects = kept;
  const localCards = await localReadCards(pngPath, rects, tpl, workDir, cfg.localMinConf);
  const { serials, corrected } = fixSerials(localCards.map((c) => c.serial));

  // 3. Escalate uncertain cards to the model. Cards are batched (several card images per
  //    call) to amortise the prompt; a batch whose reply has the wrong card count is redone
  //    card by card.
  const cards: VoterCard[] = new Array(localCards.length);
  const rawEpics: string[] = new Array(localCards.length).fill("");
  const uncertain = localCards.map((c, i) => (c.escalate.length ? i : -1)).filter((i) => i >= 0);
  const escalatedIdx = local ? [] : uncertain;
  const pad = tpl.strips.padPx;
  const cropCard = (r: Rect) =>
    cropRect(pngPath, {
      left: Math.max(0, r.left - pad), top: Math.max(0, r.top - pad),
      width: Math.min(dims.width, r.left + r.width + pad) - Math.max(0, r.left - pad),
      height: Math.min(dims.height, r.top + r.height + pad) - Math.max(0, r.top - pad),
    });
  const adopt = (i: number, raw: CardOut | undefined) => {
    if (!raw) {
      const vc = localToVoterCard(localCards[i], serials[i], tpl);
      vc.extraFlags!.push("llm_fallback_empty");
      vc.escalated = localCards[i].escalate;
      cards[i] = vc;
      return;
    }
    const vc: VoterCard = { ...normalizeCard(raw, tpl), engine: "llm", escalated: localCards[i].escalate, extraFlags: [] };
    rawEpics[i] = raw.epicNo;
    // Serial from the grid position is more reliable than either read.
    if (serials[i] !== null && vc.serial !== serials[i]) {
      if (vc.serial !== null) vc.extraFlags!.push("serial_corrected");
      vc.serial = serials[i];
    }
    cards[i] = vc;
  };
  const BATCH = Math.max(1, cfg.escalationBatch);
  const batches: number[][] = [];
  for (let i = 0; i < escalatedIdx.length; i += BATCH) batches.push(escalatedIdx.slice(i, i + BATCH));
  await Promise.all(
    batches.map(async (idxs) => {
      const images = await Promise.all(idxs.map((i) => cropCard(rects[i])));
      if (idxs.length > 1) {
        const out = await tracked(ctx, usage, () =>
          requireClient(ctx).callJson(
            { images, system, prompt: extractPrompt(tpl, { rows: 1, cols: 1, what: "cards", count: idxs.length }), schema: EXTRACT_JSON_SCHEMA, schemaName: "cards", maxTokens: 2000 + 400 * idxs.length },
            ExtractZ,
            `${label} cards ${idxs.map((i) => i + 1).join(",")}`,
          ),
        );
        if (out.cards.length === idxs.length) {
          idxs.forEach((i, k) => adopt(i, out.cards[k]));
          return;
        }
        warnings.push(`model returned ${out.cards.length} cards for a batch of ${idxs.length}; retried one by one`);
      }
      await Promise.all(
        idxs.map(async (i, k) => {
          const out = await tracked(ctx, usage, () =>
            requireClient(ctx).callJson(
              { images: [images[k]], system, prompt: extractPrompt(tpl, { rows: 1, cols: 1, what: "card" }), schema: EXTRACT_JSON_SCHEMA, schemaName: "cards", maxTokens: 3000 },
              ExtractZ,
              `${label} card ${i + 1} (${localCards[i].escalate.join(",")})`,
            ),
          );
          adopt(i, out.cards[0]);
        }),
      );
    }),
  );
  for (let i = 0; i < localCards.length; i++) {
    if (cards[i]) continue;
    const vc = localToVoterCard(localCards[i], serials[i], tpl);
    rawEpics[i] = localCards[i].epicRaw;
    if (corrected.includes(i) && localCards[i].serial !== null) vc.extraFlags!.push("serial_corrected");
    // Local engine: what would have gone to a model is flagged for a human instead.
    if (local) vc.extraFlags!.push(...localCards[i].escalate);
    cards[i] = vc;
  }

  // 4. Page-level name consensus (a confident read elsewhere on the page repairs a 1-char
  //    variant), then English names: local transliteration for every card, whichever engine read it.
  const fixed = correctNames(cards, { known: knownNames(ctx) });
  if (fixed) log.debug("page", `${label}: ${fixed} name token(s) repaired by page consensus`);
  fillEnglish(cards, translit);

  result.cards = cards;
  result.rawEpics = rawEpics;
  if (classifierCards && cards.length !== classifierCards) warnings.push(`card count ${cards.length} != classifier estimate ${classifierCards}`);
  if (corrected.length) warnings.push(`serial reads corrected from grid order on ${corrected.length} card(s)`);
  log.info("page", `${label}: ${pageType} "${sectionHeader.slice(0, 40)}" -> ${cards.length} cards, ${local ? `${uncertain.length} flagged for review` : `${escalatedIdx.length} to model, ${usage.calls} calls`}, ${Date.now() - t0}ms${warnings.length ? " WARN: " + warnings.join(" | ") : ""}`);
  result.durationMs = Date.now() - t0;
  return result;
}

/** Processes one PDF end to end, with page-level resume. Never throws for a bad PDF: returns status "failed". */
export async function processPdf(ctx: PdfContext, pdfFile: string): Promise<PdfResult> {
  const { cfg, log, cache, tpl } = ctx;
  const base = path.basename(pdfFile);
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  let hash = "";
  try {
    hash = await sha256File(pdfFile);
  } catch (e) {
    return failed(base, "", tpl, ctx, startedAt, `cannot hash file: ${errMsg(e)}`);
  }

  if (cfg.force) cache.clearPdf(hash);
  const cached = cache.getPdf(hash);
  if (cached) {
    log.info("pdf", `${base}: cached result (${cached.pages.reduce((n, p) => n + p.cards.length, 0)} cards, ${cached.model}) - skipping OCR`);
    refreshEnglish(cached.pages, ctx.translit);
    cached.cover = cached.pages.find((x) => x.cover)?.cover ?? null;
    return cached;
  }

  const tmpDir = path.join(cfg.tmpDir, hash.slice(0, 12));
  const usage = zeroUsage();
  const pages: PageResult[] = [];
  try {
    const pageCount = await pdfPageCount(pdfFile);
    const last = cfg.limitPages ? Math.min(pageCount, cfg.limitPages) : pageCount;
    log.info("pdf", `${base}: ${pageCount} pages${last < pageCount ? ` (limited to ${last})` : ""}, sha256 ${hash.slice(0, 12)}`);

    // Pages are independent, so they are OCR'd in parallel (bounded by the shared page
    // semaphore); results are kept in page order. Each page's image is removed as soon as it is read.
    const pageSem = ctx.pageSem ?? new Semaphore(cfg.pageConcurrency);
    const slots: PageResult[] = new Array(last);
    let done = 0;
    const settled = await Promise.allSettled(
      Array.from({ length: last }, (_, k) => k + 1).map(async (p) => {
        const cachedPage = cache.getPage(hash, p);
        if (cachedPage) {
          refreshEnglish([cachedPage], ctx.translit);
          slots[p - 1] = cachedPage;
          done++;
          log.debug("pdf", `${base} p${p}: from page cache`);
          return;
        }
        await pageSem.run(async () => {
          let png: string | null = null;
          try {
            png = await renderPage(pdfFile, p, cfg.dpi, tmpDir);
            const pr = await processPage(ctx, pdfFile, p, png);
            slots[p - 1] = pr;
            cache.putPage(hash, pr);
          } finally {
            if (png) removeQuiet(png); // release the page image before moving on
          }
        });
        done++;
        const elapsed = (Date.now() - t0) / 1000;
        log.info("progress", `${base}: ${done}/${last} pages, ${(done / Math.max(elapsed, 1e-3)).toFixed(2)} pages/s`);
      }),
    );
    // Wait for every page before failing, so none is still writing into tmpDir when it is removed.
    const firstErr = settled.find((r): r is PromiseRejectedResult => r.status === "rejected");
    if (firstErr) throw firstErr.reason;
    for (const pr of slots) {
      pages.push(pr);
      addUsage(usage, pr.usage);
    }

    // Document-level consensus: names repeat across a part (families), so a token read
    // confidently on one page repairs a one-character variant on another.
    const allCards = pages.flatMap((p) => p.cards);
    const fixed = correctNames(allCards, { known: knownNames(ctx) });
    if (fixed) {
      log.info("pdf", `${base}: ${fixed} name token(s) repaired by document consensus`);
      fillEnglish(allCards, ctx.translit);
    }

    const cover = pages.find((x) => x.cover)?.cover ?? null;
    const partCounts = new Map<string, number>();
    for (const pg of pages) if (pg.partNo) partCounts.set(pg.partNo, (partCounts.get(pg.partNo) ?? 0) + 1);
    const partNo = cover?.partNo || [...partCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "";

    const result: PdfResult = {
      schemaVersion: RESULT_SCHEMA_VERSION,
      file: base, hash, template: tpl.name, provider: cfg.provider, model: cfg.model,
      pageCount, partNo, cover, pages,
      status: "ok", startedAt, finishedAt: new Date().toISOString(), usage,
    };
    cache.putPdf(result);
    const cards = pages.reduce((n, x) => n + x.cards.length, 0);
    log.info("pdf", `${base}: done - part ${partNo || "?"}, ${cards} cards, ${usage.calls} calls, ${usage.inputTokens}+${usage.outputTokens} tokens, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    return result;
  } catch (e) {
    log.error("pdf", `${base}: FAILED - ${errMsg(e)}`);
    return failed(base, hash, tpl, ctx, startedAt, errMsg(e), pages, usage);
  } finally {
    removeQuiet(tmpDir);
  }
}

function failed(base: string, hash: string, tpl: Template, ctx: PdfContext, startedAt: string, error: string, pages: PageResult[] = [], usage: Usage = zeroUsage()): PdfResult {
  return {
    schemaVersion: RESULT_SCHEMA_VERSION,
    file: base, hash, template: tpl.name, provider: ctx.cfg.provider, model: ctx.cfg.model,
    pageCount: pages.length, partNo: "", cover: null, pages,
    status: "failed", error, startedAt, finishedAt: new Date().toISOString(), usage,
  };
}
