/**
 * Deterministic image preprocessing for the math scan pipeline
 * (2026-10-06 image-to-solution round).
 *
 * Pure functions over a { width, height, data } buffer — no DOM, so the
 * whole preprocess stage (crop / rotate / deskew) is unit-testable and
 * runs identically in Node tests and in the browser canvas.
 *
 * Deskew uses the classic projection-profile method: for candidate angles
 * in [-9°, +9°], rotate and measure the variance of the horizontal ink
 * projection; text lines align → sharp projections → maximum variance.
 */

export interface GrayImage {
  width: number;
  height: number;
  /** grayscale 0..255, row-major */
  grayscale: Uint8Array;
}

export function toGrayscale(width: number, height: number, rgba: Uint8Array | Uint8ClampedArray): GrayImage {
  const out = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const r = rgba[i * 4], g = rgba[i * 4 + 1], b = rgba[i * 4 + 2];
    out[i] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
  }
  return { width, height, grayscale: out };
}

/** Otsu threshold — ink mask for detection/deskew. */
export function otsuThreshold(img: GrayImage): number {
  const hist = new Array(256).fill(0);
  for (let i = 0; i < img.grayscale.length; i++) hist[img.grayscale[i]]++;
  const total = img.grayscale.length;
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0, wB = 0, best = 0, threshold = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) { best = between; threshold = t; }
  }
  return threshold;
}

export function inkMask(img: GrayImage): Uint8Array {
  const t = otsuThreshold(img);
  const mask = new Uint8Array(img.width * img.height);
  for (let i = 0; i < mask.length; i++) mask[i] = img.grayscale[i] <= t ? 1 : 0;
  return mask;
}

/** Ink density — a low-ink image is likely blank/no expression detected. */
export function inkRatio(img: GrayImage): number {
  const mask = inkMask(img);
  let ink = 0;
  for (let i = 0; i < mask.length; i++) ink += mask[i];
  return ink / mask.length;
}

/** Detect whether a mathematical expression is plausibly present:
 *  ink ratio in a sane band + enough horizontal structure. Deterministic. */
export function detectExpression(img: GrayImage): { detected: boolean; reason: string } {
  const ratio = inkRatio(img);
  if (ratio < 0.005) return { detected: false, reason: `almost no ink (${(ratio * 100).toFixed(2)}%) — the image looks blank` };
  if (ratio > 0.55) return { detected: false, reason: `too dense (${(ratio * 100).toFixed(1)}% ink) — not a readable page of math; retake the photo` };
  return { detected: true, reason: `ink structure present (${(ratio * 100).toFixed(1)}%)` };
}

/** Nearest-neighbor rotation by angle degrees about the center. */
export function rotateImage(img: GrayImage, angleDeg: number, fill = 255): GrayImage {
  if (angleDeg === 0) return img;
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(-rad), sin = Math.sin(-rad);
  const { width: w, height: h } = img;
  const cx = w / 2, cy = h / 2;
  const out = new Uint8Array(w * h).fill(fill);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = x - cx, dy = y - cy;
      const sx = Math.round(cx + dx * cos - dy * sin);
      const sy = Math.round(cy + dx * sin + dy * cos);
      if (sx >= 0 && sx < w && sy >= 0 && sy < h) out[y * w + x] = img.grayscale[sy * w + sx];
    }
  }
  return { width: w, height: h, grayscale: out };
}

/** Estimate the skew of a text image (projection-profile variance). */
export function estimateDeskewAngle(img: GrayImage): number {
  const mask = inkMask(img);
  const w = img.width, h = img.height;
  let bestAngle = 0;
  let bestScore = -1;
  for (let deg = -9; deg <= 9; deg += 0.5) {
    const rad = (deg * Math.PI) / 180;
    const cos = Math.cos(rad), sin = Math.sin(rad);
    const cx = w / 2, cy = h / 2;
    const rows = new Float64Array(h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!mask[y * w + x]) continue;
        const dx = x - cx, dy = y - cy;
        const ry = Math.round(cy + dx * sin + dy * cos);
        if (ry >= 0 && ry < h) rows[ry]++;
      }
    }
    // variance of the row profile
    let sum = 0, sumSq = 0, n = 0;
    for (let y = 0; y < h; y++) { sum += rows[y]; sumSq += rows[y] * rows[y]; n++; }
    const mean = sum / n;
    const variance = sumSq / n - mean * mean;
    if (variance > bestScore) { bestScore = variance; bestAngle = deg; }
  }
  return bestAngle;
}

/** Crop to the ink bounding box with margin (deterministic). */
export function cropToInk(img: GrayImage, margin = 8): GrayImage {
  const mask = inkMask(img);
  const w = img.width, h = img.height;
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (mask[y * w + x]) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return img; // no ink — nothing to crop
  minX = Math.max(0, minX - margin);
  minY = Math.max(0, minY - margin);
  maxX = Math.min(w - 1, maxX + margin);
  maxY = Math.min(h - 1, maxY + margin);
  const nw = maxX - minX + 1, nh = maxY - minY + 1;
  const out = new Uint8Array(nw * nh);
  for (let y = 0; y < nh; y++) {
    for (let x = 0; x < nw; x++) out[y * nw + x] = img.grayscale[(minY + y) * w + (minX + x)];
  }
  return { width: nw, height: nh, grayscale: out };
}

/** Full preprocess stage: crop → deskew → rotate (both deterministic). */
export function preprocessForOcr(img: GrayImage, userRotation = 0): { image: GrayImage; deskewDegrees: number } {
  const cropped = cropToInk(img);
  const rotated = rotateImage(cropped, userRotation);
  const deskewDegrees = estimateDeskewAngle(rotated);
  const final = rotateImage(rotated, deskewDegrees);
  return { image: final, deskewDegrees };
}
