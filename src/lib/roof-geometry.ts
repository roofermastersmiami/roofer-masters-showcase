import { z } from "zod";
import earcut from "earcut";
import polygonClipping from "polygon-clipping";
export const EDGE_TYPES = ["eave", "rake", "ridge", "hip", "valley", "other"] as const;
export type EdgeType = (typeof EDGE_TYPES)[number];
export type Point = { x: number; y: number; z: number };
export const pointSchema = z.object({
  x: z.number().min(-10000).max(10000),
  y: z.number().min(0).max(10000),
  z: z.number().min(-10000).max(10000),
});
export const planeSchema = z
  .object({
    id: z.string(),
    name: z.string().min(1).max(100),
    points: z.array(pointSchema).min(3).max(100),
    edges: z.array(z.enum(EDGE_TYPES)).min(3).max(100),
  })
  .refine((p) => p.edges.length === p.points.length, "Each edge needs a classification");
export const geoReferenceSchema = z.object({
  addressLatitude: z.number().finite().min(-90).max(90),
  addressLongitude: z.number().finite().min(-180).max(180),
  originLatitude: z.number().finite().min(-90).max(90),
  originLongitude: z.number().finite().min(-180).max(180),
});
export type GeoReference = z.infer<typeof geoReferenceSchema>;
export function addressPinPosition(reference: GeoReference) {
  const latitudeScale = 110540 / 0.3048;
  const longitudeScale = (111320 * Math.cos((reference.originLatitude * Math.PI) / 180)) / 0.3048;
  return {
    x: (reference.addressLongitude - reference.originLongitude) * longitudeScale,
    z: (reference.originLatitude - reference.addressLatitude) * latitudeScale,
  };
}
export const drawingSchema = z.object({
  planes: z.array(planeSchema).min(1).max(100),
  penetrations: z
    .array(
      z.object({
        id: z.string(),
        kind: z.enum(["chimney", "skylight", "vent", "pipe", "other"]),
        x: z.number().finite().min(-10000).max(10000),
        z: z.number().finite().min(-10000).max(10000),
        width: z.number().finite().positive().max(2000),
        length: z.number().finite().positive().max(2000),
      }),
    )
    .max(500),
  waste: z.number().min(0).max(50),
  roof_type: z.enum(["Metal Roof", "Shingle Roof", "Tile Roof", "TPO", "Flat Roof"]),
  notes: z.string().max(4000),
  condition: z.string().max(1000),
  verified: z.boolean(),
  accuracy: z.enum(["photo_estimate", "scaled", "site_verified"]).optional(),
  image_credit: z.string().max(300).optional(),
  geo_reference: geoReferenceSchema.optional(),
});
export type RoofDrawing = z.infer<typeof drawingSchema>;
export type RoofPlane = z.infer<typeof planeSchema>;
export const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const sub = (a: Point, b: Point) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const cross = (a: Point, b: Point) => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y + a.z * b.z;
export function planeInfo(p: RoofPlane) {
  for (let i = 0; i < p.points.length; i++)
    for (let j = i + 1; j < p.points.length; j++) {
      if (j === i + 1 || (i === 0 && j === p.points.length - 1)) continue;
      const a = p.points[i],
        b = p.points[(i + 1) % p.points.length],
        c = p.points[j],
        d = p.points[(j + 1) % p.points.length];
      if (!a || !b || !c || !d) continue;
      const side = (u: Point, v: Point, w: Point) =>
        (v.x - u.x) * (w.z - u.z) - (v.z - u.z) * (w.x - u.x);
      if (side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0)
        throw new Error(`${p.name}: roof edges cross`);
    }
  const a = p.points[0],
    b = p.points[1],
    c = p.points[2];
  if (!a || !b || !c) throw new Error("A plane needs three vertices");
  const n = cross(sub(b, a), sub(c, a));
  const mag = Math.hypot(n.x, n.y, n.z);
  if (mag < 0.0001 || Math.abs(n.y) < 0.0001)
    throw new Error(`${p.name}: zero area or vertical plane`);
  for (const v of p.points)
    if (Math.abs(dot(n, sub(v, a))) / mag > 0.02)
      throw new Error(`${p.name}: vertices must lie on one roof plane`);
  const triangles = earcut(p.points.flatMap((v) => [v.x, v.z]));
  let area = 0;
  for (let i = 0; i < triangles.length; i += 3) {
    const ai = triangles[i],
      bi = triangles[i + 1],
      ci = triangles[i + 2];
    if (ai === undefined || bi === undefined || ci === undefined) continue;
    const av = p.points[ai],
      bv = p.points[bi],
      cv = p.points[ci];
    if (!av || !bv || !cv) continue;
    const cr = cross(sub(bv, av), sub(cv, av));
    area += Math.hypot(cr.x, cr.y, cr.z) / 2;
  }
  if (area <= 0) throw new Error(`${p.name}: invalid area`);
  return { area, pitch: (12 * Math.hypot(n.x, n.z)) / Math.abs(n.y), triangles };
}
const ring = (p: RoofPlane): [number, number][] => {
  const points = p.points.map((v) => [v.x, v.z] as [number, number]);
  const first = points[0];
  return first ? [...points, first] : points;
};
function ringArea(r: number[][]) {
  let area = 0;
  for (let i = 0; i < r.length; i++) {
    const a = r[i],
      b = r[(i + 1) % r.length];
    if (a && b) area += (a[0] ?? 0) * (b[1] ?? 0) - (b[0] ?? 0) * (a[1] ?? 0);
  }
  return Math.abs(area) / 2;
}
function edgeKey(a: Point, b: Point) {
  const key = (p: Point) => [p.x, p.y, p.z].map((n) => Math.round(n * 100)).join(",");
  return [key(a), key(b)].sort().join("|");
}

