/**
 * Local (Tesseract) OCR of eRoll pages. Produces cards with per-field confidences and a list
 * of reasons a card should be escalated to the vision model. Pure parsing helpers are exported
 * for unit tests.
 */
import sharp from "sharp";
import type { Band, Dims } from "./image.js";
import { pageSharp, type PageSource } from "./image.js";
import { detectColumnBands } from "./image.js";
import { asciiDigits, epicMatches, mapGender, mapRelation, normalizeEpic, parseIntLoose, parseSerialBox, tidyName } from "./normalize.js";
import { labelAlternation, labelRegex, scriptLetters, type Template } from "./templates.js";
import { tesseractBatch, type TessResult, type TessWord } from "./tesseract.js";
import type { PageType } from "./types.js";
import { editDistance } from "./util.js";

export interface Rect { left: number; top: number; width: number; height: number }

export interface LocalCard {
  rect: Rect;
  /** Index of `rect` in the rectangles given to localReadCards (cells that were not cards are skipped). */
  index: number;
  serial: number | null;
  serialConf: number;
  /** Marker printed before the serial: deletion reason letter (E S R M Q) or "#" (modified). */
  marker: string;
  /** Supplement digit glued to the marker ("S2 144" -> "2"). */
  markerSupplementNo: string;
  /** Section number from the small box next to the serial; "" when the card has none (main roll). */
  sectionNo: string;
  epicNo: string;
  epicRaw: string;
  epicConf: number;
  nameHi: string;
  nameConf: number;
  relationTypeHi: string;
  relationNameHi: string;
  relationConf: number;
  houseNo: string;
  houseConf: number;
  age: number | null;
  genderHi: string;
  ageGenderConf: number;
  deleted: boolean;
  /** Empty when the local read is trusted; otherwise why the card needs the vision model. */
  escalate: string[];
  /** Lowest confidence among the key fields, 0..1. */
  confidence: number;
}

const EPIC_RE = /[A-Z]{2,3}[0-9]{6,8}|[A-Z]{2}\/[0-9]{1,3}\/[0-9]{1,3}\/[0-9]{4,8}/;

/* ---------- pure parsing ---------- */

export function parseEpicText(text: string): string {
  const t = asciiDigits(text).toUpperCase().replace(/\s+/g, "");
  const m = EPIC_RE.exec(t);
  return m ? m[0] : t;
}

export interface Box { x: number; y: number; w: number; h: number }

export interface BodyFields {
  nameHi: string; nameConf: number;
  relationTypeHi: string; relationNameHi: string; relationConf: number;
  houseNo: string; houseConf: number;
  age: number | null; genderHi: string; ageGenderConf: number;
  deleted: boolean;
  /** Bounding box (in the body-crop's pixels) of the age/gender line, for the digit re-read. */
  ageLine?: Box;
}

function bbox(words: TessWord[]): Box | undefined {
  if (!words.length) return undefined;
  const x = Math.min(...words.map((w) => w.x)), y = Math.min(...words.map((w) => w.y));
  const r = Math.max(...words.map((w) => w.x + w.w)), b = Math.max(...words.map((w) => w.y + w.h));
  return { x, y, w: r - x, h: b - y };
}

/** Finds a gender word in a line, tolerating one OCR'd character (पुरूष, महीला / Femle). */
export function fuzzyGender(words: string[], genderWords: string[], script: Template["script"] = "devanagari"): string {
  const letters = script === "latin" ? /[^A-Za-z]/g : /[^ऀ-ॿ]/g;
  const norm = (x: string) => (script === "latin" ? x.toLowerCase() : x);
  for (const w of words) for (const g of genderWords) if (norm(w) === norm(g)) return g;
  for (const w of words) {
    const clean = norm(w.replace(letters, ""));
    if (clean.length < 3) continue;
    for (const g of genderWords) if (g.length >= 3 && editDistance(clean, norm(g).replace(letters, "")) <= 1) return g;
  }
  return "";
}

const LABEL_SPLIT = /\s*[:：]\s*/;

/** Whole-word test for a Latin label, substring test for Devanagari (OCR often glues marks). */
function hasLabel(line: string, label: string, script: Template["script"]): boolean {
  if (script === "latin") return new RegExp(`\\b${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}s?\\b`, "i").test(line);
  return line.includes(label);
}

/**
 * Parses the Tesseract read of a card body (name / relation / house / age-gender lines).
 * Labels come from the template (Hindi: नाम / पिता का नाम / मकान संख्या / आयु, लिंग; English:
 * Name / Fathers Name / House Number / Age, Gender); matching is tolerant of OCR damage and line
 * position is the fallback.
 */
