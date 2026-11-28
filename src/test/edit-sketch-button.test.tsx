import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditSketchButton } from "@/components/dashboard/EditSketchButton";
import type { Database } from "@/integrations/supabase/types";
import type { RoofDrawing } from "@/lib/roof-geometry";
import type { RoofOrder } from "@/components/dashboard/roof-orders-data";

type RoofDrawingRow = Database["public"]["Tables"]["roof_drawings"]["Row"];

const SAVED_ROW_ID = "44444444-4444-4444-8444-444444444444";

const saveMock = vi.fn(
  async (_input: {
    data: {
      property_id: string;
      title: string;
      geometry: RoofDrawing;
      parent_id: string | null;
      media: unknown[];
      report_order_id?: string;
    };
  }) => ({ id: SAVED_ROW_ID, revision: 4 }),
);

const refreshMock = vi.fn((_reportId: string, _drawingId: string) => {});

vi.mock("@/lib/roof-drawing.functions", () => ({
  saveRoofDrawing: (input: unknown) => saveMock(input as never),
}));

vi.mock("@/components/dashboard/use-auto-finish", () => ({
  requestReportPdfRefresh: (reportId: string, drawingId: string) =>
    refreshMock(reportId, drawingId),
}));

vi.mock("@tanstack/react-start", () => ({
  useServerFn: (fn: unknown) => fn,
}));

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

const report = {
  id: "11111111-1111-4111-8111-111111111111",
  property_id: "22222222-2222-4222-8222-222222222222",
  title: "Roof measurement — 4311 Southwest 32nd Drive",
  address: "4311 Southwest 32nd Drive, West Park, FL 33023",
  drawing_id: "33333333-3333-4333-8333-333333333333",
} as unknown as RoofOrder;

const drawingRow = {
  id: "33333333-3333-4333-8333-333333333333",
  property_id: "22222222-2222-4222-8222-222222222222",
  revision: 3,
  geometry: drawing,
  media: [],
} as unknown as RoofDrawingRow;

afterEach(() => {
  cleanup();
  saveMock.mockClear();
  refreshMock.mockClear();
});

function renderButton(row: RoofDrawingRow | null = drawingRow) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <EditSketchButton report={report} drawingRow={row} />
    </QueryClientProvider>,
  );
}

describe("EditSketchButton (report list)", () => {
  it("renders an Edit sketch action when the report has a saved drawing, and nothing when it does not", () => {
    const { unmount } = renderButton();
    expect(screen.getByRole("button", { name: /edit sketch/i })).toBeTruthy();
    unmount();
    const empty = renderButton(null);
    expect(empty.container.querySelector("button")).toBeNull();
  });

  it("opens the editor from the list and Cancel closes it without saving", () => {
    renderButton();
    fireEvent.click(screen.getByRole("button", { name: /edit sketch/i }));
    // The full sketch editor is mounted (its toolbar Done/Cancel show).
    expect(screen.getByRole("button", { name: "Done" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("button", { name: "Done" })).toBeNull();
    expect(saveMock).not.toHaveBeenCalled();
  });

  it("Done with no edits closes without saving a revision", () => {
    renderButton();
    fireEvent.click(screen.getByRole("button", { name: /edit sketch/i }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(saveMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Done" })).toBeNull();
  });

  it("saves an edit as a new unreviewed revision of the same report, through saveRoofDrawing", async () => {
    const { container } = renderButton();
    fireEvent.click(screen.getByRole("button", { name: /edit sketch/i }));
    fireEvent.click(screen.getByRole("button", { name: "Edges" }));
    const hitLines = [...container.querySelectorAll("line")].filter(
      (line) => line.getAttribute("stroke") === "transparent",
    );
    expect(hitLines.length).toBe(8);
    fireEvent.pointerDown(hitLines[0]!);
    fireEvent.click(screen.getByRole("button", { name: "Valley" }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));

    await waitFor(() => expect(saveMock).toHaveBeenCalledTimes(1));
    const input = saveMock.mock.calls[0]![0] as {
      data: {
        property_id: string;
        title: string;
        geometry: RoofDrawing;
        parent_id: string | null;
        media: unknown[];
        report_order_id?: string;
      };
    };
    expect(input.data.property_id).toBe(report.property_id);
    expect(input.data.title).toBe(report.title);
    expect(input.data.report_order_id).toBe(report.id);
    // New revision hangs off the drawing the list opened.
    expect(input.data.parent_id).toBe(drawingRow.id);
    // Measurement edits clear review state.
    expect(input.data.geometry.verified).toBe(false);
    expect(input.data.geometry.planes[0]?.edges[0]).toBe("valley");
    // This report carries no PDF yet, so no refresh hand-off is
    // registered — the normal auto-finish picks the report up.
    expect(refreshMock).not.toHaveBeenCalled();
    // Editor closed after the successful save.
    await waitFor(() => expect(screen.queryByRole("button", { name: "Done" })).toBeNull());
  });

  it("hands the PDF refresh to the engine and retires the service edge totals when the report already has a PDF", async () => {
    const serviceTotals = {
      ridge: 111,
      hip: 222,
      valley: 333,
      eave: 444,
      rake: 55,
      pitch_change: 0,
    };
    const detectedRow = {
      ...drawingRow,
      geometry: { ...drawing, service_edge_lengths_lf: serviceTotals },
    } as unknown as RoofDrawingRow;
    const finishedReport = {
      ...report,
      file_path: `roof-report/${report.id}/original.pdf`,
      status: "received",
    } as unknown as RoofOrder;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(
      <QueryClientProvider client={client}>
        <EditSketchButton report={finishedReport} drawingRow={detectedRow} />
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: /edit sketch/i }));
    fireEvent.click(screen.getByRole("button", { name: "Edges" }));
    const hitLines = [...container.querySelectorAll("line")].filter(
      (line) => line.getAttribute("stroke") === "transparent",
    );
    fireEvent.pointerDown(hitLines[0]!);
    fireEvent.click(screen.getByRole("button", { name: "Valley" }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));

    await waitFor(() => expect(saveMock).toHaveBeenCalledTimes(1));
    const input = saveMock.mock.calls[0]![0] as { data: { geometry: RoofDrawing } };
    // The hand edit supersedes the detection's seam classification:
    // the saved revision no longer carries the service edge totals,
    // so the material list and the regenerated PDF derive their edge
    // totals from the edited geometry.
    expect(input.data.geometry.service_edge_lengths_lf).toBeUndefined();
    expect(input.data.geometry.planes[0]?.edges[0]).toBe("valley");
    // The one finisher regenerates the PDF from the new revision.
    await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));
    expect(refreshMock).toHaveBeenCalledWith(report.id, SAVED_ROW_ID);
  });
});
