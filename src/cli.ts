#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { ResultCache } from "./cache.js";
import { buildConfig, type CliOverrides } from "./config.js";
import { writeCsv } from "./csv.js";
import { outputCsvName, outputDirName, parseConstituencyFolder, partCsvName } from "./folder.js";
import { cropBand, detectColumnBands, detectRowBands, imageDims, templateRowBands } from "./image.js";
import { Logger } from "./logger.js";
import { mergeResults, type MergeStats } from "./merge.js";
import { evalText, evalTruthFile } from "./ocr-eval.js";
import { checkPopplerAvailable, pdfPageCount, removeQuiet, renderPage } from "./pdf.js";
import { processPdf, type PdfContext } from "./pipeline.js";
import { pushConfigFromEnv, pushPdf, type PushConfig } from "./push.js";
import { buildSummary, summaryText, writeSummary } from "./summary.js";
import { loadTemplates, selectTemplate } from "./templates.js";
import { checkTesseract } from "./tesseract.js";
import { loadPairsAny, loadPairsTsv, MODEL_FILE, OVERRIDES_FILE, Transliterator } from "./translit.js";
import { trainModel } from "./translit/model.js";
import type { PdfResult } from "./types.js";
import { NameMemory } from "./name-memory.js";
import { Semaphore, errMsg, naturalCompare } from "./util.js";
import { createProvider, VisionClient } from "./vision/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(here, ".."); // works from dist/ and src/
/** Transliteration data: seed/eval TSVs, overrides.tsv and the trained model.json. */
const NAME_MEMORY_FILE = process.env.OCR_NAME_MEMORY_FILE ? path.resolve(process.env.OCR_NAME_MEMORY_FILE) : path.join(PROJECT_ROOT, "data", "learned", "hi-names.json");
const TRANSLIT_DIR = process.env.OCR_TRANSLIT_DIR ? path.resolve(process.env.OCR_TRANSLIT_DIR) : path.join(PROJECT_ROOT, "data", "translit");

const program = new Command();
program.name("eroll-ocr").description("Batch OCR: ECI eRoll PDFs -> upload-ready CSV").version("0.1.0");

function addCommonOptions(cmd: Command): Command {
  return cmd
    .option("--out <dir>", "output directory (default ./output)")
    .option("--cache <dir>", "result cache directory (default ./cache)")
    .option("--tmp <dir>", "scratch dir for rendered pages (default ./tmp)")
    .option("--template <name>", "force a layout template (default: by state)")
    .option("--dpi <n>", "render DPI (default 200)", (v) => Number(v))
    .option("--mode <mode>", "strip | page | card (default strip; llm engine only)")
    .option("--engine <engine>", "hybrid | llm (default hybrid: tesseract locally, model only for uncertain cards)")
    .option("--local-min-conf <n>", "hybrid: tesseract confidence 0..1 below which a card goes to the model (default 0.85)", (v) => Number(v))
    .option("--provider <p>", "claude | openai | gemini (default $OCR_PROVIDER or claude)")
    .option("--model <id>", "model id for the provider")
    .option("--concurrency <n>", "PDFs processed in parallel (default 2)", (v) => Number(v))
    .option("--page-concurrency <n>", "pages OCR'd in parallel across all PDFs (default: CPU cores)", (v) => Number(v))
    .option("--ocr-concurrency <n>", "max simultaneous model calls (default 4)", (v) => Number(v))
    .option("--threshold <n>", "confidence threshold for low_confidence flag (default 0.7)", (v) => Number(v))
    .option("--limit-pages <n>", "only process the first N pages of each PDF (smoke tests)", (v) => Number(v))
    .option("--force", "ignore cached results and re-OCR")
    .option("--no-learn", "do not read or update the cross-PDF Hindi name memory (data/learned/hi-names.json)")
    .option("--bom", "write a UTF-8 BOM at the start of the CSV (Excel-friendly)")
    .option("--push", "after each PDF, push its rows into the dashboard (needs DASHBOARD_URL and DASHBOARD_INGEST_TOKEN in .env; or OCR_PUSH=true)")
    .option("--force-push", "with --push: re-send PDFs already recorded in data/pushed.json")
    .option("--dry-run", "list PDFs and planned output; no rendering or model calls");
}

