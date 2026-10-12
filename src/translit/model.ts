/**
 * Statistical transliteration model on top of the rule layer.
 *
 * Training aligns each (Devanagari, Roman) pair slot by slot (the Roman string must be a
 * concatenation of allowed alternatives, found by dynamic programming) and counts which
 * alternative each slot took in which context. Inference scores the alternatives of a slot by
 * interpolating the smoothed distributions of its context keys, most specific first, and backs
 * off to the rule default when there is no evidence. Plain JSON, no runtime dependencies.
 */
import { clusterKey, parseWord, type Unit } from "./devanagari.js";
import { schwaKeep, slotsOf, type Slot } from "./rules.js";

export interface SlotCounts {
  [alt: string]: number;
}

export interface TranslitModel {
  version: number;
  trainedAt: string;
  pairs: number;
  aligned: number;
  /** Exact single-token lexicon: Devanagari token -> best Roman spelling and its weight. */
  lexicon: Record<string, { en: string; n: number }>;
  /** Counts per context key ("<slotKey>|<feature>") -> alternative -> weight. */
  ctx: Record<string, SlotCounts>;
}

export const MODEL_VERSION = 1;

export function emptyModel(): TranslitModel {
  return { version: MODEL_VERSION, trainedAt: new Date().toISOString(), pairs: 0, aligned: 0, lexicon: {}, ctx: {} };
}

/* ---------------- features ---------------- */

interface SlotContext {
  slot: Slot;
  /** Context keys, most specific first. */
  keys: string[];
}

function contexts(units: Unit[], slots: Slot[]): SlotContext[] {
  const content = units.map((u, i) => (u.kind === "X" ? -1 : i)).filter((i) => i >= 0);
  const first = content[0];
  const last = content[content.length - 1];
  const keep = schwaKeep(units);
  // Neighbour signature = cluster + the vowel it actually carries after schwa deletion ("न+a",
  // "ना", "न"), so "before a bare consonant" and "before a full syllable" are different contexts.
  const sig = (idx: number, edge: string): string => {
    const u = units[idx];
    if (!u) return edge;
    if (u.kind === "C") return clusterKey(u.cons) + (u.vowel === null ? (keep[idx] ? "+a" : "") : u.vowel) + (u.nasal ? "ं" : "");
    if (u.kind === "V") return (u.vowel ?? "") + (u.nasal ? "ं" : "");
    return u.text;
  };
  return slots.map((s) => {
    const i = s.unitIndex;
    const u = units[i];
    const pos = i === first && i === last ? "FL" : i === first ? "F" : i === last ? "L" : "M";
    const p = sig(i - 1, "^");
    const n = sig(i + 1, "$");
    // C slots: conditioned on the unit's own vowel; V/N slots: on the unit's cluster.
    const c = s.kind === "C" ? (u.vowel === null ? (keep[i] ? "a" : "") : u.vowel ?? "") : u.kind === "C" ? clusterKey(u.cons) : u.vowel ?? "";
    const k = s.key;
    // The inherent-vowel decision hinges on what follows, so its backoff never drops "n=":
    // "ल before bare final य" (Vidyalay) and "ल before जी" (Baljit) must stay separate contexts.
    const keys = k === "V:a"
      ? [
          `${k}|c=${c}|p=${p}|n=${n}`,
          `${k}|c=${c}|n=${n}`,
          `${k}|p=${p}|n=${n}`,
          `${k}|c=${c}|pos=${pos}|n=${n}`,
          `${k}|n=${n}`,
        ]
      : [
          `${k}|c=${c}|p=${p}|n=${n}`,
          `${k}|c=${c}|n=${n}`,
          `${k}|c=${c}|p=${p}`,
          `${k}|c=${c}|pos=${pos}`,
          `${k}|n=${n}`,
          `${k}|p=${p}`,
          `${k}|c=${c}`,
          `${k}|pos=${pos}`,
          k,
        ];
    return { slot: s, keys };
  });
}

/* ---------------- alignment (training) ---------------- */

/**
 * Aligns a Roman string to the slot sequence: returns the chosen alternative index per slot, or
 * null when the string is not a concatenation of allowed alternatives. Among valid alignments
 * the one using the most rule-default choices wins.
 */
export function alignSlots(slots: Slot[], roman: string): number[] | null {
  const n = slots.length;
  const L = roman.length;
  // best[i][j]: best score covering slots[0..i) with roman[0..j), -Infinity if impossible
  const NEG = -1e9;
  const best: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(L + 1).fill(NEG));
  const choice: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(L + 1).fill(-1));
  const from: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(L + 1).fill(-1));
  best[0][0] = 0;
  for (let i = 0; i < n; i++) {
    const s = slots[i];
    for (let j = 0; j <= L; j++) {
      if (best[i][j] === NEG) continue;
      s.alts.forEach((alt, ai) => {
        if (roman.startsWith(alt, j)) {
          const j2 = j + alt.length;
          const score = best[i][j] + (ai === s.dflt ? 2 : ai === 0 ? 1 : 0);
          if (score > best[i + 1][j2]) {
            best[i + 1][j2] = score;
            choice[i + 1][j2] = ai;
            from[i + 1][j2] = j;
          }
        }
      });
    }
  }
  if (best[n][L] === NEG) return null;
  const out = new Array<number>(n);
  let j = L;
  for (let i = n; i > 0; i--) {
    out[i - 1] = choice[i][j];
    j = from[i][j];
  }
  return out;
}

