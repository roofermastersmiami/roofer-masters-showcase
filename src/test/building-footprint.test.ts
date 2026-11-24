import { describe, expect, it } from "vitest";
import { parseBuildingFootprints, shouldAutoSearchFootprint } from "@/lib/building-footprint";

const origin = { lat: 25.47, lon: -80.48 };
const square = [
  { lat: 25.47, lon: -80.4801 },
  { lat: 25.47, lon: -80.4799 },
  { lat: 25.4702, lon: -80.4799 },
  { lat: 25.4702, lon: -80.4801 },
  { lat: 25.47, lon: -80.4801 },
];

describe("OpenStreetMap building footprint parsing", () => {
  it("returns closed nearby building outlines with approximate ground area", () => {
    const result = parseBuildingFootprints(
      {
        elements: [{ type: "way", id: 42, tags: { building: "house" }, geometry: square }],
      },
      origin,
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe(42);
    expect(result[0]?.buildingType).toBe("house");
    expect(result[0]?.areaSqFt).toBeGreaterThan(100);
    expect(result[0]?.areaSqFt).toBeLessThan(10000);
    expect(result[0]?.points).toHaveLength(4);
  });

  it("uses the area centroid for irregular building outlines", () => {
    const lShape = [
      { lat: origin.lat, lon: origin.lon },
      { lat: origin.lat, lon: origin.lon + 0.00012 },
      { lat: origin.lat + 0.00003, lon: origin.lon + 0.00012 },
      { lat: origin.lat + 0.00003, lon: origin.lon + 0.00003 },
      { lat: origin.lat + 0.00012, lon: origin.lon + 0.00003 },
      { lat: origin.lat + 0.00012, lon: origin.lon },
      { lat: origin.lat, lon: origin.lon },
    ];
    const result = parseBuildingFootprints(
      {
        elements: [{ type: "way", id: 77, geometry: lShape }],
      },
      origin,
    );
    expect(result).toHaveLength(1);
    // The L-shaped polygon's area centroid is about 1.36/4 units from
    // the lower-left corner, not the 2/4 vertex-average position.
    expect(result[0]!.center.lat - origin.lat).toBeCloseTo(0.0000407, 5);
    expect(result[0]!.center.lon - origin.lon).toBeCloseTo(0.0000407, 5);
  });

  it("rejects open, invalid, oversized, and distant polygons", () => {
    const result = parseBuildingFootprints(
      {
        elements: [
          { type: "way", id: 1, geometry: square.slice(0, 4) },
          { type: "way", id: 2, geometry: square.map((p) => ({ ...p, lat: p.lat + 1 })) },
          { type: "way", id: 3, geometry: [{ lat: 25.47, lon: -80.48 }] },
          {
            type: "way",
            id: 4,
            geometry: [square[0], { lat: Number.NaN, lon: -80.48 }, ...square.slice(2)],
          },
          {
            type: "way",
            id: 5,
            geometry: [
              { lat: origin.lat, lon: origin.lon },
              { lat: origin.lat + 0.002, lon: origin.lon + 0.0002 },
              { lat: origin.lat, lon: origin.lon + 0.0002 },
              { lat: origin.lat + 0.0002, lon: origin.lon },
              { lat: origin.lat, lon: origin.lon },
            ],
          },
          {
            type: "way",
            id: 6,
            geometry: [
              { lat: origin.lat, lon: origin.lon },
              { lat: origin.lat, lon: origin.lon + 0.0002 },
              { lat: origin.lat + 0.0002, lon: origin.lon + 0.0002 },
              { lat: origin.lat + 0.0002, lon: origin.lon },
              { lat: origin.lat, lon: origin.lon + 0.0001 },
              { lat: origin.lat, lon: origin.lon },
            ],
          },
        ],
      },
      origin,
    );
    expect(result).toEqual([]);
  });

  it("limits the result set and rejects malformed responses", () => {
    expect(parseBuildingFootprints(null, origin)).toEqual([]);
    expect(parseBuildingFootprints({ elements: "bad" }, origin)).toEqual([]);
    const elements = Array.from({ length: 12 }, (_, index) => ({
      type: "way",
      id: index + 1,
      geometry: square.map((p) => ({ ...p, lon: p.lon + index * 0.00003 })),
    }));
    expect(parseBuildingFootprints({ elements }, origin)).toHaveLength(8);
  });
});


describe("automatic building footprint lookup guard", () => {
  it("runs once for each address/report key and skips missing addresses", () => {
    expect(shouldAutoSearchFootprint("123 Main St", "report-1", "")).toBe(true);
    expect(shouldAutoSearchFootprint("123 Main St", "report-1", "report-1")).toBe(false);
    expect(shouldAutoSearchFootprint("456 Oak Ave", "report-2", "report-1")).toBe(true);
    expect(shouldAutoSearchFootprint("  ", "report-2", "report-1")).toBe(false);
    expect(shouldAutoSearchFootprint(undefined, "report-2", "report-1")).toBe(false);
  });
});
