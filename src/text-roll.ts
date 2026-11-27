/**
 * Rolls that carry a real text layer (the 2027 SSR draft) need no OCR: the cards are read from the
 * PDF's own text, by position. The result goes into the same result cache the OCR uses, so
 * `cli.js run <folder> --push` then adds English names, merges and uploads it unchanged.
 *
 * A PDF is cached only when what was read agrees with the totals printed on its own cover.
 * Layout handled: Hindi rolls, A4, 3 columns of cards.
 */
import { asciiDigits, mapGender, mapRelation } from "./normalize.js";
import { buildCover, filePartNo, parseCoverText, parseErollFilename } from "./cover.js";
import { RESULT_SCHEMA_VERSION } from "./cache.js";
import type { Template } from "./templates.js";
import type { Transliterator } from "./translit.js";
import type { CoverInfo, PageResult, PdfResult, VoterCard } from "./types.js";

/** [x0, y0, x1, y1, text] as printed by scripts/pdf_lines.py (PDF points, origin top-left). */
export type TextLine = [number, number, number, number, string];

const COL_LEFT = 14;
const COL_WIDTH = 190;
const HEADER_BOTTOM = 28;
const FOOTER_TOP = 806;
const CARD_HEIGHT = 77;
/** Current IDs, and the old slash form, which some cards print with backslashes ("UP\28\137\0459373"). */
const EPIC_RE = /^(?:[A-Z]{2,3}\d{6,8}|[A-Z]{2}[\/\\]\d+[\/\\]\d+[\/\\]\d+)$/i;
const PHOTO_RE = /फोटो\s*उपलब्ध/;

const clean = (s: string): string => s.normalize("NFC").replace(/[​-‍﻿]/g, "").replace(/\s+/g, " ").trim();
const column = (l: TextLine): number => Math.min(2, Math.max(0, Math.floor((l[0] - COL_LEFT) / COL_WIDTH)));

/** Lines sharing a baseline, left to right, joined into one string per visual row. */
export function visualRows(lines: TextLine[], tolerance = 3): string[] {
  const rows: TextLine[][] = [];
  for (const l of [...lines].sort((a, b) => a[1] - b[1] || a[0] - b[0])) {
    const last = rows[rows.length - 1];
    if (last && Math.abs(l[1] - last[0][1]) <= tolerance) last.push(l);
    else rows.push([l]);
  }
  return rows.map((r) => clean(r.sort((a, b) => a[0] - b[0]).map((l) => l[4]).join(" ")));
}

type Field = "name" | "relation" | "house" | "";

export function parseCard(lines: TextLine[], tpl: Template): VoterCard {
  const epic = lines.find((l) => EPIC_RE.test(l[4].replace(/\s/g, "")));
  const top = Math.min(...lines.map((l) => l[1]));
  const isTop = (l: TextLine) => l[1] - top <= 5;
  const serialLine = lines.find((l) => isTop(l) && l !== epic && /^\D{0,4}\d{1,5}$/.test(asciiDigits(l[4])));
  const serialText = serialLine ? asciiDigits(serialLine[4]) : "";
  const marker = lines.filter((l) => isTop(l) && l !== epic && l !== serialLine).map((l) => l[4]).join(" ");
  let name = "", relationType = "", relationName = "", house = "", gender = "";
  let age: number | null = null;
  let current: Field = "";
  const extra: string[] = [];
  for (const row of visualRows(lines.filter((l) => !isTop(l) && !PHOTO_RE.test(l[4])))) {
    let m: RegExpExecArray | null;
    if ((m = /^आयु\s*:?\s*([0-9०-९]*)\s*लिंग\s*:?\s*(.*)$/.exec(row))) {
      age = m[1] ? Number(asciiDigits(m[1])) : null;
      gender = m[2].trim();
      current = "";
    } else if ((m = /^मकान\s*संख्या\s*:?\s*(.*)$/.exec(row))) {
      house = m[1].trim();
      current = "house";
    } else if ((m = /^(.*?)\s*का\s*नाम\s*:\s*(.*)$/.exec(row)) || (m = /^(अन्य)\s*:\s*(.*)$/.exec(row))) {
      relationType = m[1].trim();
      relationName = m[2].trim();
      current = "relation";
    } else if ((m = /^(?:निर्वाचक\s*का\s*)?नाम\s*:\s*(.*)$/.exec(row))) {
      name = m[1].trim();
      current = "name";
    } else if (current === "name") name = `${name} ${row}`.trim();
    else if (current === "relation") relationName = `${relationName} ${row}`.trim();
    else if (current === "house") house = `${house} ${row}`.trim();
    else extra.push(row);
  }
  const serialNo = /(\d{1,5})$/.exec(serialText);
  return {
    serial: serialNo ? Number(serialNo[1]) : null,
    marker: clean(`${marker} ${serialText.replace(/\d{1,5}$/, "")}`),
    epicNo: epic ? epic[4].replace(/\s/g, "").replace(/\\/g, "/").toUpperCase() : "",
    nameHi: name,
    nameEn: "",
    relationTypeHi: relationType,
    relationType: mapRelation(relationType, tpl),
    relationNameHi: relationName,
    relationNameEn: "",
    houseNo: house,
    age,
    genderHi: gender,
    genderEn: mapGender(gender, tpl),
    confidence: 1,
    notes: extra.join(" | "),
    engine: "text",
  };
}

