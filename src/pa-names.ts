/**
 * Word-level correction of Punjabi (Gurmukhi) names read by OCR, against a dictionary of the name
 * words printed in the text layer of Punjab's 2027 SSR rolls (data/learned/pa-names.json, word ->
 * count). Tesseract's Punjabi model reads most letters of a name right but drops or swaps vowel
 * signs (ਸਿੰਘ -> ਸੰਘ, ਕੌਰ -> ਕੋਰ); the nearest common dictionary word puts them back.
 *
 * Cautious by design (measured on 1,086 cards checked against the printed text): a word the
 * dictionary contains, however rare, is kept; one letter away from a word seen 3+ times is
 * corrected; two letters only for long words, and only towards a word seen 20+ times.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export class PunjabiNames {
  private readonly all: Map<string, number>;
  private readonly common = new Map<string, number>();
  private readonly index = new Map<string, string[]>();
  private readonly memo = new Map<string, string>();

  constructor(file: string) {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as { words: Record<string, number> };
    this.all = new Map(Object.entries(raw.words));
    for (const [w, n] of this.all) {
      if (n < 3) continue;
      this.common.set(w, n);
      for (const v of deletes(w, 2)) {
        const list = this.index.get(v);
        if (list) list.push(w);
        else this.index.set(v, [w]);
      }
    }
  }

  get size(): number {
    return this.all.size;
  }

  word(tok: string): string {
    if (!tok || this.all.has(tok) || !/[਀-੿]/.test(tok)) return tok;
    const hit = this.memo.get(tok);
    if (hit !== undefined) return hit;
    const len = [...tok].length;
    let best: { d: number; n: number; w: string } | null = null;
    const seen = new Set<string>();
    for (const v of deletes(tok, 2)) {
      for (const c of this.index.get(v) ?? []) {
        if (seen.has(c)) continue;
        seen.add(c);
        const d = lev(tok, c);
        const n = this.common.get(c) ?? 0;
        if (!(d <= 1 || (d === 2 && len >= 6 && n >= 20))) continue;
        if (!best || d < best.d || (d === best.d && n > best.n)) best = { d, n, w: c };
      }
    }
    const out = best ? best.w : tok;
    this.memo.set(tok, out);
    return out;
  }

  name(s: string): string {
    return s ? s.split(" ").map((t) => this.word(t)).join(" ") : s;
  }
}

/** Every string reachable from w by deleting up to d characters (code points). */
function deletes(w: string, d: number): Set<string> {
  let cur = new Set([w]);
  const out = new Set([w]);
  for (let k = 0; k < d; k++) {
    const next = new Set<string>();
    for (const x of cur) {
      const cs = [...x];
      for (let i = 0; i < cs.length; i++) next.add(cs.slice(0, i).join("") + cs.slice(i + 1).join(""));
    }
    for (const x of next) out.add(x);
    cur = next;
  }
  return out;
}

function lev(a: string, b: string): number {
  const A = [...a], B = [...b];
  let prev = Array.from({ length: B.length + 1 }, (_, j) => j);
  for (let i = 1; i <= A.length; i++) {
    const cur = [i];
    for (let j = 1; j <= B.length; j++) cur.push(Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (A[i - 1] === B[j - 1] ? 0 : 1)));
    prev = cur;
  }
  return prev[B.length];
}

let shared: PunjabiNames | null | undefined;
/** The dictionary at OCR_PA_NAMES_FILE or data/learned/pa-names.json, loaded once; null when absent. */
export function punjabiNames(): PunjabiNames | null {
  if (shared !== undefined) return shared;
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const file = process.env.OCR_PA_NAMES_FILE || path.join(root, "data", "learned", "pa-names.json");
  shared = fs.existsSync(file) ? new PunjabiNames(file) : null;
  return shared;
}
