#!/usr/bin/env node
// Builds the human-check kit for the 300-card test set (paper Section 6.3).
//
//   npm run build && node paper/analysis/human_check_build.mjs
//
// For every truth file in paper/private/bench/truth it renders the page at 300 dpi, cuts the
// thirty cards with the pipeline's own layout code, and writes
//   paper/private/bench/human/crops/<page>-<nn>.jpg
//   paper/private/bench/human/cards.js      (the model transcription, kept apart from the page)
//   paper/private/bench/human/check.html    (the entry form; open it in a browser)
// Everything stays under paper/private, which is git-ignored: the crops are personal data.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import sharp from "sharp";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const dist = (f) => import(pathToFileURL(path.join(root, "dist", f)).href);
const { renderPage, removeQuiet } = await dist("pdf.js");
const { loadPage, imageDims, detectRowBands, templateRowBands } = await dist("image.js");
const { cardRects } = await dist("local.js");
const { loadTemplates, selectTemplate } = await dist("templates.js");

const truthDir = path.join(root, "paper/private/bench/truth");
const outDir = path.join(root, "paper/private/bench/human");
const cropDir = path.join(outDir, "crops");
fs.mkdirSync(cropDir, { recursive: true });
const tpl = selectTemplate(loadTemplates(path.join(root, "templates")), "Uttar Pradesh");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "human-check-"));

const pages = [];
for (const f of fs.readdirSync(truthDir).filter((x) => x.endsWith(".json")).sort()) {
  const id = f.replace(/\.json$/, "");
  const truth = JSON.parse(fs.readFileSync(path.join(truthDir, f), "utf8"));
  const pdf = path.isAbsolute(truth.pdf) ? truth.pdf : path.join(root, truth.pdf);
  const png = await renderPage(pdf, truth.page, 300, tmp);
  const page = await loadPage(png);
  const dims = await imageDims(page);
  const bands = (await detectRowBands(page, dims, tpl)) ?? templateRowBands(dims, tpl, tpl.grid.rows);
  const rects = await cardRects(page, dims, bands, tpl);
  if (rects.length !== truth.cards.length) {
    console.error(`${id}: ${rects.length} card rectangles but ${truth.cards.length} cards in the truth file; skipped`);
    continue;
  }
  const cards = [];
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    const pad = 6;
    const left = Math.max(0, r.left - pad), top = Math.max(0, r.top - pad);
    const width = Math.min(dims.width - left, r.width + 2 * pad), height = Math.min(dims.height - top, r.height + 2 * pad);
    const img = `${id}-${String(i + 1).padStart(2, "0")}.jpg`;
    await sharp(png).extract({ left, top, width, height }).jpeg({ quality: 88 }).toFile(path.join(cropDir, img));
    const t = truth.cards[i];
    cards.push({ img, serial: t.serial, model: { epic: t.epic, name: t.name, rel: t.rel, relName: t.relName, house: t.house, age: String(t.age), gender: t.gender } });
  }
  pages.push({ id, pdf: truth.pdf, page: truth.page, cards });
  console.log(`${id}: ${cards.length} cards`);
}
removeQuiet(tmp);

fs.writeFileSync(path.join(outDir, "cards.js"), "window.BENCH = " + JSON.stringify(pages) + ";\n");
fs.copyFileSync(path.join(here, "human_check.html"), path.join(outDir, "check.html"));
const n = pages.reduce((a, p) => a + p.cards.length, 0);
console.log(`\n${n} cards on ${pages.length} pages. Open ${path.join(outDir, "check.html")} in a browser.`);
