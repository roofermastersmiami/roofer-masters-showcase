import { describe, expect, it } from "vitest";
import { measureDrawing } from "@/lib/roof-geometry";
import {
  detectedFacetsToDrawing,
  roofAnalysisJobSchema,
  roofDetectionResponseSchema,
  type RoofDetectionResponse,
} from "@/lib/roof-detection";

const response: RoofDetectionResponse = {
  status: "lidar_facets",
  verification: "unverified_public_data",
  matched_address: "100 Main Street",
  location: { lat: 25.47, lon: -80.48 },
  lidar: {
    source: "Microsoft Planetary Computer / USGS 3DEP COPC",
    stac_items: 3,
    tiles_used: 2,
    tile_ids_used: ["USGS_LPC_FL_South_2020_19R_1234", "USGS_LPC_FL_South_2020_19R_1235"],
    building_class_points: 420,
    raw_building_class_points: 450,
    duplicate_points_removed: 30,
  },
  footprint: {
    source: "OpenStreetMap",
    area_sqft: 1200,
    polygon_geojson: {
      type: "Polygon",
      coordinates: [
        [
          [-80.4801, 25.4699],
          [-80.4799, 25.4699],
          [-80.4799, 25.4701],
          [-80.4801, 25.4701],
          [-80.4801, 25.4699],
        ],
      ],
    },
  },
  roof: {
    facet_count: 1,
    area_sqft: 1200,
    total_squares: 12,
    dominant_pitch_rise_per_12: 6,
    edge_lengths_lf: null,
    facets: [
      {
        id: "facet-1",
        point_count: 200,
        pitch_degrees: 26.57,
        pitch_rise_per_12: 6,
        azimuth_degrees: 180,
        area_sqft: 1200,
        squares: 12,
        boundary_latlon: [
          [25.4699, -80.4801, 10],
          [25.4699, -80.4799, 11],
          [25.4701, -80.4799, 12],
          [25.4701, -80.4801, 11],
          [25.4699, -80.4801, 10],
        ],
      },
    ],
  },
  fallback: {
    available: false,
    mode: null,
    footprint_area_sqft: 1200,
    message: null,
  },
  disclaimer: "Preliminary public-data result.",
};

describe("LiDAR facet roof-system selection", () => {
  it.each(["Metal Roof", "Shingle Roof", "Tile Roof", "TPO", "Flat Roof"] as const)(
    "preserves the estimator-selected %s system",
    (roofType) => {
      const drawing = detectedFacetsToDrawing(response, roofType);
      expect(drawing.roof_type).toBe(roofType);
      expect(drawing.verified).toBe(false);
      expect(drawing.accuracy).toBe("public_lidar_estimate");
      expect(drawing.planes).toHaveLength(1);
      // A lone facet's perimeter is classified from its slope: eaves run
      // across the downslope, rakes along it. Nothing stays "other".
      expect(drawing.planes[0]?.edges.every((edge) => edge === "eave" || edge === "rake")).toBe(
        true,
      );
    },
  );
});

describe("LiDAR geometry measurement parity", () => {
  it("reconstructs backend facet surface area and pitch from geographic boundary elevations", () => {
    const lat = response.location.lat;
    const lon = response.location.lon;
    const latOffset = 5 / 110540;
    const lonOffset = 5 / (111320 * Math.cos((lat * Math.PI) / 180));
    const areaSqFt = (100 / Math.cos(Math.atan(0.5))) * 10.7639104167;
    const fixture: RoofDetectionResponse = {
      ...response,
      roof: {
        ...response.roof,
        area_sqft: areaSqFt,
        total_squares: areaSqFt / 100,
        facets: [
          {
            ...response.roof.facets[0]!,
            pitch_degrees: 26.565051,
            pitch_rise_per_12: 6,
            area_sqft: areaSqFt,
            squares: areaSqFt / 100,
            plane_model: { z_equals_ax_plus_by_plus_c: [0.5, 0, 10] },
            boundary_latlon: [
              [lat - latOffset, lon - lonOffset, 7.5],
              [lat - latOffset, lon + lonOffset, 12.5],
              [lat + latOffset, lon + lonOffset, 12.5],
              [lat + latOffset, lon - lonOffset, 7.5],
              [lat - latOffset, lon - lonOffset, 7.5],
            ],
          },
        ],
      },
    };

    const drawing = detectedFacetsToDrawing(fixture, "Metal Roof");
    const measured = measureDrawing(drawing).planes[0];

    expect(measured).toBeDefined();
    expect(measured!.pitch).toBeCloseTo(6, 1);
    expect(measured!.area).toBeCloseTo(areaSqFt, 0);
  });
});

