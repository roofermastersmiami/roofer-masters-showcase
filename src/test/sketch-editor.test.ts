import { describe, expect, it } from "vitest";
import {
  applyPitchToPlane,
  createPlaneFromDraft,
  deleteAllEdges,
  deleteEdge,
  drawingPointToLatLon,
  edgeLengthFt,
  formatEdgeLength,
  insertVertexOnEdge,
  latLonToDrawingPoint,
  latLonToWorldPx,
  moveVertex,
  planePitchArea,
  retypeEdge,
  snapSegmentPoint,
  snapVertexPosition,
  validateSketchDrawing,
  worldPxToLatLon,
} from "@/lib/sketch-editor";
import type { RoofDrawing, RoofPlane } from "@/lib/roof-geometry";

const square: RoofPlane = {
  id: "p1",
  name: "Main",
  // 40ft (x) by 30ft (z) flat facet at 10ft elevation.
  points: [
    { x: 0, y: 10, z: 0 },
    { x: 40, y: 10, z: 0 },
    { x: 40, y: 10, z: 30 },
    { x: 0, y: 10, z: 30 },
  ],
  edges: ["eave", "rake", "eave", "rake"],
};

function drawingWith(planes: RoofPlane[]): RoofDrawing {
  return {
    planes,
    penetrations: [],
    waste: 10,
    roof_type: "Shingle Roof",
    notes: "",
    condition: "",
    verified: true,
  };
}

describe("edge lengths", () => {
  it("measures the full 3D distance and formats like the reference", () => {
    expect(edgeLengthFt({ x: 0, y: 0, z: 0 }, { x: 30, y: 0, z: 40 })).toBe(50);
    // A sloped edge reads its slope length: 12ft run at 6/12 rises 6ft.
    expect(edgeLengthFt({ x: 0, y: 10, z: 0 }, { x: 0, y: 16, z: 12 })).toBeCloseTo(
      Math.hypot(6, 12),
      6,
    );
    expect(formatEdgeLength(84.64)).toBe("84.6ft");
    expect(formatEdgeLength(7)).toBe("7.0ft");
  });
});

describe("retypeEdge", () => {
  it("changes only the targeted edge classification", () => {
    const next = retypeEdge(drawingWith([square]), "p1", 1, "valley");
    expect(next.planes[0]?.edges).toEqual(["eave", "valley", "eave", "rake"]);
    expect(next.planes[0]?.points).toEqual(square.points);
  });
  it("ignores out-of-range indices", () => {
    const d = drawingWith([square]);
    expect(retypeEdge(d, "p1", 9, "hip")).toBe(d);
    expect(retypeEdge(d, "missing", 0, "hip")).toBe(d);
  });
});

describe("deleteEdge", () => {
  it("removes the corner at the end of the edge and merges its neighbours", () => {
    const next = deleteEdge(drawingWith([square]), "p1", 0);
    const plane = next?.planes[0];
    // Edge 0 runs corner1 -> corner2; corner2 is removed and the
    // merged edge keeps the deleted edge's type ("eave").
    expect(plane?.points).toEqual([
      { x: 0, y: 10, z: 0 },
      { x: 40, y: 10, z: 30 },
      { x: 0, y: 10, z: 30 },
    ]);
    expect(plane?.edges).toEqual(["eave", "eave", "rake"]);
  });
  it("handles the closing edge (last corner back to the first)", () => {
    const next = deleteEdge(drawingWith([square]), "p1", 3);
    const plane = next?.planes[0];
    // Closing edge runs corner4 -> corner1; corner1 is removed and
    // the merged closing edge keeps the deleted edge's type.
    expect(plane?.points).toEqual([
      { x: 40, y: 10, z: 0 },
      { x: 40, y: 10, z: 30 },
      { x: 0, y: 10, z: 30 },
    ]);
    expect(plane?.edges).toEqual(["rake", "eave", "rake"]);
  });
  it("refuses to drop a facet below three corners", () => {
    const triangle: RoofPlane = {
      id: "t",
      name: "Tri",
      points: square.points.slice(0, 3),
      edges: ["eave", "rake", "hip"],
    };
    expect(deleteEdge(drawingWith([triangle]), "t", 0)).toBeNull();
  });
});

describe("deleteAllEdges", () => {
  it("removes every facet but keeps pins and drawing settings", () => {
    const d = drawingWith([square]);
    d.penetrations = [{ id: "pin1", kind: "pipe", x: 5, z: 5, width: 1, length: 1 }];
    const next = deleteAllEdges(d);
    expect(next.planes).toEqual([]);
    expect(next.penetrations).toHaveLength(1);
    expect(next.roof_type).toBe("Shingle Roof");
  });
});

