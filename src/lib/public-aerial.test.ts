import { describe, expect, it } from "vitest";
import { aerialBox, AERIAL_CREDIT, ACCURACY_LABELS } from "./public-aerial";

describe("public aerial map scale", () => {
  it("returns a square ground-scale extent at the equator", () => {
    const result = aerialBox(0, 0, 100, 2000);
    expect(result.bbox).toHaveLength(4);
    expect(result.bbox[2]! - result.bbox[0]!).toBeCloseTo(100, 6);
    expect(result.bbox[3]! - result.bbox[1]!).toBeCloseTo(100, 6);
    expect(result.feetPerPixel).toBeCloseTo((100 * 3.28084) / 2000, 8);
  });

  it("compensates Web Mercator coordinates for latitude while retaining ground scale", () => {
    const equator = aerialBox(0, -80, 100, 1000);
    const miamiLatitude = aerialBox(26, -80, 100, 1000);
    expect(miamiLatitude.bbox[2]! - miamiLatitude.bbox[0]!).toBeGreaterThan(
      equator.bbox[2]! - equator.bbox[0]!,
    );
    expect(miamiLatitude.feetPerPixel).toBeCloseTo(equator.feetPerPixel, 10);
  });

  it.each([
    ["NaN latitude", Number.NaN, -80, 100, 1000],
    ["latitude outside Web Mercator", 85, -80, 100, 1000],
    ["longitude outside range", 26, 181, 100, 1000],
    ["zero ground span", 26, -80, 0, 1000],
    ["oversized ground span", 26, -80, 10001, 1000],
    ["fractional pixel dimension", 26, -80, 100, 1000.5],
    ["oversized pixel dimension", 26, -80, 100, 10001],
  ])("rejects %s", (_label, lat, lon, span, pixels) => {
    expect(() => aerialBox(lat, lon, span, pixels)).toThrow();
  });
});

describe("aerial provenance labels", () => {
  it("identifies the public imagery and geocoding sources", () => {
    expect(AERIAL_CREDIT).toContain("USGS");
    expect(AERIAL_CREDIT).toContain("US Census Bureau");
  });

  it("distinguishes photo estimates from scaled and site-verified measurements", () => {
    expect(ACCURACY_LABELS.photo_estimate).toMatch(/Estimated/);
    expect(ACCURACY_LABELS.scaled).toMatch(/known measured distance/);
    expect(ACCURACY_LABELS.site_verified).toMatch(/Verified on site/);
  });
});
