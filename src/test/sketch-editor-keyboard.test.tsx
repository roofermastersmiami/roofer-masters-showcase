import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SketchEditor } from "@/components/dashboard/SketchEditor";
import type { RoofDrawing } from "@/lib/roof-geometry";

/**
 * Keyboard support in Edit Sketch (Fredy, testing on a Mac):
 * Delete/Backspace removes the current selection, Cmd+Z undoes and
 * Cmd+Shift+Z redoes — all through the same operations the toolbar
 * and panel buttons use. Shortcuts must never fire while typing in a
 * form field, where Backspace and Cmd+Z belong to the text.
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

// jsdom's setPointerCapture throws for synthetic pointer ids; real
// browsers accept the capture the editor requests on pointerdown.
Element.prototype.setPointerCapture = () => {};
Element.prototype.releasePointerCapture = () => {};

/** jsdom has no PointerEvent constructor, so dispatch MouseEvents
 * under the pointer type names (same quirk the other editor tests
 * document). */
function pointer(el: Element, type: string, init: MouseEventInit) {
  fireEvent(el, new MouseEvent(type, { bubbles: true, cancelable: true, ...init }));
}

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

/** Click the facet body in Edges mode — selects the nearest edge. */
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
  const click = { x: c.x, y: c.y + (edgeY - c.y) * 0.65 };
  const svg = container.querySelector('svg[aria-label^="Roof sketch"]');
  if (!svg) throw new Error("editor canvas svg not found");
  pointer(svg, "pointerdown", { clientX: click.x, clientY: click.y });
  pointer(svg, "pointerup", { clientX: click.x, clientY: click.y });
}

/** The transparent 18px hit lines are the clickable edge targets —
 * one per drawing edge, so their count tracks deletions exactly. */
function hitLineCount(container: HTMLElement) {
  return [...container.querySelectorAll("line")].filter(
    (line) => line.getAttribute("stroke") === "transparent",
  ).length;
}

function canvasClick(container: HTMLElement, x: number, y: number) {
  const svg = container.querySelector('svg[aria-label^="Roof sketch"]');
  if (!svg) throw new Error("editor canvas svg not found");
  pointer(svg, "pointerdown", { clientX: x, clientY: y });
  pointer(svg, "pointerup", { clientX: x, clientY: y });
}

function key(init: KeyboardEventInit) {
  fireEvent.keyDown(document.body, init);
}

