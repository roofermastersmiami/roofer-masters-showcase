import { describe, expect, it } from "vitest";
import { satelliteTraceToPlane } from "@/components/dashboard/SatelliteRoofTrace";
import { planeInfo } from "@/lib/roof-geometry";

const origin = { lat: 25.47, lon: -80.48 };
const metersToLatitudeDegrees = 20 / 110540;
const metersToLongitudeDegrees =
  20 / (111320 * Math.cos((origin.lat * Math.PI) / 180));

describe("manual satellite trace geometry units", () => {
  it("converts a 20-meter mapped footprint into feet before roof calculations", () => {
    const plane = satelliteTraceToPlane(
      [
        origin,
        { lat: origin.lat, lon: origin.lon + metersToLongitudeDegrees },
        {
          lat: origin.lat - metersToLatitudeDegrees,
          lon: origin.lon + metersToLongitudeDegrees,
        },
        { lat: origin.lat - metersToLatitudeDegrees, lon: origin.lon },
      ],
      0,
    );

    const widthFt =
      Math.max(...plane.points.map((point) => point.x)) -
      Math.min(...plane.points.map((point) => point.x));
    const depthFt =
      Math.max(...plane.points.map((point) => point.z)) -
      Math.min(...plane.points.map((point) => point.z));

    expect(widthFt).toBeGreaterThan(64);
    expect(widthFt).toBeLessThan(67);
    expect(depthFt).toBeGreaterThan(64);
    expect(depthFt).toBeLessThan(67);
    expect(planeInfo(plane).area).toBeGreaterThan(4100);
    expect(planeInfo(plane).area).toBeLessThan(4500);
    expect(plane.edges).toEqual(["other", "other", "other", "other"]);
  });

  it("calculates pitch rise using feet-based horizontal coordinates", () => {
    const plane = satelliteTraceToPlane(
      [
        origin,
        { lat: origin.lat, lon: origin.lon + metersToLongitudeDegrees },
        {
          lat: origin.lat - metersToLatitudeDegrees,
          lon: origin.lon + metersToLongitudeDegrees,
        },
        { lat: origin.lat - metersToLatitudeDegrees, lon: origin.lon },
      ],
      6,
    );

    const minY = Math.min(...plane.points.map((point) => point.y));
    const maxY = Math.max(...plane.points.map((point) => point.y));
    expect(maxY - minY).toBeGreaterThan(32);
    expect(maxY - minY).toBeLessThan(34);
    expect(planeInfo(plane).pitch).toBeCloseTo(6, 1);
  });
});
