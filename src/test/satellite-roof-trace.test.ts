import { describe, expect, it } from "vitest";
import {
  nextSatelliteZoom,
  satelliteTraceToPlane,
  satelliteTraceToGablePlanes,
  nearestBuildingFootprint,
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

describe("guided satellite gable facet splitting", () => {
  const rectangle = [
    { lat: origin.lat, lon: origin.lon },
    { lat: origin.lat, lon: origin.lon + metersToLongitudeDegrees },
    { lat: origin.lat - metersToLatitudeDegrees, lon: origin.lon + metersToLongitudeDegrees },
    { lat: origin.lat - metersToLatitudeDegrees, lon: origin.lon },
  ];

  it("splits a rectangular footprint into two north-south gable facets with a shared ridge", () => {
    const planes = satelliteTraceToGablePlanes(rectangle, 6, "north-south");
    expect(planes).toHaveLength(2);
    expect(planes[0]?.name).toBe("West gable facet");
    expect(planes[1]?.name).toBe("East gable facet");
    expect(planeInfo(planes[0]!).pitch).toBeCloseTo(6, 1);
    expect(planeInfo(planes[1]!).pitch).toBeCloseTo(6, 1);
    expect(planes[0]?.edges[planes[0].edges.length - 1]).toBe("ridge");
    expect(planes[1]?.edges[planes[1].edges.length - 1]).toBe("ridge");
    const drawing = {
      planes,
      penetrations: [],
      waste: 10,
      roof_type: "Metal Roof" as const,
      notes: "",
      condition: "",
      verified: false,
    };
    expect(measureDrawing(drawing).planes).toHaveLength(2);
    expect(measureDrawing(drawing).edges.ridge).toBeGreaterThan(60);
  });

  it("splits a rectangular footprint along an east-west ridge", () => {
    const planes = satelliteTraceToGablePlanes(rectangle, 6, "east-west");
    expect(planes).toHaveLength(2);
    expect(planeInfo(planes[0]!).pitch).toBeCloseTo(6, 1);
    expect(planeInfo(planes[1]!).pitch).toBeCloseTo(6, 1);
    expect(
      measureDrawing({
        planes,
        penetrations: [],
        waste: 0,
        roof_type: "Metal Roof",
        notes: "",
        condition: "",
        verified: false,
      }).area,
    ).toBeGreaterThan(0);
  });

  it("moves the ridge off center to create unequal gable facets", () => {
    const centered = satelliteTraceToGablePlanes(rectangle, 6, "north-south");
    const offset = satelliteTraceToGablePlanes(rectangle, 6, "north-south", 20);
    expect(offset).toHaveLength(2);
    expect(planeInfo(offset[0]!).pitch).toBeCloseTo(6, 1);
    expect(planeInfo(offset[1]!).pitch).toBeCloseTo(6, 1);
    expect(planeInfo(offset[0]!).area).not.toBeCloseTo(planeInfo(offset[1]!).area, 0);
    expect(planeInfo(centered[0]!).area).toBeCloseTo(planeInfo(centered[1]!).area, 0);
  });

  it("rejects ridge offsets outside the safe range", () => {
    expect(() => satelliteTraceToGablePlanes(rectangle, 6, "north-south", 41)).toThrow(/offset/);
    expect(() => satelliteTraceToGablePlanes(rectangle, 6, "north-south", -41)).toThrow(/offset/);
  });

  it("rejects ambiguous ridge cuts, zero pitch, and outlines with too few corners", () => {
    expect(() => satelliteTraceToGablePlanes(rectangle, 0, "north-south")).toThrow(/pitch/);
    expect(() => satelliteTraceToGablePlanes(rectangle.slice(0, 3), 6, "north-south")).toThrow(
      /four/,
    );
    const toGeo = (x: number, z: number) => ({
      lat: origin.lat - (z / 20) * metersToLatitudeDegrees,
      lon: origin.lon + (x / 20) * metersToLongitudeDegrees,
    });
    // A C-shaped outline crosses its centerline four times, so a simple
    // two-facet gable split would be ambiguous and must be rejected.
    const concave = [
      toGeo(-10, -10),
      toGeo(10, -10),
      toGeo(10, -5),
      toGeo(-5, -5),
      toGeo(-5, 5),
      toGeo(10, 5),
      toGeo(10, 10),
      toGeo(-10, 10),
    ];
    expect(() => satelliteTraceToGablePlanes(concave, 6, "north-south")).toThrow(/exactly two/);
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

describe("automatic OpenStreetMap building footprint selection", () => {
  const center = { lat: 25.47, lon: -80.48 };
  it("selects the closest valid building way and removes its repeated closing point", () => {
    const footprint = nearestBuildingFootprint(
      [
        {
          type: "way",
          geometry: [
            { lat: 25.4701, lon: -80.4801 },
            { lat: 25.4701, lon: -80.4799 },
            { lat: 25.4699, lon: -80.4799 },
            { lat: 25.4699, lon: -80.4801 },
            { lat: 25.4701, lon: -80.4801 },
          ],
        },
        {
          type: "way",
          geometry: [
            { lat: 25.472, lon: -80.482 },
            { lat: 25.472, lon: -80.4818 },
            { lat: 25.4718, lon: -80.4818 },
            { lat: 25.4718, lon: -80.482 },
          ],
        },
      ],
      center,
    );
    expect(footprint).toHaveLength(4);
    expect(footprint?.[0]).toEqual({ lat: 25.4701, lon: -80.4801 });
  });
  it("prefers the building containing the address over a closer neighboring centroid", () => {
    const containingBuilding = [
      { lat: center.lat - 0.0001, lon: center.lon - 0.0004 },
      { lat: center.lat - 0.0001, lon: center.lon + 0.00005 },
      { lat: center.lat + 0.0001, lon: center.lon + 0.00005 },
      { lat: center.lat + 0.0001, lon: center.lon - 0.0004 },
      { lat: center.lat - 0.0001, lon: center.lon - 0.0004 },
    ];
    const nearbyNeighbor = [
      { lat: center.lat - 0.00002, lon: center.lon + 0.00006 },
      { lat: center.lat - 0.00002, lon: center.lon + 0.00008 },
      { lat: center.lat + 0.00002, lon: center.lon + 0.00008 },
      { lat: center.lat + 0.00002, lon: center.lon + 0.00006 },
      { lat: center.lat - 0.00002, lon: center.lon + 0.00006 },
    ];
    const footprint = nearestBuildingFootprint(
      [
        { type: "way", geometry: nearbyNeighbor },
        { type: "way", geometry: containingBuilding },
      ],
      center,
    );
    expect(footprint).toHaveLength(4);
    expect(footprint?.[0]).toEqual(containingBuilding[0]);
  });

  it("accepts an address on the building outline and rejects invalid address coordinates", () => {
    const boundaryBuilding = [
      { lat: center.lat, lon: center.lon },
      { lat: center.lat, lon: center.lon + 0.0002 },
      { lat: center.lat + 0.0002, lon: center.lon + 0.0002 },
      { lat: center.lat + 0.0002, lon: center.lon },
      { lat: center.lat, lon: center.lon },
    ];
    expect(
      nearestBuildingFootprint([{ type: "way", geometry: boundaryBuilding }], center),
    ).toHaveLength(4);
    expect(
      nearestBuildingFootprint([{ type: "way", geometry: boundaryBuilding }], {
        lat: Number.NaN,
        lon: center.lon,
      }),
    ).toBeNull();
  });

  it("ignores malformed, non-way, and distant building geometry", () => {
    expect(
      nearestBuildingFootprint(
        [
          { type: "relation", geometry: [{ lat: 25.47, lon: -80.48 }] },
          { type: "way", geometry: [{ lat: 25.47, lon: -80.48 }] },
          {
            type: "way",
            geometry: [
              { lat: 25.48, lon: -80.49 },
              { lat: 25.48, lon: -80.489 },
              { lat: 25.479, lon: -80.489 },
            ],
          },
        ],
        center,
      ),
    ).toBeNull();
  });
});