addCommonOptions(program.command("run").description("process every PDF in a constituency folder into one CSV").argument("<folder>", "constituency folder, e.g. \"raw-data/Uttar Pradesh/390-Varanasi Cantt-2024-Final\""))
  .action(async (folder: string, opts: CliOverrides) => {
    const code = await runCommand(folder, opts);
    process.exitCode = code;
  });

addCommonOptions(
  program.command("watch")
    .description("keep processing every <State>/<AC folder> under a raw-data root: new or changed PDFs are OCR'd (finished ones are cached) and, with --push, land in the dashboard without any upload")
    .argument("[root]", "raw-data root holding <State>/<AC No>-<AC Name>-<Year>-<Draft|Final>/ folders", "raw-data")
    .option("--interval <seconds>", "seconds between scans (default 120)", (v) => Number(v), 120)
    .option("--once", "scan every folder once and exit (e.g. from cron)"),
).action(async (rootDir: string, opts: CliOverrides & { interval: number; once?: boolean }) => {
  const root = path.resolve(rootDir);
  if (!fs.existsSync(root)) {
    console.error(`Not a directory: ${root}`);
    process.exitCode = 2;
    return;
  }
  const interval = Math.max(10, Number(opts.interval) || 120) * 1000;
  let stop = false;
  process.on("SIGINT", () => { stop = true; console.log("\nstopping after the current folder..."); });
  for (;;) {
    const folders = listAcFolders(root);
    const t0 = Date.now();
    let failed = 0;
    for (const f of folders) {
      if (stop) break;
      const code = await runCommand(f, opts);
      if (code !== 0) failed++;
    }
    console.log(`[watch] ${new Date().toISOString()} scanned ${folders.length} folder(s) in ${((Date.now() - t0) / 1000).toFixed(0)}s${failed ? `, ${failed} with failures` : ""}`);
    if (opts.once || stop) {
      process.exitCode = failed ? 1 : 0;
      return;
    }
    await new Promise((r) => setTimeout(r, interval));
  }
});

/** <root>/<State>/<AC folder>/ directories that hold at least one PDF, natural order. */
function listAcFolders(root: string): string[] {
  const out: string[] = [];
  for (const state of fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith(".")).sort((a, b) => naturalCompare(a.name, b.name))) {
    const stateDir = path.join(root, state.name);
    for (const ac of fs.readdirSync(stateDir, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith(".")).sort((a, b) => naturalCompare(a.name, b.name))) {
      const dir = path.join(stateDir, ac.name);
      if (fs.readdirSync(dir).some((f) => /\.pdf$/i.test(f))) out.push(dir);
    }
  }
  return out;
}

program
  .command("templates")
  .description("list available layout templates")
  .action(() => {
    const cfg = buildConfig({}, PROJECT_ROOT);
    for (const t of loadTemplates(cfg.templatesDir).values()) {
      console.log(`${t.name.padEnd(18)} ${t.grid.cols}x${t.grid.rows}  states=[${t.match.states.join(", ")}]  ${t.description}`);
    }
  });

