/**
 * Pure geometry/state helpers for the Edit Sketch editor
 * (src/components/dashboard/SketchEditor.tsx), modelled on the
 * RoofSnap-style sketch editor Fredy asked for: a satellite canvas
 * with the roof drawn over it, edges coloured by type with live
 * length labels, Draw / Edges / Facets / Pins modes, and a right
 * panel with Drawing Options and Edge Actions.
 *
 * Everything here operates on the EXISTING drawing data model
 * (src/lib/roof-geometry.ts): planes are rings of 3D points in feet
 * (x east, z south, y elevation) and each edge carries one of the
 * stored EdgeType classifications. The reference editor also offers
 * STEP, WALL and PITCH CHANGE edge types; the drawing model (and
 * every report/takeoff built on it) has no per-edge classifications
 * for those, so they are deliberately not offered here — see the
 * editor PR description. "Unlabeled" is the stored "other" type.
 */
import {
  distance,
  measureDrawing,
  planeInfo,
  type EdgeType,
  type GeoReference,
  type Point,
  type RoofDrawing,
  type RoofPlane,
} from "@/lib/roof-geometry";

/** Edge metadata for the editor, in the reference's Edge Actions
 * order and colour scheme: Unlabeled yellow, Eave red, Rake gray,
 * Ridge purple, Hip brown, Valley magenta/pink. */
export const SKETCH_EDGE_STYLES: Record<EdgeType, { label: string; color: string }> = {
  other: { label: "Unlabeled", color: "#EAB308" },
  eave: { label: "Eave", color: "#DC2626" },
  rake: { label: "Rake", color: "#6B7280" },
  ridge: { label: "Ridge", color: "#9333EA" },
  hip: { label: "Hip", color: "#B45309" },
  valley: { label: "Valley", color: "#EC4899" },
};

export const SKETCH_EDGE_ACTION_ORDER: EdgeType[] = [
  "other",
  "eave",
  "rake",
  "ridge",
  "hip",
  "valley",
];

export type SketchMode = "draw" | "edges" | "facets" | "pins";
export type PitchDirection = "north" | "south" | "east" | "west";

/** Live edge length in feet — the full 3D distance, so hips and
 * valleys read as slope lengths like the reference editor. */
export function edgeLengthFt(a: Point, b: Point): number {
  return distance(a, b);
}

/** Reference-style length label: one decimal, e.g. "84.6ft". */
export function formatEdgeLength(lengthFt: number): string {
  return `${lengthFt.toFixed(1)}ft`;
}

export function sketchPlane(drawing: RoofDrawing, planeId: string): RoofPlane | undefined {
  return drawing.planes.find((plane) => plane.id === planeId);
}

function replacePlane(drawing: RoofDrawing, next: RoofPlane): RoofDrawing {
  return {
    ...drawing,
    planes: drawing.planes.map((plane) => (plane.id === next.id ? next : plane)),
  };
}

/** Assign a stored edge classification. Edge i runs from points[i]
 * to points[i + 1] (wrapping to points[0]). */
export function retypeEdge(
  drawing: RoofDrawing,
  planeId: string,
  edgeIndex: number,
  type: EdgeType,
): RoofDrawing {
  const plane = sketchPlane(drawing, planeId);
  if (!plane || edgeIndex < 0 || edgeIndex >= plane.edges.length) return drawing;
  return replacePlane(drawing, {
    ...plane,
    edges: plane.edges.map((edge, index) => (index === edgeIndex ? type : edge)),
  });
}

/**
 * Delete one edge of a facet. A ring cannot lose a segment and stay
 * a ring, so — as in the reference editor — the corner at the END
 * of the selected edge is removed and its two neighbouring edges
 * merge into one. The merged edge keeps the classification of the
 * edge that starts at the same corner as the deleted edge (for the
 * deleted edge itself, that is its own type). Returns null when the
 * facet would drop below three corners.
 */
