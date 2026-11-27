import { z } from "zod";
import polygonClipping from "polygon-clipping";
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
    // True when every facet ring is the service's exact outline
    // partition (see services/roof-detection _drawing_partition):
    // the converter then skips its snap/trim surgery, which exists
    // for legacy hull responses and introduces micro-defects into
    // already exact tilings.
    drawing_ready: z.boolean().optional(),
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

/** Envelope of the asynchronous analyze jobs API (POST /v1/roof/analyze/jobs,
 * GET /v1/roof/analyze/jobs/{id}). A cold-cache analysis can outlast the
 * hosting tier's request window, so the service runs it as a job: submission
 * answers 202 immediately and polling reports progress. A completed job's
 * `result` is the exact payload the synchronous endpoint returns, validated
 * by the same schema above. A failed job carries the pipeline's own
 * rejection (`error_status` / `error_detail`, e.g. a building-candidate
 * list) so every existing flow keeps working. A job lost to a service
 * restart answers 404 instead of an envelope — job state is in-memory —
 * and the caller resubmits automatically.
 */
export const roofAnalysisJobSchema = z.object({
  job_id: z.string().min(1),
  status: z.enum(["queued", "running", "complete", "failed"]),
  stage: z.string().nullable().optional(),
  detail: z.string().nullable().optional(),
  download_fraction: z.number().min(0).max(1).nullable().optional(),
  elapsed_seconds: z.number().nonnegative().optional(),
  result: roofDetectionResponseSchema.optional(),
  error: z.string().nullable().optional(),
  error_status: z.number().int().nullable().optional(),
  error_detail: z.unknown().optional(),
});

export type RoofAnalysisJob = z.infer<typeof roofAnalysisJobSchema>;

type PlanVertex = { x: number; z: number; elevation: number };

const planDistance = (a: { x: number; z: number }, b: { x: number; z: number }) =>
  Math.hypot(a.x - b.x, a.z - b.z);

function pointToSegmentDistance(
  point: { x: number; z: number },
  a: { x: number; z: number },
  b: { x: number; z: number },
): { distance: number; t: number } {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const lengthSq = dx * dx + dz * dz;
  const t =
    lengthSq <= 1e-12
      ? 0
      : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.z - a.z) * dz) / lengthSq));
  return {
    distance: Math.hypot(point.x - (a.x + t * dx), point.z - (a.z + t * dz)),
    t,
  };
}