export type SharedEdgeSuggestion = {
  planeId: string;
  edgeIndex: number;
  type: "ridge" | "valley" | "hip" | "eave" | "rake";
  sharedWith?: string;
};

/**
 * Suggest conservative roof-edge classifications from the existing 3D facets.
 * Shared edges can be ridge, valley, or hip; exterior edges can be eave or rake
 * when the facet has measurable pitch. Suggestions never mutate the drawing.
 */
export function suggestSharedEdgeClassifications(d: RoofDrawing): SharedEdgeSuggestion[] {
  type EdgeOccurrence = { plane: RoofPlane; edgeIndex: number; a: Point; b: Point };
  const edges: EdgeOccurrence[] = [];
  for (const plane of d.planes) {
    for (let edgeIndex = 0; edgeIndex < plane.points.length; edgeIndex++) {
      const a = plane.points[edgeIndex];
      const b = plane.points[(edgeIndex + 1) % plane.points.length];
      if (a && b) edges.push({ plane, edgeIndex, a, b });
    }
  }

  // Independently detected LiDAR facets can describe the same physical boundary
  // with slightly different coordinates. Match segment endpoints within 0.05 ft
  // rather than requiring identical rounded vertex keys.
  const toleranceFt = 0.05;
  const cellKey = (point: Point) =>
    [point.x, point.y, point.z].map((value) => Math.floor(value / toleranceFt)).join(",");
  const midpoint = (edge: EdgeOccurrence): Point => ({
    x: (edge.a.x + edge.b.x) / 2,
    y: (edge.a.y + edge.b.y) / 2,
    z: (edge.a.z + edge.b.z) / 2,
  });
  const endpointMatch = (first: EdgeOccurrence, second: EdgeOccurrence) => {
    const direct =
      distance(first.a, second.a) <= toleranceFt &&
      distance(first.b, second.b) <= toleranceFt;
    const reversed =
      distance(first.a, second.b) <= toleranceFt &&
      distance(first.b, second.a) <= toleranceFt;
    return direct || reversed;
  };
  const buckets = new Map<string, number[]>();
  const matches = new Map<number, number[]>();

  for (let index = 0; index < edges.length; index++) {
    const edge = edges[index];
    if (!edge) continue;
    const center = midpoint(edge);
    const cell = cellKey(center);
    const [cx, cy, cz] = cell.split(",").map(Number);
    const candidates: number[] = [];
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++) {
          const key = [cx! + dx, cy! + dy, cz! + dz].join(",");
          candidates.push(...(buckets.get(key) ?? []));
        }

    for (const candidateIndex of candidates) {
      const candidate = edges[candidateIndex];
      if (
        !candidate ||
        candidate.plane.id === edge.plane.id ||
        !endpointMatch(edge, candidate)
      )
        continue;
      matches.set(index, [...(matches.get(index) ?? []), candidateIndex]);
      matches.set(candidateIndex, [...(matches.get(candidateIndex) ?? []), index]);
    }

    const list = buckets.get(cell) ?? [];
    list.push(index);
    buckets.set(cell, list);
  }

  const suggestions: SharedEdgeSuggestion[] = [];
  const suggestedPairs = new Set<string>();
  for (let index = 0; index < edges.length; index++) {
    const edge = edges[index];
    if (!edge) continue;
    const linked = matches.get(index) ?? [];

    if (linked.length === 0) {
      let pitch = 0;
      try {
        pitch = planeInfo(edge.plane).pitch;
      } catch {
        continue;
      }
      // A level/flat facet does not provide enough evidence to distinguish an eave.
      if (pitch < 0.25) continue;
      const type = Math.abs(edge.a.y - edge.b.y) <= toleranceFt ? "eave" : "rake";
      if (edge.plane.edges[edge.edgeIndex] !== type) {
        suggestions.push({ planeId: edge.plane.id, edgeIndex: edge.edgeIndex, type });
      }
      continue;
    }

    // More than one nearby facet edge is ambiguous; never guess which surface
    // is truly adjacent. Require a one-to-one match in both directions.
    if (linked.length !== 1) continue;
    const otherIndex = linked[0];
    if (otherIndex === undefined || index > otherIndex) continue;
    const reciprocal = matches.get(otherIndex) ?? [];
    if (reciprocal.length !== 1 || reciprocal[0] !== index) continue;
    const other = edges[otherIndex];
    if (!other) continue;

    const pairKey = [index, otherIndex].sort((a, b) => a - b).join(":");
    if (suggestedPairs.has(pairKey)) continue;
    suggestedPairs.add(pairKey);

    const firstCenter =
      edge.plane.points.reduce((sum, point) => sum + point.y, 0) / edge.plane.points.length;
    const secondCenter =
      other.plane.points.reduce((sum, point) => sum + point.y, 0) / other.plane.points.length;
    const edgeLow = Math.min(edge.a.y, edge.b.y, other.a.y, other.b.y);
    const edgeHigh = Math.max(edge.a.y, edge.b.y, other.a.y, other.b.y);
    const isRidge = edgeLow > firstCenter + toleranceFt && edgeLow > secondCenter + toleranceFt;
    const isValley = edgeHigh < firstCenter - toleranceFt && edgeHigh < secondCenter - toleranceFt;
    const isHip =
      edgeLow < firstCenter - toleranceFt &&
      edgeLow < secondCenter - toleranceFt &&
      edgeHigh > firstCenter + toleranceFt &&
      edgeHigh > secondCenter + toleranceFt;
    if (!isRidge && !isValley && !isHip) continue;

    const type = isRidge ? "ridge" : isValley ? "valley" : "hip";
    if (
      edge.plane.edges[edge.edgeIndex] === type &&
      other.plane.edges[other.edgeIndex] === type
    )
      continue;
    suggestions.push({
      planeId: edge.plane.id,
      edgeIndex: edge.edgeIndex,
      type,
      sharedWith: other.plane.id,
    });
    suggestions.push({
      planeId: other.plane.id,
      edgeIndex: other.edgeIndex,
      type,
      sharedWith: edge.plane.id,
    });
  }
  return suggestions;
}
export function measureDrawing(raw: RoofDrawing) {
  const d = drawingSchema.parse(raw);
  const planes = d.planes.map((p) => ({ ...planeInfo(p), id: p.id, name: p.name }));
  for (let i = 0; i < d.planes.length; i++)
    for (let j = i + 1; j < d.planes.length; j++) {
      const a = d.planes[i],
        b = d.planes[j];
      if (!a || !b) continue;
      const intersection = polygonClipping.intersection([ring(a)], [ring(b)]);
      if (intersection.reduce((sum, poly) => sum + ringArea(poly[0] ?? []), 0) > 0.1)
        throw new Error(`${a.name} overlaps ${b.name} in plan`);
    }
  const edges: Record<EdgeType, number> = {
    eave: 0,
    rake: 0,
    ridge: 0,
    hip: 0,
    valley: 0,
    other: 0,
  };
  type MeasuredEdge = {
    a: Point;
    b: Point;
    length: number;
    type: EdgeType;
    occurrences: number;
  };
  const measuredEdges: MeasuredEdge[] = [];
  const edgeToleranceFt = 0.05;
  const sameSegment = (a: Point, b: Point, c: Point, d: Point) =>
    (distance(a, c) <= edgeToleranceFt && distance(b, d) <= edgeToleranceFt) ||
    (distance(a, d) <= edgeToleranceFt && distance(b, c) <= edgeToleranceFt);

  // Count a shared physical boundary once even when separately fitted facets
  // have slightly different LiDAR-derived coordinates.
  for (const p of d.planes)
    for (let i = 0; i < p.points.length; i++) {
      const a = p.points[i],
        b = p.points[(i + 1) % p.points.length],
        type = p.edges[i];
      if (!a || !b || !type) continue;
      const length = distance(a, b);
      if (length < 0.01) throw new Error(`${p.name}: roof edges must be at least 0.01 feet long`);
      const matches = measuredEdges.filter((edge) => sameSegment(a, b, edge.a, edge.b));
      if (matches.length > 1)
        throw new Error("Roof edge matches multiple nearby boundaries; review the roof geometry");
      const existing = matches[0];
      if (existing) {
        existing.occurrences++;
        if (existing.occurrences > 2)
          throw new Error("A roof edge cannot be shared by more than two planes");
        if (existing.type !== type)
          throw new Error("Shared edges must have matching classifications");
      } else {
        measuredEdges.push({ a, b, length, type, occurrences: 1 });
        edges[type] += length;
      }
    }
  const perimeter = measuredEdges
    .filter((edge) => edge.occurrences === 1)
    .reduce((sum, edge) => sum + edge.length, 0);
  const area = planes.reduce((sum, p) => sum + p.area, 0);
  return {
    area,
    squares: area / 100,
    withWaste: area * (1 + d.waste / 100),
    edges,
    planes,
    perimeter,
    penetrations: d.penetrations.length,
  };
}
export type RoofShape = "gable" | "hip" | "flat" | "shed" | "mansard" | "complex";
export function roofPreset(shape: RoofShape, width = 40, length = 30, pitch = 6): RoofDrawing {
  if (!Number.isFinite(width) || width < 1 || width > 500)
    throw new Error("Roof width must be between 1 and 500 feet");
  if (!Number.isFinite(length) || length < 1 || length > 500)
    throw new Error("Roof length must be between 1 and 500 feet");
  if (!Number.isFinite(pitch) || pitch < 0 || pitch > 24)
    throw new Error("Roof pitch must be between 0:12 and 24:12");
  const w = width / 2,
    l = length / 2,
    h = ((width / 2) * pitch) / 12,
    base = 10;
  const point = (x: number, z: number, rise = 0): Point => ({ x, y: base + rise, z });
  const plane = (name: string, points: Point[], edges: EdgeType[]): RoofPlane => ({
    id: name,
    name,
    points,
    edges,
  });
  const sw = point(-w, -l),
    se = point(w, -l),
    ne = point(w, l),
    nw = point(-w, l);
  let planes: RoofPlane[] = [];
  if (shape === "flat")
    planes = [plane("Flat roof", [sw, se, ne, nw], ["eave", "eave", "eave", "eave"])];
  else if (shape === "shed")
    planes = [
      plane(
        "Shed roof",
        [sw, se, point(w, l, (length * pitch) / 12), point(-w, l, (length * pitch) / 12)],
        ["eave", "rake", "eave", "rake"],
      ),
    ];
  else if (shape === "hip") {
    const a = point(0, -Math.max(0, l - w), (Math.min(w, l) * pitch) / 12),
      b = point(0, Math.max(0, l - w), (Math.min(w, l) * pitch) / 12);
    if (length === width) {
      const apex = point(0, 0, (l * pitch) / 12);
      planes = [
        plane("South", [sw, se, apex], ["eave", "hip", "hip"]),
        plane("North", [ne, nw, apex], ["eave", "hip", "hip"]),
        plane("West", [nw, sw, apex], ["eave", "hip", "hip"]),
        plane("East", [se, ne, apex], ["eave", "hip", "hip"]),
      ];
    } else if (length < width) {
      const a2 = point(-Math.max(0, w - l), 0, (l * pitch) / 12),
        b2 = point(Math.max(0, w - l), 0, (l * pitch) / 12);
      planes = [
        plane("South", [sw, se, b2, a2], ["eave", "hip", "ridge", "hip"]),
        plane("North", [nw, a2, b2, ne], ["hip", "ridge", "hip", "eave"]),
        plane("West", [sw, a2, nw], ["hip", "hip", "eave"]),
        plane("East", [se, ne, b2], ["eave", "hip", "hip"]),
      ];
    } else
      planes = [
        plane("West", [sw, a, b, nw], ["hip", "ridge", "hip", "eave"]),
        plane("East", [se, ne, b, a], ["eave", "hip", "ridge", "hip"]),
        plane("South", [sw, se, a], ["eave", "hip", "hip"]),
        plane("North", [nw, b, ne], ["hip", "hip", "eave"]),
      ];
  } else if (shape === "mansard") {
    const inset = Math.min(w, l) * 0.3,
      rise = (inset * pitch) / 12;
    const a = point(-w + inset, -l + inset, rise),
      b = point(w - inset, -l + inset, rise),
      c = point(w - inset, l - inset, rise),
      d = point(-w + inset, l - inset, rise);
    planes = [
      plane("South", [sw, se, b, a], ["eave", "hip", "ridge", "hip"]),
      plane("East", [se, ne, c, b], ["eave", "hip", "ridge", "hip"]),
      plane("North", [ne, nw, d, c], ["eave", "hip", "ridge", "hip"]),
      plane("West", [nw, sw, a, d], ["eave", "hip", "ridge", "hip"]),
      plane("Upper flat", [a, b, c, d], ["ridge", "ridge", "ridge", "ridge"]),
    ];
  } else {
    const a = point(0, -l, h),
      b = point(0, l, h);
    planes = [
      plane("West plane", [sw, a, b, nw], ["rake", "ridge", "rake", "eave"]),
      plane("East plane", [a, se, ne, b], ["rake", "eave", "rake", "ridge"]),
    ];
  }
  if (shape === "complex") {
    const wing = roofPreset("hip", width / 2, length / 2, pitch);
    planes.push(
      ...wing.planes.map((p) => ({
        ...p,
        id: `wing-${p.id}`,
        name: `Wing ${p.name}`,
        points: p.points.map((v) => ({ ...v, x: v.x + width, y: v.y, z: v.z })),
      })),
    );
  }
  return {
    planes,
    penetrations: [],
    waste: 10,
    roof_type: "Metal Roof",
    notes: "",
    condition: "",
    verified: false,
  };
}
/** Per-plane quantities retain the geometry source instead of collapsing the roof to one total. */
export function roofPlaneTakeoff(raw: RoofDrawing) {
  const drawing = drawingSchema.parse(raw);
  return drawing.planes.map((plane) => {
    const info = planeInfo(plane);
    const edges: Record<EdgeType, number> = {
      eave: 0,
      rake: 0,
      ridge: 0,
      hip: 0,
      valley: 0,
      other: 0,
    };
    for (let index = 0; index < plane.points.length; index++) {
      const start = plane.points[index];
      const end = plane.points[(index + 1) % plane.points.length];
      const type = plane.edges[index];
      if (start && end && type) edges[type] += distance(start, end);
    }
    return {
      id: plane.id,
      name: plane.name,
      area_sqft: info.area,
      squares: info.area / 100,
      area_with_waste_sqft: info.area * (1 + drawing.waste / 100),
      pitch_rise_per_12: info.pitch,
      edges_lf: edges,
    };
  });
}