export function deleteEdge(
  drawing: RoofDrawing,
  planeId: string,
  edgeIndex: number,
): RoofDrawing | null {
  const plane = sketchPlane(drawing, planeId);
  if (!plane) return null;
  const n = plane.points.length;
  if (n < 4 || edgeIndex < 0 || edgeIndex >= n) return null;
  const removeIndex = (edgeIndex + 1) % n;
  const keptIndices = plane.points
    .map((_, index) => index)
    .filter((index) => index !== removeIndex);
  const points = keptIndices.map((index) => plane.points[index]!);
  // Each surviving edge starts at the same original corner as before;
  // the edge whose end corner was removed now spans the gap and keeps
  // the type of the original edge starting at its start corner.
  const edges = keptIndices.map((startIndex) => plane.edges[startIndex]!);
  return replacePlane(drawing, { ...plane, points, edges });
}

/** Delete every edge in the sketch: all facets are removed. The
 * drawing can be rebuilt with Draw mode; Done stays blocked until
 * at least one valid facet exists again. Penetrations (pins) are
 * kept — they are markers, not edges. */
export function deleteAllEdges(drawing: RoofDrawing): RoofDrawing {
  return { ...drawing, planes: [] };
}

/** Split an edge by inserting a corner at the given point. Both
 * halves keep the original edge's classification. */
export function insertVertexOnEdge(
  drawing: RoofDrawing,
  planeId: string,
  edgeIndex: number,
  point: Point,
): RoofDrawing {
  const plane = sketchPlane(drawing, planeId);
  if (!plane || edgeIndex < 0 || edgeIndex >= plane.points.length) return drawing;
  const points = [
    ...plane.points.slice(0, edgeIndex + 1),
    point,
    ...plane.points.slice(edgeIndex + 1),
  ];
  const edges = [
    ...plane.edges.slice(0, edgeIndex + 1),
    plane.edges[edgeIndex]!,
    ...plane.edges.slice(edgeIndex + 1),
  ];
  return replacePlane(drawing, { ...plane, points, edges });
}

/** Move a corner in plan (x/z). Elevation (y) is preserved — plan
 * editing never invents heights. */
export function moveVertex(
  drawing: RoofDrawing,
  planeId: string,
  vertexIndex: number,
  x: number,
  z: number,
): RoofDrawing {
  const plane = sketchPlane(drawing, planeId);
  if (!plane || vertexIndex < 0 || vertexIndex >= plane.points.length) return drawing;
  return replacePlane(drawing, {
    ...plane,
    points: plane.points.map((point, index) =>
      index === vertexIndex ? { ...point, x, z } : point,
    ),
  });
}

/**
 * 90 Mode snapping: rotate the candidate point around `anchor` so
 * the segment anchor→point makes an angle with the incoming segment
 * (referenceFrom→anchor) that is a multiple of `stepDegrees`
 * (45° family, which includes right angles). Segment length is
 * preserved. With no incoming segment, the angle is snapped to
 * absolute multiples of the step.
 */
export function snapSegmentPoint(
  anchor: { x: number; z: number },
  referenceFrom: { x: number; z: number } | null,
  point: { x: number; z: number },
  stepDegrees = 45,
): { x: number; z: number } {
  const dx = point.x - anchor.x;
  const dz = point.z - anchor.z;
  const length = Math.hypot(dx, dz);
  if (length < 1e-9) return { x: point.x, z: point.z };
  const step = (stepDegrees * Math.PI) / 180;
  const base = referenceFrom
    ? Math.atan2(anchor.z - referenceFrom.z, anchor.x - referenceFrom.x)
    : 0;
  const relative = Math.atan2(dz, dx) - base;
  const snapped = base + Math.round(relative / step) * step;
  return { x: anchor.x + length * Math.cos(snapped), z: anchor.z + length * Math.sin(snapped) };
}

/** Snap a dragged corner of a facet: the segment from the previous
 * corner is snapped against the segment before it (90 Mode). */
export function snapVertexPosition(
  plane: RoofPlane,
  vertexIndex: number,
  x: number,
  z: number,
  stepDegrees = 45,
): { x: number; z: number } {
  const n = plane.points.length;
  if (n < 3 || vertexIndex < 0 || vertexIndex >= n) return { x, z };
  const anchor = plane.points[(vertexIndex - 1 + n) % n]!;
  const before = plane.points[(vertexIndex - 2 + n) % n]!;
  return snapSegmentPoint(anchor, before, { x, z }, stepDegrees);
}

