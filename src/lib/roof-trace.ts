import type { EdgeType, RoofPlane } from "./roof-geometry";
import { planeInfo, EDGE_TYPES } from "./roof-geometry";
export type ImagePoint = { x: number; y: number };
export type Uphill = "up" | "down" | "left" | "right";

/** Snap a photo point to the nearest corner already traced on this same image. */
export function snapToExistingCorner(
  point: ImagePoint,
  existing: ImagePoint[],
  tolerancePx: number,
): ImagePoint {
  if (!Number.isFinite(tolerancePx) || tolerancePx <= 0) return point;
  let nearest: ImagePoint | undefined;
  let nearestDistance = tolerancePx;
  for (const candidate of existing) {
    if (!Number.isFinite(candidate.x) || !Number.isFinite(candidate.y)) continue;
    const distance = Math.hypot(point.x - candidate.x, point.y - candidate.y);
    if (distance <= nearestDistance) {
      nearest = candidate;
      nearestDistance = distance;
    }
  }
  return nearest ? { x: nearest.x, y: nearest.y } : point;
}
/** Return drawing-quality problems in image space before converting pixels to feet. */
export function validateRoofOutline(points: ImagePoint[]): string[] {
  const issues: string[] = [];
  if (points.length < 3) return ["Draw at least three corners."];
  if (points.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y) || p.x < 0 || p.y < 0)) {
    return ["Photo points must have valid, non-negative coordinates."];
  }
  const count = points.length;
  for (let i = 0; i < count; i++) {
    const next = points[(i + 1) % count]!;
    if (Math.hypot(points[i]!.x - next.x, points[i]!.y - next.y) < 0.5) {
      issues.push("Two neighboring corners overlap; move or remove the duplicate corner.");
      break;
    }
  }
  const twiceArea = points.reduce((sum, p, i) => {
    const q = points[(i + 1) % count]!;
    return sum + p.x * q.y - q.x * p.y;
  }, 0);
  if (Math.abs(twiceArea) / 2 < 1) issues.push("Roof outline is too small or flat to measure.");
  const cross = (a: ImagePoint, b: ImagePoint, c: ImagePoint) =>
    (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const onSegment = (a: ImagePoint, b: ImagePoint, p: ImagePoint) =>
    Math.abs(cross(a, b, p)) < 1e-7 &&
    p.x >= Math.min(a.x, b.x) - 1e-7 && p.x <= Math.max(a.x, b.x) + 1e-7 &&
    p.y >= Math.min(a.y, b.y) - 1e-7 && p.y <= Math.max(a.y, b.y) + 1e-7;
  const intersects = (a: ImagePoint, b: ImagePoint, c: ImagePoint, d: ImagePoint) => {
    const abC = cross(a, b, c), abD = cross(a, b, d);
    const cdA = cross(c, d, a), cdB = cross(c, d, b);
    if (((abC > 0 && abD < 0) || (abC < 0 && abD > 0)) &&
        ((cdA > 0 && cdB < 0) || (cdA < 0 && cdB > 0))) return true;
    return (Math.abs(abC) < 1e-7 && onSegment(a, b, c)) ||
      (Math.abs(abD) < 1e-7 && onSegment(a, b, d)) ||
      (Math.abs(cdA) < 1e-7 && onSegment(c, d, a)) ||
      (Math.abs(cdB) < 1e-7 && onSegment(c, d, b));
  };
  for (let i = 0; i < count; i++) {
    const a = points[i]!, b = points[(i + 1) % count]!;
    for (let j = i + 1; j < count; j++) {
      if (j === i || j === (i + 1) % count || (j + 1) % count === i) continue;
      const c = points[j]!, d = points[(j + 1) % count]!;
      if (intersects(a, b, c, d)) {
        issues.push("Roof outline crosses itself; adjust the corners so the perimeter does not cross.");
        return issues;
      }
    }
  }
  return issues;
}

export const UPHILL_LABELS: Record<Uphill, string> = {
  up: "Toward top of photo",
  down: "Toward bottom of photo",
  left: "Toward left of photo",
  right: "Toward right of photo",
};