/** Douglas-Peucker simplification of an open chain, endpoints pinned. */
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
  const drawingReady = result.roof.drawing_ready === true;
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
  // physical corner so shared edges share endpoints and are counted
  // once. The detection service already conflates true junction
  // vertices to exact coincidence before emission, so what remains for
  // this snap is emission round-trip noise (centimetres). The
  // tolerance is therefore small: at the previous 1.0 ft, seam vertices
  // the two facets placed independently along a shared edge — a hull
  // vertex of one facet sitting near a chord endpoint of the other —
  // were pulled to common centroids all along the seam, braiding the
  // two boundaries around each other and enclosing whole regions
  // between them (Maria's largest facet lost 90 sf to the resulting
  // plan-overlap trim). Vertices are clustered across facets and each
  // cluster moves to its centroid in a single pass: the previous
  // pairwise midpoint walk was order-dependent — a vertex near two
  // corners of a neighbouring facet was pulled twice, to two different
  // midpoints, which could fold a dense ring onto itself. Clusters are
  // diameter-capped (two clusters merge only when every cross pair
  // stays within the tolerance, pairs considered closest-first): plain
  // transitive clustering chains along a shared seam whose vertices sit
  // within reach of each other and collapses the seam onto one point.
  const SNAP_TOLERANCE_FT = 0.15;
  // Drawing-ready (partition) geometry is already conflated and
  // tiled exactly; snapping it again only folds small facets and
  // shifts shared vertices into their neighbours.
  if (!drawingReady) {
    const vertexRefs: { facet: number; index: number }[] = [];
    facetsPoints.forEach((points, facet) =>
      points.forEach((_, index) => vertexRefs.push({ facet, index })),
    );
    const clusterParent = vertexRefs.map((_, index) => index);
    const clusterMembers = new Map<number, number[]>(
      vertexRefs.map((_, index) => [index, [index]]),
    );
    const findCluster = (index: number): number => {
      let root = index;
      while (clusterParent[root] !== root) root = clusterParent[root] ?? root;
      let current = index;
      while (clusterParent[current] !== root) {
        const next = clusterParent[current] ?? root;
        clusterParent[current] = root;
        current = next;
      }
      return root;
    };
    const pointOf = (refIndex: number) => {
      const ref = vertexRefs[refIndex];
      return ref ? facetsPoints[ref.facet]?.[ref.index] : undefined;
    };
    const snapPairs: { distance: number; a: number; b: number }[] = [];
    for (let a = 0; a < vertexRefs.length; a++)
      for (let b = a + 1; b < vertexRefs.length; b++) {
        const refA = vertexRefs[a];
        const refB = vertexRefs[b];
        if (!refA || !refB || refA.facet === refB.facet) continue;
        const p = pointOf(a);
        const q = pointOf(b);
        if (!p || !q) continue;
        const distance = Math.hypot(p.x - q.x, p.z - q.z);
        if (distance <= SNAP_TOLERANCE_FT) snapPairs.push({ distance, a, b });
      }
    snapPairs.sort((left, right) => left.distance - right.distance);
    for (const { a, b } of snapPairs) {
      const rootA = findCluster(a);
      const rootB = findCluster(b);
      if (rootA === rootB) continue;
      const membersA = clusterMembers.get(rootA) ?? [a];
      const membersB = clusterMembers.get(rootB) ?? [b];
      let withinCap = true;
      for (const memberA of membersA) {
        const p = pointOf(memberA);
        if (!p) continue;
        for (const memberB of membersB) {
          const q = pointOf(memberB);
          if (!q) continue;
          if (Math.hypot(p.x - q.x, p.z - q.z) > SNAP_TOLERANCE_FT) {
            withinCap = false;
            break;
          }
        }
        if (!withinCap) break;
      }
      if (!withinCap) continue;
      clusterParent[rootA] = rootB;
      clusterMembers.set(rootB, [...membersA, ...membersB]);
      clusterMembers.delete(rootA);
    }
    const clusters = new Map<number, { facet: number; index: number }[]>();
    vertexRefs.forEach((ref, index) => {
      const root = findCluster(index);
      const members = clusters.get(root) ?? [];
      members.push(ref);
      clusters.set(root, members);
    });
    for (const members of clusters.values()) {
      if (members.length < 2) continue;
      let centroidX = 0;
      let centroidZ = 0;
      for (const member of members) {
        const point = facetsPoints[member.facet]?.[member.index];
        if (!point) continue;
        centroidX += point.x;
        centroidZ += point.z;
      }
      centroidX /= members.length;
      centroidZ /= members.length;
      for (const member of members) {
        const point = facetsPoints[member.facet]?.[member.index];
        if (!point) continue;
        point.x = centroidX;
        point.z = centroidZ;
      }
    }
  }
  // Snapping can collapse consecutive vertices; drop those duplicates,
  // including a closing vertex that now duplicates the ring's first.
  for (let i = 0; i < facetsPoints.length; i++) {
    const points = facetsPoints[i] ?? [];
    const deduped: LocalPoint[] = [];
    for (const point of points) {
      const previous = deduped[deduped.length - 1];
      if (!previous || Math.hypot(point.x - previous.x, point.z - previous.z) > 0.01)
        deduped.push(point);
    }
    if (deduped.length > 1) {
      const first = deduped[0];
      const last = deduped[deduped.length - 1];
      if (first && last && Math.hypot(first.x - last.x, first.z - last.z) <= 0.01) deduped.pop();
    }
    if (deduped.length < 3)
      throw new Error(`Facet ${projected[i]?.facet.id ?? i} has too few unique boundary points.`);
    facetsPoints[i] = deduped;
  }

  // The service emits drawing-ready geometry: facet rings are an
  // exact partition of the roof outline with straight shared seams
  // (see services/roof-detection). The converter therefore does NOT
  // restyle rings — an earlier chain-rebuilding cleanup stage could
  // scramble small facets whose vertices are all junctions (Miramar
  // facet-7 came out self-crossing), and with partition geometry it
  // has nothing left to fix. The snap + dedupe above and the
  // plan-trim below remain as safety nets for legacy responses.

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

  // Even with junction vertices conflated at the service, a facet's
  // edge can still cross a neighbour's by a sliver in this frame, and
  // measureDrawing rejects plan overlaps above 0.1 sf. Enforce the
  // invariant here, in the frame it is checked in: largest facet
  // first, each later facet's ring is trimmed against the rings
  // already accepted when they overlap by more than a sliver. The
  // trim never amputates: when a subtraction would split the facet
  // and discard real territory (a neighbour's boundary weaving across
  // a narrow neck of this facet), it falls back to subtracting only
  // the overlap region itself, and if that would amputate too, the
  // ring is left as it is rather than silently losing area.
  // Drawing-ready geometry skips the trim as well: its overlaps in
  // this frame are already under the service's repair threshold, and
  // trimming exact tilings is what produced junction spikes.
  if (!drawingReady) {
    const ringOf = (points: LocalPoint[]) => {
      const ring = points.map((p) => [p.x, p.z] as [number, number]);
      const first = ring[0];
      return first ? [...ring, first] : ring;
    };
    const ringArea = (r: [number, number][]) => {
      let area = 0;
      for (let i = 0; i < r.length; i++) {
        const a = r[i]!;
        const b = r[(i + 1) % r.length]!;
        area += a[0] * b[1] - b[0] * a[1];
      }
      return Math.abs(area) / 2;
    };
    const order = facetsPoints
      .map((points, index) => ({ index, area: ringArea(ringOf(points)) }))
      .sort((a, b) => b.area - a.area);
    const acceptedRings: [number, number][][] = [];
    for (const { index } of order) {
      const points = facetsPoints[index] ?? [];
      let ring = ringOf(points);
      const originalArea = ringArea(ring);
      let changed = false;
      for (const accepted of acceptedRings) {
        const intersection: [number, number][][][] = polygonClipping.intersection(
          [[ring]],
          [[accepted]],
        );
        const overlap = intersection.reduce(
          (sum: number, poly: [number, number][][]) => sum + ringArea(poly[0] ?? []),
          0,
        );
        if (overlap <= 0.08) continue;
        // Choose a trimmed ring from a difference result, or nothing
        // when keeping only its largest piece would discard more than
        // a sliver of the facet.
        const chooseTrim = (parts: [number, number][][][]) => {
          let largest: [number, number][] | undefined;
          let largestArea = 0;
          let totalArea = 0;
          for (const part of parts) {
            const outer = part[0];
            if (!outer) continue;
            const area = ringArea(outer);
            totalArea += area;
            if (area > largestArea) {
              largestArea = area;
              largest = outer;
            }
          }
          if (!largest || totalArea - largestArea > 0.02 * originalArea) return undefined;
          return largest;
        };
        let trimmed = chooseTrim(polygonClipping.difference([[ring]], [[accepted]]));
        if (!trimmed) trimmed = chooseTrim(polygonClipping.difference([[ring]], intersection));
        if (!trimmed) continue;
        ring = trimmed;
        changed = true;
      }
      acceptedRings.push(ring);
      if (changed) {
        const trimmed = ring.slice(0, -1).map(([x, z]) => ({
          x,
          z,
          elevation: planeElevation(index, x, z) ?? 0,
        }));
        if (trimmed.length >= 3) {
          facetsPoints[index] = trimmed;
          leveledElevations[index] = trimmed.map((point) => point.elevation);
        }
      }
    }
  }

  // Split rings at T-junctions. A tiling has them wherever a small
  // facet's corner lands in the middle of a neighbour's long seam:
  // one side carries the corner as a vertex, the other side runs
  // straight past it. measureDrawing pairs shared segments by their
  // endpoints, so an unsplit seam cannot pair — it is counted twice
  // (once per side) and classified independently per side, which
  // doubled Miramar's drawing-side hip/valley totals. Inserting the
  // corner vertex into the straight side gives both sides the same
  // segmentation; classification and reconciliation below then see
  // matched pairs.
  {
    const T_TOLERANCE_FT = 0.05;
    const planDistance = (a: PlanVertex, b: PlanVertex) => Math.hypot(a.x - b.x, a.z - b.z);
    for (let i = 0; i < facetsPoints.length; i++) {
      const ring = facetsPoints[i]!;
      const elevations = leveledElevations[i]!;
      const rebuilt: PlanVertex[] = [];
      const rebuiltElevations: number[] = [];
      for (let s = 0; s < ring.length; s++) {
        const a = ring[s]!;
        const b = ring[(s + 1) % ring.length]!;
        rebuilt.push(a);
        rebuiltElevations.push(elevations[s]!);
        const hits: { t: number; point: PlanVertex; elevation: number }[] = [];
        for (let j = 0; j < facetsPoints.length; j++) {
          if (j === i) continue;
          const other = facetsPoints[j]!;
          for (let k = 0; k < other.length; k++) {
            const v = other[k]!;
            if (planDistance(v, a) <= T_TOLERANCE_FT || planDistance(v, b) <= T_TOLERANCE_FT)
              continue;
            // A neighbour vertex landing within 0.1 ft of ANY of the
            // host ring's own vertices is the same physical junction
            // the host already carries (partition corners can smear
            // over ~0.07 ft): inserting it would saw the host's
            // corner into a self-crossing zigzag (Miramar facet-5).
            // The seam still pairs in measureDrawing — the existing
            // corner is within its plan tolerance of the neighbour's.
            if (ring.some((w) => planDistance(v, w) <= 0.1)) continue;
            const dx = b.x - a.x;
            const dz = b.z - a.z;
            const lengthSq = dx * dx + dz * dz;
            if (lengthSq <= 1e-12) continue;
            const t = ((v.x - a.x) * dx + (v.z - a.z) * dz) / lengthSq;
            if (t <= 0 || t >= 1) continue;
            const px = a.x + t * dx;
            const pz = a.z + t * dz;
            if (Math.hypot(v.x - px, v.z - pz) > T_TOLERANCE_FT) continue;
            if (ring.some((w) => Math.hypot(px - w.x, pz - w.z) <= 0.1)) continue;
            // Insert the neighbour vertex's PROJECTION onto the host
            // segment, not the vertex itself: the vertex can sit up
            // to the tolerance off the segment, and inserting it
            // verbatim would bend the host edge into a thin wedge
            // overlapping the neighbour (measureDrawing rejects plan
            // overlaps over 0.1 sf). The projection keeps the host
            // ring exactly on its own geometry; the residual
            // endpoint mismatch against the neighbour's copy stays
            // within the plan matching tolerance. The elevation is
            // the HOST facet's plane at the projected point
            // (measureDrawing checks planarity to 0.02 ft; the two
            // planes disagree by centimetres at a junction, which is
            // exactly why shared-segment matching is done in plan).
            hits.push({
              t,
              point: { x: px, z: pz, elevation: 0 },
              elevation: planeElevation(i, px, pz) ?? v.elevation,
            });
          }
        }
        hits.sort((h1, h2) => h1.t - h2.t);
        for (const hit of hits) {
          const last = rebuilt[rebuilt.length - 1]!;
          if (planDistance(hit.point, last) <= T_TOLERANCE_FT) continue;
          rebuilt.push({
            x: hit.point.x,
            z: hit.point.z,
            elevation: hit.elevation,
          });
          rebuiltElevations.push(hit.elevation);
        }
      }
      if (rebuilt.length > ring.length) {
        facetsPoints[i] = rebuilt;
        leveledElevations[i] = rebuiltElevations;
      }
    }
  }
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
  const classifyShared = (i: number, j: number, mid: Pt2, segmentSlope: number): EdgeType => {
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

  // Reconcile shared-edge classifications. measureDrawing matches a
  // shared segment across facets by its endpoints (0.05 ft, 3D) and
  // requires both sides to carry the same type, but the per-segment
  // classification above is not symmetric: the ridge/hip slope test
  // reads the classifying facet's own plane, and the type-propagation
  // heuristic can bind a neighbouring segment that was already
  // assigned. Miramar shipped a seam called hip from one side and
  // valley from the other; Francisco a seam called ridge from one side
  // and hip from the other. For every endpoint-matched pair that
  // disagrees, re-run the chord test once with symmetric inputs (the
  // steeper of the two planes' slopes along the segment) and give both
  // sides the result.
  {
    type SegRef = { facet: number; index: number };
    const segPoint = (ref: SegRef, end: 0 | 1) => {
      const points = facetsPoints[ref.facet] ?? [];
      const pointIndex = (ref.index + end) % points.length;
      const point = points[pointIndex];
      return point
        ? {
            x: point.x,
            z: point.z,
            y: leveledElevations[ref.facet]?.[pointIndex] ?? point.elevation,
          }
        : null;
    };
    // Plan distance: the two sides of a seam share (x, z) exactly but
    // their elevations sit on different fitted planes and disagree by
    // centimetres at junctions, so 3D matching would miss the pair —
    // the same reason measureDrawing matches segments in plan.
    const segDistance = (
      a: { x: number; y: number; z: number } | null,
      b: { x: number; y: number; z: number } | null,
    ) => (a && b ? Math.hypot(a.x - b.x, a.z - b.z) : Infinity);
    const refs: SegRef[] = [];
    facetsPoints.forEach((points, facet) =>
      points.forEach((_, index) => refs.push({ facet, index })),
    );
    for (let a = 0; a < refs.length; a++) {
      for (let b = a + 1; b < refs.length; b++) {
        const refA = refs[a]!;
        const refB = refs[b]!;
        if (refA.facet === refB.facet) continue;
        const typeA = edgesByFacet[refA.facet]?.[refA.index];
        const typeB = edgesByFacet[refB.facet]?.[refB.index];
        if (!typeA || !typeB || typeA === typeB) continue;
        const a0 = segPoint(refA, 0);
        const a1 = segPoint(refA, 1);
        const b0 = segPoint(refB, 0);
        const b1 = segPoint(refB, 1);
        const same =
          (segDistance(a0, b0) <= 0.05 && segDistance(a1, b1) <= 0.05) ||
          (segDistance(a0, b1) <= 0.05 && segDistance(a1, b0) <= 0.05);
        if (!same || !a0 || !a1) continue;
        const length = Math.hypot(a1.x - a0.x, a1.z - a0.z);
        if (length < 1e-6) continue;
        const slopeOf = (facet: number) =>
          Math.abs(
            (planeElevation(facet, a1.x, a1.z) ?? 0) - (planeElevation(facet, a0.x, a0.z) ?? 0),
          ) / length;
        const mid = { x: (a0.x + a1.x) / 2, z: (a0.z + a1.z) / 2 };
        let unified = classifyShared(
          refA.facet,
          refB.facet,
          mid,
          Math.max(slopeOf(refA.facet), slopeOf(refB.facet)),
        );
        if (unified === "other" && (typeA === "other") !== (typeB === "other"))
          unified = typeA === "other" ? typeB : typeA;
        if (edgesByFacet[refA.facet]) edgesByFacet[refA.facet]![refA.index] = unified;
        if (edgesByFacet[refB.facet]) edgesByFacet[refB.facet]![refB.index] = unified;
      }
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