describe("insertVertexOnEdge", () => {
  it("splits the edge and keeps its classification on both halves", () => {
    const next = insertVertexOnEdge(drawingWith([square]), "p1", 0, { x: 20, y: 10, z: 0 });
    expect(next.planes[0]?.points).toHaveLength(5);
    expect(next.planes[0]?.points[1]).toEqual({ x: 20, y: 10, z: 0 });
    expect(next.planes[0]?.edges).toEqual(["eave", "eave", "rake", "eave", "rake"]);
  });
});

describe("moveVertex", () => {
  it("moves a corner in plan and preserves its elevation", () => {
    const next = moveVertex(drawingWith([square]), "p1", 1, 44, -2);
    expect(next.planes[0]?.points[1]).toEqual({ x: 44, y: 10, z: -2 });
  });
});

describe("90 mode snapping", () => {
  it("snaps a segment to the nearest 45-degree family angle", () => {
    // Incoming segment runs east; candidate heads mostly south with
    // an eastward drift — the right angle (due south) must win.
    const snapped = snapSegmentPoint({ x: 10, z: 0 }, { x: 0, z: 0 }, { x: 13, z: 12 });
    expect(snapped.x).toBeCloseTo(10, 6);
    expect(snapped.z).toBeCloseTo(Math.hypot(3, 12), 6);
  });
  it("snaps to absolute multiples when there is no incoming segment", () => {
    const snapped = snapSegmentPoint({ x: 0, z: 0 }, null, { x: 10, z: 1 });
    expect(snapped.z).toBeCloseTo(0, 6);
    expect(snapped.x).toBeCloseTo(Math.hypot(10, 1), 6);
  });
  it("snaps a dragged facet corner against the previous segment", () => {
    const snapped = snapVertexPosition(square, 2, 43, 31);
    // Corner 3 dragged slightly off the rectangle; the segment from
    // corner 2 runs east, so the next segment snaps to due south.
    expect(snapped.x).toBeCloseTo(40, 6);
  });
});

describe("applyPitchToPlane", () => {
  it("slopes the facet at the requested pitch, lowest corner unchanged", () => {
    const sloped = applyPitchToPlane(square, 6, "south");
    const info = planePitchArea(sloped);
    expect(info?.pitch).toBeCloseTo(6, 4);
    expect(Math.min(...sloped.points.map((p) => p.y))).toBe(10);
    // South edge (z = 30) is the high side when pitch rises south.
    expect(sloped.points[2]?.y).toBeCloseTo(10 + (30 * 6) / 12, 6);
    expect(info?.area).toBeGreaterThan(40 * 30);
  });
  it("leaves the plane alone for an out-of-range pitch", () => {
    expect(applyPitchToPlane(square, 30, "south")).toBe(square);
  });
});

describe("draft facets and validation", () => {
  it("creates an unlabeled facet from draft corners", () => {
    const plane = createPlaneFromDraft(square.points, "Traced facet", "draft-1");
    expect(plane.edges).toEqual(["other", "other", "other", "other"]);
    expect(plane.name).toBe("Traced facet");
  });
  it("accepts a measurable drawing and rejects an empty one", () => {
    expect(validateSketchDrawing(drawingWith([square]))).toBeNull();
    expect(validateSketchDrawing(drawingWith([]))).toMatch(/at least one/);
  });
  it("rejects overlapping facets like the save path does", () => {
    const overlapping: RoofPlane = { ...square, id: "p2", name: "Copy" };
    expect(validateSketchDrawing(drawingWith([square, overlapping]))).toMatch(/overlaps/);
  });
});

describe("geo anchoring", () => {
  const reference = {
    addressLatitude: 25.979306,
    addressLongitude: -80.186822,
    originLatitude: 25.979306,
    originLongitude: -80.186822,
  };
  it("round-trips drawing feet through lat/lon", () => {
    const point = { x: 25, y: 12, z: -40 };
    const latLon = drawingPointToLatLon(point, reference);
    const back = latLonToDrawingPoint(latLon.lat, latLon.lon, reference, point.y);
    expect(back.x).toBeCloseTo(point.x, 6);
    expect(back.z).toBeCloseTo(point.z, 6);
    expect(back.y).toBe(12);
  });
  it("places the origin at the geo reference origin", () => {
    const latLon = drawingPointToLatLon({ x: 0, z: 0 }, reference);
    expect(latLon.lat).toBeCloseTo(reference.originLatitude, 9);
    expect(latLon.lon).toBeCloseTo(reference.originLongitude, 9);
  });
  it("round-trips Web Mercator world pixels", () => {
    const px = latLonToWorldPx(25.979306, -80.186822, 19);
    const back = worldPxToLatLon(px.x, px.y, 19);
    expect(back.lat).toBeCloseTo(25.979306, 7);
    expect(back.lon).toBeCloseTo(-80.186822, 7);
  });
});
