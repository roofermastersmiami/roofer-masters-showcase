import { describe, expect, it } from "vitest";
import { planeInfo } from "@/lib/roof-geometry";
import { satelliteTraceToPlane } from "./SatelliteRoofTrace";

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
