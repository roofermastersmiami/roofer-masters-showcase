import { z } from "zod";
import type { EdgeType, RoofDrawing, RoofPlane } from "@/lib/roof-geometry";

const facetSchema = z.object({
  id: z.string().min(1),
  point_count: z.number().int().positive(),
  pitch_degrees: z.number().finite().min(0).max(90),
  fit_rmse_m: z.number().finite().nonnegative().optional(),
  pitch_rise_per_12: z.number().finite().min(0).max(1000),
  azimuth_degrees: z.number().finite().min(0).lt(360),
  area_sqft: z.number().finite().positive(),
  squares: z.number().finite().positive(),
  boundary_latlon: z
    .array(
      z.tuple([
        z.number().finite().min(-90).max(90),
        z.number().finite().min(-180).max(180),
        z.number().finite(),
      ]),
    )
    .min(4)
    .max(200),
  plane_model: z
    .object({
      z_equals_ax_plus_by_plus_c: z.tuple([
        z.number().finite(),
        z.number().finite(),
        z.number().finite(),
      ]),
    })
    .optional(),
});

export const roofDetectionResponseSchema = z.object({
  status: z.enum(["lidar_facets", "footprint_only"]),
  verification: z.literal("unverified_public_data"),
  matched_address: z.string(),
  location: z.object({
    lat: z.number().finite().min(-90).max(90),
    lon: z.number().finite().min(-180).max(180),
  }),
  footprint: z.object({
    source: z.string(),
    area_sqft: z.number().finite().positive(),
    address_point_inside_footprint: z.boolean().optional(),
    address_to_footprint_distance_m: z.number().finite().nonnegative().optional(),
    polygon_geojson: z.object({
      type: z.literal("Polygon"),
      coordinates: z.array(z.array(z.tuple([z.number().finite(), z.number().finite()]))),
    }),
  }),
  lidar: z
    .object({
      source: z.string(),
      stac_items: z.number().int().nonnegative().optional(),
      tiles_used: z.number().int().nonnegative().optional(),
      tile_ids_used: z.array(z.string().min(1)).optional(),
      building_class_points: z.number().int().nonnegative().optional(),
      raw_building_class_points: z.number().int().nonnegative().optional(),
      duplicate_points_removed: z.number().int().nonnegative().optional(),
    })
    .optional(),
  roof: z.object({
    facet_count: z.number().int().nonnegative(),
    area_sqft: z.number().finite().positive().nullable(),
    total_squares: z.number().finite().positive().nullable(),
    dominant_pitch_rise_per_12: z.number().finite().nonnegative().nullable(),
    facets: z.array(facetSchema),
    edge_lengths_lf: z
      .object({
        ridge: z.number().finite().nonnegative(),
        hip: z.number().finite().nonnegative(),
        valley: z.number().finite().nonnegative(),
        eave: z.number().finite().nonnegative(),
        rake: z.number().finite().nonnegative(),
        pitch_change: z.number().finite().nonnegative(),
      })
      .nullable(),
  }),
  fallback: z.object({
    available: z.boolean(),
    mode: z.string().nullable(),
    footprint_area_sqft: z.number().finite().positive(),
    message: z.string().nullable(),
  }),
  disclaimer: z.string(),
});

export type RoofDetectionResponse = z.infer<typeof roofDetectionResponseSchema>;

const FEET_PER_METER = 1 / 0.3048;
const METERS_PER_LAT_DEGREE = 110540;
const METERS_PER_LON_DEGREE = 111320;

/** Convert validated LiDAR facets into the CRM's local-feet roof drawing model.
 * Boundary vertices shared by two facets are snapped to a common position so
 * shared edges are counted once, and every edge is classified from the facet
 * geometry (shared-boundary chord test for ridge/hip/valley, downslope
 * alignment for eave/rake) — the same topology the detection service uses for
 * its edge totals. Classifications are preliminary like the facets themselves:
 * the drawing stays unverified until the estimator reviews it.
 */
