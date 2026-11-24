import { describe, expect, it } from "vitest";
import {
  nextSatelliteZoom,
  satelliteTraceToPlane,
} from "@/components/dashboard/SatelliteRoofTrace";
import { measureDrawing, planeInfo, toMaterialReport } from "@/lib/roof-geometry";

const origin = { lat: 25.47, lon: -80.48 };
const metersToLatitudeDegrees = 20 / 110540;
const metersToLongitudeDegrees = 20 / (111320 * Math.cos((origin.lat * Math.PI) / 180));

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

  it("feeds the traced plane into live drawing and material-report calculations", () => {
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
    const drawing = {
      planes: [plane],
      penetrations: [],
      waste: 10,
      roof_type: "Metal Roof" as const,
      notes: "",
      condition: "",
      verified: false,
    };

    const measured = measureDrawing(drawing);
    const report = toMaterialReport(drawing);

    expect(measured.area).toBeCloseTo(planeInfo(plane).area, 4);
    expect(report.area_sqft).toBeCloseTo(measured.area, 4);
    expect(report.waste_pct).toBe(10);
    expect(measured.area).toBeGreaterThan(4100);
    expect(measured.area).toBeLessThan(4500);
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

describe("satellite map zoom", () => {
  it("zooms in and out in predictable steps", () => {
    expect(nextSatelliteZoom(1, "in")).toBe(1.5);
    expect(nextSatelliteZoom(1.5, "out")).toBe(1);
  });

  it("keeps zoom inside supported bounds", () => {
    expect(nextSatelliteZoom(8, "in")).toBe(8);
    expect(nextSatelliteZoom(0.5, "out")).toBe(0.5);
  });
});

describe("satellite trace validation", () => {
  it("rejects traces with fewer than three corners or repeated corners", () => {
    expect(() =>
      satelliteTraceToPlane([origin, { lat: origin.lat, lon: origin.lon + 0.001 }], 0),
    ).toThrow(/between 3 and 100/);
    expect(() =>
      satelliteTraceToPlane([origin, origin, { lat: origin.lat - 0.001, lon: origin.lon }], 0),
    ).toThrow(/different location/);
  });

  it("rejects invalid pitch and crossed outlines before they enter the drawing", () => {
    expect(() =>
      satelliteTraceToPlane(
        [
          origin,
          { lat: origin.lat, lon: origin.lon + 0.001 },
          { lat: origin.lat - 0.001, lon: origin.lon },
        ],
        25,
      ),
    ).toThrow(/pitch/);
    expect(() =>
      satelliteTraceToPlane(
        [
          origin,
          { lat: origin.lat - metersToLatitudeDegrees, lon: origin.lon + metersToLongitudeDegrees },
          { lat: origin.lat, lon: origin.lon + metersToLongitudeDegrees },
          { lat: origin.lat - metersToLatitudeDegrees, lon: origin.lon },
        ],
        0,
      ),
    ).toThrow(/edges cross/);
  });
});
