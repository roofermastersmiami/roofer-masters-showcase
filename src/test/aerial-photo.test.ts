import { describe, expect, it } from "vitest";
import { aerialTilePlan, roofCoverFraming } from "@/lib/aerial-photo";

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

describe("roofCoverFraming (step 10)", () => {
  const origin = { originLatitude: 25.98, originLongitude: -80.4 };
  const drawing = (minX: number, maxX: number, minZ: number, maxZ: number) => ({
    planes: [
      {
        points: [
          { x: minX, z: minZ },
          { x: maxX, z: minZ },
          { x: maxX, z: maxZ },
          { x: minX, z: maxZ },
        ],
      },
    ],
    geo_reference: origin,
  });

  it("returns null without a geographic origin", () => {
    expect(roofCoverFraming({ planes: [{ points: [{ x: 0, z: 0 }] }] })).toBeNull();
    expect(
      roofCoverFraming({ planes: [{ points: [{ x: 0, z: 0 }] }], geo_reference: null }),
    ).toBeNull();
  });

  it("centres on the roof, not the geocode origin", () => {
    // Roof centre 45 ft west and 67.5 ft north of the origin (plan
    // z runs south of the origin, so negative z is north): the
    // frame must move north-west of the origin — Miramar's origin
    // sits ~64 ft from its roof centre, which left the house small
    // and off-centre in the step-8 covers.
    const framing = roofCoverFraming(drawing(-70, -20, -95, -40))!;
    expect(framing.latitude).toBeGreaterThan(origin.originLatitude);
    expect(framing.longitude).toBeLessThan(origin.originLongitude);
    expect(framing.latitude).toBeCloseTo(
      origin.originLatitude + (67.5 * 0.3048) / 110540,
      6,
    );
    // A 50 x 55 ft roof takes the tightest allowed window.
    expect(framing.halfExtentMeters).toBe(24);
  });

  it("sizes the window to the roof with margin, capped at the old ±42 m", () => {
    // EW 130 ft = 39.6 m -> 25.8 m at a 30% margin; NS 100 ft =
    // 30.5 m -> 27.3 m once the cover box's vertical crop of the
    // square photo is accounted for. The NS term wins.
    const framing = roofCoverFraming(drawing(0, 130, 0, 100))!;
    expect(framing.halfExtentMeters).toBeCloseTo(27.3, 0);
    const huge = roofCoverFraming(drawing(0, 400, 0, 400))!;
    expect(huge.halfExtentMeters).toBe(42);
  });
});
