import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SketchEditor } from "@/components/dashboard/SketchEditor";
import type { RoofDrawing } from "@/lib/roof-geometry";

/**
 * Regression tests for the reported "edge actions are not working" bug.
 *
 * In a real browser a click on the roof body lands on a facet FILL (the
 * polygons paint over the edges of facets drawn before them, and the
 * natural place to click for an edge is right next to it, on the facet).
 * Before the fix, fills swallowed those clicks in Edges mode: nothing was
 * ever selected, so the Edge Actions panel stayed on "No edge selected"
 * and every action looked dead. The editor must treat a click on the
 * facet body in Edges mode as selecting the nearest edge.
 */

const drawing: RoofDrawing = {
  planes: [
    {
      id: "front-slope",
      name: "Front slope",
      points: [
        { x: 0, y: 10, z: 0 },
        { x: 40, y: 10, z: 0 },
        { x: 40, y: 16, z: 15 },
        { x: 0, y: 16, z: 15 },
      ],
      edges: ["eave", "rake", "ridge", "rake"],
    },
    {
      id: "back-slope",
      name: "Back slope",
      points: [
        { x: 0, y: 16, z: 15 },
        { x: 40, y: 16, z: 15 },
        { x: 40, y: 10, z: 30 },
        { x: 0, y: 10, z: 30 },
      ],
      edges: ["ridge", "rake", "eave", "rake"],
    },
  ],
  penetrations: [],
  waste: 10,
  roof_type: "Shingle Roof",
  notes: "",
  condition: "",
  verified: true,
};

afterEach(() => cleanup());

function pointsOf(el: Element) {
  return (el.getAttribute("points") ?? "")
    .trim()
    .split(/\s+/)
    .map((pair) => {
      const [x, y] = pair.split(",").map(Number);
      return { x: x ?? 0, y: y ?? 0 };
    });
}

function centroid(points: { x: number; y: number }[]) {
  return {
    x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
    y: points.reduce((sum, p) => sum + p.y, 0) / points.length,
  };
}

/** jsdom has no PointerEvent constructor, so RTL's fireEvent builds
 * pointer events as plain Events and drops clientX (the same quirk
 * satellite-map-wheel.test.tsx documents). Dispatch MouseEvents under
 * the pointer type names instead — React keys its synthetic pointer
 * handlers off the type string. */
function pointer(el: Element, type: string, init: MouseEventInit) {
  fireEvent(el, new MouseEvent(type, { bubbles: true, cancelable: true, ...init }));
}

// jsdom's setPointerCapture throws for synthetic pointer ids; real
// browsers accept the capture the editor requests on pointerdown.
Element.prototype.setPointerCapture = () => {};
Element.prototype.releasePointerCapture = () => {};

/** Click the facet body (what a browser delivers to the canvas when the
 *  fill does not swallow it), at a point inside the facet near an edge. */
function clickFacetBody(container: HTMLElement, polygonIndex: number, toward: "top" | "bottom") {
  const polygons = [...container.querySelectorAll("polygon")].filter(
    (el) => !el.getAttribute("points")?.includes("0,0 24,0"),
  );
  const polygon = polygons[polygonIndex];
  if (!polygon) throw new Error("facet polygon not found");
  const pts = pointsOf(polygon);
  const c = centroid(pts);
  const ys = pts.map((p) => p.y);
  const edgeY = toward === "top" ? Math.min(...ys) : Math.max(...ys);
  // 65% of the way from the centroid to the facet's top/bottom edge:
  // clearly on the facet body, close to that edge, off the vertices.
  const click = { x: c.x, y: c.y + (edgeY - c.y) * 0.65 };
  // The canvas is the labelled svg (toolbar icons are svgs too).
  const svg = container.querySelector('svg[aria-label^="Roof sketch"]');
  if (!svg) throw new Error("editor canvas svg not found");
  pointer(svg, "pointerdown", { clientX: click.x, clientY: click.y });
  pointer(svg, "pointerup", { clientX: click.x, clientY: click.y });
  return click;
}

