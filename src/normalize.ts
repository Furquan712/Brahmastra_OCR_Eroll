import type { CardOut } from "./schemas.js";
import type { Template } from "./templates.js";
import type { VoterCard } from "./types.js";

const DEVANAGARI_DIGITS = "०१२३४५६७८९";

export function asciiDigits(s: string): string {
  return s.replace(/[०-९]/g, (d) => String(DEVANAGARI_DIGITS.indexOf(d)));
}

export function parseIntLoose(s: string): number | null {
  const m = /-?\d+/.exec(asciiDigits(s));
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

/**
 * Cleans an EPIC: uppercase, strip whitespace/stray punctuation, Devanagari digits -> ASCII,
 * and fix O/0 I/1 confusions in the numeric tail of the common 3-letter+7-digit format.
 */
export function normalizeEpic(raw: string): { epic: string; corrected: boolean } {
  let e = asciiDigits(raw).toUpperCase().replace(/[\s ]/g, "").replace(/[^A-Z0-9/]/g, "");
  let corrected = false;
  // 3 letters + 7 "digit-ish" chars: fix letter/digit confusions in the tail only.
  const m = /^([A-Z]{3})([A-Z0-9]{7})$/.exec(e);
  if (m && /[OIlSBZ]/.test(m[2])) {
    const tail = m[2].replace(/O/g, "0").replace(/I/g, "1").replace(/L/g, "1").replace(/S/g, "5").replace(/B/g, "8").replace(/Z/g, "2");
    if (/^\d{7}$/.test(tail)) {
      e = m[1] + tail;
      corrected = true;
    }
  }
  return { epic: e, corrected };
}

export function epicMatches(epic: string, tpl: Template): boolean {
  return tpl.epicPatterns.some((p) => new RegExp(p).test(epic));
}

function cleanLabel(s: string): string {
  return s.replace(/[:\-–.]+$/g, "").replace(/\s+/g, " ").trim();
}

/** Closed-vocabulary lookup; falls back to substring match on the keys. */
export function mapRelation(hi: string, tpl: Template): string {
  const k = cleanLabel(hi);
  if (!k) return "";
  if (tpl.relationMap[k]) return tpl.relationMap[k];
  const lower = k.toLowerCase();
  for (const [key, val] of Object.entries(tpl.relationMap)) {
    if (key.toLowerCase() === lower) return val;
  }
  // substring (e.g. "पिता का नाम" vs "पिता")
  for (const [key, val] of Object.entries(tpl.relationMap)) {
    if (/[ऀ-ॿ]/.test(key) && (k.includes(key) || key.includes(k))) return val;
  }
  return "";
}

export function mapGender(hi: string, tpl: Template): string {
  const k = cleanLabel(hi);
  if (!k) return "";
  if (tpl.genderMap[k]) return tpl.genderMap[k];
  const lower = k.toLowerCase();
  for (const [key, val] of Object.entries(tpl.genderMap)) {
    if (key.toLowerCase() === lower) return val;
  }
  for (const [key, val] of Object.entries(tpl.genderMap)) {
    if (/[ऀ-ॿ]/.test(key) && k.includes(key)) return val;
  }
  return "";
}

export function tidyName(s: string): string {
  return s.replace(/\s+/g, " ").replace(/^[\s:.-]+/, "").trim();
}

// Combining marks that cannot start a token (vowel signs, nukta, virama, nasal/visarga, accents).
const LEADING_MARKS = /^[\u0900-\u0903\u093A-\u093C\u093E-\u094F\u0951-\u0957\u0962\u0963]+/;
// Vedic accents / rare signs tesseract emits for print noise; never part of a name.
const NOISE_MARKS = /[\u0951-\u0954\u0955-\u0957\u0970\u0973-\u097F]/g;

/**
 * A Hindi name field as read: keeps Devanagari letters and marks, spaces, hyphens, the dot of an
 * abbreviation ("मो.") and the "0" the rolls print as an abbreviation sign ("कु0", "मौ0").
 * Drops OCR garbage: quotes, "@", "|", stray marks with no base letter, tokens with no Devanagari
 * letter at all ("“", ";", "754", "ok"), and Latin letters glued to a Devanagari token.
 */
export function cleanNameHi(raw: string): string {
  let t = asciiDigits(raw.normalize("NFC"))
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(NOISE_MARKS, "")
    .replace(/[\u0964\u0965]/g, ".") // danda
    .replace(/[^\u0900-\u097F0-9A-Za-z\s.\-]/g, " ") // quotes, @, |, _, brackets, ...
    .replace(/\s+/g, " ")
    .trim();
  const tokens: string[] = [];
  for (let tok of t.split(" ")) {
    tok = tok.replace(LEADING_MARKS, "").replace(/^[.\-]+/, "");
    if (!/[\u0905-\u0939\u0958-\u0961\u0972-\u097F]/.test(tok)) continue; // no Devanagari letter: garbage
    tok = tok.replace(/[A-Za-z]/g, ""); // Latin glued to Devanagari
    // digits only as a trailing abbreviation sign after a letter ("कु0"); elsewhere they are noise
    tok = tok.replace(/^\d+|(?<![\u0900-\u097F])\d+|\d+(?=[\u0900-\u097F])/g, "").replace(/\d{2,}$/, "0");
    tok = tok.replace(/\.{2,}/g, ".").replace(/-{2,}/g, "-").replace(/[.\-]+$/, (m) => (m.includes(".") ? "." : ""));
    tok = tok.replace(LEADING_MARKS, "");
    if (tok) tokens.push(tok);
  }
  return tokens.join(" ");
}

/**
 * Model card -> normalized VoterCard. Pure; flags are computed separately in validate.ts.
 * English names are left empty here: the pipeline fills them from the local transliterator.
 */
export function normalizeCard(c: CardOut, tpl: Template): VoterCard {
  const { epic } = normalizeEpic(c.epicNo);
  return {
    serial: parseIntLoose(c.serial),
    epicNo: epic,
    nameHi: cleanNameHi(c.nameHi),
    nameEn: "",
    relationTypeHi: cleanLabel(c.relationTypeHi),
    relationType: mapRelation(c.relationTypeHi, tpl),
    relationNameHi: cleanNameHi(c.relationNameHi),
    relationNameEn: "",
    houseNo: tidyName(c.houseNo),
    age: parseIntLoose(c.age),
    genderHi: cleanLabel(c.genderHi),
    genderEn: mapGender(c.genderHi, tpl),
    confidence: c.confidence,
    notes: c.notes,
    deleted: c.deleted,
  };
}
