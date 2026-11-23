import { describe, expect, it } from "vitest";
import { applySharedEdgeSuggestions, suggestSharedEdgeTypes } from "./roof-edge-suggestions";
import type { RoofDrawing, RoofPlane } from "./roof-geometry";

function plane(id: string, points: RoofPlane["points"]): RoofPlane {
  return { id, name: id, points, edges: points.map(() => "other") };
}

function drawing(planes: RoofPlane[]): RoofDrawing {
  return {
    planes,
    penetrations: [],
    waste: 10,
    roof_type: "Metal Roof",
    notes: "",
    condition: "",
    verified: false,
  };
}

describe("suggestSharedEdgeTypes", () => {
  it("suggests a ridge for a shared edge above both facet centroids", () => {
    const left = plane("left", [
      { x: 0, y: 10, z: -1 },
      { x: 0, y: 10, z: 1 },
      { x: -2, y: 0, z: 0 },
    ]);
    const right = plane("right", [
      { x: 0, y: 10, z: 1 },
      { x: 0, y: 10, z: -1 },
      { x: 2, y: 0, z: 0 },
    ]);

    expect(suggestSharedEdgeTypes(drawing([left, right]))).toMatchObject([
      {
        firstPlaneId: "left",
        firstEdgeIndex: 0,
        secondPlaneId: "right",
        secondEdgeIndex: 0,
        type: "ridge",
        confidence: "review",
      },
    ]);
  });

  it("suggests a valley for a shared edge below both facet centroids", () => {
    const left = plane("left", [
      { x: 0, y: 0, z: -1 },
      { x: 0, y: 0, z: 1 },
      { x: -2, y: 10, z: 0 },
    ]);
    const right = plane("right", [
      { x: 0, y: 0, z: 1 },
      { x: 0, y: 0, z: -1 },
      { x: 2, y: 10, z: 0 },
    ]);

    expect(suggestSharedEdgeTypes(drawing([left, right]))).toMatchObject([
      { type: "valley", confidence: "review" },
    ]);
  });

  it("does not classify exterior edges or unmatched shared geometry", () => {
    const single = plane("single", [
      { x: 0, y: 10, z: -1 },
      { x: 0, y: 10, z: 1 },
      { x: -2, y: 0, z: 0 },
    ]);

    expect(suggestSharedEdgeTypes(drawing([single]))).toEqual([]);
  });

  it("leaves ambiguous shared edges unchanged", () => {
    const left = plane("left", [
      { x: 0, y: 5, z: -1 },
      { x: 0, y: 5, z: 1 },
      { x: -2, y: 0, z: 0 },
    ]);
    const right = plane("right", [
      { x: 0, y: 5, z: 1 },
      { x: 0, y: 5, z: -1 },
      { x: 2, y: 10, z: 0 },
    ]);

    expect(suggestSharedEdgeTypes(drawing([left, right]))).toEqual([]);
  });
});

describe("applySharedEdgeSuggestions", () => {
  it("updates both sides of each shared edge and keeps the drawing unverified", () => {
    const left = plane("left", [
      { x: 0, y: 10, z: -1 },
      { x: 0, y: 10, z: 1 },
      { x: -2, y: 0, z: 0 },
    ]);
    const right = plane("right", [
      { x: 0, y: 10, z: 1 },
      { x: 0, y: 10, z: -1 },
      { x: 2, y: 0, z: 0 },
    ]);
    const source = drawing([left, right]);
    const suggestions = suggestSharedEdgeTypes(source);
    const updated = applySharedEdgeSuggestions(source, suggestions);
    expect(updated.planes[0]?.edges[0]).toBe("ridge");
    expect(updated.planes[1]?.edges[0]).toBe("ridge");
    expect(updated.verified).toBe(false);
    expect(source.planes[0]?.edges[0]).toBe("other");
  });

  it("returns the original drawing when there are no suggestions", () => {
    const source = drawing([
      plane("single", [
        { x: 0, y: 10, z: -1 },
        { x: 0, y: 10, z: 1 },
        { x: -2, y: 0, z: 0 },
      ]),
    ]);
    expect(applySharedEdgeSuggestions(source, [])).toBe(source);
  });
});
