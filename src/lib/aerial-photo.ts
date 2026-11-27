/**
 * Free aerial imagery for report cover pages.
 *
 * Source: Esri World Imagery (free for use with attribution —
 * "Esri, Maxar, Earthstar Geographics"). Tiles are stitched in the
 * browser at zoom 19 (~0.27 m/px at South Florida latitudes) around
 * the property and cropped to a square window centred on it. This
 * is the FALLBACK path: report generation fetches the same window
 * server-side first (report-aerial.server.ts — one exportImage
 * request, no browser CORS dependency); this stitch runs only when
 * the server fetch is unavailable. Either way the photo arrives
 * automatically when a report is generated for a drawing that has
 * a geographic origin and no stored aerial photo — address in,
 * report out, no manual photo fetching (Fredy's hands-off rule).
 *
 * Any failure (offline, tile missing, CORS, canvas unavailable)
 * returns null and the report falls back to its sketch cover: the
 * report never blocks on imagery.
 */

export const AERIAL_SOURCE = "Esri World Imagery — Esri, Maxar, Earthstar Geographics";
const TILE_URL =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const TILE_PX = 256;

export type AerialTilePlan = {
  zoom: number;
  tiles: { x: number; y: number }[];
  /** Pixel rect of the property window inside the stitched canvas. */
  crop: { x: number; y: number; size: number };
  canvas: { width: number; height: number };
};

const lonLatToGlobalPx = (lon: number, lat: number, zoom: number) => {
  const scale = 2 ** zoom * TILE_PX;
  const x = ((lon + 180) / 360) * scale;
  const latRad = (lat * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * scale;
  return { x, y };
};

/** Pure tile math (unit-tested): which tiles to fetch and where the
 * centred square window sits in the stitched canvas. */
export function aerialTilePlan(
  latitude: number,
  longitude: number,
  zoom = 19,
  halfExtentMeters = 42,
): AerialTilePlan {
  const center = lonLatToGlobalPx(longitude, latitude, zoom);
  const metersPerPixel = (156543.03392 * Math.cos((latitude * Math.PI) / 180)) / 2 ** zoom;
  const halfPx = Math.max(64, Math.round(halfExtentMeters / metersPerPixel));
  const minX = center.x - halfPx;
  const minY = center.y - halfPx;
  const size = halfPx * 2;
  const tileMinX = Math.floor(minX / TILE_PX);
  const tileMinY = Math.floor(minY / TILE_PX);
  const tileMaxX = Math.floor((minX + size - 1) / TILE_PX);
  const tileMaxY = Math.floor((minY + size - 1) / TILE_PX);
  const tiles: { x: number; y: number }[] = [];
  for (let x = tileMinX; x <= tileMaxX; x++)
    for (let y = tileMinY; y <= tileMaxY; y++) tiles.push({ x, y });
  return {
    zoom,
    tiles,
    crop: { x: minX - tileMinX * TILE_PX, y: minY - tileMinY * TILE_PX, size },
    canvas: {
      width: (tileMaxX - tileMinX + 1) * TILE_PX,
      height: (tileMaxY - tileMinY + 1) * TILE_PX,
    },
  };
}

export type AerialPhoto = {
  bytes: Uint8Array;
  mime: string;
  category: string;
  name: string;
  source: string;
  latitude: number;
  longitude: number;
};

export type RoofCoverFraming = {
  latitude: number;
  longitude: number;
  halfExtentMeters: number;
};

/**
 * Cover framing for a drawing (pure, unit-tested): centre the
 * photo window on the roof itself rather than the geocode origin —
 * Miramar's origin sits ~64 ft from its roof centre, which left
 * the house small and off-centre in the step-8 covers — and size
 * the window to the roof instead of a fixed ±42 m. The cover's
 * picture box is wider than it is tall (612×444 pt), so a square
 * photo shows only its middle 444/612 vertically; the window is
 * the smallest square that keeps the whole roof in frame with a
 * 30% margin on both axes once that crop is accounted for,
 * clamped to [24, 42] m so a small roof still shows some street
 * context and a large roof never frames wider than before. Local
 * plan coordinates follow the converter's convention: x east and
 * z SOUTH of the origin (z = (originLat − lat) × scale), so the
 * centre latitude subtracts the centre z.
 */
export function roofCoverFraming(drawing: {
  planes: { points: { x: number; z: number }[] }[];
  geo_reference?: { originLatitude: number; originLongitude: number } | null;
}): RoofCoverFraming | null {
  const origin = drawing.geo_reference;
  if (!origin) return null;
  const points = drawing.planes.flatMap((plane) => plane.points);
  if (!points.length) return null;
  const minX = Math.min(...points.map((point) => point.x));
  const maxX = Math.max(...points.map((point) => point.x));
  const minZ = Math.min(...points.map((point) => point.z));
  const maxZ = Math.max(...points.map((point) => point.z));
  const feetToMeters = 0.3048;
  const centerXFt = (minX + maxX) / 2;
  const centerZFt = (minZ + maxZ) / 2;
  const latitude = origin.originLatitude - (centerZFt * feetToMeters) / 110540;
  const longitude =
    origin.originLongitude +
    (centerXFt * feetToMeters) / (111320 * Math.cos((origin.originLatitude * Math.PI) / 180));
  const eastWestM = (maxX - minX) * feetToMeters;
  const northSouthM = (maxZ - minZ) * feetToMeters;
  const halfExtentMeters = Math.min(
    42,
    Math.max(24, eastWestM * 0.65, northSouthM * (0.65 / (444 / 612))),
  );
  return { latitude, longitude, halfExtentMeters };
}

export async function fetchAerialPhoto(
  latitude: number,
  longitude: number,
  halfExtentMeters?: number,
): Promise<AerialPhoto | null> {
  try {
    const plan = aerialTilePlan(latitude, longitude, 19, halfExtentMeters);
    const tileMinX = Math.min(...plan.tiles.map((t) => t.x));
    const tileMinY = Math.min(...plan.tiles.map((t) => t.y));
    const canvas = document.createElement("canvas");
    canvas.width = plan.canvas.width;
    canvas.height = plan.canvas.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    await Promise.all(
      plan.tiles.map(async (tile) => {
        const url = TILE_URL.replace("{z}", String(plan.zoom))
          .replace("{y}", String(tile.y))
          .replace("{x}", String(tile.x));
        const response = await fetch(url);
        if (!response.ok) throw new Error(`aerial tile ${response.status}`);
        const bitmap = await createImageBitmap(await response.blob());
        ctx.drawImage(bitmap, (tile.x - tileMinX) * TILE_PX, (tile.y - tileMinY) * TILE_PX);
        bitmap.close();
      }),
    );
    const cropped = document.createElement("canvas");
    cropped.width = plan.crop.size;
    cropped.height = plan.crop.size;
    const croppedCtx = cropped.getContext("2d");
    if (!croppedCtx) return null;
    croppedCtx.drawImage(
      canvas,
      plan.crop.x,
      plan.crop.y,
      plan.crop.size,
      plan.crop.size,
      0,
      0,
      plan.crop.size,
      plan.crop.size,
    );
    const blob = await new Promise<Blob | null>((resolve) =>
      cropped.toBlob(resolve, "image/jpeg", 0.88),
    );
    if (!blob) return null;
    return {
      bytes: new Uint8Array(await blob.arrayBuffer()),
      mime: "image/jpeg",
      category: "aerial",
      name: "Aerial photo (Esri World Imagery)",
      source: AERIAL_SOURCE,
      latitude,
      longitude,
    };
  } catch {
    return null;
  }
}