describe("LiDAR source-data evidence", () => {
  it("validates point and tile counts returned by the public-data service", () => {
    const parsed = roofDetectionResponseSchema.parse(response);
    expect(parsed.lidar?.building_class_points).toBe(420);
    expect(parsed.lidar?.tiles_used).toBe(2);
    expect(parsed.lidar?.tile_ids_used).toEqual([
      "USGS_LPC_FL_South_2020_19R_1234",
      "USGS_LPC_FL_South_2020_19R_1235",
    ]);
    expect(parsed.lidar?.duplicate_points_removed).toBe(30);
    expect(parsed.roof.facets[0]?.point_count).toBe(200);
  });

  it("rejects facets when the fitted elevation plane disagrees with reported pitch", () => {
    const inconsistent = {
      ...response,
      roof: {
        ...response.roof,
        facets: response.roof.facets.map((facet) => ({
          ...facet,
          plane_model: { z_equals_ax_plus_by_plus_c: [1.0, 0, 10] },
        })),
      },
    };
    expect(() => detectedFacetsToDrawing(inconsistent, "Metal Roof")).toThrow(
      /inconsistent elevation and pitch data/,
    );
  });

  it("accepts consistent fitted-plane pitch metadata", () => {
    const consistent = {
      ...response,
      roof: {
        ...response.roof,
        facets: response.roof.facets.map((facet) => ({
          ...facet,
          plane_model: { z_equals_ax_plus_by_plus_c: [0.5, 0, 10] },
        })),
      },
    };
    expect(() => detectedFacetsToDrawing(consistent, "Metal Roof")).not.toThrow();
  });

  it("accepts legacy responses without LiDAR metadata", () => {
    const { lidar: _lidar, ...legacyResponse } = response;
    const parsed = roofDetectionResponseSchema.parse(legacyResponse);
    expect(parsed.lidar).toBeUndefined();
  });
});

describe("LiDAR address-to-footprint confidence metadata", () => {
  it("preserves the outside-footprint warning and metric distance from the service", () => {
    const parsed = roofDetectionResponseSchema.parse({
      ...response,
      footprint: {
        ...response.footprint,
        address_point_inside_footprint: false,
        address_to_footprint_distance_m: 3.4,
      },
    });
    expect(parsed.footprint.address_point_inside_footprint).toBe(false);
    expect(parsed.footprint.address_to_footprint_distance_m).toBe(3.4);
  });

  it("remains compatible with earlier service responses without match metadata", () => {
    const parsed = roofDetectionResponseSchema.parse(response);
    expect(parsed.footprint.address_point_inside_footprint).toBeUndefined();
    expect(parsed.footprint.address_to_footprint_distance_m).toBeUndefined();
  });
});

