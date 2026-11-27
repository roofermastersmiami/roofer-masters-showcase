/**
 * Server-side aerial photo for report covers.
 *
 * Step 7 wired the cover photo through a browser-canvas tile stitch
 * (see aerial-photo.ts), but that path was never proven in a real
 * export: tile fetches from the browser depend on Esri's CORS
 * headers, and every validation render fell back to the sketch
 * cover. This module removes the browser from the loop — the server
 * asks an ArcGIS ImageServer for one ready JPEG of the property
 * window, so a report export either gets the real photo or a
 * definite failure, never a silent CORS question mark.
 *
 * Imagery source: USGS National Agriculture Imagery Program (NAIP)
 * via The National Map — the same free federal imagery the
 * satellite-trace flow already imports (public-aerial.server.ts),
 * public domain, no key. Esri World Imagery's MapServer was tried
 * first and rejects exportImage outright ("Invalid URL"); its tile
 * endpoint works but stitching tiles needs a JPEG codec the server
 * runtime does not carry, so the client-side Esri stitch remains
 * the fallback in RoofMeasurements and this NAIP export is the
 * primary. The caller frames the window on the roof itself
 * (aerial-photo.ts roofCoverFraming: roof centre, extent sized to
 * the roof) and the client stitch receives the same centre and
 * extent, so both paths frame the property identically.
 */

export const REPORT_AERIAL_SOURCE =
  "USGS National Agriculture Imagery Program (NAIP) via The National Map";

const IMAGE_SERVER_EXPORT_URL =
  "https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer/exportImage";
const MAX_BYTES = 10 * 1024 * 1024;

export function naipExportImageUrl(
  latitude: number,
  longitude: number,
  halfExtentMeters = 42,
  sizePx = 1024,
): string {
  const dLat = halfExtentMeters / 110540;
  const dLon = halfExtentMeters / (111320 * Math.cos((latitude * Math.PI) / 180));
  const params = new URLSearchParams({
    bbox: [longitude - dLon, latitude - dLat, longitude + dLon, latitude + dLat]
      .map((value) => value.toFixed(7))
      .join(","),
    bboxSR: "4326",
    imageSR: "4326",
    size: `${sizePx},${sizePx}`,
    format: "jpg",
    pixelType: "U8",
    noDataInterpretation: "esriNoDataMatchAny",
    interpolation: "+RSP_BilinearInterpolation",
    f: "image",
  });
  return `${IMAGE_SERVER_EXPORT_URL}?${params}`;
}

function failure(stage: string, message: string, status?: number) {
  // Do not log coordinates or image data.
  console.warn("Report aerial fetch failed", { stage, status: status ?? null });
  return { error: message, stage } as const;
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
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  let response: Response | null = null;
  try {
    response = await fetcher(naipExportImageUrl(latitude, longitude, extent), {
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
    return failure(
      "imagery",
      response
        ? `USGS NAIP imagery returned HTTP ${response.status}.`
        : "Could not connect to USGS NAIP imagery or the request timed out.",
      response?.status,
    );
  const contentType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  if (contentType !== "image/jpeg" && contentType !== "image/jpg")
    return failure(
      "imagery_response",
      "USGS returned a service error instead of a JPEG aerial image.",
      response.status,
    );
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await response.arrayBuffer());
  } catch {
    return failure("imagery_download", "The aerial image download was interrupted.");
  }
  if (bytes.length > MAX_BYTES)
    return failure("imagery_size", "The aerial image exceeds the 10 MB upload limit.");
  // JPEG SOI marker; an ArcGIS error page can arrive with a 200 status.
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8)
    return failure("imagery_response", "USGS returned an empty or invalid aerial image.");
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return {
    imageBase64: btoa(bin),
    mime: "image/jpeg",
    source: REPORT_AERIAL_SOURCE,
    latitude,
    longitude,
  } as const;
}
