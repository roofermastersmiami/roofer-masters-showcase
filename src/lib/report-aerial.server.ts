/**
 * Server-side aerial photo for report covers.
 *
 * Step 7 wired the cover photo through a browser-canvas tile stitch
 * (see aerial-photo.ts), but that path was never proven in a real
 * export: tile fetches from the browser depend on Esri's CORS
 * headers, and every validation render fell back to the sketch
 * cover. This module removes the browser from the loop — the server
 * fetches the property window itself, so a report export either
 * gets the real photo or a definite failure, never a silent CORS
 * question mark. The caller frames the window on the roof itself
 * (aerial-photo.ts roofCoverFraming: roof centre, extent sized to
 * the roof) and the client stitch receives the same centre and
 * extent, so both paths frame the property identically.
 *
 * Source chain (researched and endpoint-verified 2026-11-27 — the
 * counties' own orthophotography is the sharpest free imagery in
 * South Florida, far sharper than the federal NAIP baseline this
 * module used before):
 *
 * 1. Miami-Dade → the county's Woolpert2025 ImageServer
 *    exportImage at native 0.25 ft/px (3-inch, 2025) — about 4x
 *    finer than NAIP. Miami-Dade only; anonymous.
 * 2. Broward → the county's Aerials2026_V2 tile service (6-inch,
 *    flown Jan 2026) stitched server-side at z20. The service is
 *    TilesOnly (its export endpoint 404s), so the tiles are
 *    composited with the pure-JS jpeg-js codec this module now
 *    carries for exactly this purpose. Coverage is flight-block
 *    based: a tile that 404s is replaced by the Esri World
 *    Imagery tile for the same slot (Esri embeds the county's
 *    2024 orthos), and if any slot can't be filled either way the
 *    whole stitch is abandoned for the fallback below.
 * 3. Everywhere / any failure → USDA FPAC NAIP exportImage
 *    (Florida flown Nov 2025 at 0.3 m, public domain) — fresher
 *    than the USGS TNM NAIP copy (2022) this chain replaces.
 *
 * All sources are free and keyless. The returned `source` names
 * the imagery that actually produced the photo, and the report
 * cover prints it as the attribution line.
 */

import { decode as decodeJpeg, encode as encodeJpeg } from "jpeg-js";
import { AERIAL_SOURCE, aerialTilePlan } from "./aerial-photo";
import { BROWARD_AERIAL_EXTENT, BROWARD_AERIAL_TILE_URL } from "./satellite-map";

export const AERIAL_SOURCE_MIAMI_DADE = "Miami-Dade County GIS";
export const AERIAL_SOURCE_BROWARD = "Broward County GIS (BCPA)";
/** The universal fallback's attribution — USDA NAIP via the FPAC
 * geo-imagery service. Kept under the historical export name:
 * HousePhotoView mirrors this string for its cached-photo label. */
export const REPORT_AERIAL_SOURCE = "USDA National Agriculture Imagery Program (NAIP)";

const WOOLPERT_EXPORT_URL =
  "https://imageserverintra.miamidade.gov/arcgis/rest/services/Woolpert2025/ImageServer/exportImage";
const FPAC_EXPORT_URL =
  "https://apps.geo.fpac.usda.gov/geo-imagery/rest/services/naip/conus_naip/ImageServer/exportImage";
const ESRI_TILE_URL =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const MAX_BYTES = 10 * 1024 * 1024;
/** The Broward cover stitch is built from z20 tiles: z20 ground
 * resolution (≈0.134 m/px) matches the county's 6-inch source,
 * and z20 tiles exist at points where the z19 level has holes. */
const BROWARD_STITCH_ZOOM = 20;

export type AerialCounty = "broward" | "miami-dade" | "other";

/** Which county chain a point belongs to, from the coordinates
 * the aerial code path already has. Broward is the
 * Aerials2026_V2 item extent (the rectangle the county publishes
 * for the layer; its buffer strip reaches slightly into northern
 * Miami-Dade, where the Broward chain still produces a good photo
 * via its Esri-tile fallback). Miami-Dade is the county's
 * approximate bounding box. A boundary miss is safe: every chain
 * ends at the FPAC NAIP fallback, which covers both counties. */
export function aerialCountyFor(latitude: number, longitude: number): AerialCounty {
  if (
    latitude >= BROWARD_AERIAL_EXTENT.minLat &&
    latitude <= BROWARD_AERIAL_EXTENT.maxLat &&
    longitude >= BROWARD_AERIAL_EXTENT.minLon &&
    longitude <= BROWARD_AERIAL_EXTENT.maxLon
  )
    return "broward";
  if (latitude >= 25.1 && latitude <= 25.99 && longitude >= -81.0 && longitude <= -80.1)
    return "miami-dade";
  return "other";
}

