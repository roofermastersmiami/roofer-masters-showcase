import type { EdgeType, RoofPlane } from './roof-geometry';
import { planeInfo, EDGE_TYPES } from './roof-geometry';
export type ImagePoint = { x: number; y: number };
export type Uphill = 'up' | 'down' | 'left' | 'right';
export const UPHILL_LABELS: Record<Uphill, string> = { up: 'Toward top of photo', down: 'Toward bottom of photo', left: 'Toward left of photo', right: 'Toward right of photo' };

/** Checks the two scale points and known distance before any measurement is produced. */
export function checkCalibration(reference: ImagePoint[], feet: number, imageWidth: number, imageHeight?: number) {
  const a = reference[0], b = reference[1];
  if (!a || !b) return { ok: false, message: 'Click two points on something you know the length of.' } as const;
  if (![a.x, a.y, b.x, b.y, imageWidth, ...(imageHeight === undefined ? [] : [imageHeight])].every(Number.isFinite) || imageWidth <= 0 || (imageHeight !== undefined && imageHeight <= 0)) return { ok: false, message: 'Calibration coordinates are invalid.' } as const;
  const pixels = Math.hypot(b.x - a.x, b.y - a.y);
  if (!Number.isFinite(pixels) || pixels < 1) return { ok: false, message: 'Calibration points must be distinct.' } as const;
  if (!Number.isFinite(feet) || feet <= 0) return { ok: false, message: 'Enter the real distance between the two points in feet.' } as const;
  if (feet > 500) return { ok: false, message: 'Known distance over 500 ft looks wrong for one roof.' } as const;
  const ftPerPx = feet / pixels;
  if (!Number.isFinite(ftPerPx) || ftPerPx <= 0) return { ok: false, message: 'The scale is outside the supported numeric range; use a longer known reference.' } as const;
  const photoWidthFeet = ftPerPx * imageWidth;
  if (!Number.isFinite(photoWidthFeet)) return { ok: false, message: 'The calibrated photo width is invalid; check the scale points.' } as const;
  const warnings: string[] = [];
  if (pixels < imageWidth * 0.08) warnings.push('Scale points are very close together; choose a longer known edge for better accuracy.');
  if (photoWidthFeet > 600) warnings.push('This scale makes the photo wider than 600 ft; check the known distance.');
  if (photoWidthFeet < 10) warnings.push('This scale makes the photo narrower than 10 ft; check the known distance.');
  return { ok: true, ftPerPx, warnings } as const;
}

export function nextEdgeType(t: EdgeType): EdgeType { return EDGE_TYPES[(EDGE_TYPES.indexOf(t) + 1) % EDGE_TYPES.length] ?? 'other'; }

/**
 * Converts a traced outline into a pitched 3D plane. Horizontal position comes from the calibrated photo;
 * height comes only from the entered pitch and which way the roof rises — never from the photo itself.
 */
export function calibratedPlane(points: ImagePoint[], reference: ImagePoint[], feet: number, pitch: number, id: string, opts: { uphill?: Uphill; edges?: EdgeType[]; name?: string } = {}): RoofPlane {
  const a = reference[0], b = reference[1];
  if (!a || !b) throw new Error('Roof calibration requires two reference points');
  if (!Number.isFinite(feet) || feet <= 0 || feet > 500) throw new Error('Enter a known calibration distance greater than 0 and no more than 500 feet');
  if (![a.x, a.y, b.x, b.y].every(Number.isFinite)) throw new Error('Calibration coordinates must be finite numbers');
  const pixels = Math.hypot(b.x - a.x, b.y - a.y);
  if (!Number.isFinite(pixels) || pixels < 1) throw new Error('Calibration points must be distinct and at least one pixel apart');
  if (points.length < 3 || !Number.isFinite(pitch) || pitch < 0 || pitch > 24) throw new Error('Draw at least three corners and enter a valid pitch');
  if (points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) throw new Error('Roof corner coordinates must be finite numbers');
  const scale = feet / pixels;
  if (!Number.isFinite(scale) || scale <= 0) throw new Error('Calibration scale is outside the supported numeric range');
  const origin = a, uphill = opts.uphill ?? 'down';
  const run = (p: ImagePoint) => uphill === 'down' ? p.y : uphill === 'up' ? -p.y : uphill === 'right' ? p.x : -p.x;
  const low = Math.min(...points.map(run));
  const edges = opts.edges && opts.edges.length === points.length ? opts.edges : points.map(() => 'other' as EdgeType);
  const plane: RoofPlane = { id, name: opts.name ?? 'Traced roof plane', points: points.map(p => ({ x: (p.x - origin.x) * scale, z: (p.y - origin.y) * scale, y: 10 + (run(p) - low) * scale * pitch / 12 })), edges };
  if (plane.points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z))) {
    throw new Error('Calibration produces invalid roof coordinates; check the scale points and traced corners');
  }
  if (plane.points.some(p => Math.abs(p.x) > 10000 || Math.abs(p.z) > 10000 || p.y < 0 || p.y > 10000)) {
    throw new Error('Calibrated roof coordinates exceed the supported drawing bounds; check the scale and traced outline');
  }
  planeInfo(plane);
  return plane;
}

