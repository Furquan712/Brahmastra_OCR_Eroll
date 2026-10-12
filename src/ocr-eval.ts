/**
 * Scores the local read of one page against a hand-checked ground-truth file
 * (test/fixtures/*.json). Used to measure every change to the local OCR algorithms.
 */
import fs from "node:fs";
import path from "node:path";
import type { PdfContext } from "./pipeline.js";
import { processPage } from "./pipeline.js";
import { pdfPageCount, removeQuiet, renderPage } from "./pdf.js";
import type { VoterCard } from "./types.js";

export interface TruthCard {
  serial: number;
  epic: string;
  name: string;
  rel: string;
  relName: string;
  house: string;
  age: number;
  gender: string;
}

export interface TruthFile {
  pdf: string;
  page: number;
  cards: TruthCard[];
}

export const FIELDS = ["epic", "name", "rel", "relName", "house", "age", "gender"] as const;
export type Field = (typeof FIELDS)[number];

const nfc = (s: string): string => s.normalize("NFC").trim();

export function fieldOf(c: VoterCard, f: Field): string {
  switch (f) {
    case "epic": return c.epicNo;
    case "name": return nfc(c.nameHi);
    case "rel": return nfc(c.relationTypeHi);
    case "relName": return nfc(c.relationNameHi);
    case "house": return nfc(c.houseNo);
    case "age": return c.age === null ? "" : String(c.age);
    case "gender": return nfc(c.genderHi);
  }
}

function truthOf(t: TruthCard, f: Field): string {
  const v = t[f];
  return typeof v === "number" ? String(v) : nfc(v);
}

export interface EvalResult {
  cards: number;
  truth: number;
  correct: Record<Field, number>;
  /** Cards where every field is right. */
  perfect: number;
  mismatches: string[];
  /** How many cards carried at least one review flag, and how many of those were actually wrong. */
  flagged: number;
  flaggedWrong: number;
  unflaggedWrong: number;
}

export function scoreCards(cards: VoterCard[], truth: TruthCard[]): EvalResult {
  const correct = Object.fromEntries(FIELDS.map((f) => [f, 0])) as Record<Field, number>;
  const res: EvalResult = { cards: cards.length, truth: truth.length, correct, perfect: 0, mismatches: [], flagged: 0, flaggedWrong: 0, unflaggedWrong: 0 };
  const bySerial = new Map(truth.map((t) => [t.serial, t]));
  for (const c of cards) {
    const t = c.serial !== null ? bySerial.get(c.serial) : undefined;
    if (!t) {
      res.mismatches.push(`card serial ${c.serial ?? "?"} (EPIC ${c.epicNo}) has no ground truth`);
      continue;
    }
    let wrong = 0;
    for (const f of FIELDS) {
      const got = fieldOf(c, f);
      const want = truthOf(t, f);
      if (got === want) correct[f]++;
      else {
        wrong++;
        res.mismatches.push(`#${t.serial} ${f}: got "${got}" want "${want}"${c.extraFlags?.length ? ` [${c.extraFlags.join(",")}]` : ""}${c.notes ? ` (${c.notes})` : ""}`);
      }
    }
    const flagged = (c.extraFlags?.length ?? 0) > 0 || (c.escalated?.length ?? 0) > 0;
    if (flagged) res.flagged++;
    if (wrong === 0) res.perfect++;
    else if (flagged) res.flaggedWrong++;
    else res.unflaggedWrong++;
  }
  return res;
}

export function evalText(name: string, r: EvalResult): string {
  const L: string[] = [];
  const pct = (n: number) => `${n}/${r.truth} (${((100 * n) / Math.max(1, r.truth)).toFixed(0)}%)`;
  L.push(`${name}: ${r.cards} cards read, ${r.truth} in truth; fully correct cards ${pct(r.perfect)}`);
  for (const f of FIELDS) L.push(`  ${f.padEnd(8)} ${pct(r.correct[f])}`);
  L.push(`  flagged for review: ${r.flagged} (wrong among them: ${r.flaggedWrong}); wrong but NOT flagged: ${r.unflaggedWrong}`);
  for (const m of r.mismatches) L.push(`  ! ${m}`);
  return L.join("\n");
}

/** Renders the truth file's page, runs the pipeline's page read, and scores it. */
export async function evalTruthFile(ctx: PdfContext, truthFile: string, projectRoot: string): Promise<EvalResult> {
  const truth = JSON.parse(fs.readFileSync(truthFile, "utf8")) as TruthFile;
  const pdf = path.isAbsolute(truth.pdf) ? truth.pdf : path.join(projectRoot, truth.pdf);
  const pages = await pdfPageCount(pdf);
  if (truth.page > pages) throw new Error(`${truthFile}: page ${truth.page} > ${pages} pages in ${pdf}`);
  const tmp = path.join(ctx.cfg.tmpDir, "ocr-eval");
  try {
    const png = await renderPage(pdf, truth.page, ctx.cfg.dpi, tmp);
    const pr = await processPage(ctx, pdf, truth.page, png);
    return scoreCards(pr.cards, truth.cards);
  } finally {
    removeQuiet(tmp);
  }
}