/** The cards of one grid page; a card is everything in one column from its top row down. */
export function parseGridPage(lines: TextLine[], tpl: Template): VoterCard[] {
  const body = lines.filter((l) => l[1] >= HEADER_BOTTOM && l[1] < FOOTER_TOP);
  const isEpic = (l: TextLine) => EPIC_RE.test(l[4].replace(/\s/g, ""));
  const tops: number[] = [];
  for (const l of body.filter(isEpic).sort((a, b) => a[1] - b[1])) {
    if (!tops.some((t) => Math.abs(t - l[1]) <= 20)) tops.push(l[1]);
  }
  // A card printed without an EPIC still has its serial on the top row.
  for (const l of body) {
    const dx = l[0] - COL_LEFT - COL_WIDTH * column(l);
    if (/^\d{1,5}$/.test(l[4]) && dx > 20 && dx < 70 && !tops.some((t) => Math.abs(t - l[1]) <= 45)) tops.push(l[1]);
  }
  tops.sort((a, b) => a - b);
  const cards: VoterCard[] = [];
  for (const top of tops) {
    for (let col = 0; col < 3; col++) {
      const mine = body.filter((l) => column(l) === col && l[1] >= top - 4 && l[1] < top + CARD_HEIGHT);
      if (mine.some((l) => /^(?:निर्वाचक\s*का\s*)?नाम\s*:/.test(l[4]) || /लिंग/.test(l[4]))) cards.push(parseCard(mine, tpl));
    }
  }
  return cards.sort((a, b) => (a.serial ?? 0) - (b.serial ?? 0));
}

export function parseCoverPage(lines: TextLine[], base: string, translit: Transliterator): CoverInfo {
  const parse = parseCoverText(visualRows(lines).join("\n"));
  // The section list is the left column between its heading and the station details; read it apart
  // from the right-hand box so that the two never share a row.
  const rows = [...lines].sort((a, b) => a[1] - b[1]);
  const start = rows.find((l) => /अनुभागों\s*की\s*संख्या/.test(l[4]));
  const end = rows.find((l) => /मतदान\s*स्थल\s*का\s*विवरण/.test(l[4]));
  if (start && end) {
    const list = visualRows(rows.filter((l) => l[1] > start[1] + 5 && l[1] < end[1] - 3 && l[0] < 230));
    const sections: { no: string; name: string }[] = [];
    for (const r of list) {
      const m = /^(\d{1,3})\s*[-–.]\s*(.+)$/.exec(asciiDigits(r));
      if (m) sections.push({ no: String(Number(m[1])), name: m[2].trim() });
      else if (sections.length) sections[sections.length - 1].name += ` ${r}`;
    }
    parse.sections = sections;
  }
  // The station address is whatever the left column prints between its label and section 4. Taken by
  // position: the OCR-text parser misses short abbreviated ones ("पू0 मा0वि0 मऊ").
  const label = rows.find((l) => /मतदान\s*स्थल\s*का\s*पता/.test(l[4]));
  const electors = label && rows.find((l) => l[1] > label[1] && /निर्वाचकों\s*की\s*संख्या/.test(l[4]));
  if (label && electors) {
    const address = visualRows(rows.filter((l) => l[1] > label[1] + 5 && l[1] < electors[1] - 5 && l[0] < 230)).join(" ").trim();
    if (address) parse.fields.psAddressHi = address;
  }
  const { cover } = buildCover(parse, null, parseErollFilename(base), translit, base);
  cover.stateHi = cover.stateHi.replace("प्रदे श", "प्रदेश"); // title size: a false space wider than the card-text cut-off
  const fromFile = filePartNo(base);
  if (fromFile) cover.partNo = fromFile;
  return cover;
}

/** Male, female, third-gender and total as printed in the cover's electors table; null when absent. */
export function coverCounts(lines: TextLine[]): { from: number; to: number; male: number; female: number; other: number; total: number } | null {
  const rows = visualRows(lines);
  const at = rows.findIndex((r) => /निर्वाचकों\s*की\s*संख्या/.test(r));
  if (at < 0) return null;
  for (const r of rows.slice(at + 1)) {
    const n = asciiDigits(r).trim().split(/\s+/);
    if (n.length === 6 && n.every((x) => /^\d+$/.test(x))) {
      const [from, to, male, female, other, total] = n.map(Number);
      return { from, to, male, female, other, total };
    }
  }
  return null;
}

export interface TextRead {
  result: PdfResult;
  /** Reasons not to trust the read; empty = it agrees with the cover. */
  problems: string[];
}

