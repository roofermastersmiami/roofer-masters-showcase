import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SketchEditor } from "@/components/dashboard/SketchEditor";
import { rotateScreenPointDeg } from "@/lib/plan-rotation";
import type { RoofDrawing } from "@/lib/roof-geometry";

/**
 * Sketch Editor view rotation (Fredy, 2026-11-27: "allow me to
 * rotate the 2D plan with my computer mouse" — asked from Edit
 * Sketch). Rotation is view-only: the drawing that comes back from
 * Done must be identical unless a real edit happened, and pointer →
 * geometry mapping must invert the rotation exactly.
 */

// jsdom has no PointerEvent constructor and RTL's fireEvent drops
// clientX; dispatch MouseEvents under the pointer type names (the
// pattern from sketch-editor-edge-actions.test.tsx).
function pointer(el: Element, type: string, init: MouseEventInit) {
  fireEvent(el, new MouseEvent(type, { bubbles: true, cancelable: true, ...init }));
}
Element.prototype.setPointerCapture = () => {};
Element.prototype.releasePointerCapture = () => {};

const geoDrawing: RoofDrawing = {
  planes: [
    {
      id: "south",
      name: "South slope",
      points: [
        { x: 0, y: 10, z: 0 },
        { x: 40, y: 10, z: 0 },
        { x: 40, y: 16, z: 15 },
        { x: 0, y: 16, z: 15 },
      ],
      edges: ["eave", "rake", "ridge", "rake"],
    },
    {
      id: "north",
      name: "North slope",
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
  geo_reference: {
    addressLatitude: 25.979306,
    addressLongitude: -80.186822,
    originLatitude: 25.979306,
    originLongitude: -80.186822,
  },
};

const localDrawing: RoofDrawing = {
  planes: [
    {
      id: "flat",
      name: "Flat",
      points: [
        { x: 0, y: 10, z: 0 },
        { x: 40, y: 10, z: 0 },
        { x: 40, y: 10, z: 30 },
        { x: 0, y: 10, z: 30 },
      ],
      edges: ["eave", "rake", "eave", "rake"],
    },
  ],
  penetrations: [],
  waste: 10,
  roof_type: "Shingle Roof",
  notes: "",
  condition: "",
  verified: true,
};

afterEach(cleanup);

function renderEditor(drawing: RoofDrawing) {
  const onDone = vi.fn();
  const onCancel = vi.fn();
  const utils = render(<SketchEditor drawing={drawing} onDone={onDone} onCancel={onCancel} />);
  return { ...utils, onDone, onCancel };
}

describe("rotateScreenPointDeg", () => {
  const centre = { px: 480, py: 320 };
  it("turns counter-clockwise on screen for positive angles", () => {
    const rotated = rotateScreenPointDeg({ px: centre.px + 10, py: centre.py }, centre, 90);
    expect(rotated.px).toBeCloseTo(centre.px, 9);
    expect(rotated.py).toBeCloseTo(centre.py - 10, 9);
  });
  it("round-trips: rotating by θ then −θ returns the point", () => {
    const point = { px: 123.4, py: 456.7 };
    for (const angle of [0, 15, 45, 90, 137, -80, 180]) {
      const back = rotateScreenPointDeg(rotateScreenPointDeg(point, centre, angle), centre, -angle);
      expect(back.px).toBeCloseTo(point.px, 9);
      expect(back.py).toBeCloseTo(point.py, 9);
    }
    expect(rotateScreenPointDeg(centre, centre, 73)).toEqual(centre);
  });
});

describe("SketchEditor rotation controls", () => {
  it("renders the rotate controls; steppers turn the view and reset restores north", () => {
    renderEditor(geoDrawing);
    expect(screen.getByRole("button", { name: "Rotate" })).toBeTruthy();
    const ccw = screen.getByRole("button", { name: "Rotate view 15° counter-clockwise" });
    const cw = screen.getByRole("button", { name: "Rotate view 15° clockwise" });
    const reset = screen.getByRole("button", {
      name: "Reset view rotation",
    }) as HTMLButtonElement;
    expect(reset.disabled).toBe(true);
    fireEvent.click(ccw);
    expect(screen.getByText("15°")).toBeTruthy();
    expect(reset.disabled).toBe(false);
    fireEvent.click(cw);
    fireEvent.click(cw);
    expect(screen.getByText("-15°")).toBeTruthy();
    fireEvent.click(reset);
    expect(screen.queryByText("-15°")).toBeNull();
    expect(reset.disabled).toBe(true);
  });

  it("rotating (steppers and a mouse drag) never changes the drawing", () => {
    const { container, onDone } = renderEditor(geoDrawing);
    fireEvent.click(screen.getByRole("button", { name: "Rotate view 15° counter-clockwise" }));
    fireEvent.click(screen.getByRole("button", { name: "Rotate view 15° counter-clockwise" }));
    expect(screen.getByText("30°")).toBeTruthy();
    // Mouse drag with Rotate mode on: grab right of centre, drag to
    // above centre — a quarter turn counter-clockwise.
    fireEvent.click(screen.getByRole("button", { name: "Rotate" }));
    const svg = container.querySelector('svg[aria-label^="Roof sketch"]')!;
    pointer(svg, "pointerdown", { clientX: 580, clientY: 320 });
    pointer(svg, "pointermove", { clientX: 480, clientY: 220 });
    pointer(svg, "pointerup", { clientX: 480, clientY: 220 });
    expect(screen.getByText("120°")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onDone).toHaveBeenCalledTimes(1);
    const [next, changed] = onDone.mock.calls[0]! as [RoofDrawing, boolean];
    expect(changed).toBe(false);
    expect(next).toEqual(geoDrawing);
  });
});

describe("editing under rotation", () => {
  it("a vertex drag at 90° lands on the inverse-rotated drawing point", () => {
    const { container, onDone } = renderEditor(localDrawing);
    // Local camera: centre (20, 15) at canvas centre (480, 320),
    // fit scale 640·0.72/40 = 11.52 px/ft. Vertex (40, 30) projects
    // unrotated to (710.4, 492.8); at +90° it sits at (652.8, 89.6).
    for (let i = 0; i < 6; i++)
      fireEvent.click(screen.getByRole("button", { name: "Rotate view 15° counter-clockwise" }));
    expect(screen.getByText("90°")).toBeTruthy();
    const handles = [...container.querySelectorAll("circle")].filter(
      (circle) => circle.getAttribute("fill") === "#22C55E" && circle.getAttribute("r") === "5.5",
    );
    const handle = handles.find(
      (circle) =>
        Math.abs(Number(circle.getAttribute("cx")) - 652.8) < 1 &&
        Math.abs(Number(circle.getAttribute("cy")) - 89.6) < 1,
    );
    expect(handle).toBeTruthy();
    const svg = container.querySelector('svg[aria-label^="Roof sketch"]')!;
    pointer(handle!, "pointerdown", { clientX: 652, clientY: 90 });
    // Drag right on screen in the rotated view. jsdom delivers
    // integer client coordinates, so the drop lands at (768, 90),
    // whose inverse-rotated drawing position is x = 230/11.52 + 20
    // ≈ 39.965, z = 40 exactly. A mapping that forgot to invert the
    // rotation would put the vertex near (65, 5) instead.
    pointer(svg, "pointermove", { clientX: 768, clientY: 90 });
    pointer(svg, "pointerup", { clientX: 768, clientY: 90 });
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onDone).toHaveBeenCalledTimes(1);
    const [next, changed] = onDone.mock.calls[0]! as [RoofDrawing, boolean];
    expect(changed).toBe(true);
    const moved = next.planes[0]!.points[2]!;
    expect(moved.x).toBeCloseTo(39.9653, 3);
    expect(moved.z).toBeCloseTo(40, 6);
    expect(moved.y).toBe(10);
    // The untouched corners stay put.
    expect(next.planes[0]!.points[0]).toEqual({ x: 0, y: 10, z: 0 });
    expect(next.planes[0]!.points[1]).toEqual({ x: 40, y: 10, z: 0 });
  });
});