describe("SketchEditor keyboard shortcuts", () => {
  it("Backspace deletes the selected edge; Cmd+Z restores it; Cmd+Shift+Z deletes it again", () => {
    const onDone = vi.fn();
    const { container } = render(
      <SketchEditor drawing={drawing} onDone={onDone} onCancel={vi.fn()} />,
    );
    const undoButton = screen.getByRole("button", { name: "Undo" }) as HTMLButtonElement;
    const redoButton = screen.getByRole("button", { name: "Redo" }) as HTMLButtonElement;
    expect(undoButton.disabled).toBe(true);
    expect(hitLineCount(container)).toBe(8);

    clickFacetBody(container, 0, "bottom");
    expect(screen.getByText(/Edge 3 · Front slope ·/)).toBeTruthy();

    key({ key: "Backspace" });
    expect(hitLineCount(container)).toBe(7);
    // Selection cleared, exactly like the Delete Edge button leaves it.
    expect(screen.getByText("Click an edge in the drawing to select it.")).toBeTruthy();
    expect(undoButton.disabled).toBe(false);

    key({ key: "z", metaKey: true });
    expect(hitLineCount(container)).toBe(8);
    expect(redoButton.disabled).toBe(false);

    key({ key: "Z", metaKey: true, shiftKey: true });
    expect(hitLineCount(container)).toBe(7);

    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    const [next] = onDone.mock.calls[0] as [RoofDrawing, boolean];
    expect(next.planes.reduce((sum, plane) => sum + plane.edges.length, 0)).toBe(7);
  });

  it("Delete key works too, with Ctrl+Z undo and Ctrl+Y / Ctrl+Shift+Z redo", () => {
    const { container } = render(
      <SketchEditor drawing={drawing} onDone={vi.fn()} onCancel={vi.fn()} />,
    );
    clickFacetBody(container, 1, "bottom");
    expect(screen.getByText(/Edge 3 · Back slope ·/)).toBeTruthy();

    key({ key: "Delete" });
    expect(hitLineCount(container)).toBe(7);

    key({ key: "z", ctrlKey: true });
    expect(hitLineCount(container)).toBe(8);

    key({ key: "y", ctrlKey: true });
    expect(hitLineCount(container)).toBe(7);

    key({ key: "z", ctrlKey: true });
    expect(hitLineCount(container)).toBe(8);

    key({ key: "Z", ctrlKey: true, shiftKey: true });
    expect(hitLineCount(container)).toBe(7);
  });

  it("never fires while typing in a form field, and Cmd+Backspace is not a delete", () => {
    const onDone = vi.fn();
    const { container } = render(
      <SketchEditor drawing={drawing} onDone={onDone} onCancel={vi.fn()} />,
    );
    clickFacetBody(container, 0, "bottom");

    // A modified Backspace is not the delete shortcut.
    key({ key: "Backspace", metaKey: true });
    expect(hitLineCount(container)).toBe(8);

    // Make a real edit so there is history to (not) undo from a field.
    key({ key: "Backspace" });
    expect(hitLineCount(container)).toBe(7);

    fireEvent.click(screen.getByRole("button", { name: "Facets" }));
    const nameInput = screen.getByLabelText(/Facet name/);
    // Backspace inside the facet-name input edits text — the facet
    // (and the earlier edge deletion) must survive untouched.
    fireEvent.keyDown(nameInput, { key: "Backspace" });
    fireEvent.keyDown(nameInput, { key: "z", metaKey: true });
    fireEvent.keyDown(nameInput, { key: "Delete" });
    expect(hitLineCount(container)).toBe(7);
    expect(screen.getByRole("button", { name: /Front slope/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Back slope/ })).toBeTruthy();

    // Same guard for the panel's select fields.
    const directionSelect = screen.getByRole("combobox", { name: "Pitch rises toward" });
    fireEvent.keyDown(directionSelect, { key: "Backspace" });
    expect(hitLineCount(container)).toBe(7);

    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    const [next] = onDone.mock.calls[0] as [RoofDrawing, boolean];
    expect(next.planes.length).toBe(2);
    expect(next.planes.reduce((sum, plane) => sum + plane.edges.length, 0)).toBe(7);
  });

  it("Backspace deletes the selected facet in Facets mode", () => {
    const onDone = vi.fn();
    render(<SketchEditor drawing={drawing} onDone={onDone} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Facets" }));
    // The first facet is the current selection in Facets mode.
    expect((screen.getByLabelText(/Facet name/) as HTMLInputElement).value).toBe("Front slope");

    key({ key: "Backspace" });
    expect(screen.queryByRole("button", { name: /Front slope/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Back slope/ })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    const [next, changed] = onDone.mock.calls[0] as [RoofDrawing, boolean];
    expect(changed).toBe(true);
    expect(next.planes.map((plane) => plane.id)).toEqual(["back-slope"]);
  });

  it("Delete removes a selected pin in Pins mode, and Cmd+Z brings it back", () => {
    const onDone = vi.fn();
    const { container } = render(
      <SketchEditor drawing={drawing} onDone={onDone} onCancel={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Pins" }));
    expect(screen.getByText("No pin selected.")).toBeTruthy();

    // Clicking the roof drops a pin and selects it.
    canvasClick(container, 300, 200);
    expect(screen.getByLabelText("Pin type")).toBeTruthy();
    expect(screen.getByText(/1 pin on this drawing/)).toBeTruthy();

    key({ key: "Delete" });
    expect(screen.getByText("No pin selected.")).toBeTruthy();
    expect(screen.queryByText(/pin on this drawing/)).toBeNull();

    // Undo restores the pin (selection stays cleared, as with edges).
    key({ key: "z", metaKey: true });
    expect(screen.getByText(/1 pin on this drawing/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    const [next] = onDone.mock.calls[0] as [RoofDrawing, boolean];
    expect(next.penetrations.length).toBe(1);
  });

  it("Escape clears the edge selection and any in-progress draft, changing nothing", () => {
    const onDone = vi.fn();
    const { container } = render(
      <SketchEditor drawing={drawing} onDone={onDone} onCancel={vi.fn()} />,
    );
    clickFacetBody(container, 0, "bottom");
    expect(screen.getByText(/Edge 3 · Front slope ·/)).toBeTruthy();

    key({ key: "Escape" });
    expect(screen.getByText("Click an edge in the drawing to select it.")).toBeTruthy();
    expect(hitLineCount(container)).toBe(8);

    // An in-progress Draw sequence is abandoned by Escape too.
    fireEvent.click(screen.getByRole("button", { name: "Draw" }));
    canvasClick(container, 200, 200);
    canvasClick(container, 650, 200);
    canvasClick(container, 650, 480);
    expect(screen.getByText(/3 corners placed/)).toBeTruthy();
    key({ key: "Escape" });
    expect(screen.getByText(/0 corners placed/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    const [, changed] = onDone.mock.calls[0] as [RoofDrawing, boolean];
    expect(changed).toBe(false);
  });
});
