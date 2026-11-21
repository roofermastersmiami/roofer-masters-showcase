export const AERIAL_CREDIT = 'Imagery: USGS The National Map (public domain). Geocoding: US Census Bureau.';
const R = 6378137;
/** Square Web-Mercator box centred on a point, sized in true ground meters, with the resulting ground feet per pixel. */
export function aerialBox(lat: number, lon: number, spanMeters: number, pixels: number) {
  const x = R * lon * Math.PI / 180, y = R * Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360));
  const half = spanMeters / Math.cos(lat * Math.PI / 180) / 2; // mercator units stretch by 1/cos(lat)
  return { bbox: [x - half, y - half, x + half, y + half], feetPerPixel: spanMeters * 3.28084 / pixels };
}
export const ACCURACY_LABELS = { photo_estimate: 'Estimated from photo / public aerial', scaled: 'Scaled from a known measured distance', site_verified: 'Verified on site' } as const;
export type Accuracy = keyof typeof ACCURACY_LABELS;
