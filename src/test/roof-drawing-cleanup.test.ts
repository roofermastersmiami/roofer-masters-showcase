import { describe, expect, it } from "vitest";
import { measureDrawing, type RoofDrawing, type RoofPlane } from "@/lib/roof-geometry";
import {
  detectedFacetsToDrawing,
  simplifyDetectedDrawingPlanes,
  type RoofDetectionResponse,
} from "@/lib/roof-detection";

/**
 * Regression tests for the reported "3D and 2D don't look like an
 * actual roof — many bad lines" problem: the detection service's
 * facet rings follow fine-grained LiDAR hull points, so a straight
 * 40 ft eave reached the drawing as a dozen ~3 ft fragments, each
 * with its own vertex and length label in Edit Sketch. The converter
 * now merges collinear micro-segments (and removes slivers/spikes)
 * when building the drawing, globally consistently across facets so
 * shared seams keep pairing in measureDrawing.
 */

const ORIGIN = { lat: 25.47, lon: -80.48 };
const LON_SCALE = 111320 * Math.cos((ORIGIN.lat * Math.PI) / 180) * (1 / 0.3048);
const LAT_SCALE = 110540 * (1 / 0.3048);
const EAVE_M = 10;
const RIDGE_M = 12.286; // 7.5 ft above the eave over a 15 ft run = 6/12

/** Chop the straight run a→b into `steps` equal segments. */
function chop(
  a: [number, number, number],
  b: [number, number, number],
  steps: number,
): [number, number, number][] {
  const points: [number, number, number][] = [];
  for (let s = 0; s < steps; s++)
    points.push([
      a[0] + ((b[0] - a[0]) * s) / steps,
      a[1] + ((b[1] - a[1]) * s) / steps,
      a[2] + ((b[2] - a[2]) * s) / steps,
    ]);
  return points;
}

/** A gable facet ring (local feet) with every straight side chopped
 * into ~3 ft fragments, as a LiDAR hull boundary arrives. Corners are
 * listed in the same order as the plain fixture below. */
function choppedGableFacet(id: string, south: boolean) {
  const elevAt = (z: number) =>
    south ? EAVE_M + ((RIDGE_M - EAVE_M) * z) / 15 : RIDGE_M - ((RIDGE_M - EAVE_M) * (z - 15)) / 15;
  const corners: [number, number][] = south
    ? [
        [0, 0],
        [40, 0],
        [40, 15],
        [0, 15],
      ]
    : [
        [0, 15],
        [40, 15],
        [40, 30],
        [0, 30],
      ];
  const ringPoints: [number, number, number][] = [];
  for (let c = 0; c < corners.length; c++) {
    const a = corners[c]!;
    const b = corners[(c + 1) % corners.length]!;
    const steps = Math.max(2, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / 3));
    ringPoints.push(...chop([a[0], a[1], elevAt(a[1])], [b[0], b[1], elevAt(b[1])], steps));
  }
  const boundary = [...ringPoints, ringPoints[0]!].map(([x, z, elevation]) => [
    ORIGIN.lat - z / LAT_SCALE,
    ORIGIN.lon + x / LON_SCALE,
    elevation,
  ]) as [number, number, number][];
  return {
    id,
    point_count: 800,
    pitch_degrees: 26.565,
    pitch_rise_per_12: 6,
    azimuth_degrees: south ? 180 : 0,
    area_sqft: 670.8,
    squares: 6.71,
    boundary_latlon: boundary,
  };
}

function gableResponse(chopped: boolean): RoofDetectionResponse {
  const facet = (id: string, corners: [number, number, number][]) => ({
    id,
    point_count: 800,
    pitch_degrees: 26.565,
    pitch_rise_per_12: 6,
    azimuth_degrees: 180,
    area_sqft: 670.8,
    squares: 6.71,
    boundary_latlon: [...corners, corners[0]!].map(([x, z, elevation]) => [
      ORIGIN.lat - z / LAT_SCALE,
      ORIGIN.lon + x / LON_SCALE,
      elevation,
    ]) as [number, number, number][],
  });
  const plainFacets = [
    facet("facet-1", [
      [0, 0, EAVE_M],
      [40, 0, EAVE_M],
      [40, 15, RIDGE_M],
      [0, 15, RIDGE_M],
    ]),
    facet("facet-2", [
      [0, 15, RIDGE_M],
      [40, 15, RIDGE_M],
      [40, 30, EAVE_M],
      [0, 30, EAVE_M],
    ]),
  ];
  const outline: [number, number][] = [
    [0, 0],
    [40, 0],
    [40, 30],
    [0, 30],
    [0, 0],
  ];
  return {
    status: "lidar_facets",
    verification: "unverified_public_data",
    matched_address: "100 Main Street",
    location: ORIGIN,
    footprint: {
      source: "synthetic-test",
      area_sqft: 1200,
      polygon_geojson: {
        type: "Polygon",
        coordinates: [
          outline.map(([x, z]) => [ORIGIN.lon + x / LON_SCALE, ORIGIN.lat - z / LAT_SCALE]),
        ],
      },
    },
    roof: {
      facet_count: 2,
      area_sqft: 1341.6,
      total_squares: 13.42,
      dominant_pitch_rise_per_12: 6,
      facets: chopped
        ? [choppedGableFacet("facet-1", true), choppedGableFacet("facet-2", false)]
        : plainFacets,
      edge_lengths_lf: {
        ridge: 40,
        hip: 0,
        valley: 0,
        eave: 80,
        rake: 4 * Math.hypot(15, 7.5),
        pitch_change: 0,
      },
      drawing_ready: true,
    },
    fallback: { available: false, mode: null, footprint_area_sqft: 1200, message: null },
    disclaimer: "Synthetic test payload.",
  } as RoofDetectionResponse;
}