describe("LiDAR edge classification for automatic reports", () => {
  const origin = response.location;
  const lonScale = 111320 * Math.cos((origin.lat * Math.PI) / 180) * (1 / 0.3048);
  const latScale = 110540 * (1 / 0.3048);
  // Build a boundary ring from local feet (x east, z south of origin) + elevation meters.
  const ring = (points: [number, number, number][]) =>
    points.map(([x, z, elevation]) => [
      origin.lat - z / latScale,
      origin.lon + x / lonScale,
      elevation,
    ]) as [number, number, number][];
  const facet = (id: string, pitchRise: number, points: [number, number, number][]) => ({
    id,
    point_count: 500,
    pitch_degrees: (Math.atan(pitchRise / 12) * 180) / Math.PI,
    pitch_rise_per_12: pitchRise,
    azimuth_degrees: 180,
    area_sqft: 600,
    squares: 6,
    boundary_latlon: ring([...points, points[0]!]),
  });
  const makeResponse = (facets: ReturnType<typeof facet>[]): RoofDetectionResponse => ({
    ...response,
    roof: {
      ...response.roof,
      facet_count: facets.length,
      facets: facets as RoofDetectionResponse["roof"]["facets"],
    },
  });
  const EAVE_M = 10;
  const RIDGE_M = 12.286; // 7.5 ft above the eave over a 15 ft run = 6/12

  it("classifies a gable roof's ridge, eaves, and rakes", () => {
    const drawing = detectedFacetsToDrawing(
      makeResponse([
        facet("facet-1", 6, [
          [0, 0, EAVE_M],
          [40, 0, EAVE_M],
          [40, 15, RIDGE_M],
          [0, 15, RIDGE_M],
        ]),
        facet("facet-2", 6, [
          [0, 15, RIDGE_M],
          [40, 15, RIDGE_M],
          [40, 30, EAVE_M],
          [0, 30, EAVE_M],
        ]),
      ]),
      "Metal Roof",
    );
    const edges = measureDrawing(drawing).edges;
    expect(edges.ridge).toBeCloseTo(40, 0);
    expect(edges.eave).toBeCloseTo(80, 0);
    expect(edges.rake).toBeCloseTo(4 * Math.hypot(15, 7.5), 0);
    expect(edges.hip).toBe(0);
    expect(edges.valley).toBe(0);
    expect(edges.other).toBe(0);
  });

  it("trusts drawing_ready geometry: no snap surgery on flagged responses", () => {
    // Two gable facets whose shared ridge vertices disagree by 0.1 ft
    // (inside the legacy snap tolerance). Unflagged responses get the
    // snap (both sides move to the centroid); a drawing_ready
    // response is an exact service-side partition, so the converter
    // must leave every vertex exactly where the service put it.
    const facets = () => [
      facet("facet-1", 6, [
        [0, 0, EAVE_M],
        [40, 0, EAVE_M],
        [40, 15, RIDGE_M],
        [0, 15, RIDGE_M],
      ]),
      facet("facet-2", 6, [
        [0.1, 15, RIDGE_M],
        [40.1, 15, RIDGE_M],
        [40, 30, EAVE_M],
        [0, 30, EAVE_M],
      ]),
    ];
    const ridgeStartX = (drawing: ReturnType<typeof detectedFacetsToDrawing>) => {
      const plane = drawing.planes.find((p) => p.id === "lidar-facet-2")!;
      return Math.min(...plane.points.filter((p) => Math.abs(p.z - 15) < 0.01).map((p) => p.x));
    };
    const legacy = detectedFacetsToDrawing(makeResponse(facets()), "Metal Roof");
    expect(ridgeStartX(legacy)).toBeCloseTo(0.05, 1);
    const flagged: RoofDetectionResponse = {
      ...makeResponse(facets()),
      roof: { ...makeResponse(facets()).roof, drawing_ready: true },
    };
    const trusted = detectedFacetsToDrawing(flagged, "Metal Roof");
    expect(ridgeStartX(trusted)).toBeCloseTo(0.1, 1);
  });

  it("classifies the trough between two opposing slopes as a valley", () => {
    const drawing = detectedFacetsToDrawing(
      makeResponse([
        facet("facet-1", 2.25, [
          [0, 0, RIDGE_M],
          [40, 0, EAVE_M],
          [40, 30, EAVE_M],
          [0, 30, RIDGE_M],
        ]),
        facet("facet-2", 2.25, [
          [40, 0, EAVE_M],
          [80, 0, RIDGE_M],
          [80, 30, RIDGE_M],
          [40, 30, EAVE_M],
        ]),
      ]),
      "Shingle Roof",
    );
    const edges = measureDrawing(drawing).edges;
    expect(edges.valley).toBeCloseTo(30, 0);
    expect(edges.ridge).toBe(0);
    expect(edges.hip).toBe(0);
  });

  it("snaps offset hull endpoints so a shared ridge is counted once", () => {
    const drawing = detectedFacetsToDrawing(
      makeResponse([
        facet("facet-1", 6, [
          [0, 0, EAVE_M],
          [40, 0, EAVE_M],
          [40, 15, RIDGE_M],
          [0, 15, RIDGE_M],
        ]),
        // Second hull's ridge line sits 0.1 ft off the first facet's —
        // the centimetre-scale residue the emission round-trip leaves
        // between two copies of a junction the service already
        // conflated. (The snap tolerance is deliberately this small:
        // at the old 1 ft it braided independently placed seam
        // vertices of neighbouring facets around each other.)
        facet("facet-2", 6.25, [
          [0, 15.1, RIDGE_M],
          [40, 15.1, RIDGE_M],
          [40, 30, EAVE_M],
          [0, 30, EAVE_M],
        ]),
      ]),
      "Metal Roof",
    );
    const edges = measureDrawing(drawing).edges;
    expect(edges.ridge).toBeCloseTo(40, 0);
    expect(edges.eave).toBeCloseTo(80, 0);
    expect(edges.other).toBe(0);
  });
});

