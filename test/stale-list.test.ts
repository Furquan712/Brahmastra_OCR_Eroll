import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { CoverInfo } from "../src/types.js";
import type { Logger } from "../src/logger.js";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "parts-"));
process.env.OCR_PARTS_DIR = dir;
const { applyOfficialPartName } = await import("../src/official-parts.js");
const log = { debug() {}, info() {}, warn() {}, error() {} } as unknown as Logger;
const list = (ac: number, fetchedAt: string) =>
  fs.writeFileSync(path.join(dir, `S24-${ac}.json`), JSON.stringify({ acName: "X", fetchedAt, count: 1, maxPart: 1, parts: [{ partNumber: 1, partName: "OFFICIAL" }] }));
const apply = (ac: number) => {
  const cover = { acNo: String(ac), partNo: "1", psNameEn: "cover" } as CoverInfo;
  applyOfficialPartName(cover, "S24", log, `2026-EROLLGEN-S24-${ac}-SIR-FinalRoll-Revision1-HIN-1-WI.pdf`);
  return cover.psNameEn;
};

test("a list saved before the portal renumbered its parts names a SIR roll; a later one does not", () => {
  list(901, "2026-11-01T10:00:00");
  list(902, "2026-11-20T10:00:00");
  assert.equal(apply(901), "OFFICIAL");
  assert.equal(apply(902), "cover");
});
