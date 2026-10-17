import fs from "node:fs";
import path from "node:path";
import type { PageResult, PdfResult } from "./types.js";

/** Bump when cached results become unusable: 2 = cover parsed locally, English names local. */
export const RESULT_SCHEMA_VERSION = 3; // 3: cover section-2 metadata, printed page numbers, cleaned names

export class ResultCache {
  constructor(private readonly dir: string) {
    fs.mkdirSync(dir, { recursive: true });
  }

  private pdfFile(hash: string): string {
    return path.join(this.dir, `${hash}.json`);
  }
  private pageDir(hash: string): string {
    return path.join(this.dir, hash);
  }
  private pageFile(hash: string, page: number): string {
    return path.join(this.pageDir(hash), `page-${String(page).padStart(4, "0")}.json`);
  }

  getPdf(hash: string): PdfResult | null {
    const f = this.pdfFile(hash);
    if (!fs.existsSync(f)) return null;
    try {
      const r = JSON.parse(fs.readFileSync(f, "utf8")) as PdfResult;
      if (r.schemaVersion !== RESULT_SCHEMA_VERSION || r.status !== "ok") return null;
      return r;
    } catch {
      return null;
    }
  }

  putPdf(r: PdfResult): void {
    const f = this.pdfFile(r.hash);
    fs.writeFileSync(f + ".tmp", JSON.stringify(r, null, 1));
    fs.renameSync(f + ".tmp", f);
    if (r.status === "ok") fs.rmSync(this.pageDir(r.hash), { recursive: true, force: true });
  }

  getPage(hash: string, page: number): PageResult | null {
    const f = this.pageFile(hash, page);
    if (!fs.existsSync(f)) return null;
    try {
      const r = JSON.parse(fs.readFileSync(f, "utf8")) as PageResult;
      if (r.schemaVersion !== RESULT_SCHEMA_VERSION) return null;
      return r;
    } catch {
      return null;
    }
  }

  putPage(hash: string, r: PageResult): void {
    fs.mkdirSync(this.pageDir(hash), { recursive: true });
    const f = this.pageFile(hash, r.page);
    fs.writeFileSync(f + ".tmp", JSON.stringify({ ...r, schemaVersion: RESULT_SCHEMA_VERSION }));
    fs.renameSync(f + ".tmp", f);
  }

  clearPdf(hash: string): void {
    fs.rmSync(this.pdfFile(hash), { force: true });
    fs.rmSync(this.pageDir(hash), { recursive: true, force: true });
  }
}
