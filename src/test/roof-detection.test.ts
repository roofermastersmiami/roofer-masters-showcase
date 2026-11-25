import { describe, expect, it } from "vitest";
import { detectedFacetsToDrawing, type RoofDetectionResponse } from "@/lib/roof-detection";

const response: RoofDetectionResponse = {
  status: "lidar_facets",
  verification: "unverified_public_data",
  matched_address: "100 Main Street",
  location: { lat: 25.47, lon: -80.48 },
  footprint: {
    source: "OpenStreetMap",
    area_sqft: 1200,
    polygon_geojson: {
      type: "Polygon",
      coordinates: [[
        [-80.4801, 25.4699],
        [-80.4799, 25.4699],
        [-80.4799, 25.4701],
        [-80.4801, 25.4701],
        [-80.4801, 25.4699],
      ]],
    },
  },
  roof: {
    facet_count: 1,
    area_sqft: 1200,
    total_squares: 12,
    dominant_pitch_rise_per_12: 6,
    edge_lengths_lf: null,
    facets: [{
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
    }],
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
      expect(drawing.planes).toHaveLength(1);
      expect(drawing.planes[0]?.edges.every((edge) => edge === "other")).toBe(true);
    },
  );
});
