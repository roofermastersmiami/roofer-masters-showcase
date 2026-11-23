export type EdgeSnapResult = { point: { x: number; y: number }; strength: number };

/**
 * Snap an approximate image point to the strongest nearby Sobel edge.
 * Coordinates are image pixels. This is a drawing aid, never an automatic
 * roof-boundary classifier: shadows, trees and neighboring structures can win.
 */
export function snapToImageEdge(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  point: { x: number; y: number },
  radius = 12,
  minStrength = 48,
): EdgeSnapResult | null {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 3 || height < 3) return null;
  if (rgba.length < width * height * 4 || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
  const cx = Math.round(point.x), cy = Math.round(point.y);
  const r = Math.max(0, Math.min(80, Math.floor(radius)));
  const gray = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    return rgba[i]! * 0.299 + rgba[i + 1]! * 0.587 + rgba[i + 2]! * 0.114;
  };
  let best: EdgeSnapResult | null = null;
  let bestScore = 0;
  const gradient = (x: number, y: number) => {
    const gx = -gray(x - 1, y - 1) + gray(x + 1, y - 1)
      - 2 * gray(x - 1, y) + 2 * gray(x + 1, y)
      - gray(x - 1, y + 1) + gray(x + 1, y + 1);
    const gy = -gray(x - 1, y - 1) - 2 * gray(x, y - 1) - gray(x + 1, y - 1)
      + gray(x - 1, y + 1) + 2 * gray(x, y + 1) + gray(x + 1, y + 1);
    return { gx, gy, strength: Math.hypot(gx, gy) };
  };
  for (let y = Math.max(1, cy - r); y <= Math.min(height - 2, cy + r); y++) {
    for (let x = Math.max(1, cx - r); x <= Math.min(width - 2, cx + r); x++) {
      const distance = Math.hypot(x - point.x, y - point.y);
      if (distance > r) continue;
      const { gx, gy, strength } = gradient(x, y);
      if (strength < minStrength) continue;
      // A real boundary tends to continue in its tangent direction. Reward
      // aligned edge support on both sides; isolated shingle texture scores lower.
      const tangentX = -gy / strength, tangentY = gx / strength;
      let support = 0;
      for (const step of [-4, -2, 2, 4]) {
        const sx = Math.round(x + tangentX * step), sy = Math.round(y + tangentY * step);
        if (sx < 1 || sy < 1 || sx >= width - 1 || sy >= height - 1) continue;
        const neighbor = gradient(sx, sy);
        if (neighbor.strength < minStrength * 0.55) continue;
        const alignment = Math.abs((neighbor.gx * gx + neighbor.gy * gy) / (neighbor.strength * strength));
        if (alignment > 0.65) support += alignment;
      }
      const continuity = 0.55 + 0.1125 * support;
      // Favor proximity more strongly so high-contrast shingle texture is less likely to pull the point away from the click.
      const score = (strength * continuity) / (1 + distance * 0.5);
      if (strength >= minStrength && score > bestScore) {
        best = { point: { x, y }, strength };
        bestScore = score;
      }
    }
  }
  return best;
}
