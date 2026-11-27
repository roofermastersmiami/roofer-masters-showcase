import { describe, expect, it } from "vitest";
import {
  SATELLITE_DEFAULT_ZOOM,
  SATELLITE_TILE_PX,
  SATELLITE_VIEW_HEIGHT,
  SATELLITE_VIEW_WIDTH,
  satelliteMapTiles,
} from "@/lib/satellite-map";

// 4311 SW 32nd Dr, West Park, FL 33023 — the address from the bug
// report where the old Esri export image rendered as a blank box.
const LAT = 25.979306;
const LON = -80.186822;

describe("satelliteMapTiles", () => {
  it("requests the Esri tile that contains the address at the default zoom", () => {
    const tiles = satelliteMapTiles(LAT, LON, SATELLITE_DEFAULT_ZOOM);
    // Tile indices verified against the live Esri World Imagery
    // tile service for these coordinates.
    expect(
      tiles.some(
        (tile) =>
          tile.src ===
          "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/19/222941/145363",
      ),
    ).toBe(true);
  });

  it("places the address point at the exact centre of the viewport", () => {
    const tiles = satelliteMapTiles(LAT, LON, SATELLITE_DEFAULT_ZOOM);
    const centreTile = tiles.find(
      (tile) =>
        tile.left <= SATELLITE_VIEW_WIDTH / 2 &&
        SATELLITE_VIEW_WIDTH / 2 < tile.left + SATELLITE_TILE_PX &&
        tile.top <= SATELLITE_VIEW_HEIGHT / 2 &&
        SATELLITE_VIEW_HEIGHT / 2 < tile.top + SATELLITE_TILE_PX,
    );
    expect(centreTile?.src).toContain("/tile/19/222941/145363");
  });

  it("covers the whole viewport with a gapless grid", () => {
    const tiles = satelliteMapTiles(LAT, LON, SATELLITE_DEFAULT_ZOOM);
    const lefts = [...new Set(tiles.map((tile) => tile.left))].sort((a, b) => a - b);
    const tops = [...new Set(tiles.map((tile) => tile.top))].sort((a, b) => a - b);
    expect(tiles.length).toBe(lefts.length * tops.length);
    expect(new Set(tiles.map((tile) => tile.key)).size).toBe(tiles.length);
    expect(lefts[0]).toBeLessThanOrEqual(0);
    expect(lefts[lefts.length - 1]! + SATELLITE_TILE_PX).toBeGreaterThanOrEqual(
      SATELLITE_VIEW_WIDTH,
    );
    expect(tops[0]).toBeLessThanOrEqual(0);
    expect(tops[tops.length - 1]! + SATELLITE_TILE_PX).toBeGreaterThanOrEqual(
      SATELLITE_VIEW_HEIGHT,
    );
    for (let i = 1; i < lefts.length; i++)
      expect(lefts[i]! - lefts[i - 1]!).toBeCloseTo(SATELLITE_TILE_PX, 6);
    for (let i = 1; i < tops.length; i++)
      expect(tops[i]! - tops[i - 1]!).toBeCloseTo(SATELLITE_TILE_PX, 6);
  });

  it("changes the tile grid when the zoom level changes", () => {
    const zoomedOut = satelliteMapTiles(LAT, LON, 18);
    expect(zoomedOut.some((tile) => tile.src.endsWith("/tile/18/111470/72681"))).toBe(true);
    const zoomedIn = satelliteMapTiles(LAT, LON, 20);
    expect(zoomedIn.some((tile) => tile.src.endsWith("/tile/20/445883/290726"))).toBe(true);
  });

  it("only builds Esri World Imagery tile URLs", () => {
    for (const zoom of [17, 18, 19, 20]) {
      for (const tile of satelliteMapTiles(LAT, LON, zoom)) {
        expect(tile.src).toMatch(
          new RegExp(
            `^https://server\\.arcgisonline\\.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${zoom}/\\d+/\\d+$`,
          ),
        );
      }
    }
  });
});
