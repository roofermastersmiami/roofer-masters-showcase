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
/** Deepest zoom level tiles are fetched at. Esri World Imagery
 * serves real tiles to z21 (verified live 2026-11-27 in both
 * service counties) — and in Miami-Dade that matters: Esri's
 * z21 tiles there ARE Miami-Dade County's 2025 3-inch orthos at
 * near-native detail, while the old z20 cap delivered only
 * ~0.134 m/px, about half the source. No tile request may ever
 * go past this — see satelliteTileZoom. */
export const SATELLITE_MAX_ZOOM = 21;
/** Deepest VIEW zoom the maps offer. Past SATELLITE_MAX_ZOOM the
 * z21 mosaic is upscaled on screen (softer, but present) while
 * every overlay and pointer calculation keeps projecting with
 * exact Mercator math at the view zoom, so pins stay registered
 * to the imagery at every level. z24 is 8x closer than z21 —
 * at the deepest level a single house fills the frame, which is
 * what precise pin placement needs. Shared by the measurement-
 * order map (SatelliteMap) and the Sketch Editor (PR #233). */
export const SATELLITE_MAX_VIEW_ZOOM = 24;
export const SATELLITE_DEFAULT_ZOOM = 19;

/** The tile level to fetch for a view zoom: the view zoom itself
 * while real tiles exist, then pinned at the deepest real level. */
export function satelliteTileZoom(viewZoom: number): number {
  return Math.min(viewZoom, SATELLITE_MAX_ZOOM);
}

/** How much the fetched mosaic must be upscaled on screen to fill
 * the same frame at a view zoom: 1 while real tiles exist, then
 * doubling per level past them (8 at z24). Tiles are fetched for
 * a viewport shrunk by this factor and rendered scaled back up,
 * so the mosaic's centre stays glued to the frame centre. */
export function satelliteUpscale(viewZoom: number): number {
  return 2 ** Math.max(0, viewZoom - SATELLITE_MAX_ZOOM);
}

/** Deepest zoom at which Esri's reference (label) layers carry
 * real content. Past z19 both reference services answer z20/z21
 * requests with a byte-identical transparent placeholder tile
 * (verified live 2026-11-27: same MD5 across services and
 * locations), so labels fetched deeper render as nothing. The
 * label layer therefore caps here and upscales — street names
 * stay visible at deep zooms instead of silently vanishing. */
export const SATELLITE_LABEL_MAX_ZOOM = 19;

/** The tile level to fetch LABEL tiles at for a view zoom. */
export function satelliteLabelZoom(viewZoom: number): number {
  return Math.min(viewZoom, SATELLITE_LABEL_MAX_ZOOM);
}

/** Upscale factor for the label layer at a view zoom — its own
 * factor, since labels are fetched at satelliteLabelZoom, which
 * can sit below the imagery's satelliteTileZoom. */
export function satelliteLabelUpscale(viewZoom: number): number {
  return 2 ** Math.max(0, viewZoom - satelliteLabelZoom(viewZoom));
}
/** Fixed size of the centred tile layer. It overscans the visible
 * dialog map area (max ~930×520) so the imagery fills the frame at
 * any dialog size while the layer centre — the address point —
 * stays glued to the frame centre where the pin sits. */
export const SATELLITE_VIEW_WIDTH = 1408;
export const SATELLITE_VIEW_HEIGHT = 1024;

const TILE_URL =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";

/** Broward County's own aerial tile service ("Aerials2026_V2",
 * Broward County Property Appraiser / BCGIS): 6-inch (0.152 m)
 * orthos flown January 2026 on the standard XYZ scheme — roughly
 * 2x sharper as delivered than Esri's Broward tiles (Esri embeds
 * the county's 2024 orthos but caps that block at z19, ≈0.27 m/px
 * delivered) and two years fresher. Free, anonymous, published by
 * the county for basemap use. (The v1 "Aerials2026" service is
 * deprecated by the county — V2 only.)
 *
 * Coverage is flight-block based, NOT the full rectangle below:
 * the item extent is the eastern county plus a buffer, and tiles
 * 404 outside the flown blocks (verified live 2026-11-27: a z19
 * tile at a Miramar point inside the extent 404s while z20/z21
 * tiles at the same point exist). Every Broward tile therefore
 * carries the Esri tile for the same slot as its fallbackSrc,
 * and the map components swap to it per tile on error — never
 * whole-map. */
export const BROWARD_AERIAL_TILE_URL =
  "https://tiles.arcgis.com/tiles/JMAJrTsHNLrSsWf5/arcgis/rest/services/Aerials2026_V2/MapServer/tile/{z}/{y}/{x}";

/** The Aerials2026_V2 item extent (lon −80.4590…−80.0700,
 * lat 25.9567…26.3638) — the rectangle inside which the Broward
 * layer is attempted. Points outside it never request Broward
 * tiles; points inside it may still 404 per tile (see above). */
export const BROWARD_AERIAL_EXTENT = {
  minLat: 25.9567,
  maxLat: 26.3638,
  minLon: -80.459,
  maxLon: -80.07,
} as const;

/** True when a map centre should try the Broward County aerial
 * layer first (per-tile Esri fallback still applies). */
export function browardAerialApplies(latitude: number, longitude: number): boolean {
  return (
    latitude >= BROWARD_AERIAL_EXTENT.minLat &&
    latitude <= BROWARD_AERIAL_EXTENT.maxLat &&
    longitude >= BROWARD_AERIAL_EXTENT.minLon &&
    longitude <= BROWARD_AERIAL_EXTENT.maxLon
  );
}

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
  /** Same-slot tile from the fallback layer (Esri World Imagery),
   * present only on Broward County tiles: when a Broward tile
   * fails to load (a 404 outside the flown blocks), the component
   * swaps this URL in for that tile only. */
  fallbackSrc?: string;
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
 * at (width/2, height/2) of the viewport by construction.
 *
 * Base layer: when the centre is inside the Broward County
 * aerial extent, tiles come from the county's sharper
 * Aerials2026_V2 service and each carries the Esri tile for the
 * same slot as fallbackSrc (the county's flight-block coverage
 * 404s per tile — see BROWARD_AERIAL_TILE_URL). Everywhere else
 * the tiles are Esri World Imagery directly. */
export function satelliteMapTiles(
  latitude: number,
  longitude: number,
  zoom: number,
  width = SATELLITE_VIEW_WIDTH,
  height = SATELLITE_VIEW_HEIGHT,
): SatelliteMapTile[] {
  if (!browardAerialApplies(latitude, longitude))
    return tilesForUrl(TILE_URL, "imagery", latitude, longitude, zoom, width, height);
  const fallback = tilesForUrl(TILE_URL, "imagery", latitude, longitude, zoom, width, height);
  return tilesForUrl(
    BROWARD_AERIAL_TILE_URL,
    "broward",
    latitude,
    longitude,
    zoom,
    width,
    height,
  ).map((tile, index) => ({ ...tile, fallbackSrc: fallback[index]!.src }));
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
