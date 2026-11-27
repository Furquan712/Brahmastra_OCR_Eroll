#!/usr/bin/env node
/**
 * node dist/text-cli.js <folder> [--write]
 *
 * Reads every ECI PDF of a folder from its text layer. Without --write nothing is stored: it only
 * reports what agrees with the covers. With --write, each PDF that passes is put in the result cache;
 * `node dist/cli.js run <folder> --push` then uploads without OCR.
 * Exit code 1 when any PDF did not pass (those are not cached).
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { ResultCache } from "./cache.js";
import { buildConfig } from "./config.js";
import { loadTemplates, selectTemplate } from "./templates.js";
import { readTextPdf, type TextLine } from "./text-roll.js";
import { Transliterator } from "./translit.js";
import { naturalCompare, sha256File } from "./util.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, "..");
const run = promisify(execFile);

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const write = args.includes("--write");
  const folder = path.resolve(args.find((a) => !a.startsWith("--")) ?? "");
  if (!args.length || !fs.statSync(folder).isDirectory()) throw new Error("usage: node dist/text-cli.js <folder> [--write]");
  const cfg = buildConfig({ engine: "local" }, ROOT);
  const state = path.basename(path.dirname(folder));
  const tpl = selectTemplate(loadTemplates(cfg.templatesDir), state, cfg.templateOverride);
  const translit = new Transliterator(process.env.OCR_TRANSLIT_DIR ? path.resolve(process.env.OCR_TRANSLIT_DIR) : path.join(ROOT, "data", "translit"));
  const cache = new ResultCache(cfg.cacheDir);
  const files = fs.readdirSync(folder).filter((f) => f.toLowerCase().endsWith(".pdf")).sort(naturalCompare).map((f) => path.join(folder, f));
  let passed = 0, cards = 0;
  const failed: string[] = [];
  for (let i = 0; i < files.length; i += 20) {
    const batch = files.slice(i, i + 20);
    const { stdout } = await run("python3", [path.join(ROOT, "scripts", "pdf_lines.py"), ...batch], { maxBuffer: 1 << 29 });
    for (const line of stdout.split("\n").filter(Boolean)) {
      const doc = JSON.parse(line) as { file: string; pages?: TextLine[][]; error?: string };
      const base = path.basename(doc.file);
      if (!doc.pages) {
        failed.push(`${base}: ${doc.error}`);
        continue;
      }
      const { result, problems } = readTextPdf(doc.pages, base, await sha256File(doc.file), tpl, translit);
      if (problems.length) failed.push(`${base}: ${problems.join("; ")}`);
      else {
        passed++;
        cards += result.pages.reduce((n, p) => n + p.cards.length, 0);
        if (write) cache.putPdf(result);
      }
    }
  }
  for (const f of failed) console.log(`NOT PASSED  ${f}`);
  console.log(`${path.basename(folder)}: ${passed} of ${files.length} PDFs agree with their covers (${cards} cards)${write ? ", cached" : ", nothing written"}; ${failed.length} not passed`);
  process.exitCode = failed.length ? 1 : 0;
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
