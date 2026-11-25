import { describe, expect, it } from "vitest";
import { planeInfo } from "@/lib/roof-geometry";
import { nextSatelliteZoom, satelliteTraceToPlane, zoomSatelliteByPinch } from "./SatelliteRoofTrace";

describe("satelliteTraceToPlane", () => {
  it("keeps traced perimeter edges unclassified instead of reporting them as eaves", () => {
    const plane = satelliteTraceToPlane(
      [
        { lat: 25.0, lon: -80.0 },
        { lat: 25.0, lon: -79.9999 },
        { lat: 24.9999, lon: -79.9999 },
        { lat: 24.9999, lon: -80.0 },
      ],
      6,
    );

    expect(plane.edges).toEqual(["other", "other", "other", "other"]);
    expect(planeInfo(plane).pitch).toBeCloseTo(6, 1);
  });
});

describe("satellite map zoom", () => {
  it("supports a close property-level zoom without exceeding its safe maximum", () => {
    expect(nextSatelliteZoom(12, "in")).toBe(16.8);
    expect(nextSatelliteZoom(64, "in")).toBe(64);
    expect(nextSatelliteZoom(0.5, "out")).toBe(0.5);
  });

  it("supports high-resolution pinch zoom at the same maximum", () => {
    expect(zoomSatelliteByPinch(12, 100, 200)).toBe(24);
    expect(zoomSatelliteByPinch(48, 100, 200)).toBe(64);
  });
});