function exportBbox(latitude: number, longitude: number, halfExtentMeters: number): string {
  const dLat = halfExtentMeters / 110540;
  const dLon = halfExtentMeters / (111320 * Math.cos((latitude * Math.PI) / 180));
  return [longitude - dLon, latitude - dLat, longitude + dLon, latitude + dLat]
    .map((value) => value.toFixed(7))
    .join(",");
}

function exportImageUrl(
  base: string,
  latitude: number,
  longitude: number,
  halfExtentMeters: number,
  sizePx: number,
): string {
  const params = new URLSearchParams({
    bbox: exportBbox(latitude, longitude, halfExtentMeters),
    bboxSR: "4326",
    imageSR: "4326",
    size: `${sizePx},${sizePx}`,
    format: "jpg",
    f: "image",
  });
  return `${base}?${params}`;
}

/** Woolpert2025 export at ~native resolution: the service's
 * pixels are 0.25 ft (0.0762 m), so the request size follows the
 * window instead of a fixed raster (bounded to sane cover
 * sizes). */
export function woolpertExportImageUrl(
  latitude: number,
  longitude: number,
  halfExtentMeters = 42,
): string {
  const nativePx = Math.round((2 * halfExtentMeters) / 0.0762);
  const sizePx = Math.min(2048, Math.max(512, nativePx));
  return exportImageUrl(WOOLPERT_EXPORT_URL, latitude, longitude, halfExtentMeters, sizePx);
}

export function fpacExportImageUrl(
  latitude: number,
  longitude: number,
  halfExtentMeters = 42,
  sizePx = 1024,
): string {
  return exportImageUrl(FPAC_EXPORT_URL, latitude, longitude, halfExtentMeters, sizePx);
}

type AttemptFailure = { error: string; stage: string; status?: number };

function failure(stage: string, message: string, status?: number) {
  // Do not log coordinates or image data.
  console.warn("Report aerial fetch failed", { stage, status: status ?? null });
  return { error: message, stage } as const;
}

/** One exportImage attempt against an ArcGIS ImageServer:
 * validated JPEG bytes, or a classified failure. */
async function fetchExportImage(
  url: string,
  sourceName: string,
  fetcher: typeof fetch,
): Promise<{ bytes: Uint8Array } | { failure: AttemptFailure }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  let response: Response | null = null;
  try {
    response = await fetcher(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: { Accept: "image/jpeg, image/*;q=0.8" },
    });
  } catch {
    response = null;
  } finally {
    clearTimeout(timer);
  }
  if (!response?.ok)
    return {
      failure: {
        stage: "imagery",
        status: response?.status,
        error: response
          ? `${sourceName} imagery returned HTTP ${response.status}.`
          : `Could not connect to ${sourceName} imagery or the request timed out.`,
      },
    };
  const contentType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  if (contentType !== "image/jpeg" && contentType !== "image/jpg")
    return {
      failure: {
        stage: "imagery_response",
        status: response.status,
        error: `${sourceName} returned a service error instead of a JPEG aerial image.`,
      },
    };
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await response.arrayBuffer());
  } catch {
    return {
      failure: { stage: "imagery_download", error: "The aerial image download was interrupted." },
    };
  }
  if (bytes.length > MAX_BYTES)
    return {
      failure: { stage: "imagery_size", error: "The aerial image exceeds the 10 MB upload limit." },
    };
  // JPEG SOI marker; an ArcGIS error page can arrive with a 200 status.
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8)
    return {
      failure: {
        stage: "imagery_response",
        status: response.status,
        error: `${sourceName} returned an empty or invalid aerial image.`,
      },
    };
  return { bytes };
}

/** Fetch one stitch tile's pixels: the Broward County tile, or —
 * when the county has no tile for that slot (flight-block
 * coverage) or it doesn't decode — the Esri tile for the same
 * slot. Null when neither source can fill the slot. */
async function fetchStitchTile(
  tile: { x: number; y: number },
  zoom: number,
  fetcher: typeof fetch,
  signal: AbortSignal,
): Promise<{ rgba: Uint8Array; broward: boolean } | null> {
  const attempts: { url: string; broward: boolean }[] = [
    {
      url: BROWARD_AERIAL_TILE_URL.replace("{z}", String(zoom))
        .replace("{y}", String(tile.y))
        .replace("{x}", String(tile.x)),
      broward: true,
    },
    {
      url: ESRI_TILE_URL.replace("{z}", String(zoom))
        .replace("{y}", String(tile.y))
        .replace("{x}", String(tile.x)),
      broward: false,
    },
  ];
  for (const attempt of attempts) {
    try {
      const response = await fetcher(attempt.url, {
        signal,
        redirect: "follow",
        headers: { Accept: "image/jpeg, image/*;q=0.8" },
      });
      if (!response.ok) continue;
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) continue;
      const decoded = decodeJpeg(bytes, { useTArray: true, formatAsRGBA: true });
      if (decoded.width !== 256 || decoded.height !== 256) continue;
      return { rgba: decoded.data, broward: attempt.broward };
    } catch {
      // Try the next source for this slot.
    }
  }
  return null;
}

