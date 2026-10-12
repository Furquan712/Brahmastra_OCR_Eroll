import sharp from "sharp";
import type { Template } from "./templates.js";

export interface Band { top: number; bottom: number }
export interface Dims { width: number; height: number }

export async function imageDims(file: string): Promise<Dims> {
  const m = await sharp(file).metadata();
  if (!m.width || !m.height) throw new Error(`Cannot read image dimensions of ${file}`);
  return { width: m.width, height: m.height };
}

/** Downscale a page for the cheap classification call. Returns PNG bytes. */
export async function downscaleForClassification(file: string, longEdgePx: number): Promise<Buffer> {
  return sharp(file)
    .resize({ width: longEdgePx, height: longEdgePx, fit: "inside", withoutEnlargement: true })
    .png({ compressionLevel: 6 })
    .toBuffer();
}

/** Crop a horizontal strip (full width) with vertical padding. Returns PNG bytes. */
export async function cropBand(file: string, dims: Dims, band: Band, padPx: number): Promise<Buffer> {
  const top = Math.max(0, band.top - padPx);
  const bottom = Math.min(dims.height, band.bottom + padPx);
  return sharp(file)
    .extract({ left: 0, top, width: dims.width, height: bottom - top })
    .png({ compressionLevel: 6 })
    .toBuffer();
}

export async function cropRect(
  file: string,
  rect: { left: number; top: number; width: number; height: number },
): Promise<Buffer> {
  return sharp(file).extract(rect).png({ compressionLevel: 6 }).toBuffer();
}

/**
 * Finds the vertical bands occupied by card rows by looking for long horizontal
 * rules (card borders). Works for any bordered-card grid regardless of
 * per-state geometry. Returns null when the result does not look like a grid
 * (caller then falls back to the template's fixed geometry).
 */
export async function detectRowBands(file: string, dims: Dims, tpl: Template): Promise<Band[] | null> {
  const { data, info } = await sharp(file).greyscale().raw().toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
  const darkThreshold = 140;

  // 1. Per-row dark pixel counts.
  const darkPerRow = new Int32Array(h);
  for (let y = 0; y < h; y++) {
    let dark = 0;
    const off = y * w;
    for (let x = 0; x < w; x++) if (data[off + x] < darkThreshold) dark++;
    darkPerRow[y] = dark;
  }

  // Groups consecutive rows whose dark fraction >= minFrac into "lines"; drops thick blobs.
  const linesAbove = (minFrac: number): { y0: number; y1: number }[] => {
    const minDark = Math.floor(w * minFrac);
    const lines: { y0: number; y1: number }[] = [];
    for (let y = 0; y < h; y++) {
      if (darkPerRow[y] < minDark) continue;
      const last = lines[lines.length - 1];
      if (last && y - last.y1 <= 2) last.y1 = y;
      else lines.push({ y0: y, y1: y });
    }
    return lines.filter((l) => l.y1 - l.y0 < Math.max(8, h * 0.004));
  };

  // 2. Strong rules = borders of full (or mostly full) card rows. Text lines across
  //    all columns reach ~30% of the width, full-row borders ~95%.
  const rules = linesAbove(tpl.detection.minLineFraction);
  if (rules.length < 2) return null;

  // 3. Pair rules into bands: a card row = (top rule, next rule) where the gap is
  //    "card sized" (close to the largest gaps we see). Inter-card gaps are much smaller.
  const gaps: number[] = [];
  for (let i = 0; i + 1 < rules.length; i++) gaps.push(rules[i + 1].y0 - rules[i].y1);
  const sorted = [...gaps].sort((a, b) => a - b);
  const cardGap = sorted[Math.floor(sorted.length * 0.9)];
  if (!cardGap || cardGap < h * 0.03) return null;

  const bands: Band[] = [];
  let i = 0;
  while (i + 1 < rules.length) {
    const gap = rules[i + 1].y0 - rules[i].y1;
    if (gap > cardGap * 0.6 && gap < cardGap * 1.6) {
      bands.push({ top: rules[i].y0, bottom: rules[i + 1].y1 });
      i += 2;
    } else {
      i += 1;
    }
  }
  if (bands.length === 0 || bands.length > tpl.grid.rows + 1) return null;
  const heights = bands.map((b) => b.bottom - b.top);
  const med = heights.slice().sort((a, b) => a - b)[Math.floor(heights.length / 2)];
  if (heights.some((hh) => Math.abs(hh - med) > med * 0.25)) return null;

  // 4. A trailing partial row with a single card has borders spanning only ~1/cols of
  //    the width - the same as a text line - so look for it by POSITION: it must sit
  //    one row pitch below the last band and have the same height.
  if (bands.length >= 2 && bands.length < tpl.grid.rows) {
    const pitch = bands[bands.length - 1].top - bands[bands.length - 2].top;
    const last = bands[bands.length - 1];
    const expTop = last.top + pitch;
    const expBottom = last.bottom + pitch;
    const tol = Math.max(4, Math.round(med * 0.03));
    const weak = linesAbove(Math.max(0.12, 0.8 / tpl.grid.cols));
    const topLine = weak.find((l) => Math.abs(l.y0 - expTop) <= tol);
    const bottomLine = weak.find((l) => Math.abs(l.y1 - expBottom) <= tol);
    if (topLine && bottomLine && bottomLine.y1 <= h) bands.push({ top: topLine.y0, bottom: bottomLine.y1 });
  }
  return bands;
}