/**
 * Convert a saved drawing into manufacturer-reviewable material inputs.
 * Metal panel runs are emitted only for simple, rectangular gable facets with
 * one parallel eave/ridge pair of equal length. Complex facets stay manual.
 */
export function measuredMetalPlaneRuns(d: RoofDrawing) {
  if (d.roof_type !== "Metal Roof") return undefined;
  const runs: { eaveLengthFt: number; panelRunFt: number }[] = [];
  for (const plane of d.planes) {
    const eaves = plane.edges.flatMap((type, index) => (type === "eave" ? [index] : []));
    const ridges = plane.edges.flatMap((type, index) => (type === "ridge" ? [index] : []));
    if (eaves.length !== 1 || ridges.length !== 1 || plane.points.length !== 4) return undefined;
    const eaveIndex = eaves[0];
    const ridgeIndex = ridges[0];
    if (eaveIndex === undefined || ridgeIndex === undefined) return undefined;
    if ((eaveIndex + 2) % 4 !== ridgeIndex) return undefined;
    const edge = (index: number) => {
      const a = plane.points[index];
      const b = plane.points[(index + 1) % plane.points.length];
      if (!a || !b) return undefined;
      return { a, b, length: distance(a, b) };
    };
    const eave = edge(eaveIndex);
    const ridge = edge(ridgeIndex);
    if (!eave || !ridge || eave.length <= 0 || ridge.length <= 0) return undefined;
    // Equal, parallel eave/ridge edges indicate a constant panel run across the facet.
    const lengthTolerance = Math.max(0.1, eave.length * 0.01);
    if (Math.abs(eave.length - ridge.length) > lengthTolerance) return undefined;
    const ev = { x: eave.b.x - eave.a.x, z: eave.b.z - eave.a.z };
    const rv = { x: ridge.b.x - ridge.a.x, z: ridge.b.z - ridge.a.z };
    const cross2d = ev.x * rv.z - ev.z * rv.x;
    if (Math.abs(cross2d) > eave.length * ridge.length * 0.01) return undefined;
    const eaveMid = {
      x: (eave.a.x + eave.b.x) / 2,
      y: (eave.a.y + eave.b.y) / 2,
      z: (eave.a.z + eave.b.z) / 2,
    };
    const ridgeMid = {
      x: (ridge.a.x + ridge.b.x) / 2,
      y: (ridge.a.y + ridge.b.y) / 2,
      z: (ridge.a.z + ridge.b.z) / 2,
    };
    const panelRunFt = distance(eaveMid, ridgeMid);
    if (!Number.isFinite(panelRunFt) || panelRunFt <= 0) return undefined;
    runs.push({ eaveLengthFt: eave.length, panelRunFt });
  }
  return runs.length === d.planes.length && runs.length > 0 ? runs : undefined;
}

