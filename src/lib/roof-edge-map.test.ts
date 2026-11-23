import { describe, expect, it } from "vitest";
import { createRoofEdgeMap } from "./roof-edge-map";

function image(width: number, height: number, value = 30) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = value;
    data[i * 4 + 3] = 255;
  }
  return data;
}

describe("createRoofEdgeMap", () => {
  it("highlights a strong image boundary with transparent pixels elsewhere", () => {
    const width = 20,
      height = 16,
      data = image(width, height);
    for (let y = 0; y < height; y++)
      for (let x = 10; x < width; x++) {
        const i = (y * width + x) * 4;
        data[i] = data[i + 1] = data[i + 2] = 230;
      }
    const result = createRoofEdgeMap(data, width, height, 80);
    expect(result).not.toBeNull();
    const edge = result!.rgba[(8 * width + 9) * 4 + 3]!;
    const flat = result!.rgba[(8 * width + 3) * 4 + 3]!;
    expect(edge).toBeGreaterThan(0);
    expect(flat).toBe(0);
  });

  it("returns an empty guide for a flat image", () => {
    const result = createRoofEdgeMap(image(12, 12), 12, 12, 50);
    expect(result).not.toBeNull();
    expect(result!.rgba.every((v, i) => i % 4 !== 3 || v === 0)).toBe(true);
  });

  it("rejects malformed dimensions, buffers and thresholds", () => {
    expect(createRoofEdgeMap(image(2, 2), 2, 2)).toBeNull();
    expect(createRoofEdgeMap(new Uint8ClampedArray(4), 10, 10)).toBeNull();
    expect(createRoofEdgeMap(image(10, 10), 10, 10, -1)).toBeNull();
  });
});
