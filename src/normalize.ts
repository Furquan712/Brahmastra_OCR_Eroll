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
  const m = /^([A-Z]{3})([A-Z0-9/]{7})$/.exec(e);
  if (m && /[OIlSBZ/]/.test(m[2])) {
    const tail = m[2].replace(/O/g, "0").replace(/I/g, "1").replace(/L/g, "1").replace(/S/g, "5").replace(/B/g, "8").replace(/Z/g, "2").replace(/\//g, "7");
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
 * A Latin-script name as read (English rolls): letters, spaces, dots, hyphens and apostrophes
 * survive; digits, quotes, "@" and tokens with no letter are dropped. ALL-CAPS tokens (the rolls
 * mix "DEVIKA SANTOSH PILLAI" with "Shamsunder Mayekar") become Title Case; mixed case is kept.
 */
export function cleanNameLatin(raw: string): string {
  const t = raw.normalize("NFC").replace(/[\u200B-\u200D\uFEFF]/g, "").replace(/[^A-Za-z\s.'\-]/g, " ").replace(/\s+/g, " ").trim();
  const tokens: string[] = [];
  for (let tok of t.split(" ")) {
    tok = tok.replace(/^[.'\-]+/, "").replace(/\.{2,}/g, ".").replace(/-{2,}/g, "-").replace(/[\-']+$/, "");
    if (!/[A-Za-z]/.test(tok)) continue;
    if (tok.length === 1 && tok !== "." && !/[A-Za-z]/.test(tok)) continue;
    if (tok === tok.toUpperCase() && tok.length > 1) tok = tok.charAt(0) + tok.slice(1).toLowerCase();
    tokens.push(tok);
  }
  return tokens.join(" ");
}

/** Script-aware name clean-up. */
export function cleanName(raw: string, script: "devanagari" | "latin"): string {
  return script === "latin" ? cleanNameLatin(raw) : cleanNameHi(raw);
}

/** Deletion-reason letters printed before the serial in deletion lists (footer legend of the roll). */
export const DELETION_REASONS: Record<string, string> = {
  E: "Expired", S: "Shifted", R: "Duplicate", M: "Missing", Q: "Disqualified", D: "Deleted",
};

/**
 * Parses the serial box of a card: optional marker (a deletion-reason letter or "#" for a
 * modification), optional supplement digit glued to it ("S2 144", "#2 93", "R 1084"), then the
 * serial. `digitsOnly` is the digit-whitelisted read of the same box, used for the serial when
 * the alphanumeric read shows no marker.
 */
export function parseSerialBox(alnum: string, digitsOnly: string, glued = "", wideGap = true): { serial: number | null; marker: string; supplementNo: string } {
  const a = asciiDigits(alnum).toUpperCase().replace(/[^A-Z0-9#]+/g, " ").trim();
  let d = asciiDigits(digitsOnly).replace(/\D/g, "");
  const g = asciiDigits(glued).toUpperCase().replace(/[^A-Z0-9#]/g, "");
  // The line read sometimes drops a leading digit ("08" for 708); the single-word read of the same
  // box keeps it, and the two agree on the rest.
  if (/^\d+$/.test(g) && g.length > d.length && g.length <= 5 && g.endsWith(d)) d = g;
  const num = (s: string): number | null => (s ? Number(s.slice(0, 5)) : null);
  const legend = (c: string) => c === "#" || c in DELETION_REASONS;
  // Two tokens with a gap ("S2 144", "R 1084", or "2 144" when the letter was lost): the last token
  // is the serial, what precedes it is the marker (+ supplement digit). A single-word read of the
  // same box ("S2144") supplies the marker letter the spaced read dropped.
  // A gap between digits alone ("7 05") is kerning unless the two words sit far apart in the box
  // (`wideGap`, from the word positions), which is how "S2    144" is printed.
  const toks = a.split(" ");
  if (toks.length >= 2 && /^\d{1,5}$/.test(toks[toks.length - 1])) {
    const prefix = toks.slice(0, -1).join("");
    let marker = /^[A-Z#]/.test(prefix) ? prefix[0] : "";
    if (!marker && g.length > prefix.length && legend(g[0]) && g.endsWith(prefix + toks[toks.length - 1])) marker = g[0];
    if (!marker && !/^\d+$/.test(prefix)) return { serial: num(d || toks[toks.length - 1]), marker: "", supplementNo: "" };
    const supp = prefix.replace(/[^0-9]/g, "");
    if (marker || (wideGap && supp.length === 1 && /^\d$/.test(prefix))) return { serial: num(toks[toks.length - 1]), marker, supplementNo: supp.length === 1 ? supp : "" };
    if (!marker && /^\d+$/.test(prefix)) return { serial: num(d || prefix + toks[toks.length - 1]), marker: "", supplementNo: "" };
  }
  // "S2 144" / "# 2 93" / "R 1084": marker, optional supplement digit, serial.
  let m = /^([A-Z#])\s?(\d)?\s+(\d{1,5})$/.exec(a);
  if (m) return { serial: num(m[3]), marker: m[1], supplementNo: m[2] ?? "" };
  // No space survived: "S2144" -> S, 2, 144. Only a legend letter counts, and only when the digit-only
  // read saw the same digits (a plain serial whose "1" was read as "I" has fewer digits here).
  const sameDigits = a.replace(/\D/g, "") === d;
  m = /^([A-Z#])(\d)(\d{1,5})$/.exec(a);
  if (m && legend(m[1]) && sameDigits && (m[2] + m[3]).length >= 3) return { serial: num(m[3]), marker: m[1], supplementNo: m[2] };
  m = /^([A-Z#])\s*(\d{1,5})$/.exec(a);
  if (m && legend(m[1]) && sameDigits) return { serial: num(m[2]), marker: m[1], supplementNo: "" };
  // Plain serial: the digit-only read is the more reliable one.
  if (/^\d{1,5}$/.test(d)) return { serial: num(d), marker: "", supplementNo: "" };
  const last = /(\d{1,5})\s*$/.exec(a);
  return { serial: last ? num(last[1]) : num(d.slice(0, 5)), marker: "", supplementNo: "" };
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