export function parseCardBody(res: TessResult, tpl: Template): BodyFields {
  const out: BodyFields = {
    nameHi: "", nameConf: 0, relationTypeHi: "", relationNameHi: "", relationConf: 0,
    houseNo: "", houseConf: 0, age: null, genderHi: "", ageGenderConf: 0, deleted: false,
  };
  // Apostrophes vary between prints ("Father's Name" / "Fathers Name") and OCR; labels never need them.
  const lines = res.lines.filter((l) => l.text.trim()).map((l) => ({ ...l, text: l.text.replace(/['’]/g, "") }));
  const used = new Set<number>();
  const joined = res.text;
  if (/DELET|विलोपित/i.test(joined)) out.deleted = true;
  const script = tpl.script;
  const L = tpl.labels ?? {};
  const nameLabels = L.name?.length ? L.name : ["नाम"];
  const nameStartRe = new RegExp(`^\\W{0,2}(?:${labelAlternation(nameLabels)})\\s*[:：ः]`, "iu");
  const nameRe = labelRegex(nameLabels)!;
  const ageRe = labelRegex(L.age?.length ? L.age : ["आयु", "उम्र"])!;
  const genderRe = labelRegex(L.gender?.length ? L.gender : ["लिंग"])!;
  const houseRe = labelRegex(L.house?.length ? L.house : ["मकान संख्या", "गृह संख्या"])!;
  const houseLooseRe = labelRegex(L.houseLoose);
  const nameWord = script === "latin" ? /\bName\b/i : /नाम/;

  const valueOf = (line: { text: string; words: { text: string; conf: number }[] }): { value: string; conf: number } => {
    const idx = line.text.search(LABEL_SPLIT);
    if (idx < 0) return { value: "", conf: 0 };
    const value = tidyName(line.text.slice(idx).replace(LABEL_SPLIT, ""));
    // confidence = min conf of the words that form the value (last N words)
    const nValueWords = value ? value.split(/\s+/).length : 0;
    const ws = line.words.slice(Math.max(0, line.words.length - nValueWords));
    const conf = ws.length ? Math.min(...ws.map((w) => w.conf)) : 0;
    return { value, conf };
  };

  const ofScript = (k: string) => (script === "latin" ? /^[A-Za-z ]+$/.test(k) : /[ऀ-ॿ]/.test(k));
  const relationLabels = Object.keys(tpl.relationMap).filter((k) => ofScript(k) && !/ /.test(k)).sort((a, b) => a.length - b.length);
  const genderWords = Object.keys(tpl.genderMap).filter(ofScript).sort((a, b) => b.length - a.length);
  const findGender = (t: string): string => genderWords.find((gw) => hasLabel(t, gw, script)) ?? "";

  // 1. age/gender line: most distinctive (digits + gender word).
  for (const [i, l] of lines.entries()) {
    const t = asciiDigits(l.text);
    const g = findGender(t) || fuzzyGender(l.words.map((w) => w.text), genderWords, script);
    const ageM = /(?:^|[^\d])(\d{1,3})(?!\d)/.exec(t.replace(new RegExp(`^.*?${ageRe.source}`, "iu"), (m) => m.replace(/\d/g, " ")));
    if (g || ageRe.test(t) || genderRe.test(t)) {
      used.add(i);
      const ageWord = l.words.find((w) => /^\d{1,3}$/.test(asciiDigits(w.text)));
      out.age = ageWord ? parseIntLoose(ageWord.text) : ageM ? Number(ageM[1]) : null;
      out.genderHi = g;
      const gWord = l.words.find((w) => g && (hasLabel(w.text, g, script) || editDistance(w.text.replace(scriptLetters(tpl), "").toLowerCase(), g.replace(scriptLetters(tpl), "").toLowerCase()) <= 1));
      out.ageGenderConf = Math.min(ageWord?.conf ?? 0, gWord?.conf ?? 0);
      out.ageLine = bbox(l.words);
      break;
    }
  }
  // 2. relation line: "<पिता|पति|माता> का नाम: X" / "Fathers Name: X"
  for (const [i, l] of lines.entries()) {
    if (used.has(i)) continue;
    const lab = relationLabels.find((r) => hasLabel(l.text, r, script));
    if (lab && nameWord.test(l.text) && !nameStartRe.test(l.text)) {
      used.add(i);
      out.relationTypeHi = lab;
      const v = valueOf(l);
      out.relationNameHi = v.value;
      out.relationConf = v.conf;
      break;
    }
  }
  // 3. house line: "मकान संख्या : X" / "House Number : X" (label often damaged -> accept the loose label alone)
  for (const [i, l] of lines.entries()) {
    if (used.has(i)) continue;
    if ((houseRe.test(l.text) || houseLooseRe?.test(l.text)) && !ageRe.test(l.text) && !genderRe.test(l.text)) {
      used.add(i);
      const v = valueOf(l);
      out.houseNo = v.value;
      out.houseConf = v.value ? v.conf : 100; // an empty house number is legitimately common
      break;
    }
  }
  // 4. name line: "नाम : X" / "Name : X" - first remaining line that starts with the name label.
  for (const [i, l] of lines.entries()) {
    if (used.has(i)) continue;
    if (nameStartRe.test(l.text) || nameRe.test(l.text)) {
      used.add(i);
      const v = valueOf(l);
      out.nameHi = v.value;
      out.nameConf = v.conf;
      break;
    }
  }
  // Positional fallback: if the name is still missing, take the first unused line's value.
  if (!out.nameHi) {
    const first = lines.findIndex((_, i) => !used.has(i));
    if (first >= 0) {
      used.add(first);
      const v = valueOf(lines[first]);
      out.nameHi = v.value || tidyName(lines[first].text);
      out.nameConf = v.value ? v.conf : Math.min(...lines[first].words.map((w) => w.conf)) * 0.5;
    }
  }
  return out;
}

export interface HeaderInfo {
  pageType: PageType | null;
  partNo: string;
  sectionHeader: string;
  /** Main-roll pages: "अनुभाग संख्या और नाम : 1-कामबक्शपुर" / "Section No and Name 1-Near ..." */
  sectionNo: string;
  sectionName: string;
  /** "परिवर्धन की सूची 1", "List of Additions 1 (...)", or a "Supplement 2" line. */
  supplementNo: string;
}

const LIST_KINDS: { kind: PageType; hint: string; re: RegExp }[] = [
  { kind: "deletion_grid", hint: "deletion", re: /विलोपन(?:ों)?\s*की\s*सूची|List\s+of\s+Deletions?\b/i },
  { kind: "modification_grid", hint: "modification", re: /संशोधन(?:ों)?\s*की\s*सूची|List\s+of\s+Modifications?\b/i },
  { kind: "supplement_grid", hint: "supplement", re: /परिवर्धन(?:ों)?\s*की\s*सूची|पूरक\s*सूची|List\s+of\s+Additions?\b/i },
  { kind: "voter_grid", hint: "main", re: /अनुभाग\s*संख्या|Section\s*No\.?\s*(?:and|&)\s*Name/i },
];

/** A section name as printed on a header line, without the OCR debris of the other script. */
export function cleanSectionName(name: string, script: Template["script"]): string {
  const junk = script === "latin" ? /[ऀ-ॿ]/ : /[A-Za-z]/;
  return name
    .replace(/[^ऀ-ॿA-Za-z0-9\s.,()'/-]/g, " ")
    .split(/\s+/)
    .filter((t) => t && !junk.test(t))
    .join(" ")
    .replace(/^[\s.,/-]+|[\s.,/-]+$/g, "")
    .trim();
}

/**
 * Recognises the page kind from the header strip text + whether a card grid was found, and reads
 * the part / section / list numbers printed there. Works for Hindi and English rolls. When several
 * list headings appear (a supplement's description line names all three kinds, then "2- List of
 * Deletions" names the one on the page), the last one wins.
 */
export function classifyHeader(headerText: string, hasBands: boolean, pageNo: number, tpl: Template): HeaderInfo {
  const rawLines = asciiDigits(headerText).split(/\r?\n/).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  const t = rawLines.join(" ");
  const m = /(?:भाग\s*संख्या|Part\s*No\.?)\s*[:：\s]*(\d{1,4})/i.exec(t) || /(\d{1,4})\s*$/.exec(rawLines[0] ?? "");
  const partNo = m ? m[1] : "";
  const hintsOf = (h: string) => tpl.sectionHints[h] ?? [];
  let best: { kind: PageType; line: string } | null = null;
  for (const line of rawLines) {
    for (const k of LIST_KINDS) {
      if (hintsOf(k.hint).some((h) => line.includes(h)) || k.re.test(line)) {
        best = { kind: k.kind, line };
        break;
      }
    }
  }
  let pageType: PageType | null = null;
  // The summary page's bordered table looks like a card grid to the row detector, so its heading
  // decides regardless; a page whose header names a list is that list even when the grid detector
  // saw nothing (a last page with a single card has no full-width border).
  if (/निर्वाचकों\s*का\s*सार|निर्वाचकों\s*की\s*संख्या|नामावली\s*का\s*प्रकार|SUMMARY\s+OF\s+ELECTORS|NUMBER\s+OF\s+ELECTORS/i.test(t)) pageType = "summary";
  else if (best) pageType = best.kind;
  else if (!hasBands) pageType = pageNo === 1 ? "cover" : "other";
  // hasBands but no recognisable header -> null (caller decides)

  let sectionNo = "", sectionName = "", supplementNo = "";
  if (best?.kind === "voter_grid") {
    const sm = /(?:अनुभाग\s*संख्या\s*(?:और|व|एवं)?\s*नाम|Section\s*No\.?\s*(?:and|&)?\s*Name)\s*[:：]?\s*(\d{1,3})\s*[-–.]\s*(.*)$/i.exec(best.line);
    if (sm) {
      sectionNo = String(Number(sm[1]));
      sectionName = cleanSectionName(sm[2], tpl.script);
    }
  } else if (best) {
    const lm = /(?:सूची|Additions?|Deletions?|Modifications?)\s*[-–]?\s*(\d{1,2})\s*(?:\(|$)/i.exec(best.line);
    if (lm) supplementNo = String(Number(lm[1]));
  }
  if (!supplementNo) {
    const sp = /(?:Supplement|अनुपूरक|परिशिष्ट|पूरक\s*सूची)\s*(?:No\.?|संख्या)?\s*[:：-]?\s*(\d{1,2})\b/i.exec(t);
    if (sp) supplementNo = String(Number(sp[1]));
  }
  const second = rawLines.slice(1).join(" ").trim();
  return { pageType, partNo, sectionHeader: best?.line ?? second, sectionNo, sectionName, supplementNo };
}

/* ---------- image-level ---------- */

function sub(r: Rect, box: { left: number; top: number; width: number; height: number }): Rect {
  return {
    left: Math.round(r.left + r.width * box.left),
    top: Math.round(r.top + r.height * box.top),
    width: Math.max(1, Math.round(r.width * box.width)),
    height: Math.max(1, Math.round(r.height * box.height)),
  };
}

export async function readHeaderText(pngPath: PageSource, dims: Dims, tpl: Template, workDir: string, bands?: Band[] | null): Promise<string> {
  // Everything above the first card row is header (a separately published supplement has a
  // four-line header); without a grid, the template's fixed fraction.
  let h = Math.round(dims.height * tpl.local.headerFraction);
  if (bands && bands.length) h = Math.max(Math.round(dims.height * 0.02), Math.min(bands[0].top - 4, Math.round(dims.height * 0.2)));
  const png = await pageSharp(pngPath).extract({ left: 0, top: 0, width: dims.width, height: h }).greyscale().png().toBuffer();
  const [r] = await tesseractBatch([png], { langs: tpl.local.langs, psm: 6 }, workDir);
  return r?.text ?? "";
}

export interface FooterRead { page: number | null; total: number | null; text: string }

/** "कुल पृष्ठ 42 - पृष्ठ 40" (or "Page 40 of 42") -> { total: 42, page: 40 }. */
export function parseFooterText(text: string): FooterRead {
  const t = asciiDigits(text).replace(/\s+/g, " ").trim();
  const out: FooterRead = { page: null, total: null, text: t };
  let m = /(?:कुल\s*)?पृष्ठ\s*(\d{1,4})\s*[-–—]+\s*पृष्ठ\s*(\d{1,4})/.exec(t);
  if (m) { out.total = Number(m[1]); out.page = Number(m[2]); return out; }
  m = /Total\s*Pages?\s*(\d{1,4})\s*[-–—]+\s*Page\s*(\d{1,4})/i.exec(t);
  if (m) { out.total = Number(m[1]); out.page = Number(m[2]); return out; }
  m = /page\s*(\d{1,4})\s*(?:of|\/)\s*(\d{1,4})/i.exec(t);
  if (m) { out.page = Number(m[1]); out.total = Number(m[2]); return out; }
  const tot = /कुल\s*पृष्ठ\s*(\d{1,4})/.exec(t);
  if (tot) out.total = Number(tot[1]);
  const pg = /[-–—]\s*पृष्ठ\s*(\d{1,4})\s*$/.exec(t) ?? /पृष्ठ\s*(\d{1,4})\s*$/.exec(t);
  if (pg) out.page = Number(pg[1]);
  return out;
}

/** Reads the page number printed in the footer (bottom-right corner), upscaled for the small type. */
export async function readPrintedPage(pngPath: PageSource, dims: Dims, tpl: Template, workDir: string): Promise<FooterRead> {
  const frac = tpl.local.footerFraction ?? 0.045;
  const top = Math.round(dims.height * (1 - frac));
  const left = Math.round(dims.width * 0.5);
  const box = { left, top, width: dims.width - left, height: dims.height - top };
  const png = await pageSharp(pngPath).extract(box).resize({ width: box.width * 2, kernel: "lanczos3" }).greyscale().normalise()
    .extend({ top: 16, bottom: 16, left: 16, right: 16, background: "#fff" }).png().toBuffer();
  const [r] = await tesseractBatch([png], { langs: tpl.local.langs, psm: 7 }, workDir);
  return parseFooterText(r?.text ?? "");
}

export interface TopBoxes { serial: Rect | null; section: Rect | null }

/**
 * The small boxes printed along the top-left of a card (serial, and on supplement / deletion /
 * modification cards the section number), found from their own borders so the crops hold the
 * digits alone whatever the print size (A4 roll, oversized supplement). Null = not found.
 */
export async function detectTopBoxes(pngPath: PageSource, r: Rect): Promise<TopBoxes> {
  const w = Math.max(10, Math.round(r.width * 0.68));
  const h = Math.max(10, Math.round(r.height * 0.24));
  const { data } = await pageSharp(pngPath).extract({ left: r.left, top: r.top, width: w, height: h }).greyscale().raw().toBuffer({ resolveWithObject: true });
  const dark = 150;
  // Vertical rules: columns dark over at least half the strip (a box is 12-15% of the card, the
  // strip 24%, so a box border covers 50-65% of it; a digit stroke reaches ~35%).
  const colDark = new Int32Array(w);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (data[y * w + x] < dark) colDark[x]++;
  const rules: { x0: number; x1: number; full: boolean }[] = [];
  for (let x = 0; x < w; x++) {
    if (colDark[x] < h * 0.5) continue;
    const last = rules[rules.length - 1];
    if (last && x - last.x1 <= 2) { last.x1 = x; last.full = last.full || colDark[x] >= h * 0.95; }
    else rules.push({ x0: x, x1: x, full: colDark[x] >= h * 0.95 });
  }
  // Drop the card's own left border (dark over the whole strip) and anything too thick to be a rule.
  const xs = rules.filter((q) => !q.full && q.x0 > 2 && q.x1 - q.x0 < Math.max(6, r.width * 0.01));
  const boxes: Rect[] = [];
  for (let i = 0; i + 1 < xs.length && boxes.length < 2; i += 2) {
    const left = xs[i].x1 + 1, right = xs[i + 1].x0 - 1;
    if (right - left < r.width * 0.05 || right - left > r.width * 0.45) break;
    // Horizontal borders of this box: rows dark across most of its width but not across the whole
    // strip (that is the card's own top border).
    const rows: number[] = [];
    for (let y = 0; y < h; y++) {
      let d = 0, all = 0;
      for (let x = 0; x < w; x++) if (data[y * w + x] < dark) { all++; if (x >= left && x <= right) d++; }
      if (d >= (right - left) * 0.7 && all < w * 0.9) rows.push(y);
    }
    if (rows.length < 2) break;
    const top = rows[0] + 1, bottom = rows[rows.length - 1] - 1;
    if (bottom - top < r.height * 0.04) break;
    boxes.push({ left: r.left + left + 1, top: r.top + top + 1, width: Math.max(1, right - left - 2), height: Math.max(1, bottom - top - 2) });
  }
  return { serial: boxes[0] ?? null, section: boxes[1] ?? null };
}

/** Card rectangles for all detected bands (left-to-right, top-to-bottom). */
export async function cardRects(pngPath: PageSource, dims: Dims, bands: Band[], tpl: Template): Promise<Rect[]> {
  const rects: Rect[] = [];
  for (const b of bands) {
    const cols = await detectColumnBands(pngPath, dims, b, tpl);
    for (const c of cols) rects.push({ left: c.left, top: b.top, width: c.right - c.left, height: b.bottom - b.top });
  }
  return rects;
}

const latinInName = (s: string): boolean => /[A-Za-z]/.test(s);
/** Characters of the other script inside a name are OCR garbage. */
export const foreignInName = (s: string, script: Template["script"]): boolean => (script === "latin" ? /[ऀ-ॿ]/.test(s) : latinInName(s));

interface Read { v: string; conf: number }

/** Two reads of a name field: drop reads with garbage from the other script, prefer the confident one, reward agreement. */
export function voteName(a: Read, b: Read, script: Template["script"] = "devanagari"): Read {
  const ok = (r: Read): boolean => !!r.v && !foreignInName(r.v, script);
  const A = ok(a) ? a : null;
  const B = ok(b) ? b : null;
  if (A && B) {
    if (A.v === B.v) return { v: A.v, conf: Math.min(100, Math.max(A.conf, B.conf) + 5) };
    return A.conf >= B.conf ? A : B;
  }
  return A ?? B ?? (a.v ? a : b); // keep a garbled read so the flags fire, rather than silently empty
}

/** Majority vote over EPIC reads; a lone pattern-matching read is accepted but never fully trusted. */
export function voteEpic(reads: Read[], tpl: Template): Read {
  const valid = reads.filter((r) => r.v && epicMatches(r.v, tpl));
  const counts = new Map<string, Read[]>();
  for (const r of valid) (counts.get(r.v) ?? counts.set(r.v, []).get(r.v)!).push(r);
  let best: Read[] | null = null;
  for (const group of counts.values()) if (!best || group.length > best.length || (group.length === best.length && Math.max(...group.map((r) => r.conf)) > Math.max(...best.map((r) => r.conf)))) best = group;
  if (best && best.length >= 2) return { v: best[0].v, conf: Math.max(...best.map((r) => r.conf)) };
  if (best) return { v: best[0].v, conf: Math.min(best[0].conf, 75) };
  const any = reads.filter((r) => r.v).sort((x, y) => y.conf - x.conf)[0];
  return any ? { v: any.v, conf: Math.min(any.conf, 50) } : { v: "", conf: 0 };
}

/** Merges the eng+hin body read (A: labels, digits) with the Hindi-only read (B: names). */
export function mergeBodies(A: BodyFields, B: BodyFields, script: Template["script"] = "devanagari"): BodyFields {
  const name = voteName({ v: A.nameHi, conf: A.nameConf }, { v: B.nameHi, conf: B.nameConf }, script);
  const rel = voteName({ v: A.relationNameHi, conf: A.relationConf }, { v: B.relationNameHi, conf: B.relationConf }, script);
  const ageFromA = A.age !== null;
  return {
    nameHi: name.v, nameConf: name.conf,
    relationTypeHi: A.relationTypeHi || B.relationTypeHi,
    relationNameHi: rel.v, relationConf: rel.conf,
    houseNo: A.houseNo || B.houseNo, houseConf: A.houseNo ? A.houseConf : B.houseConf,
    age: ageFromA ? A.age : B.age,
    genderHi: A.genderHi || B.genderHi,
    ageGenderConf: ageFromA ? (A.age === B.age && A.genderHi === B.genderHi ? Math.min(100, Math.max(A.ageGenderConf, B.ageGenderConf) + 5) : A.ageGenderConf) : B.ageGenderConf,
    deleted: A.deleted || B.deleted,
    ageLine: A.ageLine ?? B.ageLine,
  };
}

/**
 * Tesseract passes over every card on a page, all batched:
 *   EPIC 1x / 2x / 3x-binarised (eng, whitelist) -> majority vote
 *   serial box (digits) -> cross-checked with grid order by the caller
 *   body eng+hin (labels, digits) + body Hindi-only 2x (names) -> per-field vote
 *   age line re-read at 3x with a digit whitelist when the body read is unsure
 */
export async function localReadCards(pngPath: PageSource, rects: Rect[], tpl: Template, workDir: string, minConf: number): Promise<LocalCard[]> {
  if (rects.length === 0) return [];
  const L = tpl.local;
  const img = { clone: () => pageSharp(pngPath) }; // a fresh instance per crop (see pageSharp)
  const epicCrops: Buffer[] = [];
  const epicCrops2x: Buffer[] = [];
  const epicCrops3x: Buffer[] = [];
  const serialCrops: Buffer[] = [];
  const serialCrops3x: Buffer[] = [];
  const sectionCrops: Buffer[] = [];
  const sectionCrops4x: Buffer[] = [];
  const serialBoxFound: boolean[] = [];
  const bodyCrops: Buffer[] = [];
  const bodyCropsHi: Buffer[] = [];
  const hindiOnly = L.langs.split("+").includes("hin") ? "hin" : L.langs;
  for (const r of rects) {
    const e = sub(r, L.epicBox);
    epicCrops.push(await img.clone().extract(e).greyscale().png().toBuffer());
    epicCrops2x.push(await img.clone().extract(e).resize({ width: e.width * 2, kernel: "lanczos3" }).greyscale().normalise().png().toBuffer());
    epicCrops3x.push(await img.clone().extract(e).resize({ width: e.width * 3, kernel: "lanczos3" }).greyscale().normalise().threshold(165).png().toBuffer());
    // Serial / section box interiors only (the box borders confuse tesseract), found from the
    // borders themselves, else from the template; padded with white and upscaled.
    const found = await detectTopBoxes(pngPath, r);
    serialBoxFound.push(!!found.serial);
    // Box interiors with a margin off the borders (a border row left in the crop turns a "2" into a "1").
    const inner = (b: Rect): Rect => {
      const mx = Math.max(3, Math.round(b.height * 0.06)), my = Math.max(3, Math.round(b.height * 0.07));
      return { left: b.left + mx, top: b.top + my, width: Math.max(4, b.width - 2 * mx), height: Math.max(4, b.height - 2 * my) };
    };
    const sb = found.serial ? inner(found.serial) : sub(r, L.serialBox);
    const pad = { top: 16, bottom: 16, left: 24, right: 24, background: "#fff" };
    // Digits read best at 60-100 px tall: the A4 boxes (~45 px) are doubled, the oversized
    // supplement print (~100 px) is read as is (doubling it loses the leading digit).
    const scaleOf = (b: Rect): number => (b.height >= 70 ? 1 : b.height >= 40 ? 2 : 3);
    const up = (b: Rect, k: number) => (k > 1 ? img.clone().extract(b).resize({ width: b.width * k, kernel: "lanczos3" }) : img.clone().extract(b));
    serialCrops.push(await up(sb, scaleOf(sb)).greyscale().extend(pad).png().toBuffer());
    serialCrops3x.push(await up(sb, 2).greyscale().extend(pad).png().toBuffer());
    // A main-roll card has no section box: only a box found by its borders is read (twice: plain
    // and binarised at double scale, the small digit is faint on the oversized supplement print).
    const xb = found.section ? inner(found.section) : null;
    const blank = async () => sharp({ create: { width: 40, height: 20, channels: 3, background: "#fff" } }).png().toBuffer();
    sectionCrops.push(xb ? await up(xb, scaleOf(xb)).greyscale().extend(pad).png().toBuffer() : await blank());
    sectionCrops4x.push(xb ? await up(xb, scaleOf(xb) * 2).greyscale().normalise().threshold(160).extend(pad).png().toBuffer() : await blank());
    const bb = sub(r, L.bodyBox);
    bodyCrops.push(await img.clone().extract(bb).greyscale().png().toBuffer());
    bodyCropsHi.push(await img.clone().extract(bb).resize({ width: bb.width * 2, kernel: "lanczos3" }).greyscale().normalise().png().toBuffer());
  }
  const WL = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/";
  // The serial box is read twice: digits only (the serial itself) and with letters, for the marker a
  // deletion / modification card prints before the serial ("S2 144", "#2 93", "R 1084").
  const SWL = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ# ";
  const [epicRes, epic2xRes, epic3xRes, serialRes, serialAlnumRes, serialWordRes, sectionRes, section4xRes, bodyRes, bodyHiRes] = await Promise.all([
    tesseractBatch(epicCrops, { langs: "eng", psm: 7, whitelist: WL }, workDir),
    tesseractBatch(epicCrops2x, { langs: "eng", psm: 7, whitelist: WL }, workDir),
    tesseractBatch(epicCrops3x, { langs: "eng", psm: 7, whitelist: WL }, workDir),
    tesseractBatch(serialCrops, { langs: "eng", psm: 7, whitelist: "0123456789" }, workDir),
    tesseractBatch(serialCrops, { langs: "eng", psm: 7, whitelist: SWL }, workDir),
    tesseractBatch(serialCrops3x, { langs: "eng", psm: 8, whitelist: SWL.trim() }, workDir),
    tesseractBatch(sectionCrops, { langs: "eng", psm: 7, whitelist: "0123456789" }, workDir),
    tesseractBatch(sectionCrops4x, { langs: "eng", psm: 7, whitelist: "0123456789" }, workDir),
    tesseractBatch(bodyCrops, { langs: L.langs, psm: 6 }, workDir),
    tesseractBatch(bodyCropsHi, { langs: hindiOnly, psm: 6 }, workDir),
  ]);

  const empty: TessResult = { text: "", words: [], lines: [] };
  const bodies: BodyFields[] = rects.map((_, i) => mergeBodies(parseCardBody(bodyRes[i] ?? empty, tpl), parseCardBody(bodyHiRes[i] ?? empty, tpl), tpl.script));

  // Second round: digits-only re-read of the age line where the body read is missing or unsure.
  const ageIdx = bodies.map((b, i) => (b.ageLine && (b.age === null || b.ageGenderConf < 90) ? i : -1)).filter((i) => i >= 0);
  const ageCrops = await Promise.all(
    ageIdx.map(async (i) => {
      const box = bodies[i].ageLine!;
      const meta = await sharp(bodyCrops[i]).metadata();
      const left = Math.max(0, box.x - 4), top = Math.max(0, box.y - 4);
      const width = Math.min((meta.width ?? box.w) - left, box.w + 8), height = Math.min((meta.height ?? box.h) - top, box.h + 8);
      return sharp(bodyCrops[i]).extract({ left, top, width, height }).resize({ width: width * 3, kernel: "lanczos3" }).normalise()
        .extend({ top: 12, bottom: 12, left: 12, right: 12, background: "#fff" }).png().toBuffer();
    }),
  );
  const ageRes = await tesseractBatch(ageCrops, { langs: "eng", psm: 7, whitelist: "0123456789 " }, workDir);
  ageIdx.forEach((i, k) => {
    const r = ageRes[k];
    const nums = (r?.text ?? "").split(/\s+/).map((s) => s.replace(/\D/g, "")).filter((s) => s.length >= 1 && s.length <= 3).map(Number).filter((n) => n >= 0 && n <= 120);
    if (!nums.length) return;
    const conf = r.words.length ? Math.min(...r.words.map((w) => w.conf)) : 0;
    const b = bodies[i];
    if (b.age === null) { b.age = nums[0]; b.ageGenderConf = Math.min(b.ageGenderConf || conf, conf); }
    else if (nums.includes(b.age)) b.ageGenderConf = Math.min(100, Math.max(b.ageGenderConf, conf));
    else if (conf > b.ageGenderConf + 10) { b.age = nums[0]; b.ageGenderConf = Math.min(conf, 80); }
  });

  const cards: LocalCard[] = [];
  for (let i = 0; i < rects.length; i++) {
    // A bordered cell that is not a card: no serial box along its top and no EPIC (the totals table
    // under a supplement list, a summary table row), or nothing voter-like at all.
    const probe = bodies[i];
    const epicText = parseEpicText(epicRes[i]?.text ?? "");
    const hasEpic = EPIC_RE.test(epicText);
    if (!hasEpic && !serialBoxFound[i]) continue;
    if (!hasEpic && !probe.nameHi.trim() && !probe.relationNameHi && probe.age === null && !probe.genderHi) continue;
    const epic = (() => {
      const reads = [epicRes[i], epic2xRes[i], epic3xRes[i]].map((r) => ({
        v: normalizeEpic(parseEpicText(r?.text ?? "")).epic,
        conf: r?.words.length ? Math.min(...r.words.map((w) => w.conf)) : 0,
      }));
      const v = voteEpic(reads, tpl);
      return { epic: v.v, conf: v.conf };
    })();

    // Two words far apart in the box = marker and serial; a small gap is kerning inside one number.
    const sw = serialAlnumRes[i]?.words ?? [];
    const wideGap = sw.length >= 2 ? sw[sw.length - 1].x - (sw[sw.length - 2].x + sw[sw.length - 2].w) > Math.max(...sw.map((w) => w.h)) * 1.2 : true;
    const { serial, marker, supplementNo: markerSupplementNo } = parseSerialBox(serialAlnumRes[i]?.text ?? "", serialRes[i]?.text ?? "", serialWordRes[i]?.text ?? "", wideGap);
    const serialConf = serialRes[i]?.words.length ? Math.min(...serialRes[i].words.map((w) => w.conf)) : 0;
    const secReads = [sectionRes[i], section4xRes[i]].map((x) => ({ v: asciiDigits(x?.text ?? "").replace(/\D/g, ""), conf: x?.words.length ? Math.min(...x.words.map((w) => w.conf)) : 0 })).filter((x) => x.v.length >= 1 && x.v.length <= 3);
    const secBest = secReads.length === 2 && secReads[0].v === secReads[1].v ? secReads[0] : secReads.sort((x, y) => y.conf - x.conf)[0];
    const sectionNo = secBest ? String(Number(secBest.v)) : "";

    const body = bodies[i];

    const escalate: string[] = [];
    // Letters of the other script inside a name are OCR garbage ("ok सिंह", "fast"), always escalate.
    if (!epic.epic || !epicMatches(epic.epic, tpl)) escalate.push("epic_unreadable");
    else if (epic.conf < minConf * 100) escalate.push("epic_low_conf");
    if (!body.nameHi) escalate.push("name_unreadable");
    else if (foreignInName(body.nameHi, tpl.script)) escalate.push("name_garbled");
    else if (body.nameConf < minConf * 100) escalate.push("name_low_conf");
    if (body.relationNameHi && foreignInName(body.relationNameHi, tpl.script)) escalate.push("relation_name_garbled");
    if (body.relationTypeHi && !mapRelation(body.relationTypeHi, tpl)) escalate.push("relation_unknown");
    if (!body.relationTypeHi) escalate.push("relation_unreadable");
    else if (body.relationConf < minConf * 100 || !body.relationNameHi) escalate.push("relation_name_low_conf");
    if (body.age === null || body.age < 0 || body.age > 120) escalate.push("age_unreadable");
    if (!body.genderHi || !mapGender(body.genderHi, tpl)) escalate.push("gender_unreadable");
    else if (body.ageGenderConf < minConf * 100) escalate.push("age_gender_low_conf");
    // An unreadable serial box alone is not worth a model call: serials come from grid order.

    const key = [epic.conf, body.nameConf, body.relationConf, body.ageGenderConf].map((c) => c / 100);
    cards.push({
      rect: rects[i],
      index: i,
      serial, serialConf, marker, markerSupplementNo, sectionNo,
      epicNo: epic.epic, epicRaw: epicRes[i]?.text ?? "", epicConf: epic.conf,
      nameHi: body.nameHi, nameConf: body.nameConf,
      relationTypeHi: body.relationTypeHi, relationNameHi: body.relationNameHi, relationConf: body.relationConf,
      houseNo: body.houseNo, houseConf: body.houseConf,
      age: body.age, genderHi: body.genderHi, ageGenderConf: body.ageGenderConf,
      deleted: body.deleted,
      escalate,
      confidence: Math.max(0, Math.min(...key)),
    });
  }
  return cards;
}
