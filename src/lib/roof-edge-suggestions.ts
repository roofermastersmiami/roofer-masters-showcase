import type { EdgeType, RoofDrawing } from "./roof-geometry";

export type SharedEdgeSuggestion = {
  firstPlaneId: string;
  firstEdgeIndex: number;
  secondPlaneId: string;
  secondEdgeIndex: number;
  type: "ridge" | "valley";
  confidence: "high" | "review";
};

/**
 * Suggests classifications only for edges shared by two roof facets.
 * It deliberately does not classify exterior edges: an overhead image alone
 * cannot reliably distinguish an eave from a rake.
 *
 * Coordinates are expected to be in the same calibrated 3D model space.
 * A shared edge above both facet centroids is a ridge candidate; one below
 * both is a valley candidate. Ambiguous geometry is left untouched.
 */
export function suggestSharedEdgeTypes(drawing: RoofDrawing): SharedEdgeSuggestion[] {
  const keyPoint = (p: { x: number; y: number; z: number }) =>
    [p.x, p.y, p.z].map((n) => Math.round(n * 100)).join(",");
  const keyEdge = (
    a: { x: number; y: number; z: number },
    b: { x: number; y: number; z: number },
  ) => [keyPoint(a), keyPoint(b)].sort().join("|");

  const edges = new Map<
    string,
    Array<{
      planeId: string;
      edgeIndex: number;
      edgeType: EdgeType;
      edgeMidY: number;
      centroidY: number;
    }>
  >();

  for (const plane of drawing.planes) {
    const centroidY = plane.points.reduce((sum, point) => sum + point.y, 0) / plane.points.length;
    for (let i = 0; i < plane.points.length; i += 1) {
      const a = plane.points[i];
      const b = plane.points[(i + 1) % plane.points.length];
      const edgeType = plane.edges[i];
      if (!a || !b || !edgeType) continue;
      const key = keyEdge(a, b);
      const items = edges.get(key) ?? [];
      items.push({
        planeId: plane.id,
        edgeIndex: i,
        edgeType,
        edgeMidY: (a.y + b.y) / 2,
        centroidY,
      });
      edges.set(key, items);
    }
  }

  const suggestions: SharedEdgeSuggestion[] = [];
  for (const items of edges.values()) {
    if (items.length !== 2) continue;
    const [a, b] = items;
    if (!a || !b) continue;
    if (a.edgeType === b.edgeType && (a.edgeType === "ridge" || a.edgeType === "valley")) continue;

    const aboveBoth = a.edgeMidY > a.centroidY + 0.03 && b.edgeMidY > b.centroidY + 0.03;
    const belowBoth = a.edgeMidY < a.centroidY - 0.03 && b.edgeMidY < b.centroidY - 0.03;
    if (!aboveBoth && !belowBoth) continue;

    suggestions.push({
      firstPlaneId: a.planeId,
      firstEdgeIndex: a.edgeIndex,
      secondPlaneId: b.planeId,
      secondEdgeIndex: b.edgeIndex,
      type: aboveBoth ? "ridge" : "valley",
      confidence: "review",
    });
  }
  return suggestions;
}

/** Apply only the edge pairs returned by the reviewable suggestion pass. */
export function applySharedEdgeSuggestions(
  drawing: RoofDrawing,
  suggestions: SharedEdgeSuggestion[],
): RoofDrawing {
  if (suggestions.length === 0) return drawing;
  const byPlane = new Map<string, Map<number, EdgeType>>();
  for (const suggestion of suggestions) {
    for (const [planeId, edgeIndex] of [
      [suggestion.firstPlaneId, suggestion.firstEdgeIndex],
      [suggestion.secondPlaneId, suggestion.secondEdgeIndex],
    ] as const) {
      if (!Number.isInteger(edgeIndex) || edgeIndex < 0) continue;
      const edges = byPlane.get(planeId) ?? new Map<number, EdgeType>();
      edges.set(edgeIndex, suggestion.type);
      byPlane.set(planeId, edges);
    }
  }
  let changed = false;
  const planes = drawing.planes.map((plane) => {
    const updates = byPlane.get(plane.id);
    if (!updates) return plane;
    const edges = plane.edges.map((edge, index) => updates.get(index) ?? edge);
    if (edges.every((edge, index) => edge === plane.edges[index])) return plane;
    changed = true;
    return { ...plane, edges };
  });
  return changed ? { ...drawing, planes, verified: false } : drawing;
}