/** Checks the two scale points and known distance before any measurement is produced. */
export function checkCalibration(
  reference: ImagePoint[],
  feet: number,
  imageWidth: number,
  imageHeight?: number,
) {
  const a = reference[0],
    b = reference[1];
  if (!a || !b)
    return { ok: false, message: "Click two points on something you know the length of." } as const;
  if (
    ![a.x, a.y, b.x, b.y, imageWidth, ...(imageHeight === undefined ? [] : [imageHeight])].every(
      Number.isFinite,
    ) ||
    imageWidth <= 0 ||
    (imageHeight !== undefined && imageHeight <= 0) ||
    a.x < 0 ||
    b.x < 0 ||
    a.x > imageWidth ||
    b.x > imageWidth ||
    a.y < 0 ||
    b.y < 0 ||
    (imageHeight !== undefined && (a.y > imageHeight || b.y > imageHeight))
  )
    return { ok: false, message: "Calibration points must be inside a valid image." } as const;
  const pixels = Math.hypot(b.x - a.x, b.y - a.y);
  if (pixels < 1) return { ok: false, message: "Calibration points must be distinct." } as const;
  if (!Number.isFinite(feet) || feet <= 0)
    return {
      ok: false,
      message: "Enter the real distance between the two points in feet.",
    } as const;
  if (feet > 500)
    return { ok: false, message: "Known distance over 500 ft looks wrong for one roof." } as const;
  const ftPerPx = feet / pixels;
  const warnings: string[] = [];
  if (pixels < imageWidth * 0.08)
    warnings.push(
      "Scale points are very close together; choose a longer known edge for better accuracy.",
    );
  if (ftPerPx * imageWidth > 600)
    warnings.push("This scale makes the photo wider than 600 ft; check the known distance.");
  if (ftPerPx * imageWidth < 10)
    warnings.push("This scale makes the photo narrower than 10 ft; check the known distance.");
  return { ok: true, ftPerPx, warnings } as const;
}

export function nextEdgeType(t: EdgeType): EdgeType {
  return EDGE_TYPES[(EDGE_TYPES.indexOf(t) + 1) % EDGE_TYPES.length] ?? "other";
}

/**
 * Converts a traced outline into a pitched 3D plane. Horizontal position comes from the calibrated photo;
 * height comes only from the entered pitch and which way the roof rises — never from the photo itself.
 */
export function calibratedPlane(
  points: ImagePoint[],
  reference: ImagePoint[],
  feet: number,
  pitch: number,
  id: string,
  opts: { uphill?: Uphill; edges?: EdgeType[]; name?: string } = {},
): RoofPlane {
  const a = reference[0],
    b = reference[1];
  if (!a || !b || !Number.isFinite(feet) || feet <= 0 || feet > 500)
    throw new Error("Set two calibration points and a known distance between 0 and 500 feet");
  if (
    ![a.x, a.y, b.x, b.y, ...points.flatMap((p) => [p.x, p.y])].every(Number.isFinite) ||
    points.some((p) => p.x < 0 || p.y < 0)
  )
    throw new Error("Photo points must have valid, non-negative coordinates");
  const pixels = Math.hypot(b.x - a.x, b.y - a.y);
  if (pixels < 1) throw new Error("Calibration points must be distinct");
  if (!Number.isFinite(pitch) || pitch < 0 || pitch > 24)
    throw new Error("Enter a valid pitch from 0:12 to 24:12");
  const outlineIssues = validateRoofOutline(points);
  if (outlineIssues.length) throw new Error(outlineIssues[0]);
  const scale = feet / pixels,
    origin = a,
    uphill = opts.uphill ?? "down";
  const run = (p: ImagePoint) =>
    uphill === "down" ? p.y : uphill === "up" ? -p.y : uphill === "right" ? p.x : -p.x;
  const low = Math.min(...points.map(run));
  const edges =
    opts.edges && opts.edges.length === points.length
      ? opts.edges
      : points.map(() => "other" as EdgeType);
  const plane: RoofPlane = {
    id,
    name: opts.name ?? "Traced roof plane",
    points: points.map((p) => ({
      x: (p.x - origin.x) * scale,
      z: (p.y - origin.y) * scale,
      y: 10 + ((run(p) - low) * scale * pitch) / 12,
    })),
    edges,
  };
  planeInfo(plane);
  return plane;
}
