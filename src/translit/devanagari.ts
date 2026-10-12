/**
 * Devanagari text -> aksharas ("units"). A unit is one consonant cluster with its vowel and
 * nasal/visarga marks, one independent vowel, or one passthrough character (digit, punctuation,
 * Latin). Everything downstream (rules, model, alignment) works on units, never on raw code points.
 */

export interface Consonant {
  base: string; // the plain consonant code point, e.g. "क"
  nukta: boolean;
}

export interface Unit {
  kind: "C" | "V" | "X";
  /** C: 1+ consonants joined by virama (reph र् counts as the first member). */
  cons: Consonant[];
  /**
   * C: the vowel sign ("ा", "ि", ...), null for the inherent vowel (schwa), "" for an explicit
   * halant (no vowel). V: the independent vowel letter ("अ", "आ", ...). X: "".
   */
  vowel: string | null;
  nasal: "" | "ं" | "ँ";
  visarga: boolean;
  /** X: the literal text to pass through (digits already ASCII). C/V: the source slice. */
  text: string;
}

const CONSONANT_RE = /[क-हक़-य़ॹ-ॿ]/; // क..ह, nukta forms, rare
const INDEPENDENT_VOWEL_RE = /[ऄ-औॠॡॲ-ॷऍऑ]/;
const MATRA_RE = /[ा-ौॢॣॕ-ॗॅॉ]/;
const VIRAMA = "्";
const NUKTA = "़";
const ANUSVARA = "ं";
const CHANDRABINDU = "ँ";
const VISARGA = "ः";

const DEVANAGARI_DIGITS = "०१२३४५६७८९";

export const isConsonant = (ch: string): boolean => CONSONANT_RE.test(ch);
export const isIndependentVowel = (ch: string): boolean => INDEPENDENT_VOWEL_RE.test(ch);
export const isMatra = (ch: string): boolean => MATRA_RE.test(ch);
export const isDevanagari = (s: string): boolean => /[ऀ-ॿ]/.test(s);

/** NFC (which also splits precomposed nukta letters into base + nukta), drops joiners, ASCII digits. */
export function normalizeDevanagari(s: string): string {
  return s
    .normalize("NFC")
    .replace(/[​-‍﻿]/g, "")
    .replace(/[०-९]/g, (d) => String(DEVANAGARI_DIGITS.indexOf(d)))
    .replace(/॰/g, ".") // abbreviation sign
    .replace(/[।॥]/g, "."); // danda
}

/** Splits one word (no whitespace) into units. */
export function parseWord(word: string): Unit[] {
  const chars = [...normalizeDevanagari(word)];
  const units: Unit[] = [];
  let i = 0;
  const readMarks = (u: Unit): void => {
    // nasal / visarga may appear in either order; take what is there
    for (let k = 0; k < 2 && i < chars.length; k++) {
      const c = chars[i];
      if (c === ANUSVARA || c === CHANDRABINDU) {
        u.nasal = c as "ं" | "ँ";
        u.text += c;
        i++;
      } else if (c === VISARGA) {
        u.visarga = true;
        u.text += c;
        i++;
      } else break;
    }
  };

  while (i < chars.length) {
    const c = chars[i];
    if (isConsonant(c)) {
      const u: Unit = { kind: "C", cons: [], vowel: null, nasal: "", visarga: false, text: "" };
      for (;;) {
        const base = chars[i];
        let text = base;
        i++;
        let nukta = false;
        if (chars[i] === NUKTA) {
          nukta = true;
          text += NUKTA;
          i++;
        }
        u.cons.push({ base, nukta });
        u.text += text;
        if (chars[i] === VIRAMA) {
          if (i + 1 < chars.length && isConsonant(chars[i + 1])) {
            u.text += VIRAMA;
            i++;
            continue; // cluster continues
          }
          u.vowel = ""; // explicit halant: no vowel
          u.text += VIRAMA;
          i++;
          break;
        }
        if (i < chars.length && isMatra(chars[i])) {
          u.vowel = chars[i];
          u.text += chars[i];
          i++;
        }
        break;
      }
      readMarks(u);
      units.push(u);
      continue;
    }
    if (isIndependentVowel(c)) {
      const u: Unit = { kind: "V", cons: [], vowel: c, nasal: "", visarga: false, text: c };
      i++;
      readMarks(u);
      units.push(u);
      continue;
    }
    // Stray marks with no base letter: drop them.
    if (c === NUKTA || c === VIRAMA || c === ANUSVARA || c === CHANDRABINDU || c === VISARGA || isMatra(c)) {
      i++;
      continue;
    }
    units.push({ kind: "X", cons: [], vowel: "", nasal: "", visarga: false, text: c });
    i++;
  }
  return units;
}

/** Canonical key of a cluster, e.g. "क्ष", "ज़", "न्द्र". Used for model statistics and alt lookup. */
export function clusterKey(cons: Consonant[]): string {
  return cons.map((c) => c.base + (c.nukta ? NUKTA : "")).join(VIRAMA);
}

/** Short signature of a unit for context features: cluster key, vowel letter, or the literal. */
export function unitSignature(u: Unit | undefined, edge: string): string {
  if (!u) return edge;
  if (u.kind === "C") return clusterKey(u.cons);
  if (u.kind === "V") return u.vowel ?? "";
  return u.text;
}
