import { describe, expect, it } from "vitest";
import { parseBuildingFootprints } from "@/lib/building-footprint";

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
    const result = parseBuildingFootprints({
      elements: [{ type: "way", id: 42, tags: { building: "house" }, geometry: square }],
    }, origin);
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe(42);
    expect(result[0]?.buildingType).toBe("house");
    expect(result[0]?.areaSqFt).toBeGreaterThan(100);
    expect(result[0]?.areaSqFt).toBeLessThan(10000);
    expect(result[0]?.points).toHaveLength(4);
  });

  it("rejects open, invalid, oversized, and distant polygons", () => {
    const result = parseBuildingFootprints({
      elements: [
        { type: "way", id: 1, geometry: square.slice(0, 4) },
        { type: "way", id: 2, geometry: square.map((p) => ({ ...p, lat: p.lat + 1 })) },
        { type: "way", id: 3, geometry: [{ lat: 25.47, lon: -80.48 }] },
        { type: "way", id: 4, geometry: [square[0], { lat: Number.NaN, lon: -80.48 }, ...square.slice(2)] },
      ],
    }, origin);
    expect(result).toEqual([]);
  });

  it("limits the result set and rejects malformed responses", () => {
    expect(parseBuildingFootprints(null, origin)).toEqual([]);
    expect(parseBuildingFootprints({ elements: "bad" }, origin)).toEqual([]);
    const elements = Array.from({ length: 12 }, (_, index) => ({
      type: "way", id: index + 1, geometry: square.map((p) => ({ ...p, lon: p.lon + index * 0.00001 })),
    }));
    expect(parseBuildingFootprints({ elements }, origin)).toHaveLength(8);
  });
});
