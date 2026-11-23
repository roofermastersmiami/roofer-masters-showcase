export const AERIAL_CREDIT =
  "Imagery: USGS The National Map (public domain). Geocoding: US Census Bureau.";
const R = 6378137;
/** Square Web-Mercator box centred on a point, sized in true ground meters, with the resulting ground feet per pixel. */
export function aerialBox(lat: number, lon: number, spanMeters: number, pixels: number) {
  if (!Number.isFinite(lat) || Math.abs(lat) >= 85)
    throw new Error("Aerial latitude must be finite and within Web Mercator coverage.");
  if (!Number.isFinite(lon) || Math.abs(lon) > 180)
    throw new Error("Aerial longitude must be finite and between -180 and 180 degrees.");
  if (!Number.isFinite(spanMeters) || spanMeters <= 0 || spanMeters > 10000)
    throw new Error("Aerial ground span must be greater than 0 and no more than 10,000 meters.");
  if (!Number.isSafeInteger(pixels) || pixels <= 0 || pixels > 10000)
    throw new Error(
      "Aerial image dimensions must be positive safe integers no greater than 10,000 pixels.",
    );
  const x = (R * lon * Math.PI) / 180,
    y = R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
  const half = spanMeters / Math.cos((lat * Math.PI) / 180) / 2; // mercator units stretch by 1/cos(lat)
  const bbox = [x - half, y - half, x + half, y + half];
  const feetPerPixel = (spanMeters * 3.28084) / pixels;
  if (![...bbox, feetPerPixel].every(Number.isFinite) || feetPerPixel <= 0)
    throw new Error("Aerial map scale is outside the supported numeric range.");
  return { bbox, feetPerPixel };
}
export const ACCURACY_LABELS = {
  photo_estimate: "Estimated from photo / public aerial",
  scaled: "Scaled from a known measured distance",
  site_verified: "Verified on site",
} as const;
export type Accuracy = keyof typeof ACCURACY_LABELS;
