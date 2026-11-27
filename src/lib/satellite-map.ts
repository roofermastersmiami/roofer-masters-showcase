/**
 * Tile math for the satellite map in the "Confirm building
 * location" step (src/components/dashboard/SatelliteMap.tsx).
 *
 * The dialog previously requested one stitched image from the
 * Esri World Imagery MapServer `export` endpoint. That endpoint
 * rejects the tight bounding boxes the dialog asks for at its
 * default zoom (HTTP 500 "Error: bytes", an HTML error page the
 * browser cannot render as an image), so the map rendered as a
 * blank box. The standard Esri tile service used here — plain GET
 * image requests — succeeds at every zoom level offered (verified
 * against the live service). Same imagery source and tile scheme
 * as src/lib/aerial-photo.ts (report covers).
 */

export const SATELLITE_TILE_PX = 256;
export const SATELLITE_MIN_ZOOM = 17;
export const SATELLITE_MAX_ZOOM = 20;
export const SATELLITE_DEFAULT_ZOOM = 19;
/** Fixed size of the centred tile layer. It overscans the visible
 * dialog map area (max ~930×520) so the imagery fills the frame at
 * any dialog size while the layer centre — the address point —
 * stays glued to the frame centre where the pin sits. */
export const SATELLITE_VIEW_WIDTH = 1408;
export const SATELLITE_VIEW_HEIGHT = 1024;

const TILE_URL =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";

/** Esri reference overlays drawn over the imagery so the map reads
 * like the labelled satellite view in the measurement-order form
 * Fredy modelled this on: street names along the roads
 * (World_Transportation) and place/boundary labels
 * (World_Boundaries_and_Places). Both are transparent PNG tile
 * layers on the same tile scheme; every URL was verified against
 * the live service for the West Park bug-report address at zooms
 * 17–20 before being relied on. */
export const SATELLITE_LABEL_TILE_URLS = [
  "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}",
  "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
] as const;

export type SatelliteMapTile = {
  key: string;
  src: string;
  left: number;
  top: number;
};

export type LatLon = { lat: number; lon: number };

/** Global pixel coordinates of a point at a zoom level (Web
 * Mercator, 256px tiles) — the shared frame for tile layout, pan
 * and pin projection. */
export function latLonToWorldPixels(latitude: number, longitude: number, zoom: number) {
  const scale = SATELLITE_TILE_PX * 2 ** zoom;
  const latRad = (latitude * Math.PI) / 180;
  return {
    x: ((longitude + 180) / 360) * scale,
    y: ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * scale,
  };
}

/** Inverse of latLonToWorldPixels. Longitude wraps into
 * [-180, 180); latitude is clamped to the Mercator limit. */
export function worldPixelsToLatLon(x: number, y: number, zoom: number): LatLon {
  const scale = SATELLITE_TILE_PX * 2 ** zoom;
  const wrappedX = ((x % scale) + scale) % scale;
  const clampedY = Math.min(Math.max(y, 0), scale);
  const lon = (wrappedX / scale) * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * clampedY) / scale))) * 180) / Math.PI;
  return { lat, lon };
}

/** Pixel offset of a point from the viewport centre when the map
 * is centred on `center`: positive x is east (right), positive y
 * is south (down) — screen coordinates. */
export function projectToViewport(point: LatLon, center: LatLon, zoom: number) {
  const pointPx = latLonToWorldPixels(point.lat, point.lon, zoom);
  const centerPx = latLonToWorldPixels(center.lat, center.lon, zoom);
  const scale = SATELLITE_TILE_PX * 2 ** zoom;
  let dx = pointPx.x - centerPx.x;
  // Take the short way around the antimeridian.
  if (dx > scale / 2) dx -= scale;
  if (dx < -scale / 2) dx += scale;
  return { x: dx, y: pointPx.y - centerPx.y };
}

/** The lat/lon at a pixel offset from the viewport centre — the
 * inverse of projectToViewport, used to turn clicks, pin drags and
 * pans into coordinates. */
export function latLonAtViewportOffset(
  center: LatLon,
  zoom: number,
  offsetX: number,
  offsetY: number,
): LatLon {
  const centerPx = latLonToWorldPixels(center.lat, center.lon, zoom);
  return worldPixelsToLatLon(centerPx.x + offsetX, centerPx.y + offsetY, zoom);
}

function tilesForUrl(
  urlTemplate: string,
  keyPrefix: string,
  latitude: number,
  longitude: number,
  zoom: number,
  width: number,
  height: number,
): SatelliteMapTile[] {
  const tileCount = 2 ** zoom;
  const center = latLonToWorldPixels(latitude, longitude, zoom);
  const originX = center.x - width / 2;
  const originY = center.y - height / 2;
  const firstTileX = Math.floor(originX / SATELLITE_TILE_PX);
  const lastTileX = Math.floor((originX + width - 1) / SATELLITE_TILE_PX);
  const firstTileY = Math.max(0, Math.floor(originY / SATELLITE_TILE_PX));
  const lastTileY = Math.min(tileCount - 1, Math.floor((originY + height - 1) / SATELLITE_TILE_PX));
  const tiles: SatelliteMapTile[] = [];
  for (let tileY = firstTileY; tileY <= lastTileY; tileY++) {
    for (let tileX = firstTileX; tileX <= lastTileX; tileX++) {
      const wrappedX = ((tileX % tileCount) + tileCount) % tileCount;
      tiles.push({
        key: `${keyPrefix}/${zoom}/${tileY}/${tileX}`,
        src: urlTemplate
          .replace("{z}", String(zoom))
          .replace("{y}", String(tileY))
          .replace("{x}", String(wrappedX)),
        left: tileX * SATELLITE_TILE_PX - originX,
        top: tileY * SATELLITE_TILE_PX - originY,
      });
    }
  }
  return tiles;
}

/** Pure tile math (unit-tested): the tiles covering a
 * width×height viewport centred on the address point, with each
 * tile's pixel offset inside that viewport. The address point sits
 * at (width/2, height/2) of the viewport by construction. */
export function satelliteMapTiles(
  latitude: number,
  longitude: number,
  zoom: number,
  width = SATELLITE_VIEW_WIDTH,
  height = SATELLITE_VIEW_HEIGHT,
): SatelliteMapTile[] {
  return tilesForUrl(TILE_URL, "imagery", latitude, longitude, zoom, width, height);
}

/** The label-overlay tiles aligned with satelliteMapTiles for the
 * same viewport — one entry per reference layer in
 * SATELLITE_LABEL_TILE_URLS, in draw order. */
export function satelliteLabelTiles(
  latitude: number,
  longitude: number,
  zoom: number,
  width = SATELLITE_VIEW_WIDTH,
  height = SATELLITE_VIEW_HEIGHT,
): SatelliteMapTile[][] {
  return SATELLITE_LABEL_TILE_URLS.map((url, index) =>
    tilesForUrl(url, `labels${index}`, latitude, longitude, zoom, width, height),
  );
}