export function toMaterialReport(d: RoofDrawing) {
  const m = measureDrawing(d);
  const metalPlaneRuns = measuredMetalPlaneRuns(d);
  return {
    roof_type: d.roof_type,
    area_sqft: m.area,
    waste_pct: d.waste,
    ridge_lf: m.edges.ridge,
    hips_lf: m.edges.hip,
    valleys_lf: m.edges.valley,
    eaves_lf: m.edges.eave,
    rakes_lf: m.edges.rake,
    panel_width_in: 16,
    dominant_pitch: [...m.planes].sort((a, b) => b.area - a.area)[0]?.pitch ?? 0,
    pipes: d.penetrations.filter((p) => p.kind === "pipe" || p.kind === "vent").length,
    ...(metalPlaneRuns ? { metal_plane_runs: metalPlaneRuns } : {}),
  };
}

export type RoofReportAudit = {
  status: "ready" | "review" | "blocked";
  blockers: string[];
  warnings: string[];
  unclassifiedEdges: number;
  planeCount: number;
};

/**
 * Preflight checks for a customer-facing roof report.
 * This validates geometry and disclosure requirements; it does not certify field accuracy.
 */
export function auditRoofReport(raw: RoofDrawing): RoofReportAudit {
  const blockers: string[] = [];
  const warnings: string[] = [];
  let unclassifiedEdges = 0;
  let planeCount = 0;
  try {
    const drawing = drawingSchema.parse(raw);
    planeCount = drawing.planes.length;
    const measurement = measureDrawing(drawing);
    unclassifiedEdges = drawing.planes.reduce(
      (total, plane) => total + plane.edges.filter((edge) => edge === "other").length,
      0,
    );
    if (measurement.area <= 0 || !Number.isFinite(measurement.area))
      blockers.push("Roof area could not be calculated.");
    if (drawing.planes.some((plane) => plane.points.length !== plane.edges.length))
      blockers.push("One or more roof planes have missing edge classifications.");
    if (unclassifiedEdges > 0)
      warnings.push(`${unclassifiedEdges} roof boundary edge(s) remain unclassified.`);
    if (!drawing.geo_reference) warnings.push("No geographic origin is saved with this drawing.");
    if (drawing.accuracy !== "site_verified")
      warnings.push("Measurements are not marked as site verified.");
    if (!drawing.verified) warnings.push("The drawing has not been marked as owner reviewed.");
    if (measurement.planes.some((plane) => plane.pitch <= 0) && drawing.roof_type !== "Flat Roof")
      warnings.push("A zero-pitch plane exists on a non-flat roofing system; confirm pitch.");
  } catch (error) {
    blockers.push(error instanceof Error ? error.message : "Roof geometry failed validation.");
  }
  return {
    status: blockers.length ? "blocked" : warnings.length ? "review" : "ready",
    blockers,
    warnings,
    unclassifiedEdges,
    planeCount,
  };
}
