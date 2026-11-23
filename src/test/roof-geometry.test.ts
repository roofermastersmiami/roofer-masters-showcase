import { describe, it, expect } from "vitest";
import { roofPreset, measureDrawing, toMaterialReport } from "@/lib/roof-geometry";
describe("roof geometry", () => {
  it("measures a 40 by 30 flat roof as 1200 square feet and 12 squares", () => {
    const m = measureDrawing(roofPreset("flat", 40, 30));
    expect(m.area).toBeCloseTo(1200);
    expect(m.squares).toBeCloseTo(12);
    expect(m.edges.eave).toBeCloseTo(140);
  });
  it("calculates 6:12 pitch and sloped gable area without doubling the shared ridge", () => {
    const m = measureDrawing(roofPreset("gable", 40, 30, 6));
    expect(m.area).toBeCloseTo(1200 * Math.sqrt(1.25));
    expect(m.planes[0]?.pitch).toBeCloseTo(6);
    expect(m.edges.ridge).toBeCloseTo(30);
    expect(m.edges.eave).toBeCloseTo(60);
  });
  it("keeps 10 percent waste separate from actual area", () => {
    const m = measureDrawing(roofPreset("flat"));
    expect(m.area).toBe(1200);
    expect(m.withWaste).toBe(1320);
  });
  it("rejects overlapping roof planes", () => {
    const d = roofPreset("flat");
    const p = d.planes[0];
    if (!p) throw new Error("Missing plane");
    d.planes.push({ ...p, id: "duplicate", name: "Duplicate" });
    expect(() => measureDrawing(d)).toThrow("overlaps");
  });
  it("rejects nonplanar edits instead of returning trustworthy totals", () => {
    const d = roofPreset("gable");
    const p = d.planes[0]?.points[3];
    if (!p) throw new Error("Missing vertex");
    p.y += 5;
    expect(() => measureDrawing(d)).toThrow("one roof plane");
  });
  it("counts only pipes and vents as boots when transferring measurements", () => {
    const d = roofPreset("flat");
    d.penetrations = [
      { id: "a", kind: "skylight", x: 0, z: 0, width: 2, length: 4 },
      { id: "b", kind: "pipe", x: 5, z: 0, width: 1, length: 1 },
    ];
    expect(toMaterialReport(d).pipes).toBe(1);
  });
  it("supports the required editable shape configurations", () => {
    for (const shape of ["gable", "hip", "flat", "shed", "mansard", "complex"] as const)
      expect(measureDrawing(roofPreset(shape)).area).toBeGreaterThan(0);
  });
  it("supports a square pyramidal hip roof without degenerate ridge vertices", () => {
    const m = measureDrawing(roofPreset("hip", 30, 30, 6));
    expect(m.planes).toHaveLength(4);
    expect(m.edges.ridge).toBe(0);
    expect(m.area).toBeCloseTo(900 * Math.sqrt(1.25));
  });
  it("keeps complex starter structures distinct from a single gable", () => {
    const d = roofPreset("complex");
    expect(d.planes.length).toBeGreaterThan(2);
    expect(measureDrawing(d).area).toBeGreaterThan(measureDrawing(roofPreset("gable")).area);
  });
  it("calculates perimeter even when unclassified traced edges are used", () => {
    const d = roofPreset("flat", 40, 30);
    const p = d.planes[0];
    if (!p) throw new Error("Missing plane");
    p.edges = p.edges.map(() => "other");
    expect(measureDrawing(d).perimeter).toBe(140);
  });
  it("rejects self-intersecting roof boundaries", () => {
    const d = roofPreset("flat");
    const p = d.planes[0];
    if (!p) throw new Error("Missing plane");
    const a = p.points[1],
      b = p.points[2];
    if (!a || !b) throw new Error("Missing vertices");
    p.points[1] = b;
    p.points[2] = a;
    expect(() => measureDrawing(d)).toThrow("cross");
  });
});