describe("LiDAR converter vertex snap robustness", () => {
  const origin = response.location;
  const lonScale = 111320 * Math.cos((origin.lat * Math.PI) / 180) * (1 / 0.3048);
  const latScale = 110540 * (1 / 0.3048);
  const ring = (points: [number, number, number][]) =>
    points.map(([x, z, elevation]) => [
      origin.lat - z / latScale,
      origin.lon + x / lonScale,
      elevation,
    ]) as [number, number, number][];
  const facet = (id: string, points: [number, number, number][]) => ({
    id,
    point_count: 500,
    pitch_degrees: (Math.atan(6 / 12) * 180) / Math.PI,
    pitch_rise_per_12: 6,
    azimuth_degrees: 180,
    area_sqft: 600,
    squares: 6,
    boundary_latlon: ring([...points, points[0]!]),
  });
  const makeResponse = (facets: ReturnType<typeof facet>[]): RoofDetectionResponse => ({
    ...response,
    roof: {
      ...response.roof,
      facet_count: facets.length,
      facets: facets as RoofDetectionResponse["roof"]["facets"],
    },
  });
  // One plane for both facets: elevation (meters) rises 6/12 with z (ft).
  const elev = (z: number) => 10 + 2.286 * (z / 15);

  it("conflates a vertex bracketed by two vertices of the neighbouring facet to one shared point", () => {
    // Facet A's seam vertex at (30.05, 10.02) sits within the snap
    // tolerance of TWO seam vertices of facet B, (30, 9.95) and
    // (30, 10.09), which are 0.14 ft apart. A sequential midpoint snap
    // pulled A's vertex twice, leaving the three vertices at two
    // different positions and the seam unshared; cluster conflation
    // must land all three on exactly the same point.
    const drawing = detectedFacetsToDrawing(
      makeResponse([
        facet("facet-1", [
          [0, 0, elev(0)],
          [30, 0, elev(0)],
          [30.05, 10.02, elev(10.02)],
          [30, 20, elev(20)],
          [0, 20, elev(20)],
        ]),
        facet("facet-2", [
          [30, 0, elev(0)],
          [60, 0, elev(0)],
          [60, 20, elev(20)],
          [30, 20, elev(20)],
          [30, 10.09, elev(10.09)],
          [30, 9.95, elev(9.95)],
        ]),
      ]),
      "Metal Roof",
    );
    // Step 8: the two facets are halves of ONE plane (elevation is a
    // function of z alone), so drawing consolidation merges them
    // into a single plane and the seam — bracketed vertices and all —
    // disappears from the outline entirely instead of braiding the
    // three near-coincident vertices around each other. (Seams
    // between DIFFERENT planes still exercise the snap; see the
    // edge-classification tests above.)
    expect(drawing.planes).toHaveLength(1);
    const merged = drawing.planes[0]!;
    const seamResidue = merged.points.filter(
      (point) => Math.abs(point.x - 30.02) < 0.5 && Math.abs(point.z - 10.02) < 0.5,
    );
    expect(seamResidue).toHaveLength(0);
    expect(merged.points.length).toBeLessThanOrEqual(8);
    // And the resulting drawing measures cleanly (no plan overlap).
    const measured = measureDrawing(drawing);
    const total = measured.planes.reduce((sum, plane) => sum + plane.area, 0);
    expect(total).toBeGreaterThan(1250);
    expect(total).toBeLessThan(1450);
  });
});

