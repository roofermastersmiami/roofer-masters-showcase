import { describe, expect, it } from "vitest";
import {
  BROWARD_AERIAL_EXTENT,
  SATELLITE_DEFAULT_ZOOM,
  SATELLITE_LABEL_MAX_ZOOM,
  SATELLITE_MAX_VIEW_ZOOM,
  SATELLITE_MAX_ZOOM,
  SATELLITE_TILE_PX,
  SATELLITE_VIEW_HEIGHT,
  SATELLITE_VIEW_WIDTH,
  browardAerialApplies,
  latLonAtViewportOffset,
  latLonToWorldPixels,
  projectToViewport,
  satelliteLabelTiles,
  satelliteLabelUpscale,
  satelliteLabelZoom,
  satelliteMapTiles,
  satelliteTileZoom,
  satelliteUpscale,
  worldPixelsToLatLon,
} from "@/lib/satellite-map";

// 4311 SW 32nd Dr, West Park, FL 33023 — the address from the bug
// report where the old Esri export image rendered as a blank box.
// West Park is in Broward County, inside the Aerials2026_V2
// extent, so its base tiles now come from the county service
// (with the Esri tile for each slot as fallbackSrc).
const LAT = 25.979306;
const LON = -80.186822;
// Downtown Miami — Miami-Dade, outside the Broward extent.
const MIA_LAT = 25.7617;
const MIA_LON = -80.1918;
// Miramar — Broward, inside the extent (its z19 county tile 404s
// live; the per-tile fallback exists for exactly this case).
const MIR_LAT = 25.9802;
const MIR_LON = -80.3995;

