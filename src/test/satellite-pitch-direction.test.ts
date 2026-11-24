import { describe, expect, it } from "vitest";
import { satelliteTraceToPlane } from "@/components/dashboard/SatelliteRoofTrace";
import { planeInfo } from "@/lib/roof-geometry";

const origin = { lat: 25.47, lon: -80.48 };
const metersToLatitudeDegrees = 20 / 110540;
const metersToLongitudeDegrees = 20 / (111320 * Math.cos((origin.lat * Math.PI) / 180));
const square = [
  origin,
  { lat: origin.lat, lon: origin.lon + metersToLongitudeDegrees },
  { lat: origin.lat - metersToLatitudeDegrees, lon: origin.lon + metersToLongitudeDegrees },
  { lat: origin.lat - metersToLatitudeDegrees, lon: origin.lon },
];

describe("satellite roof pitch direction", () => {
  it.each([
    ["north", 0, 3],
    ["south", 3, 0],
    ["east", 1, 0],
    ["west", 0, 1],
  ] as const)("raises the plane toward %s", (direction, highIndex, lowIndex) => {
    const plane = satelliteTraceToPlane(square, 6, direction);
    expect(plane.points[highIndex]!.y).toBeGreaterThan(plane.points[lowIndex]!.y);
    expect(planeInfo(plane).pitch).toBeCloseTo(6, 1);
  });

  it("preserves south as the default direction", () => {
    const defaultPlane = satelliteTraceToPlane(square, 6);
    const southPlane = satelliteTraceToPlane(square, 6, "south");
    expect(defaultPlane.points.map((point) => point.y)).toEqual(
      southPlane.points.map((point) => point.y),
    );
  });
});
