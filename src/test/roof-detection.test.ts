import { describe, expect, it } from "vitest";
import { measureDrawing } from "@/lib/roof-geometry";
import { detectedFacetsToDrawing } from "@/lib/roof-detection";

const fixture = {
  status: "lidar_facets" as const,
  verification: "unverified_public_data" as const,
  matched_address: "100 Main St",
  location: { lat: 25, lon: -80 },
  footprint: {
    source: "OpenStreetMap",
    area_sqft: 1800,
    polygon_geojson: { type: "Polygon" as const, coordinates: [[[-80, 25], [-79.9999, 25], [-79.9999, 25.0001], [-80, 25.0001], [-80, 25]]] },
  },
  roof: {
    facet_count: 1,
    area_sqft: 900,
    total_squares: 9,
    dominant_pitch_rise_per_12: 6,
    edge_lengths_lf: null,
    facets: [{
      id: "facet-1",
      point_count: 250,
      pitch_degrees: 26.565,
      pitch_rise_per_12: 6,
      azimuth_degrees: 180,
      area_sqft: 900,
      squares: 9,
      // Closed ring, elevations are meters in the 3DEP point-cloud vertical datum.
      boundary_latlon: [
        [25, -80, 5],
        [25, -79.9999, 10],
        [25.0001, -79.9999, 10],
        [25.0001, -80, 5],
        [25, -80, 5],
      ],
      plane_model: { z_equals_ax_plus_by_plus_c: [0, 0, 0] },
    }],
  },
  fallback: { available: false, mode: null, footprint_area_sqft: 1800, message: null },
  disclaimer: "Preliminary public data",
};

describe("public LiDAR roof adapter", () => {
  it("converts measured facet vertices to local feet and retains unverified edge state", () => {
    const drawing = detectedFacetsToDrawing(fixture);
    expect(drawing.accuracy).toBe("photo_estimate");
    expect(drawing.verified).toBe(false);
    expect(drawing.planes).toHaveLength(1);
    expect(drawing.planes[0]?.edges).toEqual(["other", "other", "other", "other"]);
    expect(drawing.geo_reference?.originLatitude).toBe(25);
    expect(measureDrawing(drawing).area).toBeGreaterThan(0);
    expect(measureDrawing(drawing).planes[0]?.pitch).toBeGreaterThan(0);
  });

  it("rejects footprint-only responses rather than inventing roof facets", () => {
    expect(() => detectedFacetsToDrawing({
      ...fixture,
      status: "footprint_only",
      roof: { ...fixture.roof, facet_count: 0, area_sqft: null, total_squares: null, dominant_pitch_rise_per_12: null, facets: [] },
    })).toThrow(/no supported LiDAR roof facets/i);
  });

  it("rejects malformed coordinates before they enter roof geometry", () => {
    const malformed = structuredClone(fixture);
    malformed.roof.facets[0]!.boundary_latlon[1] = [200, -79.9999, 10];
    expect(() => detectedFacetsToDrawing(malformed)).toThrow();
  });
});
