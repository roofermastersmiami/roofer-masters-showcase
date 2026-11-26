import { z } from "zod";
import type { RoofDrawing, RoofPlane } from "@/lib/roof-geometry";

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
    candidate_id: z.string().min(1).nullable().optional(),
    parcel_match: z.record(z.string(), z.unknown()).nullable().optional(),
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
    edge_lengths_lf: z.null(),
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
 * All perimeter edges remain "other" until the estimator confirms their roles.
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
  const minElevation = Math.min(...projected.flatMap((facet) => facet.elevations));
  const planes: RoofPlane[] = projected.map(({ facet, points, elevations }) => ({
    id: `lidar-${facet.id}`,
    name: `LiDAR ${facet.id}`,
    points: points.map((point, index) => ({
      x: point.x,
      z: point.z,
      y: Math.max(0, (elevations[index] ?? minElevation) - minElevation),
    })),
    edges: points.map(() => "other" as const),
  }));
  return {
    planes,
    penetrations: [],
    waste: 10,
    roof_type: roofType,
    notes:
      "Preliminary roof facets from public USGS 3DEP LiDAR. Verify all facet boundaries, pitch, edge types, and material system before use.",
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