export function readTextPdf(pages: TextLine[][], base: string, hash: string, tpl: Template, translit: Transliterator): TextRead {
  const now = new Date().toISOString();
  const problems: string[] = [];
  const cover = parseCoverPage(pages[0] ?? [], base, translit);
  const out: PageResult[] = [];
  const zero = { inputTokens: 0, outputTokens: 0, calls: 0 };
  pages.forEach((lines, i) => {
    const header = visualRows(lines.filter((l) => l[1] < HEADER_BOTTOM)).join(" ");
    const summary = lines.some((l) => /निर्वाचकों\s*का\s*सार/.test(l[4]));
    const cards = i < 2 || summary ? [] : parseGridPage(lines, tpl);
    const section = /अनुभाग\s*संख्या\s*(?:और|व)?\s*नाम\s*:?\s*(\d{1,3})\s*[-–.]\s*(.*?)\s*(?:भाग\s*संख्या.*)?$/.exec(asciiDigits(header));
    const footer = /कुल\s*पृष्ठ\s*(\d+)\s*-\s*पृष्ठ\s*(\d+)/.exec(asciiDigits(visualRows(lines.filter((l) => l[1] >= FOOTER_TOP)).join(" ")));
    const listPage = /(?:विलोपन|संशोधन|परिवर्धन)/.test(header);
    if (listPage) problems.push(`page ${i + 1} is an additions / deletions / corrections list, which the text reader does not handle`);
    if (cards.length && !section) problems.push(`page ${i + 1}: section heading not read`);
    out.push({
      schemaVersion: RESULT_SCHEMA_VERSION,
      page: i + 1,
      pageType: i === 0 ? "cover" : summary ? "summary" : cards.length ? "voter_grid" : "other",
      partNo: cover.partNo,
      sectionHeader: header,
      section: cards.length ? "main" : "none",
      sectionNo: section ? String(Number(section[1])) : "",
      sectionName: section ? clean(section[2]) : "",
      supplementNo: "",
      printedPage: footer ? Number(footer[2]) : null,
      printedTotal: footer ? Number(footer[1]) : null,
      cards,
      cover: i === 0 ? cover : null,
      warnings: [],
      usage: { ...zero },
      durationMs: 0,
    });
  });

  const cards = out.flatMap((p) => p.cards);
  const counts = coverCounts(pages[0] ?? []);
  if (!counts) problems.push("electors table on the cover not read");
  else {
    const g = (v: string) => cards.filter((c) => c.genderEn === v).length;
    if (cards.length !== counts.total) problems.push(`${cards.length} cards read, cover says ${counts.total}`);
    if (g("Male") !== counts.male || g("Female") !== counts.female || g("Other") !== counts.other)
      problems.push(`male/female/other ${g("Male")}/${g("Female")}/${g("Other")}, cover says ${counts.male}/${counts.female}/${counts.other}`);
    const serials = new Set(cards.map((c) => c.serial));
    let missing = 0;
    for (let s = counts.from; s <= counts.to; s++) if (!serials.has(s)) missing++;
    if (missing || serials.size !== cards.length) problems.push(`serials ${counts.from}-${counts.to}: ${missing} missing, ${cards.length - serials.size} repeated`);
  }
  const count = (bad: (c: VoterCard) => boolean) => cards.filter(bad).length;
  const noName = count((c) => !c.nameHi);
  const noAge = count((c) => c.age === null);
  const noRelation = count((c) => !c.relationTypeHi);
  // Punctuation typed into a name ("मो*") is printed that way and is cleaned later. A broken text
  // layer shows up as unmapped glyphs or letters of some other script.
  const foreign = count((c) => /[�-\u0000-\u001F]|(?![\u0000-ͯऀ-ॿ])\p{L}/u.test((c.nameHi + c.relationNameHi).replace(/[ŒœŠšŸŽžƒ]/g, "")));
  const marked = count((c) => !!c.marker || !!c.notes);
  const limit = Math.max(2, Math.ceil(cards.length * 0.005));
  if (noName > limit) problems.push(`${noName} cards without a name`);
  if (noAge > limit) problems.push(`${noAge} cards without an age`);
  if (noRelation > limit) problems.push(`${noRelation} cards without a relation line`);
  if (foreign > limit) problems.push(`${foreign} cards with unexpected characters in a name`);
  if (marked) problems.push(`${marked} cards carry a marker or unread text (possible deletion / correction)`);
  if (!cover.psNameHi) problems.push("polling station name not read from cover");
  if (!cover.psAddressHi) problems.push("polling station address not read from cover");
  if (!cover.districtHi) problems.push("district not read from cover");

  return {
    result: {
      schemaVersion: RESULT_SCHEMA_VERSION,
      file: base, hash, template: tpl.name, provider: "pdf-text", model: "pdf-text",
      pageCount: pages.length, partNo: cover.partNo, cover, pages: out,
      status: "ok", startedAt: now, finishedAt: now, usage: { ...zero },
    },
    problems,
  };
}