describe("drawing cleanup in the LiDAR converter", () => {
  it("merges a chopped hull boundary into clean edges", () => {
    const drawing = detectedFacetsToDrawing(gableResponse(true), "Metal Roof");
    // 36 hull points per facet (13+5+13+5) collapse to the corners,
    // plus a vertex wherever the converter's own classification
    // changes along a run (cleanup never merges across a
    // classification change) — 6 per facet here, from 36.
    for (const plane of drawing.planes) expect(plane.points.length).toBeLessThanOrEqual(6);
    const totalSegments = drawing.planes.reduce((sum, plane) => sum + plane.points.length, 0);
    expect(totalSegments).toBeLessThanOrEqual(12);
    const measured = measureDrawing(drawing);
    expect(measured.edges.eave).toBeCloseTo(80, 1);
    expect(measured.edges.valley).toBe(0);
    expect(measured.edges.other).toBe(0);
    expect(measured.area).toBeCloseTo(1341.64, 1);
  });

  it("keeps the cleaned outline on the facets' own geometry", () => {
    const drawing = detectedFacetsToDrawing(gableResponse(true), "Metal Roof");
    const plain = detectedFacetsToDrawing(gableResponse(false), "Metal Roof");
    // Same roof, same area as the unchopped conversion.
    expect(Math.abs(measureDrawing(drawing).area - measureDrawing(plain).area)).toBeLessThanOrEqual(
      0.001 * measureDrawing(plain).area,
    );
    // Every surviving vertex is one of the facet's own hull vertices
    // (cleanup removes points, it never moves or invents them), and
    // each facet's plan area is preserved.
    const chopped = [choppedGableFacet("facet-1", true), choppedGableFacet("facet-2", false)];
    drawing.planes.forEach((plane, index) => {
      const source = chopped[index]!;
      const sourcePoints = source.boundary_latlon.slice(0, -1).map(([lat, lon]) => ({
        x: (lon - ORIGIN.lon) * LON_SCALE,
        z: (ORIGIN.lat - lat) * LAT_SCALE,
      }));
      for (const point of plane.points) {
        const nearest = Math.min(
          ...sourcePoints.map((candidate) =>
            Math.hypot(candidate.x - point.x, candidate.z - point.z),
          ),
        );
        expect(nearest).toBeLessThanOrEqual(0.05);
      }
      let planArea = 0;
      for (let i = 0; i < plane.points.length; i++) {
        const a = plane.points[i]!;
        const b = plane.points[(i + 1) % plane.points.length]!;
        planArea += a.x * b.z - b.x * a.z;
      }
      expect(Math.abs(Math.abs(planArea) / 2 - 600)).toBeLessThanOrEqual(3);
    });
  });
});

/** The same gable as RoofPlane geometry in local feet, chopped. */
function choppedPlane(id: string, south: boolean): RoofPlane {
  const yAt = (z: number) => (south ? 10 + z * 0.5 : 17.5 - (z - 15) * 0.5);
  const zEave = south ? 0 : 30;
  const segments: {
    from: [number, number];
    to: [number, number];
    type: RoofPlane["edges"][number];
  }[] = [
    { from: [0, zEave], to: [40, zEave], type: "eave" },
    { from: [40, zEave], to: [40, 15], type: "rake" },
    { from: [40, 15], to: [0, 15], type: "ridge" },
    { from: [0, 15], to: [0, zEave], type: "rake" },
  ];
  const points: RoofPlane["points"] = [];
  const edges: RoofPlane["edges"] = [];
  for (const segment of segments) {
    const steps = Math.round(
      Math.hypot(segment.to[0] - segment.from[0], segment.to[1] - segment.from[1]) / 3,
    );
    for (let s = 0; s < steps; s++) {
      const x = segment.from[0] + ((segment.to[0] - segment.from[0]) * s) / steps;
      const z = segment.from[1] + ((segment.to[1] - segment.from[1]) * s) / steps;
      points.push({ x, y: yAt(z), z });
      edges.push(segment.type);
    }
  }
  return { id, name: id, points, edges };
}

