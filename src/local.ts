/**
 * Local (Tesseract) OCR of eRoll pages. Produces cards with per-field confidences and a list
 * of reasons a card should be escalated to the vision model. Pure parsing helpers are exported
 * for unit tests.
 */
import sharp from "sharp";
import type { Band, Dims } from "./image.js";
import { detectColumnBands } from "./image.js";
import { asciiDigits, epicMatches, mapGender, mapRelation, normalizeEpic, parseIntLoose, tidyName } from "./normalize.js";
import type { Template } from "./templates.js";
import { tesseractBatch, type TessResult, type TessWord } from "./tesseract.js";
import type { PageType } from "./types.js";
import { editDistance } from "./util.js";

export interface Rect { left: number; top: number; width: number; height: number }

export interface LocalCard {
  rect: Rect;
  serial: number | null;
  serialConf: number;
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

/** Finds a gender word in a line, tolerating one OCR'd character (पुरूष, महीला). */
export function fuzzyGender(words: string[], genderWords: string[]): string {
  for (const w of words) for (const g of genderWords) if (w === g) return g;
  for (const w of words) {
    const clean = w.replace(/[^ऀ-ॿ]/g, "");
    if (clean.length < 3) continue;
    for (const g of genderWords) if (g.length >= 3 && editDistance(clean, g) <= 1) return g;
  }
  return "";
}

const LABEL_SPLIT = /\s*[:：]\s*/;

/**
 * Parses the Tesseract read of a card body (name / relation / house / age-gender lines).
 * Label matching is tolerant of OCR damage; line position is the fallback.
 */
export function parseCardBody(res: TessResult, tpl: Template): BodyFields {
  const out: BodyFields = {
    nameHi: "", nameConf: 0, relationTypeHi: "", relationNameHi: "", relationConf: 0,
    houseNo: "", houseConf: 0, age: null, genderHi: "", ageGenderConf: 0, deleted: false,
  };
  const lines = res.lines.filter((l) => l.text.trim());
  const used = new Set<number>();
  const joined = res.text;
  if (/DELETED|विलोपित|DELETE/i.test(joined)) out.deleted = true;

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

  const relationLabels = Object.keys(tpl.relationMap).filter((k) => /[ऀ-ॿ]/.test(k) && !/ /.test(k));
  const genderWords = Object.keys(tpl.genderMap).filter((k) => /[ऀ-ॿ]/.test(k));

  // 1. age/gender line: most distinctive (digits + gender word).
  for (const [i, l] of lines.entries()) {
    const t = asciiDigits(l.text);
    const g = genderWords.find((gw) => t.includes(gw)) || fuzzyGender(l.words.map((w) => w.text), genderWords);
    const ageM = /(?:^|[^\d])(\d{1,3})(?!\d)/.exec(t.replace(/^.*?आयु|^.*?उम्र/u, (m) => m.replace(/\d/g, " ")));
    if (g || /आयु|उम्र|लिंग/.test(t)) {
      used.add(i);
      const ageWord = l.words.find((w) => /^\d{1,3}$/.test(asciiDigits(w.text)));
      out.age = ageWord ? parseIntLoose(ageWord.text) : ageM ? Number(ageM[1]) : null;
      out.genderHi = g ?? "";
      const gWord = l.words.find((w) => g && (w.text.includes(g) || editDistance(w.text.replace(/[^ऀ-ॿ]/g, ""), g) <= 1));
      out.ageGenderConf = Math.min(ageWord?.conf ?? 0, gWord?.conf ?? 0);
      out.ageLine = bbox(l.words);
      break;
    }
  }
  // 2. relation line: "<पिता|पति|माता> का नाम: X"
  for (const [i, l] of lines.entries()) {
    if (used.has(i)) continue;
    const lab = relationLabels.find((r) => l.text.includes(r));
    if (lab && /नाम|नामः|नाम:/.test(l.text) && !/^\s*नाम\b/.test(l.text)) {
      used.add(i);
      out.relationTypeHi = lab;
      const v = valueOf(l);
      out.relationNameHi = v.value;
      out.relationConf = v.conf;
      break;
    }
  }
  // 3. house line: "मकान संख्या : X" (label often damaged -> accept "संख्या" alone)
  for (const [i, l] of lines.entries()) {
    if (used.has(i)) continue;
    if (/(मकान|गृह|संख्या|सकान)/.test(l.text) && !/आयु|लिंग/.test(l.text)) {
      used.add(i);
      const v = valueOf(l);
      out.houseNo = v.value;
      out.houseConf = v.value ? v.conf : 100; // an empty house number is legitimately common
      break;
    }
  }
  // 4. name line: "नाम : X" - first remaining line that starts with the name label.
  for (const [i, l] of lines.entries()) {
    if (used.has(i)) continue;
    if (/^\s*(नाम|नामः|नाम:)/.test(l.text) || /नाम/.test(l.text)) {
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

/** Recognise the page kind from the header strip text + whether a card grid was found. */
export function classifyHeader(headerText: string, hasBands: boolean, pageNo: number, tpl: Template): { pageType: PageType | null; partNo: string; sectionHeader: string } {
  const rawLines = asciiDigits(headerText).split(/\r?\n/).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  const t = rawLines.join(" ");
  const m = /भाग\s*संख्या\s*[:：\s]*(\d{1,4})/.exec(t) || /(\d{1,4})\s*$/.exec(rawLines[0] ?? "");
  const partNo = m ? m[1] : "";
  const hit = (keys: string[] | undefined) => (keys ?? []).some((k) => t.includes(k));
  const second = rawLines.slice(1).join(" ").trim();
  let pageType: PageType | null = null;
  if (pageNo === 1) pageType = "cover";
  else if (/निर्वाचकों का सार|निर्वाचकों की संख्या|नामावली का प्रकार/.test(t) && !hasBands) pageType = "summary";
  else if (hit(tpl.sectionHints.deletion) || /विलोपन/.test(t)) pageType = "deletion_grid";
  else if (hit(tpl.sectionHints.modification) || /संशोधन/.test(t)) pageType = "modification_grid";
  else if (hit(tpl.sectionHints.supplement) || /परिवर्धन|पूरक/.test(t)) pageType = "supplement_grid";
  else if (hit(tpl.sectionHints.main) || /अनुभाग/.test(t)) pageType = "voter_grid";
  else if (!hasBands) pageType = "other";
  // hasBands but no recognisable header -> null (caller asks the vision model)
  if (pageType && pageType.endsWith("_grid") && !hasBands) pageType = null;
  return { pageType, partNo, sectionHeader: second };
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

export async function readHeaderText(pngPath: string, dims: Dims, tpl: Template, workDir: string): Promise<string> {
  const h = Math.round(dims.height * tpl.local.headerFraction);
  const png = await sharp(pngPath).extract({ left: 0, top: 0, width: dims.width, height: h }).greyscale().png().toBuffer();
  const [r] = await tesseractBatch([png], { langs: tpl.local.langs, psm: 6 }, workDir);
  return r?.text ?? "";
}

/** Card rectangles for all detected bands (left-to-right, top-to-bottom). */
export async function cardRects(pngPath: string, dims: Dims, bands: Band[], tpl: Template): Promise<Rect[]> {
  const rects: Rect[] = [];
  for (const b of bands) {
    const cols = await detectColumnBands(pngPath, dims, b, tpl);
    for (const c of cols) rects.push({ left: c.left, top: b.top, width: c.right - c.left, height: b.bottom - b.top });
  }
  return rects;
}

const latinInName = (s: string): boolean => /[A-Za-z]/.test(s);

interface Read { v: string; conf: number }

/** Two reads of a Devanagari field: drop Latin garbage, prefer the confident one, reward agreement. */
export function voteName(a: Read, b: Read): Read {
  const ok = (r: Read): boolean => !!r.v && !latinInName(r.v);
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
export function mergeBodies(A: BodyFields, B: BodyFields): BodyFields {
  const name = voteName({ v: A.nameHi, conf: A.nameConf }, { v: B.nameHi, conf: B.nameConf });
  const rel = voteName({ v: A.relationNameHi, conf: A.relationConf }, { v: B.relationNameHi, conf: B.relationConf });
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
export async function localReadCards(pngPath: string, rects: Rect[], tpl: Template, workDir: string, minConf: number): Promise<LocalCard[]> {
  if (rects.length === 0) return [];
  const L = tpl.local;
  const img = sharp(pngPath);
  const epicCrops: Buffer[] = [];
  const epicCrops2x: Buffer[] = [];
  const epicCrops3x: Buffer[] = [];
  const serialCrops: Buffer[] = [];
  const bodyCrops: Buffer[] = [];
  const bodyCropsHi: Buffer[] = [];
  const hindiOnly = L.langs.split("+").includes("hin") ? "hin" : L.langs;
  for (const r of rects) {
    const e = sub(r, L.epicBox);
    epicCrops.push(await img.clone().extract(e).greyscale().png().toBuffer());
    epicCrops2x.push(await img.clone().extract(e).resize({ width: e.width * 2, kernel: "lanczos3" }).greyscale().normalise().png().toBuffer());
    epicCrops3x.push(await img.clone().extract(e).resize({ width: e.width * 3, kernel: "lanczos3" }).greyscale().normalise().threshold(165).png().toBuffer());
    // Serial box interior only (the box border confuses tesseract), padded with white and upscaled.
    const sb = sub(r, L.serialBox);
    serialCrops.push(
      await img.clone().extract(sb).resize({ width: sb.width * 2, kernel: "lanczos3" }).greyscale()
        .extend({ top: 16, bottom: 16, left: 24, right: 24, background: "#fff" }).png().toBuffer(),
    );
    const bb = sub(r, L.bodyBox);
    bodyCrops.push(await img.clone().extract(bb).greyscale().png().toBuffer());
    bodyCropsHi.push(await img.clone().extract(bb).resize({ width: bb.width * 2, kernel: "lanczos3" }).greyscale().normalise().png().toBuffer());
  }
  const WL = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/";
  const [epicRes, epic2xRes, epic3xRes, serialRes, bodyRes, bodyHiRes] = await Promise.all([
    tesseractBatch(epicCrops, { langs: "eng", psm: 7, whitelist: WL }, workDir),
    tesseractBatch(epicCrops2x, { langs: "eng", psm: 7, whitelist: WL }, workDir),
    tesseractBatch(epicCrops3x, { langs: "eng", psm: 7, whitelist: WL }, workDir),
    tesseractBatch(serialCrops, { langs: "eng", psm: 7, whitelist: "0123456789" }, workDir),
    tesseractBatch(bodyCrops, { langs: L.langs, psm: 6 }, workDir),
    tesseractBatch(bodyCropsHi, { langs: hindiOnly, psm: 6 }, workDir),
  ]);

  const empty: TessResult = { text: "", words: [], lines: [] };
  const bodies: BodyFields[] = rects.map((_, i) => mergeBodies(parseCardBody(bodyRes[i] ?? empty, tpl), parseCardBody(bodyHiRes[i] ?? empty, tpl)));

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
    const epic = (() => {
      const reads = [epicRes[i], epic2xRes[i], epic3xRes[i]].map((r) => ({
        v: normalizeEpic(parseEpicText(r?.text ?? "")).epic,
        conf: r?.words.length ? Math.min(...r.words.map((w) => w.conf)) : 0,
      }));
      const v = voteEpic(reads, tpl);
      return { epic: v.v, conf: v.conf };
    })();

    const serialText = asciiDigits(serialRes[i]?.text ?? "").replace(/\D/g, "");
    const serial = serialText ? Number(serialText.slice(0, 5)) : null;
    const serialConf = serialRes[i]?.words.length ? Math.min(...serialRes[i].words.map((w) => w.conf)) : 0;

    const body = bodies[i];

    const escalate: string[] = [];
    // Latin letters inside a Devanagari name are OCR garbage ("ok सिंह", "fast"), always escalate.
    if (!epic.epic || !epicMatches(epic.epic, tpl)) escalate.push("epic_unreadable");
    else if (epic.conf < minConf * 100) escalate.push("epic_low_conf");
    if (!body.nameHi) escalate.push("name_unreadable");
    else if (latinInName(body.nameHi)) escalate.push("name_garbled");
    else if (body.nameConf < minConf * 100) escalate.push("name_low_conf");
    if (body.relationNameHi && latinInName(body.relationNameHi)) escalate.push("relation_name_garbled");
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
      serial, serialConf,
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
