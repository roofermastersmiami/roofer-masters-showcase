import { aerialBox, AERIAL_CREDIT } from "./public-aerial";
const FALLBACK =
  " Use Add image to upload your own aerial/drone photo, then calibrate and trace it.";
const MAX_BYTES = 10 * 1024 * 1024;
function failure(stage: string, message: string, status?: number) {
  // Do not log addresses, coordinates, images or sessions.
  console.warn("Public aerial import failed", { stage, status: status ?? null });
  return { error: message + FALLBACK, stage } as const;
}
async function request(url: string, timeout: number, fetcher: typeof fetch) {
  try {
    return await fetcher(url, { signal: AbortSignal.timeout(timeout), redirect: "manual" });
  } catch {
    return null;
  }
}
/** Fixed keyless Census/USGS sources only; never fetch user-supplied URLs. */
export async function fetchPublicAerial(
  address: string,
  spanMeters: number,
  fetcher: typeof fetch = fetch,
) {
  const geo = await request(
    `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=${encodeURIComponent(address)}&benchmark=Public_AR_Current&format=json`,
    15000,
    fetcher,
  );
  if (!geo?.ok)
    return failure(
      "geocoding",
      "The free Census address lookup is unavailable or timed out. Try again later.",
      geo?.status,
    );
  let body: string;
  try {
    body = await geo.text();
  } catch {
    return failure("geocoding_response", "The free Census response could not be read.", geo.status);
  }

  let result: unknown;
  try {
    result = JSON.parse(body);
  } catch {
    const contentType = geo.headers.get("content-type") ?? "unknown";
    return failure(
      "geocoding_response",
      `Census returned a non-JSON response (${contentType}, HTTP ${geo.status}).`,
      geo.status,
    );
  }
  const matches = (result as { result?: { addressMatches?: unknown[] } } | null)?.result
    ?.addressMatches;
  const match = Array.isArray(matches)
    ? (matches[0] as
        { coordinates?: { x?: unknown; y?: unknown }; matchedAddress?: unknown } | undefined)
    : undefined;
  if (!match)
    return failure(
      "address_not_found",
      "The free Census lookup could not find this address. Check the street, city and ZIP code.",
    );
  const lat = match.coordinates?.y,
    lon = match.coordinates?.x;
  if (
    typeof lat !== "number" ||
    typeof lon !== "number" ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lon) ||
    Math.abs(lat) >= 85 ||
    Math.abs(lon) > 180 ||
    typeof match.matchedAddress !== "string"
  )
    return failure(
      "geocoding_response",
      "The free address service did not return usable map coordinates.",
    );
  const box = aerialBox(lat, lon, spanMeters, 2000);
  const params = new URLSearchParams({
    bbox: box.bbox.join(","),
    bboxSR: "3857",
    imageSR: "3857",
    size: "2000,2000",
    format: "png",
    f: "image",
  });
  const img = await request(
    `https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPPlus/ImageServer/export?${params}`,
    25000,
    fetcher,
  );
  if (!img?.ok) {
    return failure(
      "imagery",
      img
        ? `Miami-Dade imagery service returned HTTP ${img.status}.`
        : "Could not connect to the Miami-Dade imagery service or the request timed out.",
      img?.status,
    );
  }
  if (img.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "image/png")
    return failure(
      "imagery_response",
      "USGS returned a service error instead of a PNG aerial image.",
      img.status,
    );
  if (Number(img.headers.get("content-length")) > MAX_BYTES)
    return failure("imagery_size", "The aerial image exceeds the 10 MB upload limit.");
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await img.arrayBuffer());
  } catch {
    return failure("imagery_download", "The aerial image download was interrupted. Try again.");
  }
  if (bytes.length > MAX_BYTES)
    return failure("imagery_size", "The aerial image exceeds the 10 MB upload limit.");
  if (bytes.length < 24 || ![137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v))
    return failure("imagery_response", "USGS returned an empty or invalid aerial image.");
  const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (header.getUint32(16) !== 2000 || header.getUint32(20) !== 2000)
    return failure(
      "imagery_dimensions",
      "USGS returned unexpected image dimensions; the map scale cannot be trusted.",
    );
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return {
    image: `data:image/png;base64,${btoa(bin)}`,
    feetPerPixel: box.feetPerPixel,
    matchedAddress: match.matchedAddress,
    lat,
    lon,
    credit: AERIAL_CREDIT,
  } as const;
}
