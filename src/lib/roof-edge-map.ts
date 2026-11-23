export type RoofEdgeMap = { width: number; height: number; rgba: Uint8ClampedArray };

/**
 * Build a transparent grayscale Sobel edge guide for manual roof tracing.
 * This highlights image contrast only; it does not classify roof boundaries.
 */
export function createRoofEdgeMap(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  threshold = 90,
): RoofEdgeMap | null {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 3 || height < 3) return null;
  if (rgba.length !== width * height * 4 || !Number.isFinite(threshold) || threshold < 0)
    return null;
  const gray = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const p = i * 4;
    gray[i] = rgba[p]! * 0.299 + rgba[p + 1]! * 0.587 + rgba[p + 2]! * 0.114;
  }
  const output = new Uint8ClampedArray(width * height * 4);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const at = (xx: number, yy: number) => gray[yy * width + xx]!;
      const gx =
        -at(x - 1, y - 1) +
        at(x + 1, y - 1) -
        2 * at(x - 1, y) +
        2 * at(x + 1, y) -
        at(x - 1, y + 1) +
        at(x + 1, y + 1);
      const gy =
        -at(x - 1, y - 1) -
        2 * at(x, y - 1) -
        at(x + 1, y - 1) +
        at(x - 1, y + 1) +
        2 * at(x, y + 1) +
        at(x + 1, y + 1);
      const strength = Math.hypot(gx, gy);
      if (strength < threshold) continue;
      const p = (y * width + x) * 4;
      const value = Math.min(255, Math.round(strength));
      output[p] = 255;
      output[p + 1] = 190;
      output[p + 2] = 35;
      output[p + 3] = Math.min(190, Math.round(value * 0.65));
    }
  }
  return { width, height, rgba: output };
}