describe("SketchEditor edge actions via facet-body clicks", () => {
  it("renders facet fills click-transparent outside Facets mode so they cannot cover the edges", () => {
    const { container } = render(
      <SketchEditor drawing={drawing} onDone={vi.fn()} onCancel={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Edges" }));
    const polygons = [...container.querySelectorAll("polygon")].filter(
      (el) => !el.getAttribute("points")?.includes("0,0 24,0"),
    );
    expect(polygons.length).toBe(2);
    for (const polygon of polygons) {
      expect(polygon.getAttribute("pointer-events")).toBe("none");
    }
    // Edge hit lines paint after (above) every facet fill.
    const canvas = container.querySelector('svg[aria-label^="Roof sketch"]');
    if (!canvas) throw new Error("editor canvas svg not found");
    const descendants = [...canvas.querySelectorAll("*")];
    const lastFillIndex = Math.max(
      ...polygons.map((polygon) => descendants.indexOf(polygon as never)),
    );
    const hitLines = [...container.querySelectorAll("line")].filter(
      (line) => line.getAttribute("stroke") === "transparent",
    );
    expect(hitLines.length).toBe(8);
    for (const line of hitLines) {
      expect(descendants.indexOf(line as never)).toBeGreaterThan(lastFillIndex);
    }
  });

  it("selects the nearest edge when the facet body is clicked, and retype applies", () => {
    const onDone = vi.fn();
    const { container } = render(
      <SketchEditor drawing={drawing} onDone={onDone} onCancel={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Edges" }));
    expect(screen.getByText("Click an edge in the drawing to select it.")).toBeTruthy();

    // Click inside the back slope near its eave. The back slope projects
    // to the bottom half of the canvas, and its eave is its third edge.
    clickFacetBody(container, 1, "bottom");
    expect(screen.queryByText("Click an edge in the drawing to select it.")).toBeNull();
    expect(screen.getByText(/Edge 3 · Back slope ·/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Valley" }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onDone).toHaveBeenCalledTimes(1);
    const [next, changed] = onDone.mock.calls[0] as [RoofDrawing, boolean];
    expect(changed).toBe(true);
    // The back slope's eave (edge index 2) became a valley.
    expect(next.planes[1]?.edges).toEqual(["ridge", "rake", "valley", "rake"]);
    expect(next.planes[0]?.edges).toEqual(["eave", "rake", "ridge", "rake"]);
  });

  it("Delete Edge removes the edge selected from the facet body", () => {
    const onDone = vi.fn();
    const { container } = render(
      <SketchEditor drawing={drawing} onDone={onDone} onCancel={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Edges" }));
    // Click inside the front slope near its ridge (projected bottom side
    // of the front slope, where it meets the back slope).
    clickFacetBody(container, 0, "bottom");
    expect(screen.queryByText("Click an edge in the drawing to select it.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Delete Edge" }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    const [next, changed] = onDone.mock.calls[0] as [RoofDrawing, boolean];
    expect(changed).toBe(true);
    const totalEdges = next.planes.reduce((sum, plane) => sum + plane.edges.length, 0);
    expect(totalEdges).toBe(7);
  });

  it("Delete All Edges clears the sketch, and Done then refuses an empty drawing", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const onDone = vi.fn();
    const { container } = render(
      <SketchEditor drawing={drawing} onDone={onDone} onCancel={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Edges" }));
    clickFacetBody(container, 0, "bottom");
    expect(screen.queryByText("Click an edge in the drawing to select it.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Delete All Edges" }));
    // The whole sketch is cleared: no facet polygons remain.
    const polygons = [...container.querySelectorAll("polygon")].filter(
      (el) => !el.getAttribute("points")?.includes("0,0 24,0"),
    );
    expect(polygons.length).toBe(0);
    // An empty drawing cannot be saved — Done surfaces the validator's
    // message instead of calling onDone.
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.getByText("Draw at least one roof facet before saving.")).toBeTruthy();
    expect(onDone).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });
});
