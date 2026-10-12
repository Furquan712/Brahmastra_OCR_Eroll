import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

export class TesseractError extends Error {}

export interface TessWord {
  text: string;
  conf: number; // 0..100
  x: number; y: number; w: number; h: number;
  block: number; par: number; line: number;
}
export interface TessResult {
  text: string; // lines joined by \n, in reading order
  words: TessWord[];
  lines: { text: string; conf: number; words: TessWord[] }[];
}

export interface TessOptions {
  langs: string; // e.g. "hin+eng"
  psm: number;
  whitelist?: string;
  dpi?: number;
}

export function tesseractCmd(): string {
  return process.env.TESSERACT_CMD || "tesseract";
}

/** Verifies the binary and every requested language pack exist. */
export async function checkTesseract(langs: string): Promise<string> {
  let out: string;
  try {
    const r = await execFileP(tesseractCmd(), ["--list-langs"]);
    out = r.stdout + r.stderr;
  } catch (e: unknown) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      throw new TesseractError(`"${tesseractCmd()}" not found. Install tesseract (Debian/Ubuntu: apt-get install tesseract-ocr tesseract-ocr-hin; macOS: brew install tesseract) or set TESSERACT_CMD.`);
    }
    out = ((e as { stdout?: string }).stdout ?? "") + ((e as { stderr?: string }).stderr ?? "");
  }
  const available = new Set(out.split(/\r?\n/).map((l) => l.trim()).filter((l) => /^[a-z_]+$/.test(l)));
  const missing = langs.split("+").filter((l) => !available.has(l));
  if (missing.length) {
    throw new TesseractError(`tesseract language data missing: ${missing.join(", ")}. Install e.g. tesseract-ocr-${missing[0]} or copy ${missing[0]}.traineddata (tessdata_best recommended) into the tessdata directory.`);
  }
  const ver = await execFileP(tesseractCmd(), ["--version"]).catch((e: { stdout?: string; stderr?: string }) => ({ stdout: e.stdout ?? "", stderr: e.stderr ?? "" }));
  return (ver.stdout + ver.stderr).split(/\r?\n/)[0];
}

/**
 * Runs ONE tesseract process over many images (list-file mode) and returns a result per
 * image. This avoids ~60 ms of process start-up per crop, which dominates for small crops.
 * Images are written to `workDir` and removed afterwards.
 */
export async function tesseractBatch(images: Buffer[], opts: TessOptions, workDir: string): Promise<TessResult[]> {
  if (images.length === 0) return [];
  const dir = fs.mkdtempSync(path.join(workDir, "tess-"));
  try {
    const files: string[] = [];
    images.forEach((img, i) => {
      const f = path.join(dir, `${String(i).padStart(4, "0")}.png`);
      fs.writeFileSync(f, img);
      files.push(f);
    });
    const list = path.join(dir, "list.txt");
    fs.writeFileSync(list, files.join("\n") + "\n");
    const args = [list, "-", "-l", opts.langs, "--psm", String(opts.psm)];
    if (opts.dpi) args.push("--dpi", String(opts.dpi));
    if (opts.whitelist !== undefined) args.push("-c", `tessedit_char_whitelist=${opts.whitelist}`);
    args.push("tsv");
    let stdout: string;
    try {
      ({ stdout } = await execFileP(tesseractCmd(), args, {
        env: { ...process.env, OMP_THREAD_LIMIT: "1" },
        maxBuffer: 64 * 1024 * 1024,
        timeout: 300_000,
      }));
    } catch (e: unknown) {
      const err = e as Error & { stderr?: string };
      throw new TesseractError(`tesseract failed: ${(err.stderr || err.message).split(/\r?\n/).find((l) => l.trim()) ?? "unknown error"}`);
    }
    return parseTsv(stdout, images.length);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Parses tesseract TSV output (level 5 = word rows) into per-page results. */
export function parseTsv(tsv: string, pages: number): TessResult[] {
  const perPage: TessWord[][] = Array.from({ length: pages }, () => []);
  const rows = tsv.split(/\r?\n/);
  for (const row of rows.slice(1)) {
    const f = row.split("\t");
    if (f.length < 12) continue;
    if (f[0] !== "5") continue; // word level
    const page = Number(f[1]) - 1;
    const text = f.slice(11).join("\t").trim();
    if (!text || page < 0 || page >= pages) continue;
    perPage[page].push({
      text, conf: Number(f[10]),
      x: Number(f[6]), y: Number(f[7]), w: Number(f[8]), h: Number(f[9]),
      block: Number(f[2]), par: Number(f[3]), line: Number(f[4]),
    });
  }
  return perPage.map((words) => {
    const lines: TessResult["lines"] = [];
    let key = "";
    for (const w of words) {
      const k = `${w.block}/${w.par}/${w.line}`;
      if (k !== key) {
        lines.push({ text: "", conf: 100, words: [] });
        key = k;
      }
      const L = lines[lines.length - 1];
      L.words.push(w);
      L.text = L.text ? `${L.text} ${w.text}` : w.text;
      L.conf = Math.min(L.conf, w.conf);
    }
    // Reading order: sort lines by their top y (tesseract usually already does this).
    lines.sort((a, b) => Math.min(...a.words.map((w) => w.y)) - Math.min(...b.words.map((w) => w.y)));
    return { text: lines.map((l) => l.text).join("\n"), words, lines };
  });
}
