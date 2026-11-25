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
      expect(drawing.planes[0]?.edges.every((edge) => edge === "other")).toBe(true);
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
    expect(parsed.lidar?.tile_ids_used).toEqual(["USGS_LPC_FL_South_2020_19R_1234", "USGS_LPC_FL_South_2020_19R_1235"]);
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