/** Fixed-geometry fallback: slice the template body region into equal rows. */
export function templateRowBands(dims: Dims, tpl: Template, rowsFilled: number): Band[] {
  const top = Math.round(dims.height * tpl.fallbackBody.top);
  const bottom = Math.round(dims.height * tpl.fallbackBody.bottom);
  const rowH = (bottom - top) / tpl.grid.rows;
  const n = Math.max(1, Math.min(tpl.grid.rows, rowsFilled || tpl.grid.rows));
  const bands: Band[] = [];
  for (let r = 0; r < n; r++) {
    bands.push({ top: Math.round(top + r * rowH), bottom: Math.round(top + (r + 1) * rowH) });
  }
  return bands;
}

/**
 * Column boundaries inside a band, from long vertical rules. Used by card mode.
 * Falls back to equal division by template column count.
 */
export async function detectColumnBands(
  file: string,
  dims: Dims,
  band: Band,
  tpl: Template,
): Promise<{ left: number; right: number }[]> {
  const height = band.bottom - band.top;
  const { data, info } = await sharp(file)
    .extract({ left: 0, top: band.top, width: dims.width, height })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
  // Card borders span the whole band; the photo box inside a card spans ~60% of it,
  // so demand 85% to see only the card outlines.
  const minDark = Math.floor(h * 0.85);
  const cols: number[] = [];
  for (let x = 0; x < w; x++) {
    let dark = 0;
    for (let y = 0; y < h; y++) if (data[y * w + x] < 140) dark++;
    if (dark >= minDark) cols.push(x);
  }
  const lines: { x0: number; x1: number }[] = [];
  for (const x of cols) {
    const last = lines[lines.length - 1];
    if (last && x - last.x1 <= 2) last.x1 = x;
    else lines.push({ x0: x, x1: x });
  }
  const rules = lines.filter((l) => l.x1 - l.x0 < Math.max(8, w * 0.004));
  // Pair: card = (rule, next rule) where gap is card-width-ish.
  const gaps: number[] = [];
  for (let i = 0; i + 1 < rules.length; i++) gaps.push(rules[i + 1].x0 - rules[i].x1);
  const sorted = [...gaps].sort((a, b) => a - b);
  const cardGap = sorted[Math.floor(sorted.length * 0.9)];
  const out: { left: number; right: number }[] = [];
  if (cardGap && cardGap > w * 0.1) {
    let i = 0;
    while (i + 1 < rules.length) {
      const gap = rules[i + 1].x0 - rules[i].x1;
      if (gap > cardGap * 0.6 && gap < cardGap * 1.6) {
        out.push({ left: rules[i].x0, right: rules[i + 1].x1 });
        i += 2;
      } else i += 1;
    }
  }
  if (out.length >= 1 && out.length <= tpl.grid.cols) return out;
  // Fallback: equal division of the template body width.
  const left = Math.round(dims.width * tpl.fallbackBody.left);
  const right = Math.round(dims.width * tpl.fallbackBody.right);
  const cw = (right - left) / tpl.grid.cols;
  const res: { left: number; right: number }[] = [];
  for (let c = 0; c < tpl.grid.cols; c++) {
    res.push({ left: Math.round(left + c * cw), right: Math.round(left + (c + 1) * cw) });
  }
  return res;
}

/** Whether a crop is essentially blank (used to skip empty strips / cards). */
export async function isBlank(png: Buffer): Promise<boolean> {
  const stats = await sharp(png).greyscale().stats();
  const ch = stats.channels[0];
  // Blank white region: very high mean, very low spread.
  return ch.mean > 250 && ch.stdev < 4;
}