export interface TrainPair {
  hi: string;
  en: string;
  weight: number;
}

export interface TrainReport {
  pairs: number;
  aligned: number;
  skipped: { hi: string; en: string; why: string }[];
}

const romanClean = (s: string): string => s.toLowerCase().replace(/[^a-z]/g, "");

/** Adds one aligned word pair to the model's counts. */
function countWord(model: TranslitModel, hiWord: string, enWord: string, weight: number): boolean {
  const units = parseWord(hiWord);
  if (!units.some((u) => u.kind !== "X")) return false;
  const slots = slotsOf(units);
  const chosen = alignSlots(slots, romanClean(enWord));
  if (!chosen) return false;
  const ctxs = contexts(units, slots);
  ctxs.forEach((c, i) => {
    const alt = c.slot.alts[chosen[i]];
    for (const k of c.keys) {
      const bucket = (model.ctx[k] ??= {});
      bucket[alt] = (bucket[alt] ?? 0) + weight;
    }
  });
  return true;
}

export function trainModel(pairs: TrainPair[], base: TranslitModel = emptyModel()): { model: TranslitModel; report: TrainReport } {
  const model = base;
  const report: TrainReport = { pairs: 0, aligned: 0, skipped: [] };
  const lexAcc = new Map<string, Map<string, number>>();
  for (const p of pairs) {
    const hi = p.hi.normalize("NFC").trim();
    const en = p.en.trim();
    if (!hi || !en) continue;
    report.pairs++;
    const hiWords = hi.split(/[\s-]+/).filter(Boolean);
    const enWords = en.split(/[\s-]+/).filter(Boolean);
    if (hiWords.length !== enWords.length) {
      report.skipped.push({ hi, en, why: "word count differs" });
      continue;
    }
    let ok = true;
    for (let i = 0; i < hiWords.length; i++) {
      if (!countWord(model, hiWords[i], enWords[i], p.weight)) {
        ok = false;
        report.skipped.push({ hi: hiWords[i], en: enWords[i], why: "no alignment" });
      }
    }
    if (ok) report.aligned++;
    // Lexicon: exact tokens, even when alignment failed (an attested spelling beats the rules).
    for (let i = 0; i < hiWords.length; i++) {
      const m = lexAcc.get(hiWords[i]) ?? new Map<string, number>();
      m.set(enWords[i], (m.get(enWords[i]) ?? 0) + p.weight);
      lexAcc.set(hiWords[i], m);
    }
  }
  for (const [hi, m] of lexAcc) {
    let bestEn = "";
    let bestN = -1;
    for (const [en, n] of m) if (n > bestN) { bestEn = en; bestN = n; }
    const prev = model.lexicon[hi];
    if (!prev || bestN >= prev.n) model.lexicon[hi] = { en: bestEn, n: bestN };
  }
  model.pairs += report.pairs;
  model.aligned += report.aligned;
  model.trainedAt = new Date().toISOString();
  return { model, report };
}

/* ---------------- inference ---------------- */

const PRIOR_DEFAULT = 0.8;
const KAPPA = 3; // pseudo-count pulling sparse contexts toward the prior: one stray example never flips a rule
const LAMBDA = [1.0, 0.8, 0.8, 0.6, 0.5, 0.5, 0.45, 0.35, 0.25]; // weight per key, most specific first

function chooseAlt(model: TranslitModel | null, c: SlotContext): string {
  const s = c.slot;
  if (s.alts.length === 1 || !model) return s.alts[s.dflt] ?? s.alts[0];
  const prior = (ai: number): number => (ai === s.dflt ? PRIOR_DEFAULT : (1 - PRIOR_DEFAULT) / (s.alts.length - 1));
  const score = s.alts.map((_, ai) => prior(ai) * 0.01); // tiny prior term keeps the default ahead with no data
  let evidence = 0;
  c.keys.forEach((k, ki) => {
    const bucket = model.ctx[k];
    if (!bucket) return;
    let total = 0;
    for (const alt of s.alts) total += bucket[alt] ?? 0;
    if (total <= 0) return;
    const conf = total / (total + KAPPA);
    const w = LAMBDA[ki] * conf;
    s.alts.forEach((alt, ai) => {
      const p = ((bucket[alt] ?? 0) + KAPPA * prior(ai)) / (total + KAPPA);
      score[ai] += w * p;
    });
    evidence += w;
  });
  if (evidence === 0) return s.alts[s.dflt];
  let bi = 0;
  for (let i = 1; i < score.length; i++) if (score[i] > score[bi]) bi = i;
  return s.alts[bi];
}

/** Romanises one word with the rules alone (model = null) or re-ranked by the model. Lowercase. */
export function transliterateWord(word: string, model: TranslitModel | null): string {
  const units = parseWord(word);
  const slots = slotsOf(units);
  const ctxs = contexts(units, slots);
  let out = "";
  for (const c of ctxs) out += chooseAlt(model, c);
  return out;
}

export function loadModelJson(json: string): TranslitModel {
  const m = JSON.parse(json) as TranslitModel;
  if (m.version !== MODEL_VERSION) throw new Error(`transliteration model version ${m.version} != ${MODEL_VERSION}; retrain with translit-train`);
  return m;
}