addCommonOptions(
  program.command("inspect").description("render one page, run grid detection, and write the strip/card crops to --tmp/inspect (no model calls)")
    .argument("<pdf>", "PDF file").option("--page <n>", "page number (default 3)", (v) => Number(v), 3),
).action(async (pdf: string, opts: CliOverrides & { page: number }) => {
  const cfg = buildConfig(opts, PROJECT_ROOT);
  await checkPopplerAvailable();
  const tpl = selectTemplate(loadTemplates(cfg.templatesDir), path.basename(path.dirname(path.dirname(path.resolve(pdf)))), cfg.templateOverride);
  const outDir = path.join(cfg.tmpDir, "inspect");
  fs.rmSync(outDir, { recursive: true, force: true });
  const png = await renderPage(pdf, opts.page, cfg.dpi, outDir);
  const dims = await imageDims(png);
  const detected = await detectRowBands(png, dims, tpl);
  const bands = detected ?? templateRowBands(dims, tpl, tpl.grid.rows);
  console.log(`template ${tpl.name}; page ${opts.page} is ${dims.width}x${dims.height}; ${bands.length} row bands (${detected ? "detected" : "TEMPLATE FALLBACK"})`);
  for (const [i, b] of bands.entries()) {
    const cols = await detectColumnBands(png, dims, b, tpl);
    console.log(`  row ${i + 1}: y ${b.top}-${b.bottom} (${b.bottom - b.top}px), ${cols.length} columns: ${cols.map((c) => `${c.left}-${c.right}`).join(" ")}`);
    fs.writeFileSync(path.join(outDir, `row-${String(i + 1).padStart(2, "0")}.png`), await cropBand(png, dims, b, tpl.strips.padPx));
  }
  console.log(`crops written to ${outDir}`);
});

addCommonOptions(
  program.command("ocr-eval").description("score the local read of hand-checked pages (test/fixtures/*.json): per-field accuracy, no model calls")
    .argument("[truth...]", "truth JSON files (default: all of test/fixtures)"),
).action(async (files: string[], opts: CliOverrides) => {
  const cfg = buildConfig({ ...opts, engine: "local" }, PROJECT_ROOT);
  await checkPopplerAvailable();
  const log = new Logger({});
  const truths = files.length ? files.map((f) => path.resolve(f)) : fs.readdirSync(path.join(PROJECT_ROOT, "test", "fixtures")).filter((f) => f.endsWith(".json")).map((f) => path.join(PROJECT_ROOT, "test", "fixtures", f));
  const cache = new ResultCache(path.join(cfg.tmpDir, "ocr-eval-cache"));
  let totalPerfect = 0, totalTruth = 0;
  for (const truthFile of truths) {
    const truth = JSON.parse(fs.readFileSync(truthFile, "utf8")) as { pdf: string };
    const state = path.basename(path.dirname(path.dirname(path.resolve(PROJECT_ROOT, truth.pdf))));
    const tpl = selectTemplate(loadTemplates(cfg.templatesDir), state, cfg.templateOverride);
    const ctx: PdfContext = { cfg, log, tpl, client: null, cache, translit: new Transliterator(TRANSLIT_DIR) };
    const r = await evalTruthFile(ctx, truthFile, PROJECT_ROOT);
    console.log(evalText(path.basename(truthFile), r));
    totalPerfect += r.perfect;
    totalTruth += r.truth;
  }
  if (truths.length > 1) console.log(`\nTOTAL fully correct cards: ${totalPerfect}/${totalTruth}`);
  await log.close();
});

program
  .command("translit")
  .description("transliterate Devanagari names with the local engine (no model API)")
  .argument("<text...>", "names, e.g. \"धीर सिंह\" \"मुनेन्दर\"")
  .option("--no-lexicon", "skip the exact-match lexicon (shows what rules + model do on their own)")
  .option("--rules-only", "ignore the trained model and overrides; rules alone")
  .action((texts: string[], opts: { lexicon: boolean; rulesOnly?: boolean }) => {
    const dir = opts.rulesOnly ? path.join(PROJECT_ROOT, "nonexistent") : TRANSLIT_DIR;
    const t = new Transliterator(dir, { useLexicon: opts.lexicon, useOverrides: !opts.rulesOnly });
    for (const s of texts) console.log(`${s}\t${t.name(s)}`);
  });

