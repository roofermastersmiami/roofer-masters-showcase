export const AERIAL_CREDIT = 'Imagery: USGS The National Map (public domain). Geocoding: US Census Bureau.';
const R = 6378137;
/** Square Web-Mercator box centred on a point, sized in true ground meters, with the resulting ground feet per pixel. */
export function aerialBox(lat: number, lon: number, spanMeters: number, pixels: number) {
  if (!Number.isFinite(lat) || Math.abs(lat) >= 85) throw new Error('Latitude must be between -85 and 85 degrees.');
  if (!Number.isFinite(lon) || Math.abs(lon) > 180) throw new Error('Longitude must be between -180 and 180 degrees.');
  if (!Number.isFinite(spanMeters) || spanMeters <= 0 || spanMeters > 5000) throw new Error('Map span must be greater than 0 and no more than 5,000 meters.');
  if (!Number.isFinite(pixels) || pixels <= 0) throw new Error('Image size must be a positive number of pixels.');
  const x = R * lon * Math.PI / 180, y = R * Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360));
  const half = spanMeters / Math.cos(lat * Math.PI / 180) / 2; // mercator units stretch by 1/cos(lat)
  return { bbox: [x - half, y - half, x + half, y + half], feetPerPixel: spanMeters * 3.28084 / pixels };
}
export const ACCURACY_LABELS = { photo_estimate: 'Estimated from photo / public aerial', scaled: 'Scaled from a known measured distance', site_verified: 'Verified on site' } as const;
export type Accuracy = keyof typeof ACCURACY_LABELS;
