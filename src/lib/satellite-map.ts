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

export type SatelliteMapTile = {
  key: string;
  src: string;
  left: number;
  top: number;
};

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
  const tileCount = 2 ** zoom;
  const scale = SATELLITE_TILE_PX * tileCount;
  const centerX = ((longitude + 180) / 360) * scale;
  const latRad = (latitude * Math.PI) / 180;
  const centerY = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * scale;
  const originX = centerX - width / 2;
  const originY = centerY - height / 2;
  const firstTileX = Math.floor(originX / SATELLITE_TILE_PX);
  const lastTileX = Math.floor((originX + width - 1) / SATELLITE_TILE_PX);
  const firstTileY = Math.max(0, Math.floor(originY / SATELLITE_TILE_PX));
  const lastTileY = Math.min(tileCount - 1, Math.floor((originY + height - 1) / SATELLITE_TILE_PX));
  const tiles: SatelliteMapTile[] = [];
  for (let tileY = firstTileY; tileY <= lastTileY; tileY++) {
    for (let tileX = firstTileX; tileX <= lastTileX; tileX++) {
      const wrappedX = ((tileX % tileCount) + tileCount) % tileCount;
      tiles.push({
        key: `${zoom}/${tileY}/${tileX}`,
        src: TILE_URL.replace("{z}", String(zoom))
          .replace("{y}", String(tileY))
          .replace("{x}", String(wrappedX)),
        left: tileX * SATELLITE_TILE_PX - originX,
        top: tileY * SATELLITE_TILE_PX - originY,
      });
    }
  }
  return tiles;
}
