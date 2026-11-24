export type ResolvedRoofAddress = {
  matchedAddress: string;
  lat: number;
  lon: number;
};

/** Parse and validate the first US Census geocoder match without trusting remote payloads. */
export function parseRoofAddressMatch(
  payload: unknown,
  fallbackAddress: string,
): ResolvedRoofAddress | null {
  if (!payload || typeof payload !== "object") return null;
  const result = (payload as { result?: unknown }).result;
  if (!result || typeof result !== "object") return null;
  const matches = (result as { addressMatches?: unknown }).addressMatches;
  if (!Array.isArray(matches) || !matches.length) return null;
  const match = matches[0];
  if (!match || typeof match !== "object") return null;
  const candidate = match as {
    matchedAddress?: unknown;
    coordinates?: { x?: unknown; y?: unknown };
  };
  const lat = candidate.coordinates?.y;
  const lon = candidate.coordinates?.x;
  const matchedAddress =
    typeof candidate.matchedAddress === "string" && candidate.matchedAddress.trim()
      ? candidate.matchedAddress.trim()
      : fallbackAddress.trim();
  if (
    typeof lat !== "number" ||
    typeof lon !== "number" ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lon) ||
    lat < -90 ||
    lat > 90 ||
    lon < -180 ||
    lon > 180 ||
    matchedAddress.length < 5 ||
    matchedAddress.length > 250
  )
    return null;
  return { matchedAddress, lat, lon };
}