describe("Async analyze job envelope", () => {
  it("accepts a completed job whose result is a full detection response", () => {
    const parsed = roofAnalysisJobSchema.parse({
      job_id: "abc123",
      status: "complete",
      stage: "complete",
      detail: "Measurement complete",
      download_fraction: null,
      elapsed_seconds: 812.4,
      result: response,
    });
    expect(parsed.status).toBe("complete");
    expect(parsed.result?.roof.area_sqft).toBe(response.roof.area_sqft);
  });

  it("accepts a running job with download progress and no result yet", () => {
    const parsed = roofAnalysisJobSchema.parse({
      job_id: "abc123",
      status: "running",
      stage: "downloading_tiles",
      detail: "Downloading USGS LiDAR tiles — 42 MB of 178 MB",
      download_fraction: 0.24,
    });
    expect(parsed.result).toBeUndefined();
    expect(parsed.download_fraction).toBeCloseTo(0.24);
  });

  it("accepts a failed job carrying the pipeline rejection detail", () => {
    const parsed = roofAnalysisJobSchema.parse({
      job_id: "abc123",
      status: "failed",
      stage: "failed",
      error: "Analysis request was rejected.",
      error_status: 409,
      error_detail: { candidates: [{ candidate_id: "abc12345" }], message: "pick one" },
    });
    expect(parsed.error_status).toBe(409);
  });

  it("rejects a completed job whose result is not a valid detection response", () => {
    expect(() =>
      roofAnalysisJobSchema.parse({
        job_id: "abc123",
        status: "complete",
        result: { status: "lidar_facets" },
      }),
    ).toThrow();
  });
});

