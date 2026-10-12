import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

export class PdfToolError extends Error {}

/** First meaningful line of a child-process failure (poppler prints multi-line syntax errors). */
function shortErr(e: unknown): string {
  const err = e as Error & { stderr?: string; code?: string | number; signal?: string };
  const stderrLine = err.stderr?.split(/\r?\n/).map((l) => l.trim()).find((l) => /error/i.test(l));
  if (stderrLine) return stderrLine;
  if (err.signal) return `killed by ${err.signal}`;
  return (err.message ?? String(e)).split(/\r?\n/)[0];
}

/** Checks that poppler's pdfinfo/pdftoppm are on PATH. Throws a readable error otherwise. */
export async function checkPopplerAvailable(): Promise<void> {
  for (const tool of ["pdfinfo", "pdftoppm"]) {
    try {
      await execFileP(tool, ["-v"]);
    } catch (e: unknown) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        throw new PdfToolError(
          `"${tool}" not found on PATH. Install poppler (Debian/Ubuntu: apt-get install poppler-utils; macOS: brew install poppler).`,
        );
      }
      // pdfinfo -v exits non-zero but prints version; that's fine.
    }
  }
}

export async function pdfPageCount(file: string): Promise<number> {
  let stdout: string;
  try {
    ({ stdout } = await execFileP("pdfinfo", [file], { maxBuffer: 4 * 1024 * 1024 }));
  } catch (e: unknown) {
    throw new PdfToolError(`pdfinfo failed for ${path.basename(file)}: ${shortErr(e)}`);
  }
  const m = /^Pages:\s+(\d+)/m.exec(stdout);
  if (!m) throw new PdfToolError(`pdfinfo returned no page count for ${path.basename(file)}`);
  return Number(m[1]);
}

/**
 * Renders a single page to PNG at the given DPI. Returns the PNG path.
 * Only one page is on disk / in memory at a time per PDF by construction.
 */
export async function renderPage(file: string, page: number, dpi: number, outDir: string): Promise<string> {
  fs.mkdirSync(outDir, { recursive: true });
  const prefix = path.join(outDir, `page-${String(page).padStart(4, "0")}`);
  const out = `${prefix}.png`;
  try {
    await execFileP(
      "pdftoppm",
      ["-r", String(dpi), "-f", String(page), "-l", String(page), "-png", "-singlefile", file, prefix],
      { timeout: 120_000, maxBuffer: 1024 * 1024 },
    );
  } catch (e: unknown) {
    throw new PdfToolError(`pdftoppm failed on page ${page} of ${path.basename(file)}: ${shortErr(e)}`);
  }
  if (!fs.existsSync(out)) throw new PdfToolError(`pdftoppm produced no output for page ${page}`);
  return out;
}

export function removeQuiet(p: string): void {
  try {
    fs.rmSync(p, { force: true, recursive: true });
  } catch {
    /* ignore */
  }
}
