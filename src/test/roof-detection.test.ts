import { describe, expect, it } from "vitest";
import { measureDrawing } from "@/lib/roof-geometry";
import {
  detectedFacetsToDrawing,
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
