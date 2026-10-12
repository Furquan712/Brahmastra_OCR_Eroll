/**
 * Local Devanagari -> Roman transliteration of names. No network, no model API: a rule engine
 * (src/translit/rules.ts) re-ranked by a statistical model trained from data/translit/*.tsv
 * (src/translit/model.ts), with an exact-match lexicon and a user-editable overrides file on top.
 *
 * Lookup order per word: overrides.tsv > lexicon (attested spellings from training data) >
 * model-ranked rules > rules alone (when no model file exists).
 */
import fs from "node:fs";
import path from "node:path";
import type { Logger } from "./logger.js";
import { isDevanagari, normalizeDevanagari } from "./translit/devanagari.js";
import { loadModelJson, transliterateWord, type TrainPair, type TranslitModel } from "./translit/model.js";

export interface TranslitStats {
  modelFile: string | null;
  lexicon: number;
  contexts: number;
  overrides: number;
}

export const MODEL_FILE = "model.json";
export const OVERRIDES_FILE = "overrides.tsv";

/** Reads "hi<TAB>en[<TAB>weight]" lines; "#" starts a comment. */
export function loadPairsTsv(file: string): TrainPair[] {
  const out: TrainPair[] = [];
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const [hi, en, w] = line.split("\t").map((s) => s.trim());
    if (!hi || !en) continue;
    const weight = w ? Number(w) : 1;
    out.push({ hi, en, weight: Number.isFinite(weight) && weight > 0 ? weight : 1 });
  }
  return out;
}

/**
 * Reads an external corpus: TSV as above (Dakshina lexicon format: hi, roman, count), or
 * JSON / JSON-lines objects with a Devanagari field and a Roman field (Aksharantar:
 * "native word" / "english word"). Only pairs whose source is Devanagari are kept.
 */
export function loadPairsAny(file: string): TrainPair[] {
  if (!/\.jsonl?$/i.test(file)) return loadPairsTsv(file);
  const text = fs.readFileSync(file, "utf8");
  let rows: unknown[];
  if (/\.jsonl$/i.test(file)) rows = text.split(/\r?\n/).filter((l) => l.trim()).map((l) => JSON.parse(l) as unknown);
  else {
    const parsed = JSON.parse(text) as unknown;
    rows = Array.isArray(parsed) ? parsed : [parsed];
  }
  const out: TrainPair[] = [];
  for (const r of rows) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const keyOf = (re: RegExp): string | undefined => Object.keys(o).find((k) => re.test(k));
    const hiKey = keyOf(/native|hindi|devanagari|^hi$|^src/i);
    const enKey = keyOf(/english|roman|latin|^en$|^tgt/i);
    if (!hiKey || !enKey) continue;
    const hi = String(o[hiKey] ?? "").trim();
    const en = String(o[enKey] ?? "").trim();
    if (!hi || !en || !isDevanagari(hi) || /[^\x20-\x7E]/.test(en)) continue;
    const w = Number(o.count ?? o.weight ?? o.score ?? 1);
    out.push({ hi, en, weight: Number.isFinite(w) && w > 0 ? w : 1 });
  }
  return out;
}

function capitalize(s: string): string {
  const i = s.search(/[a-z]/i);
  if (i < 0) return s;
  return s.slice(0, i) + s[i].toUpperCase() + s.slice(i + 1).toLowerCase();
}

export interface TranslitOptions {
  log?: Logger;
  /** false = ignore the exact-match lexicon (measures how well the model generalises). */
  useLexicon?: boolean;
  /** false = ignore overrides.tsv. */
  useOverrides?: boolean;
}

export class Transliterator {
  private model: TranslitModel | null = null;
  private overrides = new Map<string, string>();
  private cache = new Map<string, string>();
  private readonly useLexicon: boolean;
  readonly stats: TranslitStats;

  constructor(readonly dataDir: string, opts: TranslitOptions = {}) {
    const { log, useLexicon = true, useOverrides = true } = opts;
    this.useLexicon = useLexicon;
    const modelFile = path.join(dataDir, MODEL_FILE);
    const overridesFile = path.join(dataDir, OVERRIDES_FILE);
    if (fs.existsSync(modelFile)) {
      this.model = loadModelJson(fs.readFileSync(modelFile, "utf8"));
    } else {
      log?.warn("translit", `${modelFile} not found - rules only (run "translit-train" to build the model)`);
    }
    if (useOverrides && fs.existsSync(overridesFile)) {
      for (const p of loadPairsTsv(overridesFile)) this.overrides.set(normalizeDevanagari(p.hi), p.en);
    }
    this.stats = {
      modelFile: this.model ? modelFile : null,
      lexicon: this.model ? Object.keys(this.model.lexicon).length : 0,
      contexts: this.model ? Object.keys(this.model.ctx).length : 0,
      overrides: this.overrides.size,
    };
  }

  /** Every Devanagari token the engine knows a spelling for (lexicon + overrides), for OCR consensus. */
  knownDevanagari(): Set<string> {
    const out = new Set<string>();
    const addAll = (s: string) => {
      for (const t of normalizeDevanagari(s).split(/[\s-]+/)) if (t && isDevanagari(t) && !/[^ऀ-ॿ]/.test(t)) out.add(t);
    };
    for (const k of Object.keys(this.model?.lexicon ?? {})) addAll(k);
    for (const k of this.overrides.keys()) addAll(k);
    return out;
  }

  /** One token (no spaces). Leading/trailing punctuation is kept; non-Devanagari passes through. */
  word(token: string): string {
    const t = normalizeDevanagari(token);
    if (!t) return "";
    const hit = this.overrides.get(t);
    if (hit) return hit;
    const cached = this.cache.get(t);
    if (cached !== undefined) return cached;
    let out: string;
    if (!isDevanagari(t)) {
      out = t;
    } else {
      const m = /^([^ऀ-ॿ]*)(.*?)([^ऀ-ॿ]*)$/u.exec(t)!;
      // Punctuation / digits inside a token ("क.नं.") separate independent Devanagari runs.
      const body = m[2]
        .split(/([^ऀ-ॿ]+)/u)
        .map((p, i) => {
          if (i % 2 === 1 || !p) return p;
          const lex = this.useLexicon ? this.model?.lexicon[p] : undefined;
          return lex ? lex.en : capitalize(transliterateWord(p, this.model));
        })
        .join("");
      out = m[1] + body + m[3];
    }
    this.cache.set(t, out);
    return out;
  }

  /** A full name or phrase: whole-phrase override first, else word by word (hyphens kept). */
  name(hi: string): string {
    const t = normalizeDevanagari(hi).replace(/\s+/g, " ").trim();
    if (!t) return "";
    const whole = this.overrides.get(t);
    if (whole) return whole;
    return t
      .split(" ")
      .map((w) => w.split("-").map((part) => this.word(part)).join("-"))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
  }
}
