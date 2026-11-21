import type { RoofPlane } from './roof-geometry';
import { planeInfo } from './roof-geometry';
export type ImagePoint = { x: number; y: number };
export function calibratedPlane(points: ImagePoint[], reference: ImagePoint[], feet: number, pitch: number, id: string): RoofPlane {
  const a = reference[0], b = reference[1];
  if (!a || !b || !Number.isFinite(feet) || feet <= 0) throw new Error('Set two calibration points and a known distance');
  const pixels = Math.hypot(b.x - a.x, b.y - a.y);
  if (pixels < 1) throw new Error('Calibration points must be distinct');
  if (points.length < 3 || !Number.isFinite(pitch) || pitch < 0 || pitch > 24) throw new Error('Draw at least three corners and enter a valid pitch');
  const scale = feet / pixels, origin = points[0];
  if (!origin) throw new Error('Missing roof corners');
  const minY = Math.min(...points.map(p => p.y));
  const plane: RoofPlane = { id, name: 'Traced roof plane', points: points.map(p => ({ x: (p.x - origin.x) * scale, z: (p.y - origin.y) * scale, y: 10 + (p.y - minY) * scale * pitch / 12 })), edges: points.map(() => 'other') };
  planeInfo(plane);
  return plane;
}