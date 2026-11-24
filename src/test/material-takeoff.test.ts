import { describe, expect, it } from "vitest";
import { calculateRoofTakeoff, type RoofMeasurements } from "@/utils/materialTakeoff";

const base: RoofMeasurements = {
  totalAreaSqFt: 2000,
  dominantPitch: 5,
  ridgesFt: 40,
  hipsFt: 20,
  valleysFt: 10,
  eavesFt: 100,
  rakesFt: 40,
  penetrationsCount: 4,
};

describe("South Florida material takeoff", () => {
  it("calculates net squares, default waste, and the shingle line quantities", () => {
    const result = calculateRoofTakeoff(base, "shingle");
    expect(result.squaresNet).toBe(20);
    expect(result.wastePct).toBe(12);
    expect(result.squaresWithWaste).toBe(22.4);
    expect(result.steepSlopeMultiplier).toBe(1);
    expect(result.lineItems.find((item) => item.code === "SHG-ARCH")?.quantity).toBe(68);
    expect(result.lineItems.find((item) => item.code === "UND-PSA")?.quantity).toBe(11);
    expect(result.lineItems.find((item) => item.code === "FLS-BOOT")?.quantity).toBe(4);
  });

  it("applies the complexity waste boundary only above 12", () => {
    const boundary = { ...base, hipsFt: 200, valleysFt: 40 };
    expect(calculateRoofTakeoff(boundary, "shingle").wastePct).toBe(12);
    expect(calculateRoofTakeoff({ ...boundary, valleysFt: 41 }, "shingle").wastePct).toBe(15);
  });

  it("uses 10 percent default waste for modified bitumen", () => {
    const result = calculateRoofTakeoff(
      { ...base, flatInstallationMethod: "torch" },
      "flat_modbit",
    );
    expect(result.wastePct).toBe(10);
    expect(result.lineItems.find((item) => item.code === "MOD-CAP")?.name).toContain("Torch");
  });

  it("distinguishes torch and self-adhered cap sheet descriptions", () => {
    const torch = calculateRoofTakeoff({ ...base, flatInstallationMethod: "torch" }, "flat_modbit");
    const adhered = calculateRoofTakeoff(
      { ...base, flatInstallationMethod: "peel_and_stick" },
      "flat_modbit",
    );
    expect(torch.lineItems.find((item) => item.code === "MOD-CAP")?.name).toContain("Torch");
    expect(adhered.lineItems.find((item) => item.code === "MOD-CAP")?.name).toContain(
      "Self-Adhered",
    );
  });

  it("honors a validated custom waste override and the steep-pitch threshold", () => {
    expect(
      calculateRoofTakeoff({ ...base, dominantPitch: 6.99 }, "shingle", 8).steepSlopeMultiplier,
    ).toBe(1);
    const result = calculateRoofTakeoff({ ...base, dominantPitch: 7 }, "shingle", 8);
    expect(result.wastePct).toBe(8);
    expect(result.steepSlopeMultiplier).toBe(1.15);
  });

  it("uses the default penetration allowance only when a count is omitted", () => {
    const inferred = calculateRoofTakeoff({ ...base, penetrationsCount: undefined }, "shingle");
    const explicitZero = calculateRoofTakeoff({ ...base, penetrationsCount: 0 }, "shingle");
    expect(inferred.lineItems.find((item) => item.code === "FLS-BOOT")?.quantity).toBe(3);
    expect(explicitZero.lineItems.find((item) => item.code === "FLS-BOOT")?.quantity).toBe(0);
  });

  it("rounds every purchasable unit up and handles zero optional edges", () => {
    const result = calculateRoofTakeoff(
      {
        ...base,
        ridgesFt: 0,
        hipsFt: 0,
        valleysFt: 0,
        eavesFt: 0,
        rakesFt: 0,
        penetrationsCount: 0,
      },
      "shingle",
      0,
    );
    expect(result.lineItems.find((item) => item.code === "MTL-DRIP-3X3")?.quantity).toBe(0);
    expect(result.lineItems.find((item) => item.code === "SHG-RIDGE")?.quantity).toBe(0);
    expect(
      result.lineItems.every((item) => Number.isSafeInteger(item.quantity) && item.quantity >= 0),
    ).toBe(true);
  });

  it("calculates tile quantities with the supplied package assumptions", () => {
    const result = calculateRoofTakeoff(base, "tile", 0);
    expect(result.lineItems.find((item) => item.code === "TIL-FIELD")?.quantity).toBe(1840);
    expect(result.lineItems.find((item) => item.code === "UND-BASE30")?.quantity).toBe(11);
    expect(result.lineItems.find((item) => item.code === "UND-TILECAP")?.quantity).toBe(23);
  });

  it("requires measured plane runs and product-specific coverage for architectural metal", () => {
    expect(() => calculateRoofTakeoff(base, "architectural_metal")).toThrow(
      "requires measured plane runs",
    );
    const result = calculateRoofTakeoff(
      {
        ...base,
        metalPlaneRuns: [
          { eaveLengthFt: 40, panelRunFt: 18 },
          { eaveLengthFt: 40, panelRunFt: 18 },
        ],
        metalConfig: {
          panelCoverageIn: 16,
          underlaymentCoverageSqFtPerRoll: 200,
          fastenersPerPanel: 20,
          fastenersPerBox: 250,
          trimStickLengthFt: 10,
        },
      },
      "architectural_metal",
    );
    expect(result.lineItems.find((item) => item.code === "MTL-PANEL-CUSTOM")?.quantity).toBe(68);
    expect(result.lineItems.find((item) => item.code === "MTL-FASTENER-CUSTOM")?.quantity).toBe(6);
  });

  it("rejects invalid dimensions, pitch, waste, and malformed penetration counts", () => {
    expect(() => calculateRoofTakeoff({ ...base, totalAreaSqFt: Number.NaN }, "shingle")).toThrow();
    expect(() => calculateRoofTakeoff({ ...base, eavesFt: -1 }, "shingle")).toThrow();
    expect(() => calculateRoofTakeoff({ ...base, dominantPitch: 25 }, "shingle")).toThrow();
    expect(() => calculateRoofTakeoff(base, "shingle", 51)).toThrow();
    expect(() => calculateRoofTakeoff({ ...base, penetrationsCount: 1.5 }, "shingle")).toThrow();
  });

  it("never returns prices or fabricated quote totals", () => {
    const result = calculateRoofTakeoff(base, "shingle");
    expect(result.lineItems.every((item) => !("unitPrice" in item) && !("lineTotal" in item))).toBe(
      true,
    );
    expect(result).not.toHaveProperty("total");
    expect(result.planningNote).toContain("manufacturer");
  });
});