describe("satelliteMapTiles", () => {
  it("requests the Broward County tile that contains the address at the default zoom, with the Esri tile as its fallback", () => {
    const tiles = satelliteMapTiles(LAT, LON, SATELLITE_DEFAULT_ZOOM);
    // Tile indices verified against the live tile services for
    // these coordinates.
    expect(
      tiles.some(
        (tile) =>
          tile.src ===
            "https://tiles.arcgis.com/tiles/JMAJrTsHNLrSsWf5/arcgis/rest/services/Aerials2026_V2/MapServer/tile/19/222941/145363" &&
          tile.fallbackSrc ===
            "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/19/222941/145363",
      ),
    ).toBe(true);
  });

  it("outside Broward, requests Esri tiles with no fallback layer", () => {
    const tiles = satelliteMapTiles(MIA_LAT, MIA_LON, SATELLITE_DEFAULT_ZOOM);
    expect(tiles.length).toBeGreaterThan(0);
    for (const tile of tiles) {
      expect(tile.src).toContain("server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/");
      expect(tile.fallbackSrc).toBeUndefined();
    }
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

  it("only builds Esri World Imagery tile URLs outside Broward", () => {
    for (const zoom of [17, 18, 19, 20, 21]) {
      for (const tile of satelliteMapTiles(MIA_LAT, MIA_LON, zoom)) {
        expect(tile.src).toMatch(
          new RegExp(
            `^https://server\\.arcgisonline\\.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${zoom}/\\d+/\\d+$`,
          ),
        );
      }
    }
  });

  it("inside Broward, every tile is a county tile whose fallback is the Esri tile for the same slot", () => {
    for (const zoom of [17, 19, 20, 21]) {
      for (const tile of satelliteMapTiles(MIR_LAT, MIR_LON, zoom)) {
        const slot = tile.src.match(/\/tile\/(\d+)\/(\d+)\/(\d+)$/);
        expect(tile.src).toContain("tiles.arcgis.com/tiles/JMAJrTsHNLrSsWf5/");
        expect(tile.src).toContain("Aerials2026_V2");
        expect(slot?.[1]).toBe(String(zoom));
        expect(tile.fallbackSrc).toBe(
          `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${slot?.[1]}/${slot?.[2]}/${slot?.[3]}`,
        );
      }
    }
  });
});

describe("browardAerialApplies", () => {
  it("covers the urban Broward points and nothing outside the published extent", () => {
    expect(browardAerialApplies(MIR_LAT, MIR_LON)).toBe(true); // Miramar
    expect(browardAerialApplies(26.1224, -80.1373)).toBe(true); // Fort Lauderdale
    expect(browardAerialApplies(LAT, LON)).toBe(true); // West Park
    expect(browardAerialApplies(MIA_LAT, MIA_LON)).toBe(false); // downtown Miami
    expect(browardAerialApplies(25.65, -80.42)).toBe(false); // SW Miami-Dade
    expect(browardAerialApplies(26.1, -80.6)).toBe(false); // Everglades (west of extent)
    expect(browardAerialApplies(30.3322, -81.6557)).toBe(false); // Jacksonville
    // The extent corners themselves are inclusive.
    expect(browardAerialApplies(BROWARD_AERIAL_EXTENT.minLat, BROWARD_AERIAL_EXTENT.minLon)).toBe(
      true,
    );
    expect(browardAerialApplies(BROWARD_AERIAL_EXTENT.maxLat, BROWARD_AERIAL_EXTENT.maxLon)).toBe(
      true,
    );
    expect(browardAerialApplies(BROWARD_AERIAL_EXTENT.minLat - 0.001, MIR_LON)).toBe(false);
    expect(browardAerialApplies(MIR_LAT, BROWARD_AERIAL_EXTENT.maxLon + 0.001)).toBe(false);
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

describe("deep zoom past the last real tile level (z22–z24)", () => {
  const center = { lat: LAT, lon: LON };

  it("caps the fetched tile level at z21 and doubles the upscale per level past it", () => {
    expect(SATELLITE_MAX_ZOOM).toBe(21);
    expect(SATELLITE_MAX_VIEW_ZOOM).toBe(24);
    for (const viewZoom of [17, 19, 20, 21]) {
      expect(satelliteTileZoom(viewZoom)).toBe(viewZoom);
      expect(satelliteUpscale(viewZoom)).toBe(1);
    }
    for (const viewZoom of [22, 23, 24]) {
      expect(satelliteTileZoom(viewZoom)).toBe(SATELLITE_MAX_ZOOM);
      expect(satelliteUpscale(viewZoom)).toBe(2 ** (viewZoom - SATELLITE_MAX_ZOOM));
    }
    expect(satelliteUpscale(SATELLITE_MAX_VIEW_ZOOM)).toBe(8);
  });

  it("caps the label level at z19 — the deepest level with real label content — and upscales labels from there", () => {
    expect(SATELLITE_LABEL_MAX_ZOOM).toBe(19);
    for (const viewZoom of [17, 19]) {
      expect(satelliteLabelZoom(viewZoom)).toBe(viewZoom);
      expect(satelliteLabelUpscale(viewZoom)).toBe(1);
    }
    for (const viewZoom of [20, 21, 22, 23, 24]) {
      expect(satelliteLabelZoom(viewZoom)).toBe(SATELLITE_LABEL_MAX_ZOOM);
      expect(satelliteLabelUpscale(viewZoom)).toBe(2 ** (viewZoom - SATELLITE_LABEL_MAX_ZOOM));
    }
  });

  it("round-trips lat/lon through world pixels at every deep zoom", () => {
    for (const zoom of [21, 22, 23, 24]) {
      const px = latLonToWorldPixels(LAT, LON, zoom);
      const back = worldPixelsToLatLon(px.x, px.y, zoom);
      expect(back.lat).toBeCloseTo(LAT, 9);
      expect(back.lon).toBeCloseTo(LON, 9);
    }
  });

  it("inverts projectToViewport with latLonAtViewportOffset at every deep zoom", () => {
    const point = { lat: LAT + 0.0004, lon: LON - 0.0007 };
    for (const zoom of [21, 22, 23, 24]) {
      const offset = projectToViewport(point, center, zoom);
      const back = latLonAtViewportOffset(center, zoom, offset.x, offset.y);
      expect(back.lat).toBeCloseTo(point.lat, 9);
      expect(back.lon).toBeCloseTo(point.lon, 9);
    }
  });

  it("a screen offset at z24 names the same ground point as 1/8th of it at z21", () => {
    // The pin math runs on the VIEW zoom: 256px east at z24 covers
    // exactly the ground that 32px east covers at z21 — the tile
    // level must never leak into the projection.
    const deep = latLonAtViewportOffset(center, 24, 256, -128);
    const tileLevel = latLonAtViewportOffset(center, 21, 256 / 8, -128 / 8);
    expect(deep.lat).toBeCloseTo(tileLevel.lat, 9);
    expect(deep.lon).toBeCloseTo(tileLevel.lon, 9);
  });

  it("builds the deep-zoom mosaic from z21 tiles only, upscaled gaplessly over the layer", () => {
    // Exactly what SatelliteMap renders at z24: tiles fetched at
    // the capped tile zoom for a viewport shrunk by the upscale,
    // then each tile drawn at (left, top) * upscale with size
    // 256 * upscale.
    const viewZoom = SATELLITE_MAX_VIEW_ZOOM;
    const tileZoom = satelliteTileZoom(viewZoom);
    const upscale = satelliteUpscale(viewZoom);
    const layerWidth = 960 + SATELLITE_TILE_PX * 4;
    const layerHeight = 560 + SATELLITE_TILE_PX * 4;
    const tiles = satelliteMapTiles(
      LAT,
      LON,
      tileZoom,
      layerWidth / upscale,
      layerHeight / upscale,
    );
    expect(tiles.length).toBeGreaterThan(0);
    for (const tile of tiles) {
      expect(tile.src).toContain(`/tile/${SATELLITE_MAX_ZOOM}/`);
      expect(tile.src).not.toMatch(/\/tile\/2[2-9]\//);
    }
    const scaled = tiles.map((tile) => ({
      left: tile.left * upscale,
      top: tile.top * upscale,
      size: SATELLITE_TILE_PX * upscale,
    }));
    const lefts = [...new Set(scaled.map((tile) => tile.left))].sort((a, b) => a - b);
    const tops = [...new Set(scaled.map((tile) => tile.top))].sort((a, b) => a - b);
    expect(scaled.length).toBe(lefts.length * tops.length);
    expect(lefts[0]).toBeLessThanOrEqual(0);
    expect(lefts[lefts.length - 1]! + SATELLITE_TILE_PX * upscale).toBeGreaterThanOrEqual(
      layerWidth,
    );
    expect(tops[0]).toBeLessThanOrEqual(0);
    expect(tops[tops.length - 1]! + SATELLITE_TILE_PX * upscale).toBeGreaterThanOrEqual(
      layerHeight,
    );
    for (let i = 1; i < lefts.length; i++)
      expect(lefts[i]! - lefts[i - 1]!).toBeCloseTo(SATELLITE_TILE_PX * upscale, 6);
    for (let i = 1; i < tops.length; i++)
      expect(tops[i]! - tops[i - 1]!).toBeCloseTo(SATELLITE_TILE_PX * upscale, 6);
    // The address point sits at the layer centre, inside the
    // centre tile — the upscaled mosaic stays registered to the
    // projection the pins use.
    const centreTile = scaled.find(
      (tile) =>
        tile.left <= layerWidth / 2 &&
        layerWidth / 2 < tile.left + tile.size &&
        tile.top <= layerHeight / 2 &&
        layerHeight / 2 < tile.top + tile.size,
    );
    expect(centreTile).toBeDefined();
  });

  it("keeps the label overlays on their own capped grid at deep zoom", () => {
    // Exactly what SatelliteMap renders at z23: labels fetched at
    // the label zoom (z19, the deepest level with real content)
    // for a viewport shrunk by the label upscale.
    const viewZoom = 23;
    const labelZoom = satelliteLabelZoom(viewZoom);
    const labelUpscale = satelliteLabelUpscale(viewZoom);
    expect(labelZoom).toBe(SATELLITE_LABEL_MAX_ZOOM);
    const layers = satelliteLabelTiles(LAT, LON, labelZoom, 400 / labelUpscale, 300 / labelUpscale);
    expect(layers).toHaveLength(2);
    for (const layer of layers) {
      expect(layer.length).toBeGreaterThan(0);
      for (const tile of layer) expect(tile.src).toContain(`/tile/${SATELLITE_LABEL_MAX_ZOOM}/`);
    }
  });
});