/** The Broward cover: Aerials2026_V2 z20 tiles stitched over the
 * caller's framing (the same tile plan the browser stitch uses),
 * cropped to the framed window and re-encoded as one JPEG.
 * Returns the bytes plus the honest attribution for the tiles
 * that actually filled the frame, or null when the stitch can't
 * be completed (the caller falls back to FPAC NAIP). */
async function stitchBrowardCover(
  latitude: number,
  longitude: number,
  halfExtentMeters: number,
  fetcher: typeof fetch,
): Promise<{ bytes: Uint8Array; source: string } | null> {
  const plan = aerialTilePlan(latitude, longitude, BROWARD_STITCH_ZOOM, halfExtentMeters);
  const tileMinX = Math.min(...plan.tiles.map((tile) => tile.x));
  const tileMinY = Math.min(...plan.tiles.map((tile) => tile.y));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const tiles = await Promise.all(
      plan.tiles.map((tile) => fetchStitchTile(tile, plan.zoom, fetcher, controller.signal)),
    );
    if (tiles.some((tile) => tile === null)) return null;
    const canvas = new Uint8Array(plan.canvas.width * plan.canvas.height * 4);
    let browardTiles = 0;
    plan.tiles.forEach((tile, index) => {
      const filled = tiles[index]!;
      if (filled.broward) browardTiles += 1;
      const offsetX = (tile.x - tileMinX) * 256;
      const offsetY = (tile.y - tileMinY) * 256;
      for (let row = 0; row < 256; row++) {
        const src = row * 256 * 4;
        const dst = ((offsetY + row) * plan.canvas.width + offsetX) * 4;
        canvas.set(filled.rgba.subarray(src, src + 256 * 4), dst);
      }
    });
    const size = plan.crop.size;
    // The plan's crop origin is fractional (the window centres on
    // the exact lat/lon). The browser stitch hands the fraction to
    // drawImage, which samples sub-pixel; a raw byte copy must
    // round to whole pixels first — an unrounded offset truncates
    // to a byte index that is not a multiple of 4, rotating every
    // pixel's channels (alpha lands in red). Half a pixel of
    // framing is invisible; rotated channels are not.
    const cropX = Math.round(plan.crop.x);
    const cropY = Math.round(plan.crop.y);
    const cropped = new Uint8Array(size * size * 4);
    for (let row = 0; row < size; row++) {
      const src = ((cropY + row) * plan.canvas.width + cropX) * 4;
      cropped.set(canvas.subarray(src, src + size * 4), row * size * 4);
    }
    const encoded = encodeJpeg({ width: size, height: size, data: cropped }, 85);
    const bytes = new Uint8Array(encoded.data);
    if (bytes.length > MAX_BYTES) return null;
    const source =
      browardTiles === plan.tiles.length
        ? AERIAL_SOURCE_BROWARD
        : browardTiles === 0
          ? AERIAL_SOURCE
          : `${AERIAL_SOURCE_BROWARD} / Esri World Imagery`;
    return { bytes, source };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function success(bytes: Uint8Array, source: string, latitude: number, longitude: number) {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { imageBase64: btoa(bin), mime: "image/jpeg", source, latitude, longitude } as const;
}

export async function fetchReportAerialImage(
  latitude: number,
  longitude: number,
  fetcher: typeof fetch = fetch,
  halfExtentMeters = 42,
) {
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    Math.abs(latitude) >= 85 ||
    Math.abs(longitude) > 180
  )
    return failure("coordinates", "The drawing has no usable map coordinates for an aerial photo.");
  const extent = Number.isFinite(halfExtentMeters)
    ? Math.min(60, Math.max(15, halfExtentMeters))
    : 42;
  const county = aerialCountyFor(latitude, longitude);
  if (county === "miami-dade") {
    const result = await fetchExportImage(
      woolpertExportImageUrl(latitude, longitude, extent),
      "Miami-Dade County",
      fetcher,
    );
    if ("bytes" in result)
      return success(result.bytes, AERIAL_SOURCE_MIAMI_DADE, latitude, longitude);
    // Fall through to the universal fallback; its outcome decides
    // what the caller hears.
  } else if (county === "broward") {
    const stitched = await stitchBrowardCover(latitude, longitude, extent, fetcher);
    if (stitched) return success(stitched.bytes, stitched.source, latitude, longitude);
    // Fall through to the universal fallback.
  }
  const fallbackResult = await fetchExportImage(
    fpacExportImageUrl(latitude, longitude, extent),
    "USDA NAIP",
    fetcher,
  );
  if ("bytes" in fallbackResult)
    return success(fallbackResult.bytes, REPORT_AERIAL_SOURCE, latitude, longitude);
  const { stage, error, status } = fallbackResult.failure;
  return failure(stage, error, status);
}
