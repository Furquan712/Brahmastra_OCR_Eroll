#!/usr/bin/env node
// Turns a saved human check (paper/private/bench/human/check.html, "Save file") into truth files
// and an agreement report.
//
//   node paper/analysis/human_check_apply.mjs <human-check-NAME.json>
//
// Writes paper/private/bench/truth_human/<page>.json in the ocr-eval format, with the person's
// final reading of every field, and paper/private/bench/human/agreement.json. Prints the figures
// the paper needs: how often the person's first entry matched the model transcription, and how
// many cells the person changed after looking again.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const file = process.argv[2];
if (!file) { console.error("usage: human_check_apply.mjs <saved-check.json>"); process.exit(2); }
const S = JSON.parse(fs.readFileSync(file, "utf8"));
const truthDir = path.join(root, "paper/private/bench/truth");
const outDir = path.join(root, "paper/private/bench/truth_human");
fs.mkdirSync(outDir, { recursive: true });

const FIELDS = ["epic", "name", "rel", "relName", "house", "age", "gender"];
const NAMES = new Set(["name", "relName"]);
const norm = (k, v) => { v = String(v ?? "").normalize("NFC").replace(/\s+/g, " ").trim(); return k === "epic" ? v.toUpperCase() : v; };
const stat = Object.fromEntries(FIELDS.map((f) => [f, { cells: 0, blind: 0, firstAgree: 0, finalDiffers: 0, cannotTell: 0 }]));
const changed = [];
let cardsDone = 0, cardsMissing = 0, cardsAnyChange = 0, stamped = 0;

for (const f of fs.readdirSync(truthDir).filter((x) => x.endsWith(".json")).sort()) {
  const id = f.replace(/\.json$/, "");
  const truth = JSON.parse(fs.readFileSync(path.join(truthDir, f), "utf8"));
  const cards = truth.cards.map((t, i) => {
    const h = S.cards[`${id}-${String(i + 1).padStart(2, "0")}.jpg`];
    if (!h) { cardsMissing++; return t; }
    cardsDone++; if (h.stamped) stamped++;
    let any = false;
    const out = { serial: t.serial };
    for (const k of FIELDS) {
      const model = norm(k, t[k]), first = norm(k, h.first?.[k]), fin = norm(k, h.final?.[k]);
      const isBlind = !NAMES.has(k) || h.nameMode === "blind";
      const s = stat[k]; s.cells++;
      if (isBlind) { s.blind++; if (first === model) s.firstAgree++; }
      if ((h.cannotTell || []).includes(k)) s.cannotTell++;
      if (fin !== model) { s.finalDiffers++; any = true; changed.push({ card: `${id}#${i + 1}`, field: k, model, human: fin, cannotTell: (h.cannotTell || []).includes(k) }); }
      out[k] = k === "age" ? (Number.parseInt(fin, 10) || 0) : fin;
    }
    if (any) cardsAnyChange++;
    return out;
  });
  const note = `Model transcription checked card by card by a person (${S.reviewer || "reviewer"}); identity fields entered blind, names ${S.nameMode === "blind" ? "entered blind" : "verified against the model transcription"}; see paper Section 4.3.`;
  fs.writeFileSync(path.join(outDir, f), JSON.stringify({ pdf: truth.pdf, page: truth.page, note, cards }, null, 0));
}

const pct = (a, b) => (b ? ((100 * a) / b).toFixed(1) + "%" : "n/a");
console.log(`Reviewer: ${S.reviewer || "?"}; names ${S.nameMode}; cards checked ${cardsDone}, not yet checked ${cardsMissing}; stamped ${stamped}`);
console.log("field      cells  blind-entry agreement with model   changed by the person   cannot tell");
for (const k of FIELDS) {
  const s = stat[k];
  console.log(`${k.padEnd(9)} ${String(s.cells).padStart(5)}  ${s.blind ? `${s.firstAgree}/${s.blind} (${pct(s.firstAgree, s.blind)})` : "not blind (verified)"}`.padEnd(52) + `${String(s.finalDiffers).padStart(4)}`.padEnd(24) + s.cannotTell);
}
console.log(`Cards with any field changed by the person: ${cardsAnyChange} of ${cardsDone}`);
fs.writeFileSync(path.join(root, "paper/private/bench/human/agreement.json"),
  JSON.stringify({ reviewer: S.reviewer, nameMode: S.nameMode, cardsDone, cardsMissing, cardsAnyChange, stamped, fields: stat, changed }, null, 1));
console.log(`\nChanged cells are listed in paper/private/bench/human/agreement.json (personal data; keep private).`);
if (cardsMissing) console.log(`WARNING: ${cardsMissing} cards were not checked; their rows in truth_human are still the model's.`);
console.log(`Re-score the pipeline:  node dist/cli.js ocr-eval paper/private/bench/truth_human/*.json`);
console.log(`Re-score Surya:         python3 paper/analysis/score_surya.py <surya out> paper/private/bench/truth_human`);