describe("LiDAR drawing consolidation (step 8)", () => {
  const origin = response.location;
  const lonScale = 111320 * Math.cos((origin.lat * Math.PI) / 180) * (1 / 0.3048);
  const latScale = 110540 * (1 / 0.3048);
  const ring = (points: [number, number, number][]) =>
    points.map(([x, z, elevation]) => [
      origin.lat - z / latScale,
      origin.lon + x / lonScale,
      elevation,
    ]) as [number, number, number][];
  const facet = (id: string, points: [number, number, number][]) => ({
    id,
    point_count: 500,
    pitch_degrees: (Math.atan(6 / 12) * 180) / Math.PI,
    pitch_rise_per_12: 6,
    azimuth_degrees: 180,
    area_sqft: 600,
    squares: 6,
    boundary_latlon: ring([...points, points[0]!]),
  });
  const makeReady = (
    facets: ReturnType<typeof facet>[],
    extra: Partial<RoofDetectionResponse["roof"]> = {},
    footprint: RoofDetectionResponse["footprint"] = response.footprint,
  ): RoofDetectionResponse => ({
    ...response,
    footprint,
    roof: {
      ...response.roof,
      facet_count: facets.length,
      facets: facets as RoofDetectionResponse["roof"]["facets"],
      drawing_ready: true,
      ...extra,
    },
  });
  const EAVE_M = 10;
  const RIDGE_M = 12.286; // 6/12 over a 15 ft run

  it("merges coplanar fragments of one fitted plane into a single drawing plane", () => {
    // The service's outline partition split Miramar's 5.64/12 plane
    // into facets carrying byte-identical plane models; drawn as
    // separate polygons their mutual seams scribbled across one face.
    // Two halves of one slope must become one plane, while the
    // opposing slope across the ridge stays its own plane.
    const drawing = detectedFacetsToDrawing(
      makeReady([
        facet("facet-a", [
          [0, 0, EAVE_M],
          [20, 0, EAVE_M],
          [20, 15, RIDGE_M],
          [0, 15, RIDGE_M],
        ]),
        facet("facet-b", [
          [20, 0, EAVE_M],
          [40, 0, EAVE_M],
          [40, 15, RIDGE_M],
          [20, 15, RIDGE_M],
        ]),
        facet("facet-c", [
          [0, 15, RIDGE_M],
          [40, 15, RIDGE_M],
          [40, 30, EAVE_M],
          [0, 30, EAVE_M],
        ]),
      ]),
      "Tile Roof",
    );
    expect(drawing.planes).toHaveLength(2);
    const measured = measureDrawing(drawing);
    // The fake seam between the fragments is gone: the ridge is the
    // only interior edge and nothing is left unclassified.
    expect(measured.edges.ridge).toBeCloseTo(40, 0);
    expect(measured.edges.other).toBe(0);
    // 1200 sf of plan at 6/12 (slope factor sqrt(1.25)).
    expect(measured.area).toBeCloseTo(1200 * Math.sqrt(1.25), 0);
  });

  it("passes the service's authoritative edge totals through to the drawing", () => {
    const serviceEdges = {
      ridge: 7.2,
      hip: 239.2,
      valley: 59.6,
      eave: 197.4,
      rake: 50.7,
      pitch_change: 0,
    };
    const drawing = detectedFacetsToDrawing(
      makeReady(
        [
          facet("facet-1", [
            [0, 0, EAVE_M],
            [40, 0, EAVE_M],
            [40, 15, RIDGE_M],
            [0, 15, RIDGE_M],
          ]),
        ],
        { edge_lengths_lf: serviceEdges },
      ),
      "Tile Roof",
    );
    expect(drawing.service_edge_lengths_lf).toEqual(serviceEdges);
    // Legacy responses without service totals leave the field unset,
    // and the report falls back to the drawing's own classification.
    const legacy = detectedFacetsToDrawing(
      makeReady([
        facet("facet-1", [
          [0, 0, EAVE_M],
          [40, 0, EAVE_M],
          [40, 15, RIDGE_M],
          [0, 15, RIDGE_M],
        ]),
      ]),
      "Tile Roof",
    );
    expect(legacy.service_edge_lengths_lf).toBeUndefined();
  });

  it("fills a compact tiling notch into its bordering facet but skips hairline margins", () => {
    // Outline = the facets' 40x30 tiling, plus a compact 3x3 ft
    // notch on the east side (a genuine hole in the sketch) and a
    // 0.15 ft hairline offset along the west side (outline-margin
    // noise that must NOT be unioned into a facet).
    const outlineFt: [number, number][] = [
      [-0.15, 0],
      [40, 0],
      [40, 10],
      [43, 10],
      [43, 13],
      [40, 13],
      [40, 30],
      [-0.15, 30],
    ];
    const footprint: RoofDetectionResponse["footprint"] = {
      source: "test",
      area_sqft: 1213,
      polygon_geojson: {
        type: "Polygon",
        coordinates: [
          [
            ...outlineFt.map(([x, z]) => [origin.lon + x / lonScale, origin.lat - z / latScale]),
            [origin.lon + outlineFt[0]![0] / lonScale, origin.lat - outlineFt[0]![1] / latScale],
          ],
        ],
      },
    };
    const drawing = detectedFacetsToDrawing(
      makeReady(
        [
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
        ],
        {},
        footprint,
      ),
      "Tile Roof",
    );
    expect(drawing.planes).toHaveLength(2);
    const measured = measureDrawing(drawing);
    // (1200 sf of facets + the 9 sf notch) at 6/12; the 4.5 sf
    // hairline strip stays unfilled.
    expect(measured.area).toBeCloseTo(1209 * Math.sqrt(1.25), 0);
  });
});

