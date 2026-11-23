import { describe, expect, it } from "vitest";
import { materialOrder, parseRoofReportText, type RoofReport } from "./material-order";

const metalReport = (overrides: Partial<RoofReport> = {}): RoofReport => ({
  roof_type: "Metal Roof" as const,
  area_sqft: 2400,
  waste_pct: 10,
  ridge_lf: 40,
  hips_lf: 20,
  valleys_lf: 0,
  eaves_lf: 80,
  rakes_lf: 40,
  panel_width_in: 16,
  pipes: 2,
  ...overrides,
});

describe("metal material order", () => {
  it("does not invent panel counts or average cut lengths from eave totals", () => {
    const lines = materialOrder(metalReport());
    expect(lines.some((line) => line.unit === "panels")).toBe(false);
    expect(lines.some((line) => line.item.toLowerCase().includes("average panel length"))).toBe(
      false,
    );
    const aggregate = lines.find((line) => line.item.includes("aggregate only"));
    expect(aggregate?.unit).toBe("linear ft");
    expect(aggregate?.qty).toBeCloseTo((2400 * 1.1) / (16 / 12), 1);
  });

  it("accepts a configurable net coverage width through 60 inches", () => {
    const lines = materialOrder(metalReport({ panel_width_in: 60 }));
    const aggregate = lines.find((line) => line.item.includes('60"'));
    expect(aggregate?.qty).toBeCloseTo((2400 * 1.1) / 5, 1);
  });

  it("uses the 16-inch company default when legacy reports omit panel width", () => {
    const { panel_width_in: _ignored, ...legacy } = metalReport();
    const lines = materialOrder(legacy);
    const aggregate = lines.find((line) => line.item.includes("aggregate only"));
    expect(aggregate?.item).toContain('16" net coverage');
    expect(aggregate?.qty).toBeCloseTo((2400 * 1.1) / (16 / 12), 1);
  });

  it("rejects invalid panel coverage widths", () => {
    expect(() => materialOrder(metalReport({ panel_width_in: 0 }))).toThrow();
    expect(() => materialOrder(metalReport({ panel_width_in: 5.99 }))).toThrow();
    expect(
      materialOrder(metalReport({ panel_width_in: 6 })).some((line) => line.item.includes('6"')),
    ).toBe(true);
    expect(() => materialOrder(metalReport({ panel_width_in: 61 }))).toThrow();
  });
});

describe("local roof report text import", () => {
  it("reads explicitly labelled measurements without guessing", () => {
    const parsed = parseRoofReportText(
      [
        "Roof Type: Metal Roof",
        "Total Roof Area: 2,400 sq ft",
        "Waste: 10%",
        "Ridge: 40 LF",
        "Hips: 20 LF",
        "Valleys: 15 LF",
        "Eaves: 80 LF",
        "Rakes: 40 LF",
        "Pipe boots: 3",
      ].join("\n"),
    );
    expect(parsed.values).toMatchObject({
      roof_type: "Metal Roof",
      area_sqft: 2400,
      waste_pct: 10,
      ridge_lf: 40,
      hips_lf: 20,
      valleys_lf: 15,
      eaves_lf: 80,
      rakes_lf: 40,
      pipes: 3,
    });
    expect(parsed.found).toContain("Roof area");
    expect(parsed.found).toContain("Pipes / vents");
  });

  it("converts explicitly labelled roofing squares to square feet", () => {
    const parsed = parseRoofReportText("Total Roof Area: 24.5 squares");
    expect(parsed.values.area_sqft).toBe(2450);
  });

  it("does not invent missing measurements", () => {
    const parsed = parseRoofReportText("Customer: Example\nAddress: Miami, FL\nPitch: 5/12");
    expect(parsed.values.area_sqft).toBeUndefined();
    expect(parsed.values.ridge_lf).toBeUndefined();
    expect(parsed.values.pipes).toBeUndefined();
    expect(parsed.found).toEqual(["Pitch (review manually)"]);
  });

  it("ignores negative values", () => {
    const parsed = parseRoofReportText("Roof area: -2400 sq ft\nRidge: -20 LF");
    expect(parsed.values.area_sqft).toBeUndefined();
    expect(parsed.values.ridge_lf).toBeUndefined();
  });

  it("recognizes common written units and keeps pitch as a manual-review note", () => {
    const parsed = parseRoofReportText(
      "Roof area: 2,400 square feet\\nRidge length: 38 linear feet\\nRoof pitch: 6/12",
    );
    expect(parsed.values.area_sqft).toBe(2400);
    expect(parsed.values.ridge_lf).toBe(38);
    expect(parsed.values).not.toHaveProperty("pitch");
    expect(parsed.found).toContain("Pitch (review manually)");
  });

  it("does not read measurements beyond the documented input limit", () => {
    const parsed = parseRoofReportText(`${"x".repeat(100_001)}\\nRoof area: 2400 sq ft`);
    expect(parsed.values.area_sqft).toBeUndefined();
  });
});
