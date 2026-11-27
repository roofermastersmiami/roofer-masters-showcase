import { describe, expect, it } from "vitest";
import { automaticMaterialList } from "@/lib/material-order";
import type { RoofDrawing } from "@/lib/roof-geometry";

// Gable roof: 40 ft eaves, 15 ft horizontal run per slope, 6/12 pitch
// (7.5 ft rise). Slope length = sqrt(15^2 + 7.5^2) ≈ 16.77 ft, so each
// plane is ≈ 670.8 sq ft and the roof totals ≈ 1,341.6 sq ft. The two
// planes share one 40 ft ridge, which is counted once.
const frontPlane: RoofDrawing["planes"][number] = {
  id: "front",
  name: "Front slope",
  points: [
    { x: 0, y: 0, z: 15 },
    { x: 40, y: 0, z: 15 },
    { x: 40, y: 7.5, z: 0 },
    { x: 0, y: 7.5, z: 0 },
  ],
  edges: ["eave", "rake", "ridge", "rake"],
};
const backPlane: RoofDrawing["planes"][number] = {
  id: "back",
  name: "Back slope",
  points: [
    { x: 40, y: 0, z: -15 },
    { x: 0, y: 0, z: -15 },
    { x: 0, y: 7.5, z: 0 },
    { x: 40, y: 7.5, z: 0 },
  ],
  edges: ["eave", "rake", "ridge", "rake"],
};

function gableDrawing(overrides: Partial<RoofDrawing> = {}): RoofDrawing {
  return {
    planes: [frontPlane, backPlane],
    penetrations: [],
    waste: 10,
    roof_type: "Shingle Roof",
    notes: "",
    condition: "",
    verified: false,
    ...overrides,
  };
}

describe("automaticMaterialList", () => {
  it("derives quantities from the measured slope area, waste, and edge totals", () => {
    const result = automaticMaterialList(gableDrawing());
    expect(result.report.area_sqft).toBeCloseTo(1341.6, 0);
    expect(result.wastePct).toBe(10);
    // Shared ridge counted once; both eaves counted.
    expect(result.report.ridge_lf).toBeCloseTo(40, 0);
    expect(result.report.eaves_lf).toBeCloseTo(80, 0);
    expect(result.report.rakes_lf).toBeCloseTo(67.1, 0);
    expect(result.lines.length).toBeGreaterThan(0);
    // Lines for features this roof lacks (valleys, pipes) legitimately
    // carry zero quantity; the takeoff as a whole must be positive.
    expect(result.lines.every((line) => line.qty >= 0)).toBe(true);
    expect(result.lines.some((line) => line.qty > 0)).toBe(true);
    const shingles = result.lines.find((line) => /Architectural Shingles/.test(line.item));
    expect(shingles).toBeDefined();
    // (1,341.6 sq ft + 10% waste) / 100 ≈ 14.76 squares of coverage.
    expect(shingles!.qty).toBeGreaterThan(10);
  });

  it("prefers the detection service's authoritative edge totals when present", () => {
    const result = automaticMaterialList(
      gableDrawing({
        service_edge_lengths_lf: {
          ridge: 111,
          hip: 0,
          valley: 22,
          eave: 99,
          rake: 44,
          pitch_change: 0,
        },
      }),
    );
    expect(result.report.ridge_lf).toBe(111);
    expect(result.report.valleys_lf).toBe(22);
    expect(result.report.eaves_lf).toBe(99);
    expect(result.report.rakes_lf).toBe(44);
    // Area still comes from the drawing geometry.
    expect(result.report.area_sqft).toBeCloseTo(1341.6, 0);
    expect(result.lines.length).toBeGreaterThan(0);
  });

  it("builds a tile takeoff for a tile drawing", () => {
    const result = automaticMaterialList(gableDrawing({ roof_type: "Tile Roof" }));
    expect(result.lines.length).toBeGreaterThan(0);
    expect(result.lines.some((line) => /Field Tiles/.test(line.item))).toBe(true);
  });

  it("returns no metal lines and a review warning until product specs exist", () => {
    const result = automaticMaterialList(gableDrawing({ roof_type: "Metal Roof" }));
    expect(result.lines).toEqual([]);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toMatch(/not order-ready/);
  });

  it("honours the drawing's waste setting instead of a fixed default", () => {
    const result = automaticMaterialList(gableDrawing({ waste: 20 }));
    expect(result.wastePct).toBe(20);
    const shingles = result.lines.find((line) => /Architectural Shingles/.test(line.item));
    const at10 = automaticMaterialList(gableDrawing()).lines.find((line) =>
      /Architectural Shingles/.test(line.item),
    );
    expect(shingles!.qty).toBeGreaterThan(at10!.qty);
  });
});
