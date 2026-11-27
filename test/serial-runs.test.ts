import assert from "node:assert/strict";
import { test } from "node:test";
import { repairSerialRuns } from "../src/pipeline.js";
import type { CoverInfo, PageResult } from "../src/types.js";

const page = (n: number, start: number, len = 30): PageResult =>
  ({ page: n, pageType: "voter_grid", cards: Array.from({ length: len }, (_, i) => ({ serial: start + i })) }) as unknown as PageResult;
const serials = (pages: PageResult[]) => pages.flatMap((p) => p.cards.map((c) => c.serial));
const cover = (serialTo: number) => ({ serialFrom: 1, serialTo }) as CoverInfo;
const oneTo = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

test("a run of pages read with a wrong leading digit is renumbered to fit its neighbours", () => {
  const pages = [page(3, 1), page(4, 31), page(5, 461), page(6, 491), page(7, 121)];
  assert.equal(repairSerialRuns(pages, cover(150)), 60);
  assert.deepEqual(serials(pages), oneTo(150));
});

test("a wrong last page is repaired only when the cover's last serial confirms it", () => {
  const confirmed = [page(3, 1), page(4, 31), page(5, 961, 5)];
  assert.equal(repairSerialRuns(confirmed, cover(65)), 5);
  assert.deepEqual(serials(confirmed), oneTo(65));
  const unknown = [page(3, 1), page(4, 31), page(5, 961, 5)];
  assert.equal(repairSerialRuns(unknown, cover(80)), 0);
});

test("a real gap (cards the OCR did not find) is left alone", () => {
  const pages = [page(3, 1), page(4, 31, 28), page(5, 61), page(6, 91)];
  assert.equal(repairSerialRuns(pages, cover(120)), 0);
});