program
  .command("translit-train")
  .description(`train the transliteration model from ${path.relative(PROJECT_ROOT, TRANSLIT_DIR)}/*.tsv (except ${OVERRIDES_FILE}, eval.tsv) plus --extra corpora`)
  .option("--extra <files...>", "extra corpora: TSV (hi, roman[, count]) or JSON/JSONL (Aksharantar-style native/english fields)")
  .option("--out <file>", `output model file (default ${path.join(TRANSLIT_DIR, MODEL_FILE)})`)
  .option("--show-skipped <n>", "print the first N pairs that could not be aligned", (v) => Number(v), 20)
  .action((opts: { extra?: string[]; out?: string; showSkipped: number }) => {
    const files = fs.readdirSync(TRANSLIT_DIR)
      .filter((f) => f.endsWith(".tsv") && f !== OVERRIDES_FILE && f !== "eval.tsv")
      .map((f) => path.join(TRANSLIT_DIR, f));
    const pairs = [...files.flatMap(loadPairsTsv), ...(opts.extra ?? []).flatMap((f) => loadPairsAny(path.resolve(f)))];
    if (!pairs.length) {
      console.error(`no training pairs found in ${TRANSLIT_DIR}`);
      process.exitCode = 2;
      return;
    }
    const { model, report } = trainModel(pairs);
    const out = opts.out ? path.resolve(opts.out) : path.join(TRANSLIT_DIR, MODEL_FILE);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(model));
    console.log(`files: ${files.map((f) => path.basename(f)).join(", ")}${opts.extra?.length ? ` + ${opts.extra.length} extra` : ""}`);
    console.log(`pairs: ${report.pairs}, aligned: ${report.aligned}, skipped: ${report.skipped.length}`);
    console.log(`lexicon: ${Object.keys(model.lexicon).length} tokens, context keys: ${Object.keys(model.ctx).length}`);
    console.log(`wrote ${out} (${(fs.statSync(out).size / 1024).toFixed(0)} KB)`);
    for (const s of report.skipped.slice(0, opts.showSkipped)) console.log(`  skipped: ${s.hi} -> ${s.en} (${s.why})`);
  });

program
  .command("translit-eval")
  .description("score the transliterator against a TSV of expected spellings (default data/translit/eval.tsv)")
  .argument("[file]", "TSV: <Devanagari>TAB<expected Roman>")
  .option("--no-lexicon", "skip the exact-match lexicon (generalisation score)")
  .option("--rules-only", "rules alone, no model")
  .action((file: string | undefined, opts: { lexicon: boolean; rulesOnly?: boolean }) => {
    const f = file ? path.resolve(file) : path.join(TRANSLIT_DIR, "eval.tsv");
    const pairs = loadPairsTsv(f);
    const dir = opts.rulesOnly ? path.join(PROJECT_ROOT, "nonexistent") : TRANSLIT_DIR;
    const t = new Transliterator(dir, { useLexicon: opts.lexicon, useOverrides: !opts.rulesOnly });
    let ok = 0;
    const miss: string[] = [];
    for (const p of pairs) {
      const got = t.name(p.hi);
      if (got.toLowerCase() === p.en.toLowerCase()) ok++;
      else miss.push(`  ${p.hi}\texpected ${p.en}\tgot ${got}`);
    }
    console.log(`${f}: ${ok}/${pairs.length} exact (${((100 * ok) / Math.max(1, pairs.length)).toFixed(1)}%)${opts.lexicon ? "" : " without lexicon"}${opts.rulesOnly ? " rules only" : ""}`);
    for (const m of miss) console.log(m);
  });

