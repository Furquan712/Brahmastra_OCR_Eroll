/**
 * Name repair without a model: a Devanagari token read with LOW confidence that differs from a
 * trusted token (name lexicon, or read confidently elsewhere on the same page / PDF) by exactly
 * one edit Tesseract is known to make is replaced by it. Allowed edits:
 *   - a dropped halant / nukta / anusvara (inserted into the read), or a stray halant / anusvara
 *     (removed from the read),
 *   - a swap between look-alike vowel signs (े/ै, ो/ौ, ु/ू, ि/ी, ं/ँ, ा/ो),
 *   - a swap between look-alike consonants (ब/व, थ/ध, घ/ध, भ/म, श/ष, न/ण, ...).
 * A matra is never dropped or added and consonants are never inserted, so a rare but real
 * spelling (चन्दा, खुरशैद) survives as long as it was read with confidence.
 */
import type { VoterCard } from "./types.js";

const VIRAMA = "्", NUKTA = "़", ANUSVARA = "ं", CHANDRABINDU = "ँ";
const INSERTABLE = new Set([VIRAMA, NUKTA, ANUSVARA, CHANDRABINDU]);
const DELETABLE = new Set([VIRAMA, ANUSVARA, CHANDRABINDU]);
const MATRA_SWAPS = [["े", "ै"], ["ो", "ौ"], ["ु", "ू"], ["ि", "ी"], [ANUSVARA, CHANDRABINDU], ["ा", "ो"], ["ृ", "ु"]];
const CONFUSION_PAIRS = [
  ["ब", "व"], ["थ", "ध"], ["घ", "ध"], ["भ", "म"], ["श", "ष"], ["न", "ण"], ["ट", "ठ"], ["ड", "ढ"], ["द", "ढ"],
  ["घ", "ष"], ["च", "ज"], ["ग", "ण"], ["त", "न"], ["य", "ध"], ["प", "ष"], ["ल", "त"], ["ख", "रव"], ["स", "रा"],
];
const swapSet = (pairs: string[][]): Map<string, Set<string>> => {
  const m = new Map<string, Set<string>>();
  for (const [a, b] of pairs) {
    (m.get(a) ?? m.set(a, new Set()).get(a)!).add(b);
    (m.get(b) ?? m.set(b, new Set()).get(b)!).add(a);
  }
  return m;
};
const MATRA = swapSet(MATRA_SWAPS);
const CONFUSION = swapSet(CONFUSION_PAIRS);

export type EditKind = "mark" | "confusion";

/** Classifies the single allowed edit turning `read` into `cand`, or null. */
export function singleEdit(read: string, cand: string): EditKind | null {
  const a = [...read], b = [...cand];
  if (a.length === b.length) {
    let i = -1;
    for (let k = 0; k < a.length; k++) {
      if (a[k] !== b[k]) {
        if (i >= 0) return null;
        i = k;
      }
    }
    if (i < 0) return null;
    if (MATRA.get(a[i])?.has(b[i])) return "mark";
    if (CONFUSION.get(a[i])?.has(b[i])) return "confusion";
    return null;
  }
  if (Math.abs(a.length - b.length) !== 1) return null;
  const readShorter = a.length < b.length;
  const [s, l] = readShorter ? [a, b] : [b, a];
  let j = 0, extra = "";
  for (let k = 0; k < l.length; k++) {
    if (j < s.length && s[j] === l[k]) j++;
    else if (extra) return null;
    else extra = l[k];
  }
  if (!extra) return null;
  // read shorter: the candidate has one more mark (OCR dropped it); read longer: a stray mark.
  return (readShorter ? INSERTABLE : DELETABLE).has(extra) ? "mark" : null;
}

export interface ConsensusOptions {
  /** Tokens known to be real names (seed lexicon, overrides). */
  known: Set<string>;
  /** Field confidence (0..1) at or above which a read is trusted as-is and supports others. */
  trustConf?: number;
}

const nfc = (s: string): string => s.normalize("NFC");

type FieldKey = "nameHi" | "relationNameHi";
const confOf = (c: VoterCard, f: FieldKey): number =>
  c.fieldConf ? (f === "nameHi" ? c.fieldConf.name : c.fieldConf.relationName) : c.confidence;

/**
 * Repairs nameHi / relationNameHi tokens in place across `cards` (a page or a whole PDF).
 * Returns the number of fields changed. Flags: name_hi_corrected / relation_name_hi_corrected,
 * with the original kept in `notes`.
 */
export function correctNames(cards: VoterCard[], opts: ConsensusOptions): number {
  const trustConf = opts.trustConf ?? 0.85;
  const support = new Map<string, number>();
  for (const c of cards) {
    for (const f of ["nameHi", "relationNameHi"] as const) {
      const w = confOf(c, f) >= trustConf ? 1 : 0.25;
      for (const t of nfc(c[f]).split(/\s+/)) if (t) support.set(t, (support.get(t) ?? 0) + w);
    }
  }
  const sup = (t: string): number => support.get(t) ?? 0;
  const trusted = (t: string): boolean => opts.known.has(t) || sup(t) >= 2;
  const trustedTokens = [...new Set([...opts.known, ...[...support.keys()].filter((t) => sup(t) >= 2)])];
  const halantOrNukta = (read: string, cand: string): boolean => [...cand].length === [...read].length + 1 && /[़्]/.test([...cand].filter((ch, i) => ch !== [...read][i]).join(""));

  /**
   * A low-confidence read takes any allowed single-edit candidate. A confident read is only
   * overruled by strong evidence: a dropped halant/nukta (never a real spelling) to a known
   * token, a lexicon token that is also read elsewhere in this document, or a token read
   * confidently at least twice here - and only while the read itself has no other support.
   */
  const fix = (field: string, confident: boolean): { value: string; changed: boolean } => {
    const toks = nfc(field).split(/\s+/).filter(Boolean);
    let changed = false;
    const out = toks.map((t) => {
      if (!/[ऀ-ॿ]/.test(t) || trusted(t)) return t;
      if (confident && sup(t) > 1) return t;
      let best: { tok: string; score: number } | null = null;
      for (const cand of trustedTokens) {
        if (cand === t) continue;
        const kind = singleEdit(t, cand);
        if (!kind) continue;
        if (confident) {
          const strong = halantOrNukta(t, cand) ? opts.known.has(cand) || sup(cand) >= 2 : (opts.known.has(cand) && sup(cand) >= 1) || sup(cand) >= 2;
          if (!strong) continue;
        }
        const score = sup(cand) + (opts.known.has(cand) ? 1.5 : 0) + (kind === "mark" ? 0.5 : 0);
        if (!best || score > best.score) best = { tok: cand, score };
      }
      if (!best) return t;
      changed = true;
      return best.tok;
    });
    return { value: out.join(" "), changed };
  };

  let n = 0;
  for (const c of cards) {
    for (const f of ["nameHi", "relationNameHi"] as const) {
      const r = fix(c[f], confOf(c, f) >= trustConf);
      if (!r.changed) continue;
      c.notes = [c.notes, `${f === "nameHi" ? "name" : "relation name"} read as "${c[f]}"`].filter(Boolean).join("; ");
      c[f] = r.value;
      (c.extraFlags ??= []).push(f === "nameHi" ? "name_hi_corrected" : "relation_name_hi_corrected");
      n++;
    }
  }
  return n;
}
