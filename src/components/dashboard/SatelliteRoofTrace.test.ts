import { describe, expect, it } from "vitest";
import { planeInfo } from "@/lib/roof-geometry";
import {
  nextSatelliteZoom,
  satelliteTileGridForBounds,
  satelliteTraceToPlane,
  zoomSatelliteByPinch,
} from "./SatelliteRoofTrace";

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

describe("satelliteTileGridForBounds", () => {
  // Bounds the tracer builds for 4311 SW 32nd Dr, West Park, FL at
  // its default zoom of 18 (TILE_SPAN 0.0015, lat span × 0.7).
  const bounds = {
    west: -80.186822 - 0.0015 / 18,
    east: -80.186822 + 0.0015 / 18,
    south: 25.979306 - (0.0015 * 0.7) / 18,
    north: 25.979306 + (0.0015 * 0.7) / 18,
  };

  it("uses Esri tile URLs, never the broken export endpoint", () => {
    const cells = satelliteTileGridForBounds(bounds);
    expect(cells.length).toBeGreaterThan(0);
    for (const cell of cells) {
      expect(cell.src).toMatch(
        /^https:\/\/server\.arcgisonline\.com\/ArcGIS\/rest\/services\/World_Imagery\/MapServer\/tile\/\d+\/\d+\/\d+$/,
      );
      expect(cell.src).not.toContain("export");
    }
  });

  it("covers the whole viewport with no gaps at the edges", () => {
    const cells = satelliteTileGridForBounds(bounds);
    const minLeft = Math.min(...cells.map((c) => c.leftPct));
    const minTop = Math.min(...cells.map((c) => c.topPct));
    const maxRight = Math.max(...cells.map((c) => c.leftPct + c.widthPct));
    const maxBottom = Math.max(...cells.map((c) => c.topPct + c.heightPct));
    expect(minLeft).toBeLessThanOrEqual(0);
    expect(minTop).toBeLessThanOrEqual(0);
    expect(maxRight).toBeGreaterThanOrEqual(100);
    expect(maxBottom).toBeGreaterThanOrEqual(100);
    // A tight property view needs only a handful of tiles.
    expect(cells.length).toBeLessThanOrEqual(12);
  });

  it("keeps the tile count bounded at the widest tracer zoom", () => {
    const wide = {
      west: -80.186822 - 0.0015 / 0.5,
      east: -80.186822 + 0.0015 / 0.5,
      south: 25.979306 - (0.0015 * 0.7) / 0.5,
      north: 25.979306 + (0.0015 * 0.7) / 0.5,
    };
    const cells = satelliteTileGridForBounds(wide);
    expect(cells.length).toBeGreaterThan(0);
    expect(cells.length).toBeLessThanOrEqual(200);
  });

  it("returns no cells for a degenerate bounds box", () => {
    expect(satelliteTileGridForBounds({ west: -80, east: -80, south: 25, north: 26 })).toEqual([]);
  });
});
