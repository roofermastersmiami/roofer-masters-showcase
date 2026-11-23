import { describe, expect, it } from 'vitest';
import { snapToImageEdge } from './roof-edge-snap';

function pixels(width: number, height: number, value = 30) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = value; data[i * 4 + 1] = value; data[i * 4 + 2] = value; data[i * 4 + 3] = 255;
  }
  return data;
}

describe('snapToImageEdge', () => {
  it('snaps an approximate point to a strong vertical boundary', () => {
    const width = 40, height = 30, data = pixels(width, height);
    for (let y = 0; y < height; y++) for (let x = 20; x < width; x++) {
      const i = (y * width + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 230;
    }
    const result = snapToImageEdge(data, width, height, { x: 17, y: 14 }, 8, 100);
    expect(result).not.toBeNull();
    expect(result!.point.x).toBeGreaterThanOrEqual(19);
    expect(result!.point.x).toBeLessThanOrEqual(20);
  });

  it('returns null on a flat image and for invalid buffers', () => {
    expect(snapToImageEdge(pixels(20, 20), 20, 20, { x: 10, y: 10 })).toBeNull();
    expect(snapToImageEdge(new Uint8ClampedArray(4), 20, 20, { x: 10, y: 10 })).toBeNull();
  });

  it('keeps candidates inside the circular search radius', () => {
    const width = 30, height = 30, data = pixels(width, height);
    for (let y = 12; y < height; y++) for (let x = 12; x < width; x++) {
      const i = (y * width + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 240;
    }
    expect(snapToImageEdge(data, width, height, { x: 10, y: 10 }, 2, 100)).toBeNull();
  });

  it('clamps the search to image boundaries', () => {
    const data = pixels(12, 12);
    for (let y = 0; y < 12; y++) for (let x = 6; x < 12; x++) {
      const i = (y * 12 + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 240;
    }
    const result = snapToImageEdge(data, 12, 12, { x: 0, y: 0 }, 80, 100);
    expect(result).not.toBeNull();
    expect(result!.point.x).toBeGreaterThanOrEqual(5);
    expect(result!.point.x).toBeLessThanOrEqual(6);
    expect(result!.point.y).toBeGreaterThanOrEqual(1);
  });
});
