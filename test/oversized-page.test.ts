import assert from "node:assert/strict";
import { test } from "node:test";
import { effectiveDensity } from "../src/image.js";
import { renderDpi } from "../src/pdf.js";

test("A4 and near-A4 pages keep the requested DPI, or the page size is unknown", () => {
  assert.equal(renderDpi(842, 300), 300);
  assert.equal(renderDpi(792, 300), 300);
  assert.equal(renderDpi(1190, 300), 300);
  assert.equal(renderDpi(null, 300), 300);
});

test("an oversized page is rendered to A4 pixel size", () => {
  const dpi = renderDpi(2806, 300);
  assert.equal(dpi, 90);
  assert.ok(Math.abs((2806 / 72) * dpi - 3508) < 5);
  assert.equal(renderDpi(2806, 200), 60);
});

test("the density tag of an A4 render is never changed", () => {
  assert.equal(effectiveDensity(300, 2480), 300);
  assert.equal(effectiveDensity(200, 1654), 200);
  assert.equal(effectiveDensity(undefined, 2480), undefined);
});

test("an oversized page rendered at 90 dpi counts as 300", () => {
  assert.equal(effectiveDensity(90, 2479), 300);
});