async function runCommand(folder: string, opts: CliOverrides): Promise<number> {
  const startedAt = new Date();
  const cfg = buildConfig(opts, PROJECT_ROOT);
  const c = parseConstituencyFolder(folder);
  if (!fs.existsSync(c.folder) || !fs.statSync(c.folder).isDirectory()) {
    console.error(`Not a directory: ${c.folder}`);
    return 2;
  }
  // Layout: <out>/<State>/<AC No>-<AC Name>-<Year>/<State>-<AC No>-<AC Name>-<Year>-<Draft|Final><part no>.csv
  const acDir = path.join(cfg.outDir, c.state, outputDirName(c));
  fs.mkdirSync(acDir, { recursive: true });
  const csvName = outputCsvName(c); // used for the summary and log names
  const csvFile = path.join(acDir, csvName);
  const stamp = startedAt.toISOString().replace(/[:.]/g, "-");
  const log = new Logger({ file: path.join(acDir, "logs", `${csvName.replace(/\.csv$/, "")}-${stamp}.log`) });

  log.info("run", `folder: ${c.folder}`);
  if (!c.parsed) {
    log.warn("run", `folder name "${path.basename(c.folder)}" does not match "<AC No>-<AC Name>-<Year>-<Draft|Final>"; output will be ${csvName}`);
  }
  const pdfs = fs.readdirSync(c.folder).filter((f) => /\.pdf$/i.test(f)).sort(naturalCompare);
  if (pdfs.length === 0) {
    log.error("run", "no PDF files found in folder");
    await log.close();
    return 2;
  }
  log.info("run", `${pdfs.length} PDFs; engine ${cfg.engine}${cfg.engine === "local" ? " (tesseract + algorithms, no model, no API)" : `; backend ${cfg.backend}; provider ${cfg.provider}/${cfg.model}`}; ${cfg.engine === "llm" ? `mode ${cfg.mode}` : `local min conf ${cfg.localMinConf}`}; dpi ${cfg.dpi}; pdf concurrency ${cfg.pdfConcurrency}; page concurrency ${cfg.pageConcurrency}${cfg.engine === "local" ? "" : `; ocr concurrency ${cfg.ocrConcurrency}`}`);

  const templates = loadTemplates(cfg.templatesDir);
  const tpl = selectTemplate(templates, c.state, cfg.templateOverride);
  log.info("run", `template: ${tpl.name} (${tpl.grid.cols}x${tpl.grid.rows}, ${tpl.script})${c.supplementNo ? `; supplement ${c.supplementNo} of AC ${c.acNo}` : ""}`);

  let push: PushConfig | null = null;
  try {
    push = pushConfigFromEnv(PROJECT_ROOT, { push: opts.push, forcePush: opts.forcePush });
  } catch (e) {
    log.error("run", errMsg(e));
    await log.close();
    return 2;
  }
  if (push) log.info("run", `push: each finished PDF -> ${push.url} (${push.batchRows} rows per request${push.force ? ", forced" : ""})`);

  if (cfg.dryRun) {
    for (const f of pdfs) log.info("dry-run", `would process ${f}`);
    log.info("dry-run", `would write one CSV per part PDF into ${acDir}`);
    await log.close();
    return 0;
  }

  try {
    await checkPopplerAvailable();
    if (cfg.engine !== "llm") log.info("run", `tesseract: ${await checkTesseract(tpl.local.langs)} (langs ${tpl.local.langs})`);
  } catch (e) {
    log.error("run", errMsg(e));
    await log.close();
    return 2;
  }

  let client: VisionClient | null = null;
  if (cfg.engine !== "local") {
    try {
      client = new VisionClient(createProvider(cfg), cfg, log);
    } catch (e) {
      log.error("run", `cannot create vision provider: ${errMsg(e)}`);
      await log.close();
      return 2;
    }
  }
  const cache = new ResultCache(cfg.cacheDir);
  const translit = new Transliterator(TRANSLIT_DIR, { log });
  const ts = translit.stats;
  log.info("run", `transliteration: ${ts.modelFile ? `model ${path.relative(PROJECT_ROOT, ts.modelFile)} (${ts.lexicon} lexicon tokens, ${ts.contexts} contexts)` : "RULES ONLY (no model.json)"}, ${ts.overrides} overrides; cover page via ${cfg.coverViaModel ? "tesseract + model" : "tesseract only"}`);
  const names = cfg.learnNames ? new NameMemory(NAME_MEMORY_FILE) : undefined;
  if (names) log.info("run", `name memory: ${names.stats().learned} trusted Hindi name tokens (seen confidently in >= ${names.minPdfs} PDFs), ${names.stats().candidates} candidates`);
  const ctx: PdfContext = { cfg, log, tpl, client, cache, translit, pageSem: new Semaphore(cfg.pageConcurrency), names };

  // Process PDFs with limited parallelism; one bad PDF never aborts the batch.
  const sem = new Semaphore(cfg.pdfConcurrency);
  const cachedFiles = new Set<string>();
  const results: PdfResult[] = new Array(pdfs.length);
  await Promise.all(
    pdfs.map((f, i) =>
      sem.run(async () => {
        const file = path.join(c.folder, f);
        try {
          const before = client?.stats.calls ?? 0;
          const r = await processPdf(ctx, file);
          if (names && r.status === "ok") {
            const added = names.learnFrom(r.hash, r.pages.flatMap((p) => p.cards));
            names.save();
            if (added) log.info("learn", `${r.file}: ${added} Hindi name token(s) newly trusted by the name memory`);
          }
          if (r.status === "ok" && (client?.stats.calls ?? 0) === before && r.pages.every((p) => p.durationMs === 0)) cachedFiles.add(r.file);
          results[i] = r;
        } catch (e) {
          // processPdf already catches; this is belt and braces.
          log.error("pdf", `${f}: unexpected failure: ${errMsg(e)}`);
          results[i] = {
            schemaVersion: 1, file: f, hash: "", template: tpl.name, provider: cfg.provider, model: cfg.model,
            pageCount: 0, partNo: "", cover: null, pages: [], status: "failed", error: errMsg(e),
            startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(),
            usage: { inputTokens: 0, outputTokens: 0, calls: 0 },
          };
        }
      }),
    ),
  );

  // One CSV per part PDF. Duplicate EPICs are resolved within a part (main roll + its supplements).
  const agg: MergeStats = { rowsIn: 0, rowsOut: 0, duplicatesReplaced: 0, flagged: 0, flagCounts: {}, warnings: [] };
  const written = new Set<string>();
  let pushed = 0, pushSkipped = 0, pushFailed = 0;
  for (const r of results) {
    if (r.status !== "ok") continue;
    const m = mergeResults([r], c, tpl, cfg, log);
    if (push) {
      const o = await pushPdf(push, c, r, m.rows, log);
      if (o.pushed) pushed++;
      else if (/failed/.test(o.reason)) { pushFailed++; agg.warnings.push(o.reason); }
      else { pushSkipped++; log.info("push", o.reason); }
    }
    let name = partCsvName(c, r.partNo);
    if (written.has(name)) {
      const alt = name.replace(/\.csv$/, `_${path.basename(r.file, path.extname(r.file))}.csv`);
      m.stats.warnings.push(`${r.file}: part number "${r.partNo || "?"}" already used by another PDF; wrote ${alt} instead`);
      name = alt;
    }
    written.add(name);
    writeCsv(path.join(acDir, name), m.rows, { bom: cfg.bom });
    log.info("run", `wrote ${m.rows.length} rows -> ${path.join(acDir, name)}`);
    agg.rowsIn += m.stats.rowsIn;
    agg.rowsOut += m.stats.rowsOut;
    agg.duplicatesReplaced += m.stats.duplicatesReplaced;
    agg.flagged += m.stats.flagged;
    for (const [k, v] of Object.entries(m.stats.flagCounts)) agg.flagCounts[k] = (agg.flagCounts[k] ?? 0) + v;
    agg.warnings.push(...m.stats.warnings);
  }
  for (const w of agg.warnings) log.warn("check", w);
  if (push) log.info("push", `dashboard: ${pushed} PDF(s) pushed, ${pushSkipped} unchanged, ${pushFailed} failed`);
  const merged = { stats: agg };

  const summary = buildSummary(c, acDir, results, cachedFiles, merged.stats, startedAt, { provider: cfg.engine === "local" ? "local" : cfg.provider, model: cfg.engine === "local" ? "tesseract" : cfg.model, template: tpl.name });
  writeSummary(csvFile.replace(/\.csv$/, ""), summary);
  console.log("\n" + summaryText(summary));
  if (names) {
    const st = names.stats();
    log.info("learn", `name memory: ${st.learned} trusted tokens (+${st.newThisRun} this run), ${st.candidates} candidates -> ${path.relative(PROJECT_ROOT, names.file)}`);
  }
  log.info("run", `log file: ${log.file}`);
  await log.close();
  return summary.pdfs.failed > 0 || pushFailed > 0 ? 1 : 0;
}

program.parseAsync(process.argv).catch((e) => {
  console.error(errMsg(e));
  process.exit(2);
});