/** Re-slope a facet to a pitch rising toward a compass direction,
 * keeping its lowest corner at its current elevation — the same
 * math the satellite trace uses to build a plane from an outline. */
export function applyPitchToPlane(
  plane: RoofPlane,
  pitch: number,
  direction: PitchDirection,
): RoofPlane {
  if (!Number.isFinite(pitch) || pitch < 0 || pitch > 24) return plane;
  const riseAt = (p: Point) =>
    direction === "north" ? -p.z : direction === "south" ? p.z : direction === "east" ? p.x : -p.x;
  const minRise = Math.min(...plane.points.map(riseAt));
  const baseY = Math.min(...plane.points.map((p) => p.y));
  return {
    ...plane,
    points: plane.points.map((p) => ({
      ...p,
      y: baseY + ((riseAt(p) - minRise) * pitch) / 12,
    })),
  };
}

/** Materialise a hand-drawn outline (≥3 corners) as a new facet.
 * New facets start Unlabeled on every edge, like a fresh trace. */
export function createPlaneFromDraft(
  points: Point[],
  name: string,
  id: string = globalThis.crypto?.randomUUID?.() ?? `plane-${Date.now()}`,
): RoofPlane {
  return { id, name, points: [...points], edges: points.map(() => "other" as EdgeType) };
}

export function planeCentroid(plane: RoofPlane): { x: number; z: number } {
  const n = Math.max(1, plane.points.length);
  return {
    x: plane.points.reduce((sum, p) => sum + p.x, 0) / n,
    z: plane.points.reduce((sum, p) => sum + p.z, 0) / n,
  };
}

/** Pitch (rise/12) and slope area for a facet, or null when the
 * facet geometry is not measurable. */
export function planePitchArea(plane: RoofPlane): { pitch: number; area: number } | null {
  try {
    const info = planeInfo(plane);
    return { pitch: info.pitch, area: info.area };
  } catch {
    return null;
  }
}

/** Done-gate: the edited drawing must measure cleanly through the
 * same validator the workspace and save path use. Returns an error
 * message, or null when the drawing is saveable. */
export function validateSketchDrawing(drawing: RoofDrawing): string | null {
  if (!drawing.planes.length) return "Draw at least one roof facet before saving.";
  try {
    measureDrawing(drawing);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : "Check the drawing geometry before saving.";
  }
}

/* ------------------------------------------------------------------ */
/* Geo anchoring: drawing feet <-> lat/lon <-> Web Mercator pixels.    */
/* The scale factors match src/lib/roof-geometry.ts exactly, so the   */
/* sketch sits on the same property the geo reference anchors.        */
/* ------------------------------------------------------------------ */

const FEET_PER_DEGREE_LAT = 110540 / 0.3048;
export function feetPerDegreeLon(originLatitude: number): number {
  return (111320 * Math.cos((originLatitude * Math.PI) / 180)) / 0.3048;
}

export function drawingPointToLatLon(
  point: { x: number; z: number },
  reference: GeoReference,
): { lat: number; lon: number } {
  return {
    lat: reference.originLatitude - point.z / FEET_PER_DEGREE_LAT,
    lon: reference.originLongitude + point.x / feetPerDegreeLon(reference.originLatitude),
  };
}

export function latLonToDrawingPoint(
  lat: number,
  lon: number,
  reference: GeoReference,
  y: number,
): Point {
  return {
    x: (lon - reference.originLongitude) * feetPerDegreeLon(reference.originLatitude),
    y,
    z: (reference.originLatitude - lat) * FEET_PER_DEGREE_LAT,
  };
}

export function latLonToWorldPx(lat: number, lon: number, zoom: number): { x: number; y: number } {
  const scale = 256 * 2 ** zoom;
  const latRad = (lat * Math.PI) / 180;
  return {
    x: ((lon + 180) / 360) * scale,
    y: ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * scale,
  };
}

export function worldPxToLatLon(x: number, y: number, zoom: number): { lat: number; lon: number } {
  const scale = 256 * 2 ** zoom;
  const lon = (x / scale) * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / scale))) * 180) / Math.PI;
  return { lat, lon };
}
