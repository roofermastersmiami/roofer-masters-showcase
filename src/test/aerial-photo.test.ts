import { describe, expect, it } from "vitest";
import { aerialTilePlan } from "@/lib/aerial-photo";

describe("aerialTilePlan", () => {
  it("plans a small tile grid whose crop window covers the property", () => {
    // Annel's house, Homestead/Miami area.
    const plan = aerialTilePlan(25.74705, -80.34425);
    expect(plan.zoom).toBe(19);
    expect(plan.tiles.length).toBeGreaterThanOrEqual(4);
    expect(plan.tiles.length).toBeLessThanOrEqual(9);
    // Crop window is square and fits inside the stitched canvas.
    expect(plan.crop.size).toBeGreaterThan(200);
    expect(plan.crop.x + plan.crop.size).toBeLessThanOrEqual(plan.canvas.width);
    expect(plan.crop.y + plan.crop.size).toBeLessThanOrEqual(plan.canvas.height);
    // Tiles are unique and within the zoom-19 grid.
    const keys = new Set(plan.tiles.map((t) => `${t.x},${t.y}`));
    expect(keys.size).toBe(plan.tiles.length);
    for (const tile of plan.tiles) {
      expect(tile.x).toBeGreaterThanOrEqual(0);
      expect(tile.x).toBeLessThan(2 ** 19);
      expect(tile.y).toBeGreaterThanOrEqual(0);
      expect(tile.y).toBeLessThan(2 ** 19);
    }
  });

  it("window size follows the requested half extent", () => {
    const small = aerialTilePlan(25.74705, -80.34425, 19, 25);
    const large = aerialTilePlan(25.74705, -80.34425, 19, 60);
    expect(large.crop.size).toBeGreaterThan(small.crop.size);
  });
});