export function detectedFacetsToDrawing(
  raw: unknown,
  roofType: RoofDrawing["roof_type"],
): RoofDrawing {
  const result = roofDetectionResponseSchema.parse(raw);
  if (result.status !== "lidar_facets" || result.roof.facets.length === 0) {
    throw new Error(
      "This address has no supported LiDAR roof facets. Trace the roof and enter pitch manually.",
    );
  }
  const originLat = result.location.lat;
  const originLon = result.location.lon;
  const longitudeScale = METERS_PER_LON_DEGREE * Math.cos((originLat * Math.PI) / 180);
  const projected = result.roof.facets.map((facet) => {
    if (facet.plane_model) {
      const [a, b] = facet.plane_model.z_equals_ax_plus_by_plus_c;
      const modelPitchDegrees = (Math.atan(Math.hypot(a, b)) * 180) / Math.PI;
      const pitchDifference = Math.abs(modelPitchDegrees - facet.pitch_degrees);
      if (pitchDifference > 1.5) {
        throw new Error(
          `Facet ${facet.id} has inconsistent elevation and pitch data (${pitchDifference.toFixed(1)}° difference). Retry detection or review manually.`,
        );
      }
      const modelPitchRise = Math.hypot(a, b) * 12;
      if (Math.abs(modelPitchRise - facet.pitch_rise_per_12) > 0.35) {
        throw new Error(
          `Facet ${facet.id} has inconsistent pitch values. Retry detection or review manually.`,
        );
      }
    }
    const points = facet.boundary_latlon.slice(0, -1).map(([lat, lon, elevationMeters]) => ({
      x: (lon - originLon) * longitudeScale * FEET_PER_METER,
      z: (originLat - lat) * METERS_PER_LAT_DEGREE * FEET_PER_METER,
      elevation: elevationMeters * FEET_PER_METER,
    }));
    if (points.length < 3) throw new Error(`Facet ${facet.id} has too few unique boundary points.`);
    const unique = new Set(points.map((point) => `${point.x.toFixed(2)}:${point.z.toFixed(2)}`));
    if (unique.size !== points.length)
      throw new Error(`Facet ${facet.id} contains duplicate boundary points.`);
    return { facet, points, elevations: points.map((point) => point.elevation) };
  });
  // Work in local feet: (x, z) is the ground plan, elevation is height.
  type LocalPoint = { x: number; z: number; elevation: number };
  const facetsPoints: LocalPoint[][] = projected.map(({ points }) =>
    points.map((point) => ({ x: point.x, z: point.z, elevation: point.elevation })),
  );

  // Snap boundary vertices from different facets that describe the same
  // physical corner (independently fitted hulls rarely share exact
  // endpoints) so shared edges share endpoints and are counted once.
  const SNAP_TOLERANCE_FT = 1.0;
  for (let i = 0; i < facetsPoints.length; i++)
    for (let j = i + 1; j < facetsPoints.length; j++) {
      const left = facetsPoints[i] ?? [];
      const right = facetsPoints[j] ?? [];
      for (const p of left)
        for (const q of right) {
          if (Math.hypot(p.x - q.x, p.z - q.z) <= SNAP_TOLERANCE_FT) {
            const midX = (p.x + q.x) / 2;
            const midZ = (p.z + q.z) / 2;
            p.x = midX;
            p.z = midZ;
            q.x = midX;
            q.z = midZ;
          }
        }
    }
  // Snapping can collapse consecutive vertices; drop those duplicates.
  for (let i = 0; i < facetsPoints.length; i++) {
    const points = facetsPoints[i] ?? [];
    const deduped = points.filter(
      (point, index) =>
        index === 0 ||
        Math.hypot(point.x - (points[index - 1]?.x ?? NaN), point.z - (points[index - 1]?.z ?? NaN)) >
          0.01,
    );
    if (deduped.length < 3)
      throw new Error(`Facet ${projected[i]?.facet.id ?? i} has too few unique boundary points.`);
    facetsPoints[i] = deduped;
  }

  // Least-squares plane per facet: elevation = a*x + b*z + c.
  const fitPlane = (points: LocalPoint[]) => {
    const n = points.length;
    let sx = 0,
      sz = 0,
      sy = 0,
      sxx = 0,
      szz = 0,
      sxz = 0,
      sxy = 0,
      szy = 0;
    for (const p of points) {
      sx += p.x;
      sz += p.z;
      sy += p.elevation;
      sxx += p.x * p.x;
      szz += p.z * p.z;
      sxz += p.x * p.z;
      sxy += p.x * p.elevation;
      szy += p.z * p.elevation;
    }
    const det = sxx * (szz * n - sz * sz) - sxz * (sxz * n - sz * sx) + sx * (sxz * sz - szz * sx);
    if (Math.abs(det) < 1e-9) return null;
    const a =
      (sxy * (szz * n - sz * sz) - sxz * (szy * n - sz * sy) + sx * (szy * sz - szz * sy)) / det;
    const b =
      (sxx * (szy * n - sz * sy) - sxy * (sxz * n - sz * sx) + sx * (sxz * sy - szy * sx)) / det;
    const c =
      (sxx * (szz * sy - szy * sz) - sxz * (sxz * sy - szy * sx) + sxy * (sxz * sz - szz * sx)) /
      det;
    return { a, b, c };
  };
  const facetPlanes = facetsPoints.map((points) => fitPlane(points));
  const planeElevation = (index: number, x: number, z: number) => {
    const plane = facetPlanes[index];
    return plane ? plane.a * x + plane.b * z + plane.c : null;
  };
  // Re-level every vertex on its facet's fitted plane at its (snapped)
  // position, so vertices stay exactly coplanar after snapping.
  const leveledElevations: number[][] = facetsPoints.map((points, index) =>
    points.map((point) => planeElevation(index, point.x, point.z) ?? point.elevation),
  );
  const minElevation = Math.min(...leveledElevations.flat());

  // --- Edge classification (mirrors the detection service's topology) ---
  const ADJACENCY_FT = 2.46; // 0.75 m buffer, same as the service
  type Pt2 = { x: number; z: number };
  const polygons: Pt2[][] = facetsPoints.map((points) => points.map((p) => ({ x: p.x, z: p.z })));
  const pointInPolygon = (pt: Pt2, poly: Pt2[]) => {
    let inside = false;
    for (let a = 0, b = poly.length - 1; a < poly.length; b = a++) {
      const pa = poly[a] ?? { x: 0, z: 0 };
      const pb = poly[b] ?? { x: 0, z: 0 };
      if (
        pa.z > pt.z !== pb.z > pt.z &&
        pt.x < ((pb.x - pa.x) * (pt.z - pa.z)) / (pb.z - pa.z) + pa.x
      )
        inside = !inside;
    }
    return inside;
  };
  const distanceToPolygon = (pt: Pt2, poly: Pt2[]) => {
    if (pointInPolygon(pt, poly)) return 0;
    let best = Infinity;
    for (let a = 0; a < poly.length; a++) {
      const pa = poly[a] ?? { x: 0, z: 0 };
      const pb = poly[(a + 1) % poly.length] ?? pa;
      const dx = pb.x - pa.x;
      const dz = pb.z - pa.z;
      const lengthSq = dx * dx + dz * dz;
      const t =
        lengthSq <= 1e-12
          ? 0
          : Math.max(0, Math.min(1, ((pt.x - pa.x) * dx + (pt.z - pa.z) * dz) / lengthSq));
      best = Math.min(best, Math.hypot(pt.x - (pa.x + t * dx), pt.z - (pa.z + t * dz)));
    }
    return best;
  };
  const sharedFraction = (p: Pt2, q: Pt2, poly: Pt2[]) => {
    const length = Math.hypot(q.x - p.x, q.z - p.z);
    const steps = Math.max(2, Math.ceil(length / 0.5) + 1);
    let inside = 0;
    for (let s = 0; s < steps; s++) {
      const t = s / (steps - 1);
      const sample = { x: p.x + (q.x - p.x) * t, z: p.z + (q.z - p.z) * t };
      if (distanceToPolygon(sample, poly) <= ADJACENCY_FT) inside++;
    }
    return inside / steps;
  };
  const classifyShared = (
    i: number,
    j: number,
    mid: Pt2,
    segmentSlope: number,
  ): EdgeType => {
    const planeI = facetPlanes[i];
    const planeJ = facetPlanes[j];
    if (!planeI || !planeJ) return "other";
    if (Math.hypot(planeI.a, planeI.b) * 12 < 1 && Math.hypot(planeJ.a, planeJ.b) * 12 < 1)
      return "other"; // flat-to-flat seam: no ridge/valley evidence
    const sampleInto = (plane: { a: number; b: number; c: number }, poly: Pt2[]) => {
      const cx = poly.reduce((sum, p) => sum + p.x, 0) / poly.length;
      const cz = poly.reduce((sum, p) => sum + p.z, 0) / poly.length;
      const vx = cx - mid.x;
      const vz = cz - mid.z;
      const norm = Math.hypot(vx, vz);
      if (norm < 1e-6) return null;
      const sx = mid.x + (vx / norm) * 3;
      const sz = mid.z + (vz / norm) * 3;
      return plane.a * sx + plane.b * sz + plane.c;
    };
    const sampleI = sampleInto(planeI, polygons[i] ?? []);
    const sampleJ = sampleInto(planeJ, polygons[j] ?? []);
    if (sampleI === null || sampleJ === null) return "other";
    const chord = (sampleI + sampleJ) / 2;
    const edgeElevation =
      ((planeElevation(i, mid.x, mid.z) ?? 0) + (planeElevation(j, mid.x, mid.z) ?? 0)) / 2;
    if (edgeElevation > chord + 0.1) return segmentSlope <= 0.14 ? "ridge" : "hip";
    if (edgeElevation < chord - 0.1) return "valley";
    return "other";
  };

  const edgesByFacet: EdgeType[][] = facetsPoints.map((points) =>
    points.map(() => "other" as EdgeType),
  );
  const assigned: boolean[][] = facetsPoints.map((points) => points.map(() => false));
  for (let i = 0; i < facetsPoints.length; i++) {
    const points = facetsPoints[i] ?? [];
    for (let k = 0; k < points.length; k++) {
      if (assigned[i]?.[k]) continue;
      const p = points[k] ?? { x: 0, z: 0, elevation: 0 };
      const q = points[(k + 1) % points.length] ?? p;
      const length = Math.hypot(q.x - p.x, q.z - p.z);
      const mark = (type: EdgeType) => {
        if (edgesByFacet[i]) edgesByFacet[i][k] = type;
        if (assigned[i]) assigned[i][k] = true;
      };
      if (length < 0.5) {
        mark("other");
        continue;
      }
      // Shared with another facet? (majority of the segment hugs its polygon)
      let bestFacet = -1;
      let bestFraction = 0;
      for (let j = 0; j < polygons.length; j++) {
        if (j === i) continue;
        const fraction = sharedFraction(p, q, polygons[j] ?? []);
        if (fraction > bestFraction) {
          bestFraction = fraction;
          bestFacet = j;
        }
      }
      if (bestFacet >= 0 && bestFraction >= 0.5) {
        const mid = { x: (p.x + q.x) / 2, z: (p.z + q.z) / 2 };
        const elevP = planeElevation(i, p.x, p.z) ?? p.elevation;
        const elevQ = planeElevation(i, q.x, q.z) ?? q.elevation;
        const segmentSlope = Math.abs(elevQ - elevP) / length;
        const type = classifyShared(i, bestFacet, mid, segmentSlope);
        mark(type);
        // Give the adjoining facet's matching segment the same type so the
        // shared edge is classified identically on both sides.
        const otherPoints = facetsPoints[bestFacet] ?? [];
        let bestSegment = -1;
        let bestScore = -1;
        for (let m = 0; m < otherPoints.length; m++) {
          if (assigned[bestFacet]?.[m]) continue;
          const op = otherPoints[m] ?? { x: 0, z: 0, elevation: 0 };
          const oq = otherPoints[(m + 1) % otherPoints.length] ?? op;
          const oMid = { x: (op.x + oq.x) / 2, z: (op.z + oq.z) / 2 };
          const midDistance = Math.hypot(oMid.x - mid.x, oMid.z - mid.z);
          if (midDistance > Math.max(2, length)) continue;
          const score = sharedFraction(op, oq, polygons[i] ?? []) - midDistance / 100;
          if (score > bestScore) {
            bestScore = score;
            bestSegment = m;
          }
        }
        if (bestSegment >= 0 && edgesByFacet[bestFacet] && assigned[bestFacet]) {
          edgesByFacet[bestFacet][bestSegment] = type;
          assigned[bestFacet][bestSegment] = true;
        }
        continue;
      }
      // Perimeter: eaves run across the downslope, rakes run along it.
      const plane = facetPlanes[i];
      if (!plane) {
        mark("other");
        continue;
      }
      const gradient = Math.hypot(plane.a, plane.b);
      if (gradient * 12 < 0.25) {
        mark("eave");
        continue;
      }
      const alignment = Math.abs(
        ((q.x - p.x) / length) * (-plane.a / gradient) +
          ((q.z - p.z) / length) * (-plane.b / gradient),
      );
      mark(alignment < 0.5 ? "eave" : "rake");
    }
  }

  const planes: RoofPlane[] = projected.map(({ facet }, index) => ({
    id: `lidar-${facet.id}`,
    name: `LiDAR ${facet.id}`,
    points: (facetsPoints[index] ?? []).map((point, pointIndex) => ({
      x: point.x,
      z: point.z,
      y: Math.max(0, (leveledElevations[index]?.[pointIndex] ?? minElevation) - minElevation),
    })),
    edges: edgesByFacet[index] ?? [],
  }));
  return {
    planes,
    penetrations: [],
    waste: 10,
    roof_type: roofType,
    notes:
      "Preliminary roof facets from public USGS 3DEP LiDAR. Edge types (ridge, hip, valley, eave, rake) are classified from facet geometry and are estimates. Verify all facet boundaries, pitch, edge types, and material system before use.",
    condition: "",
    verified: false,
    accuracy: "public_lidar_estimate",
    geo_reference: {
      addressLatitude: originLat,
      addressLongitude: originLon,
      originLatitude: originLat,
      originLongitude: originLon,
    },
  };
}