/** Snap an image point to the nearest existing traced corner within a pixel tolerance. */
export function snapToExistingCorner(point: ImagePoint, existing: ImagePoint[], tolerance: number): ImagePoint {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || !Number.isFinite(tolerance) || tolerance < 0) return point;
  let nearest: ImagePoint | null = null;
  let nearestDistance = tolerance;
  for (const candidate of existing) {
    if (!Number.isFinite(candidate.x) || !Number.isFinite(candidate.y)) continue;
    const distance = Math.hypot(candidate.x - point.x, candidate.y - point.y);
    if (distance <= nearestDistance) { nearest = candidate; nearestDistance = distance; }
  }
  return nearest ? { x: nearest.x, y: nearest.y } : point;
}

/** Finds approximately coincident boundary edges between two traced image polygons. */
export function findSharedEdges(a: ImagePoint[], b: ImagePoint[], tolerance: number): Array<{
  edgeA: number; edgeB: number; maxEndpointDistance: number;
}> {
  if (!Number.isFinite(tolerance) || tolerance < 0 || a.length < 2 || b.length < 2) return [];
  const matches: Array<{ edgeA: number; edgeB: number; maxEndpointDistance: number }> = [];
  for (let i = 0; i < a.length; i++) {
    const a1 = a[i], a2 = a[(i + 1) % a.length];
    if (!a1 || !a2) continue;
    for (let j = 0; j < b.length; j++) {
      const b1 = b[j], b2 = b[(j + 1) % b.length];
      if (!b1 || !b2) continue;
      const direct = Math.max(Math.hypot(a1.x - b1.x, a1.y - b1.y), Math.hypot(a2.x - b2.x, a2.y - b2.y));
      const reverse = Math.max(Math.hypot(a1.x - b2.x, a1.y - b2.y), Math.hypot(a2.x - b1.x, a2.y - b1.y));
      const maxEndpointDistance = Math.min(direct, reverse);
      if (maxEndpointDistance <= tolerance) matches.push({ edgeA: i, edgeB: j, maxEndpointDistance });
    }
  }
  return matches;
}

function segmentsIntersect(a: ImagePoint, b: ImagePoint, c: ImagePoint, d: ImagePoint): boolean {
  const orient = (p: ImagePoint, q: ImagePoint, r: ImagePoint) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const on = (p: ImagePoint, q: ImagePoint, r: ImagePoint) =>
    Math.abs(orient(p, q, r)) < 1e-8 &&
    r.x >= Math.min(p.x, q.x) - 1e-8 && r.x <= Math.max(p.x, q.x) + 1e-8 &&
    r.y >= Math.min(p.y, q.y) - 1e-8 && r.y <= Math.max(p.y, q.y) + 1e-8;
  const o1 = orient(a, b, c), o2 = orient(a, b, d), o3 = orient(c, d, a), o4 = orient(c, d, b);
  return (o1 * o2 < 0 && o3 * o4 < 0) || on(a, b, c) || on(a, b, d) || on(c, d, a) || on(c, d, b);
}

/** Returns user-readable issues that prevent an unsafe traced polygon from being added. */
export function validateRoofOutline(points: ImagePoint[]): string[] {
  const issues: string[] = [];
  if (points.length < 3) return ['Draw at least three roof corners.'];
  if (points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y) || p.x < 0 || p.y < 0)) {
    issues.push('Roof corners must have finite, non-negative image coordinates.');
    return issues;
  }
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    if (a && b && Math.hypot(a.x - b.x, a.y - b.y) < 1) issues.push('Adjacent roof corners must be at least one pixel apart.');
  }
  if (new Set(points.map(p => `${p.x.toFixed(4)},${p.y.toFixed(4)}`)).size < 3) issues.push('Roof outline needs at least three distinct corners.');
  let twiceArea = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    if (a && b) twiceArea += a.x * b.y - b.x * a.y;
  }
  if (Math.abs(twiceArea) / 2 < 1) issues.push('Roof outline is too small or flat to measure.');
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    if (!a || !b) continue;
    for (let j = i + 1; j < points.length; j++) {
      if (j === i || j === i + 1 || (i === 0 && j === points.length - 1)) continue;
      const c = points[j], d = points[(j + 1) % points.length];
      if (c && d && segmentsIntersect(a, b, c, d)) {
        issues.push('Roof outline edges must not cross or touch.');
        return [...new Set(issues)];
      }
    }
  }
  return [...new Set(issues)];
}