function asDrawing(planes: RoofPlane[]): RoofDrawing {
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

describe("simplifyDetectedDrawingPlanes", () => {
  it("drops chopped segment counts dramatically with totals intact", () => {
    const planes = [choppedPlane("south", true), choppedPlane("north", false)];
    const segmentCount = (list: RoofPlane[]) =>
      list.reduce((sum, plane) => sum + plane.points.length, 0);
    expect(segmentCount(planes)).toBeGreaterThan(60);
    const before = measureDrawing(asDrawing(planes));
    const cleaned = simplifyDetectedDrawingPlanes(planes);
    expect(segmentCount(cleaned)).toBe(8);
    const after = measureDrawing(asDrawing(cleaned));
    for (const type of ["ridge", "hip", "valley", "eave", "rake", "other"] as const)
      expect(Math.abs(after.edges[type] - before.edges[type])).toBeLessThanOrEqual(
        Math.max(0.001 * before.edges[type], 0.05),
      );
    expect(Math.abs(after.area - before.area)).toBeLessThanOrEqual(0.001 * before.area);
  });

  it("keeps a seam vertex that is a corner in the neighbouring facet (T-junction)", () => {
    const south: RoofPlane = {
      id: "south",
      name: "South",
      points: [
        { x: 0, y: 10, z: 0 },
        { x: 20, y: 10, z: 0 },
        { x: 40, y: 10, z: 0 },
        { x: 40, y: 17.5, z: 15 },
        { x: 20, y: 17.5, z: 15 },
        { x: 0, y: 17.5, z: 15 },
      ],
      edges: ["eave", "eave", "rake", "ridge", "ridge", "rake"],
    };
    const north: RoofPlane = {
      id: "north",
      name: "North",
      points: [
        { x: 0, y: 17.5, z: 15 },
        { x: 20, y: 17.5, z: 15 },
        { x: 20, y: 10, z: 30 },
        { x: 40, y: 10, z: 30 },
        { x: 40, y: 17.5, z: 15 },
      ],
      edges: ["ridge", "rake", "eave", "rake", "ridge"],
    };
    const cleaned = simplifyDetectedDrawingPlanes([south, north]);
    const cleanedSouth = cleaned.find((plane) => plane.id === "south")!;
    const cleanedNorth = cleaned.find((plane) => plane.id === "north")!;
    // The eave midpoint (20, 0) is a plain collinear point: merged.
    expect(cleanedSouth.points.some((p) => p.x === 20 && p.z === 0)).toBe(false);
    // The ridge midpoint (20, 15) turns a corner in the north facet:
    // it survives in BOTH facets so the seam still pairs.
    expect(cleanedSouth.points.some((p) => p.x === 20 && p.z === 15)).toBe(true);
    expect(cleanedNorth.points.some((p) => p.x === 20 && p.z === 15)).toBe(true);
    expect(() => measureDrawing(asDrawing(cleaned))).not.toThrow();
  });

  it("removes an out-and-back spike and its phantom length", () => {
    const flat: RoofPlane = {
      id: "flat",
      name: "Flat",
      points: [
        { x: 0, y: 10, z: 0 },
        { x: 40, y: 10, z: 0 },
        { x: 40, y: 10, z: 20 },
        { x: 25.05, y: 10, z: 20 },
        { x: 25, y: 10, z: 22.5 },
        { x: 24.98, y: 10, z: 20 },
        { x: 0, y: 10, z: 20 },
      ],
      edges: ["eave", "eave", "eave", "eave", "eave", "eave", "eave"],
    };
    const before = measureDrawing(asDrawing([flat]));
    expect(before.edges.eave).toBeGreaterThan(124);
    const cleaned = simplifyDetectedDrawingPlanes([flat]);
    expect(cleaned[0]!.points).toHaveLength(4);
    const after = measureDrawing(asDrawing(cleaned));
    // The clean rectangle's perimeter is exactly 120 ft; the ~4.9 ft
    // difference is the spike's phantom out-and-back length.
    expect(after.edges.eave).toBeCloseTo(120, 1);
    expect(before.edges.eave - after.edges.eave).toBeCloseTo(4.93, 1);
  });

  it("keeps a collinear vertex where the edge classification changes", () => {
    const plane: RoofPlane = {
      id: "p",
      name: "P",
      points: [
        { x: 0, y: 10, z: 0 },
        { x: 20, y: 10, z: 0 },
        { x: 40, y: 10, z: 0 },
        { x: 40, y: 10, z: 20 },
        { x: 0, y: 10, z: 20 },
      ],
      edges: ["eave", "rake", "rake", "eave", "eave"],
    };
    const cleaned = simplifyDetectedDrawingPlanes([plane]);
    expect(cleaned[0]!.points.some((p) => p.x === 20 && p.z === 0)).toBe(true);
  });

  it("leaves an already-clean drawing untouched", () => {
    const planes = [choppedPlane("south", true)];
    const clean = simplifyDetectedDrawingPlanes(planes);
    const again = simplifyDetectedDrawingPlanes(clean);
    expect(again).toEqual(clean);
    const preset = asDrawing(clean).planes;
    expect(preset[0]!.points).toHaveLength(4);
  });
});
