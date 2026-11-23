import type { EdgeType, RoofPlane } from "./roof-geometry";
import { planeInfo, EDGE_TYPES } from "./roof-geometry";
export type ImagePoint = { x: number; y: number };
export type Uphill = "up" | "down" | "left" | "right";
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
  if (points.length < 3 || !Number.isFinite(pitch) || pitch < 0 || pitch > 24)
    throw new Error("Draw at least three corners and enter a valid pitch");
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
