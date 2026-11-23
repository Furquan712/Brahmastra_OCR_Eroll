import assert from "node:assert/strict";
import { test } from "node:test";
import { STAMP_BAND_MIN, STAMP_RESID_BAND_MIN, shearBand, stampFromPixels } from "../src/local.js";

// A synthetic 200-dpi card: 320 × 140 px, white, with four horizontal lines of "text" (black cores
// with grey edges) and, when stamped, a grey band rising at 30 degrees across the body.
function card(stamped: boolean, lines = 4): { px: Uint8Array; w: number; h: number } {
  const w = 320, h = 140, px = new Uint8Array(w * h).fill(255);
  for (let l = 0; l < lines; l++) {
    const y0 = 34 + l * 22;
    for (let x = 10; x < 200; x++) {
      for (let y = y0; y < y0 + 6; y++) px[y * w + x] = 30;      // black core
      px[(y0 - 1) * w + x] = 170; px[(y0 + 6) * w + x] = 170;   // grey edges
    }
  }
  if (stamped) {
    // DELETED: a band of grey ink 14 px thick, rising to the right at 30 degrees, from bottom-left
    for (let x = 20; x < 300; x++) {
      const yc = 120 - (x - 20) * 0.5774;
      for (let y = Math.round(yc - 7); y <= Math.round(yc + 7); y++) {
        if (y < 0 || y >= h) continue;
        const i = y * w + x;
        if (px[i] === 255 && (x + y) % 3 !== 0) px[i] = 180;     // halftone grey, never over text
      }
    }
  }
  return { px, w, h };
}

test("shearBand: a 30-degree band collapses to one dense window, horizontal lines do not", () => {
  const s = card(true, 0), c = card(false, 4);
  const grey = (k: { px: Uint8Array; w: number; h: number }) => k.px.map((v) => (v > 100 && v < 235 ? 1 : 0));
  assert.ok(shearBand(grey(s), s.w, s.h) > 0.3, "band of a pure stamp");
  assert.ok(shearBand(grey(c), c.w, c.h) < 0.1, "band of text edges only");
});

test("stampFromPixels: stamped card passes both thresholds, text-only card passes neither", () => {
  const s = stampFromPixels(card(true).px, 320, 140);
  const c = stampFromPixels(card(false).px, 320, 140);
  const heavy = stampFromPixels(card(false, 5).px, 320, 140);
  assert.ok(s.band >= STAMP_BAND_MIN && s.residBand >= STAMP_RESID_BAND_MIN && s.stamped, JSON.stringify(s));
  assert.ok(!c.stamped && c.residBand < STAMP_RESID_BAND_MIN, JSON.stringify(c));
  assert.ok(!heavy.stamped, "five lines of text are not a stamp: " + JSON.stringify(heavy));
});
