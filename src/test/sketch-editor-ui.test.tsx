import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SketchEditor } from "@/components/dashboard/SketchEditor";
import type { RoofDrawing } from "@/lib/roof-geometry";

// Two gable facets sharing a ridge, geo-referenced to the West Park
// address Fredy used when reporting the broken satellite map.
const drawing: RoofDrawing = {
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
  penetrations: [{ id: "pin-1", kind: "pipe", x: 20, z: 8, width: 1, length: 1 }],
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

afterEach(cleanup);

function renderEditor() {
  const onDone = vi.fn();
  const onCancel = vi.fn();
  const utils = render(<SketchEditor drawing={drawing} onDone={onDone} onCancel={onCancel} />);
  return { ...utils, onDone, onCancel };
}

describe("SketchEditor", () => {
  it("renders the reference layout: toolbar modes, drawing options, edge actions", () => {
    renderEditor();
    for (const label of ["Draw", "Edges", "Facets", "Pins", "Cancel", "Done", "Help"]) {
      expect(screen.getByRole("button", { name: label })).toBeTruthy();
    }
    expect(screen.getByRole("switch", { name: "90 Mode" })).toBeTruthy();
    expect(screen.getByRole("switch", { name: "Line Length" })).toBeTruthy();
    expect(screen.getByRole("switch", { name: "Line Labels" })).toBeTruthy();
    expect(screen.getByText("Edge Actions")).toBeTruthy();
    // Edge type buttons wait for a selection.
    expect((screen.getByRole("button", { name: "Eave" }) as HTMLButtonElement).disabled).toBe(true);
    // The 3D view toggle is in the toolbar.
    expect(screen.getByRole("button", { name: "3D" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sketch" })).toBeTruthy();
  });

  it("draws the facets over satellite tiles with live length labels that toggle off", () => {
    const { container } = renderEditor();
    // The editor's drawing sits in Broward, so the backdrop tiles
    // are the county's Aerials2026_V2 tiles (Esri World Imagery is
    // their per-tile fallback, not the primary src).
    const tileImages = [...container.querySelectorAll("img")].filter((img) =>
      (img.getAttribute("src") ?? "").includes("/MapServer/tile/"),
    );
    expect(tileImages.length).toBeGreaterThan(0);
    expect(
      tileImages.some((img) => (img.getAttribute("src") ?? "").includes("Aerials2026_V2")),
    ).toBe(true);
    // The 40ft eave reads "40.0ft" like the reference editor.
    expect(screen.getAllByText("40.0ft").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("switch", { name: "Line Length" }));
    expect(screen.queryByText("40.0ft")).toBeNull();
  });

  it("selecting an edge enables Edge Actions and retyping flows into Done", () => {
    const { container, onDone } = renderEditor();
    const hitLines = container.querySelectorAll("line");
    expect(hitLines.length).toBeGreaterThan(0);
    fireEvent.pointerDown(hitLines[0]!);
    const eaveButton = screen.getByRole("button", { name: "Eave" }) as HTMLButtonElement;
    expect(eaveButton.disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Valley" }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onDone).toHaveBeenCalledTimes(1);
    const [next, changed] = onDone.mock.calls[0] as [RoofDrawing, boolean];
    expect(changed).toBe(true);
    expect(next.planes[0]?.edges[0]).toBe("valley");
    // Untouched geometry is preserved exactly.
    expect(next.planes[0]?.points).toEqual(drawing.planes[0]?.points);
    expect(next.planes[1]).toEqual(drawing.planes[1]);
  });

  it("Facets mode lists each facet with its measured pitch and area", () => {
    renderEditor();
    fireEvent.click(screen.getByRole("button", { name: "Facets" }));
    expect(screen.getByText("South slope")).toBeTruthy();
    expect(screen.getAllByText(/4\.8\/12 pitch/).length).toBeGreaterThan(0);
  });

  it("Pins and Draw modes render their panels", () => {
    renderEditor();
    fireEvent.click(screen.getByRole("button", { name: "Pins" }));
    expect(screen.getByText(/Pins mark penetrations/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Draw" }));
    expect(screen.getByText("Draw Facet")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Finish facet" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("Done with no edits reports unchanged; Cancel calls back", () => {
    const { onDone, onCancel } = renderEditor();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onDone).toHaveBeenCalledTimes(1);
    expect((onDone.mock.calls[0] as [RoofDrawing, boolean])[1]).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