describe("LiDAR drawing sliver folds (step 10)", () => {
  const origin = response.location;
  const lonScale = 111320 * Math.cos((origin.lat * Math.PI) / 180) * (1 / 0.3048);
  const latScale = 110540 * (1 / 0.3048);
  const ring = (points: [number, number, number][]) =>
    points.map(([x, z, elevation]) => [
      origin.lat - z / latScale,
      origin.lon + x / lonScale,
      elevation,
    ]) as [number, number, number][];
  const facet = (id: string, points: [number, number, number][]) => ({
    id,
    point_count: 500,
    pitch_degrees: (Math.atan(6 / 12) * 180) / Math.PI,
    pitch_rise_per_12: 6,
    azimuth_degrees: 180,
    area_sqft: 600,
    squares: 6,
    boundary_latlon: ring([...points, points[0]!]),
  });
  const footprintFor = (
    outlineFt: [number, number][],
  ): RoofDetectionResponse["footprint"] => ({
    source: "test",
    area_sqft: 1800,
    polygon_geojson: {
      type: "Polygon",
      coordinates: [
        [
          ...outlineFt.map(([x, z]) => [
            origin.lon + x / lonScale,
            origin.lat - z / latScale,
          ]),
          [origin.lon + outlineFt[0]![0] / lonScale, origin.lat - outlineFt[0]![1] / latScale],
        ],
      ],
    },
  });
  const makeReady = (
    facets: ReturnType<typeof facet>[],
    footprint: RoofDetectionResponse["footprint"],
  ): RoofDetectionResponse => ({
    ...response,
    footprint,
    roof: {
      ...response.roof,
      facet_count: facets.length,
      facets: facets as RoofDetectionResponse["roof"]["facets"],
      drawing_ready: true,
    },
  });
  const RECT: [number, number][] = [
    [0, 0],
    [60, 0],
    [60, 30],
    [0, 30],
  ];

  it("folds a long thin finger of one facet into the facet it protrudes into", () => {
    // (Boundary elevations are metres, as the service returns
    // them; the planes below are described in feet for readability
    // and converted: 6/12 = 0.1524 m per ft of run.)
    // Facet A (6/12 rising east) carries a 20 x 2.5 ft finger into
    // facet B's rectangle (3/12 falling east); B's ring bites
    // around it. Drawn as assigned, the finger's two seams would
    // scribble a thin spike across B's face — Miramar's facet-1
    // wedge inside facet-3, which the fold hands to B.
    const drawing = detectedFacetsToDrawing(
      makeReady(
        [
          facet("facet-a", [
            [0, 0, 3.048],
            [20, 0, 6.096],
            [20, 13, 6.096],
            [40, 13, 9.144],
            [40, 15.5, 9.144],
            [20, 15.5, 6.096],
            [20, 30, 6.096],
            [0, 30, 3.048],
          ]),
          facet("facet-b", [
            [20, 0, 7.62],
            [60, 0, 4.572],
            [60, 30, 4.572],
            [20, 30, 7.62],
            [20, 15.5, 7.62],
            [40, 15.5, 6.096],
            [40, 13, 6.096],
            [20, 13, 7.62],
          ]),
        ],
        footprintFor(RECT),
      ),
      "Metal Roof",
    );
    expect(drawing.planes).toHaveLength(2);
    const measured = measureDrawing(drawing);
    // A keeps its 600 sf body at 6/12; B is whole again at 1200 sf
    // at 3/12. The finger moved planes, so the drawing total moves
    // by exactly the finger's slope-area difference.
    expect(measured.planes[0]!.area).toBeCloseTo(600 * Math.sqrt(1.25), 0);
    expect(measured.planes[1]!.area).toBeCloseTo(1200 * Math.sqrt(1.0625), 0);
    // The finger tip is gone from A's ring.
    expect(Math.max(...drawing.planes[0]!.points.map((p) => p.x))).toBeCloseTo(20, 0);
  });

  it("absorbs a narrow notch into its owner across the seam it faces", () => {
    // Facet C's west edge dents 4 ft inward — a 6 sf tooth left
    // outside the tiling (Miramar facet-3's west tail). Facet D
    // borders the chord the dent would close along. The footprint
    // outline traces the dent, so the step-8 gap fill (which only
    // fills inside the outline) cannot take the tooth; the fold
    // absorbs it into C and the chord becomes a clean C-D seam.
    const outline: [number, number][] = [
      [20, 0],
      [50, 0],
      [50, 30],
      [20, 30],
      [20, 16.5],
      [24, 15],
      [20, 13.5],
    ];
    const drawing = detectedFacetsToDrawing(
      makeReady(
        [
          facet("facet-d", [
            [0, 0, 3.048],
            [20, 0, 6.096],
            [20, 30, 6.096],
            [0, 30, 3.048],
          ]),
          facet("facet-c", [
            [20, 0, 7.62],
            [50, 0, 3.048],
            [50, 30, 3.048],
            [20, 30, 7.62],
            [20, 16.5, 7.62],
            [24, 15, 7.0104],
            [20, 13.5, 7.62],
          ]),
        ],
        footprintFor(outline),
      ),
      "Metal Roof",
    );
    expect(drawing.planes).toHaveLength(2);
    const measured = measureDrawing(drawing);
    // C is its full 900 sf rectangle again, dent vertex gone.
    expect(measured.planes[1]!.area).toBeCloseTo(900 * Math.sqrt(1.25), 0);
    expect(
      drawing.planes[1]!.points.some(
        (p) => Math.abs(p.x - 24) < 0.01 && Math.abs(p.z - 15) < 0.01,
      ),
    ).toBe(false);
  });

  it("leaves a finger that borders two facets in place", () => {
    // The same finger as the fold test, but split between two
    // neighbours — its north edge and tip border B1, its south
    // edge B2 — so no single facet owns 85% of its border and it
    // stays a legitimate part of its facet. (Annel's facet corners
    // fail the fold rules the same way and must not move either.)
    const drawing = detectedFacetsToDrawing(
      makeReady(
        [
          facet("facet-a", [
            [0, 0, 3.048],
            [20, 0, 6.096],
            [20, 13, 6.096],
            [29, 13, 7.4676],
            [29, 16, 7.4676],
            [20, 16, 6.096],
            [20, 30, 6.096],
            [0, 30, 3.048],
          ]),
          facet("facet-b1", [
            [20, 0, 7.62],
            [60, 0, 4.572],
            [60, 16, 4.572],
            [29, 16, 6.9342],
            [29, 13, 6.9342],
            [20, 13, 7.62],
          ]),
          facet("facet-b2", [
            [20, 16, 3.048],
            [29, 16, 3.048],
            [60, 16, 3.048],
            [60, 30, 5.1816],
            [20, 30, 5.1816],
          ]),
        ],
        footprintFor(RECT),
      ),
      "Metal Roof",
    );
    expect(drawing.planes).toHaveLength(3);
    const measured = measureDrawing(drawing);
    // A keeps body + finger (627 sf at 6/12); the tip vertex stays.
    expect(measured.planes[0]!.area).toBeCloseTo(627 * Math.sqrt(1.25), 0);
    expect(Math.max(...drawing.planes[0]!.points.map((p) => p.x))).toBeCloseTo(29, 0);
  });
});
