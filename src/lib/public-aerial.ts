export const AERIAL_CREDIT =
  "Imagery: USGS The National Map (public domain). Geocoding: US Census Bureau.";
const R = 6378137;
/** Square Web-Mercator request bounds centred on a point and sized in true ground meters. */
export function aerialBox(lat: number, lon: number, spanMeters: number) {
  if (!Number.isFinite(lat) || Math.abs(lat) >= 85)
    throw new Error("Latitude must be between -85 and 85 degrees.");
  if (!Number.isFinite(lon) || Math.abs(lon) > 180)
    throw new Error("Longitude must be between -180 and 180 degrees.");
  if (!Number.isFinite(spanMeters) || spanMeters <= 0 || spanMeters > 5000)
    throw new Error("Map span must be greater than 0 and no more than 5,000 meters.");
  const x = (R * lon * Math.PI) / 180,
    y = R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
  const half = spanMeters / Math.cos((lat * Math.PI) / 180) / 2; // mercator units stretch by 1/cos(lat)
  return { bbox: [x - half, y - half, x + half, y + half] };
}
export const ACCURACY_LABELS = {
  photo_estimate: "Estimated from photo / public aerial",
  public_lidar_estimate: "Preliminary estimate from public LiDAR elevation data",
  scaled: "Scaled from a known measured distance",
  site_verified: "Verified on site",
} as const;
export type Accuracy = keyof typeof ACCURACY_LABELS;
