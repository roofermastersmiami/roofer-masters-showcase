import { describe, expect, it } from "vitest";
import {
  SATELLITE_DEFAULT_ZOOM,
  SATELLITE_TILE_PX,
  SATELLITE_VIEW_HEIGHT,
  SATELLITE_VIEW_WIDTH,
  latLonAtViewportOffset,
  latLonToWorldPixels,
  projectToViewport,
  satelliteLabelTiles,
  satelliteMapTiles,
  worldPixelsToLatLon,
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

describe("satelliteLabelTiles", () => {
  it("overlays both Esri reference layers on the same tile grid as the imagery", () => {
    const imagery = satelliteMapTiles(LAT, LON, SATELLITE_DEFAULT_ZOOM);
    const layers = satelliteLabelTiles(LAT, LON, SATELLITE_DEFAULT_ZOOM);
    expect(layers).toHaveLength(2);
    for (const layer of layers) {
      expect(layer.map((tile) => [tile.left, tile.top])).toEqual(
        imagery.map((tile) => [tile.left, tile.top]),
      );
    }
    // Tile indices verified against the live Esri reference
    // services for these coordinates (HTTP 200, street names
    // render over the imagery).
    expect(
      layers[0]?.some(
        (tile) =>
          tile.src ===
          "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/19/222941/145363",
      ),
    ).toBe(true);
    expect(
      layers[1]?.some(
        (tile) =>
          tile.src ===
          "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/19/222941/145363",
      ),
    ).toBe(true);
  });
});

describe("world-pixel projection (pan and pins)", () => {
  const center = { lat: LAT, lon: LON };

  it("round-trips lat/lon through world pixels", () => {
    for (const zoom of [17, 19, 20]) {
      const px = latLonToWorldPixels(LAT, LON, zoom);
      const back = worldPixelsToLatLon(px.x, px.y, zoom);
      expect(back.lat).toBeCloseTo(LAT, 9);
      expect(back.lon).toBeCloseTo(LON, 9);
    }
  });

  it("projects the centre to (0, 0) and east/north to +x/−y", () => {
    expect(projectToViewport(center, center, 19)).toEqual({ x: 0, y: 0 });
    const east = projectToViewport({ lat: LAT, lon: LON + 0.001 }, center, 19);
    expect(east.x).toBeGreaterThan(0);
    expect(east.y).toBeCloseTo(0, 6);
    const north = projectToViewport({ lat: LAT + 0.001, lon: LON }, center, 19);
    expect(north.y).toBeLessThan(0);
    expect(north.x).toBeCloseTo(0, 6);
  });

  it("inverts projectToViewport with latLonAtViewportOffset", () => {
    const point = { lat: LAT + 0.0004, lon: LON - 0.0007 };
    const offset = projectToViewport(point, center, 19);
    const back = latLonAtViewportOffset(center, 19, offset.x, offset.y);
    expect(back.lat).toBeCloseTo(point.lat, 9);
    expect(back.lon).toBeCloseTo(point.lon, 9);
  });

  it("moves the centre west when the map is dragged east", () => {
    // Content follows the pointer: dragging 100px east shifts the
    // centre 100px west in world pixels.
    const dragged = latLonAtViewportOffset(center, 19, -100, 0);
    expect(dragged.lon).toBeLessThan(LON);
    expect(dragged.lat).toBeCloseTo(LAT, 9);
  });
});
