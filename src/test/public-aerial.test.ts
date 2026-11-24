import { describe, it, expect } from "vitest";
import { aerialBox } from "@/lib/public-aerial";
describe("public aerial request bounds", () => {
  it("returns map bounds without claiming a pixel measurement scale", () => {
    const result = aerialBox(25.47, -80.48, 70);
    expect(result).not.toHaveProperty("feetPerPixel");
    expect(result.bbox).toHaveLength(4);
  });
  it("widens the mercator box by 1/cos(latitude) so ground span stays 70 m", () => {
    const b = aerialBox(25.47, -80.48, 70).bbox;
    const left = b[0],
      right = b[2];
    if (left === undefined || right === undefined) throw new Error("Missing bounds");
    expect((right - left) * Math.cos((25.47 * Math.PI) / 180)).toBeCloseTo(70, 3);
  });
});

it("rejects invalid coordinates and map spans instead of producing invalid map bounds", () => {
  expect(() => aerialBox(90, -80, 70)).toThrow("Latitude");
  expect(() => aerialBox(25, 181, 70)).toThrow("Longitude");
  expect(() => aerialBox(25, -80, 0)).toThrow("Map span");
  expect(() => aerialBox(25, -80, 5001)).toThrow("Map span");
});
