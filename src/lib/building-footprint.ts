export type FootprintPoint = { lat: number; lon: number };
export type BuildingFootprint = {
  id: number;
  points: FootprintPoint[];
  areaSqFt: number;
  center: FootprintPoint;
  distanceMeters: number;
  buildingType: string;
};
type OverpassElement = {
  type?: unknown;
  id?: unknown;
  tags?: unknown;
  geometry?: unknown;
};
const EARTH_RADIUS_M = 6371008.8;
function validPoint(value: unknown): value is FootprintPoint {
  if (!value || typeof value !== "object") return false;
  const point = value as Record<string, unknown>;
  return typeof point.lat === "number" && Number.isFinite(point.lat) &&
    Math.abs(point.lat) <= 90 && typeof point.lon === "number" &&
    Number.isFinite(point.lon) && Math.abs(point.lon) <= 180;
}
function localXY(point: FootprintPoint, originLat: number): [number, number] {
  const radians = Math.PI / 180;
  return [
    EARTH_RADIUS_M * point.lon * radians * Math.cos(originLat * radians),
    EARTH_RADIUS_M * point.lat * radians,
  ];
}
function polygonArea(points: FootprintPoint[], originLat: number): number {
  const xy = points.map((point) => localXY(point, originLat));
  let twiceArea = 0;
  for (let i = 0; i < xy.length; i += 1) {
    const a = xy[i]!;
    const b = xy[(i + 1) % xy.length]!;
    twiceArea += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(twiceArea) / 2;
}
function haversine(a: FootprintPoint, b: FootprintPoint): number {
  const radians = Math.PI / 180;
  const dLat = (b.lat - a.lat) * radians;
  const dLon = (b.lon - a.lon) * radians;
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * radians) * Math.cos(b.lat * radians) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}
/** Parse public OSM building ways as approximate ground footprints, never roof facets. */
export function parseBuildingFootprints(
  raw: unknown,
  origin: FootprintPoint,
  maxDistanceMeters = 100,
): BuildingFootprint[] {
  if (!validPoint(origin) || !Number.isFinite(maxDistanceMeters) ||
      maxDistanceMeters < 10 || maxDistanceMeters > 500) return [];
  if (!raw || typeof raw !== "object" || !Array.isArray((raw as { elements?: unknown }).elements))
    return [];
  const elements = (raw as { elements: OverpassElement[] }).elements;
  const results: BuildingFootprint[] = [];
  for (const element of elements) {
    if (!element || typeof element !== "object" || element.type !== "way" || typeof element.id !== "number" ||
        !Number.isSafeInteger(element.id) || !Array.isArray(element.geometry)) continue;
    if (!element.geometry.every(validPoint)) continue;
    const points = element.geometry as FootprintPoint[];
    if (points.length < 4) continue;
    const first = points[0]!;
    const last = points[points.length - 1]!;
    if (haversine(first, last) > 1) continue;
    const openRing = points.slice(0, -1);
    if (openRing.length < 3 || openRing.length > 200) continue;
    // Use the polygon centroid rather than the vertex average so irregular
    // and concave footprints are located by their area, not vertex density.
    const meanLat = openRing.reduce((sum, point) => sum + point.lat, 0) / openRing.length;
    const longitudeScale = Math.cos(meanLat * Math.PI / 180);
    const projected = openRing.map((point) => ({
      x: point.lon * longitudeScale,
      y: point.lat,
    }));
    let twiceSignedArea = 0;
    let centroidX = 0;
    let centroidY = 0;
    for (let i = 0; i < projected.length; i += 1) {
      const a = projected[i]!;
      const b = projected[(i + 1) % projected.length]!;
      const cross = a.x * b.y - b.x * a.y;
      twiceSignedArea += cross;
      centroidX += (a.x + b.x) * cross;
      centroidY += (a.y + b.y) * cross;
    }
    const center = Math.abs(twiceSignedArea) > 1e-12
      ? {
          lat: centroidY / (3 * twiceSignedArea),
          lon: centroidX / (3 * twiceSignedArea * longitudeScale),
        }
      : {
          lat: meanLat,
          lon: openRing.reduce((sum, point) => sum + point.lon, 0) / openRing.length,
        };
    const distanceMeters = haversine(origin, center);
    if (distanceMeters > maxDistanceMeters) continue;
    const areaSqM = polygonArea(openRing, center.lat);
    if (!Number.isFinite(areaSqM) || areaSqM < 20 || areaSqM > 5000) continue;
    const tags = element.tags && typeof element.tags === "object"
      ? element.tags as Record<string, unknown> : {};
    results.push({
      id: element.id,
      points: openRing,
      areaSqFt: Math.round(areaSqM * 10.7639),
      center,
      distanceMeters: Math.round(distanceMeters * 10) / 10,
      buildingType: typeof tags.building === "string" ? tags.building.slice(0, 40) : "yes",
    });
  }
  return results.sort((a, b) => a.distanceMeters - b.distanceMeters).slice(0, 8);
}
