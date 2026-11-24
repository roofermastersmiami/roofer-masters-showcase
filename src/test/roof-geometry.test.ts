import { describe, it, expect } from "vitest";
import {
  roofPreset,
  measureDrawing,
  toMaterialReport,
  suggestSharedEdgeClassifications,
  type RoofPlane,
} from "@/lib/roof-geometry";
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

describe("reviewable shared roof-edge suggestions", () => {
  it("suggests both sides of a clear gable ridge without changing the drawing", () => {
    const drawing = roofPreset("gable", 40, 30, 6);
    const west = drawing.planes.find((plane) => plane.id === "West plane");
    const east = drawing.planes.find((plane) => plane.id === "East plane");
    if (!west || !east) throw new Error("Missing gable facets");
    west.edges[1] = "other";
    east.edges[3] = "other";

    const suggestions = suggestSharedEdgeClassifications(drawing);
    expect(suggestions).toEqual([
      { planeId: "West plane", edgeIndex: 1, type: "ridge", sharedWith: "East plane" },
      { planeId: "East plane", edgeIndex: 3, type: "ridge", sharedWith: "West plane" },
    ]);
    expect(west.edges[1]).toBe("other");
    expect(east.edges[3]).toBe("other");
  });

  it("suggests a clear valley on both adjacent facets", () => {
    const drawing = roofPreset("flat", 2, 2);
    const left = drawing.planes[0];
    if (!left) throw new Error("Missing starter facet");
    const leftPlane: RoofPlane = {
      ...left,
      id: "left",
      name: "Left",
      points: [
        { x: -1, y: 1, z: 0 },
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 2 },
        { x: -1, y: 1, z: 2 },
      ],
      edges: ["other", "other", "other", "other"],
    };
    const rightPlane: RoofPlane = {
      ...left,
      id: "right",
      name: "Right",
      points: [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 1, z: 0 },
        { x: 1, y: 1, z: 2 },
        { x: 0, y: 0, z: 2 },
      ],
      edges: ["other", "other", "other", "other"],
    };
    drawing.planes = [leftPlane, rightPlane];
    expect(suggestSharedEdgeClassifications(drawing)).toEqual([
      { planeId: "left", edgeIndex: 1, type: "valley", sharedWith: "right" },
      { planeId: "right", edgeIndex: 3, type: "valley", sharedWith: "left" },
    ]);
  });

  it("leaves exterior and ambiguous shared edges for manual classification", () => {
    const drawing = roofPreset("flat", 2, 2);
    expect(suggestSharedEdgeClassifications(drawing)).toEqual([]);

    const gable = roofPreset("gable", 40, 30, 6);
    const west = gable.planes.find((plane) => plane.id === "West plane");
    const east = gable.planes.find((plane) => plane.id === "East plane");
    if (!west || !east) throw new Error("Missing gable facets");
    west.points[1]!.y = 10;
    east.points[0]!.y = 10;
    west.edges[1] = "other";
    east.edges[3] = "other";
    expect(suggestSharedEdgeClassifications(gable)).toEqual([]);
  });

  it("returns both sides when only one side of a shared edge needs correction", () => {
    const drawing = roofPreset("gable", 40, 30, 6);
    const west = drawing.planes.find((plane) => plane.id === "West plane");
    const east = drawing.planes.find((plane) => plane.id === "East plane");
    if (!west || !east) throw new Error("Missing gable facets");
    west.edges[1] = "ridge";
    east.edges[3] = "other";
    expect(suggestSharedEdgeClassifications(drawing)).toEqual([
      { planeId: "West plane", edgeIndex: 1, type: "ridge", sharedWith: "East plane" },
      { planeId: "East plane", edgeIndex: 3, type: "ridge", sharedWith: "West plane" },
    ]);
  });

  it("does not suggest an edge already classified consistently", () => {
    expect(suggestSharedEdgeClassifications(roofPreset("gable", 40, 30, 6))).toEqual([]);
  });
});

describe("roof preset dimension validation", () => {
  it("accepts supported finite dimensions and pitch", () => {
    expect(() => roofPreset("gable", 500, 500, 24)).not.toThrow();
    expect(() => roofPreset("flat", 1, 1, 0)).not.toThrow();
  });
  it.each([
    [0, 30, 6],
    [501, 30, 6],
    [40, 0, 6],
    [40, 501, 6],
    [40, 30, -1],
    [40, 30, 24.01],
    [Number.NaN, 30, 6],
    [40, Number.POSITIVE_INFINITY, 6],
  ])("rejects invalid dimensions (%s, %s, %s)", (width, length, pitch) => {
    expect(() => roofPreset("gable", width, length, pitch)).toThrow();
  });
});


describe("roof edge topology validation", () => {
  it("rejects zero-length roof edges", () => {
    const drawing = roofPreset("flat", 40, 30);
    const plane = drawing.planes[0];
    if (!plane) throw new Error("Missing roof plane");
    plane.points[3] = { ...plane.points[0]! };
    expect(() => measureDrawing(drawing)).toThrow("at least 0.01 feet long");
  });
});
