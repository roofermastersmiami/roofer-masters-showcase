import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditSketchButton } from "@/components/dashboard/EditSketchButton";
import { useAutoFinishReports } from "@/components/dashboard/use-auto-finish";
import type { RoofOrder } from "@/components/dashboard/roof-orders-data";
import type { Database } from "@/integrations/supabase/types";
import {
  getMeasurementActivitySnapshot,
  resetMeasurementActivityForTests,
  setMeasurementNotifier,
  type MeasurementNotice,
} from "@/lib/measurement-activity";
import { automaticMaterialList } from "@/lib/material-order";
import { attachRoofOrderPdf } from "@/lib/roof-orders.functions";
import { saveRoofDrawing } from "@/lib/roof-drawing.functions";
import { measureDrawing, type RoofDrawing } from "@/lib/roof-geometry";

type RoofDrawingRow = Database["public"]["Tables"]["roof_drawings"]["Row"];

// ---------------------------------------------------------------------------
// End-to-end: Fredy edits a finished report's sketch from the list and
// everything downstream updates by itself — the background engine (the
// one finisher) regenerates the report PDF from the edited drawing and
// replaces the stored file, and every surface reading the shared
// queries shows the edited drawing's totals. The store below stands in
// for the database: the mocked saveRoofDrawing performs the same
// writes the save_report_drawing RPC performs (new revision row +
// the order's drawing link/version), and the mocked attach updates
// the order's file_path, exactly like the real server functions.
// ---------------------------------------------------------------------------

const ORDER_ID = "11111111-1111-4111-8111-111111111111";
const OLD_DRAWING_ID = "33333333-3333-4333-8333-333333333333";
const NEW_DRAWING_ID = "44444444-4444-4444-8444-444444444444";
const OLD_PDF_PATH = `roof-report/${ORDER_ID}/original.pdf`;

const SERVICE_TOTALS = { ridge: 111, hip: 222, valley: 333, eave: 444, rake: 55, pitch_change: 0 };

const detectedDrawing: RoofDrawing = {
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
  service_edge_lengths_lf: SERVICE_TOTALS,
};

type Store = {
  order: Record<string, unknown>;
  drawings: Array<Record<string, unknown>>;
};

const state = vi.hoisted(() => ({ store: null as unknown as Store }));

function freshStore(): Store {
  return {
    order: {
      id: ORDER_ID,
      customer_id: "22222222-2222-4222-8222-222222222222",
      property_id: "22222222-2222-4222-8222-222222222222",
      address: "4311 SW 32nd Dr, West Park, FL 33023",
      title: "Roof measurement — 4311 SW 32nd Dr",
      provider: "manual",
      status: "received",
      provider_reference: "",
      file_path: OLD_PDF_PATH,
      measurements: null,
      notes: "",
      customer_phone: "",
      customer_email: "",
      drawing_id: OLD_DRAWING_ID,
      reviewed_at: null,
      created_at: "2026-11-27T18:00:00.000Z",
      updated_at: "2026-11-27T18:00:00.000Z",
    },
    drawings: [
      {
        id: OLD_DRAWING_ID,
        property_id: "22222222-2222-4222-8222-222222222222",
        revision: 1,
        geometry: detectedDrawing,
        media: [],
      },
    ],
  };
}

const storageUpload = vi.fn(async () => ({ error: null }));
const storageRemove = vi.fn(async () => ({ data: [], error: null }));
const storageDownload = vi.fn(async () => ({
  data: null,
  error: new Error("photo not found in test"),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    storage: {
      from: () => ({ upload: storageUpload, remove: storageRemove, download: storageDownload }),
    },
    from: (table: string) => ({
      select: () => ({
        eq: (_column: string, value: string) => ({
          maybeSingle: async () => {
            if (table === "roof_report_orders") {
              const order = state.store.order;
              return {
                data: {
                  updated_at: order.updated_at,
                  file_path: order.file_path,
                  status: order.status,
                  drawing_id: order.drawing_id,
                },
                error: null,
              };
            }
            if (table === "roof_drawings") {
              return {
                data: state.store.drawings.find((row) => row.id === value) ?? null,
                error: null,
              };
            }
            return { data: null, error: null };
          },
        }),
      }),
    }),
  },
}));

vi.mock("@/lib/roof-drawing-pdf", () => ({
  roofDrawingPdf: vi.fn(async () => new Uint8Array([37, 80, 68, 70])),
}));
vi.mock("@/lib/aerial-photo", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/aerial-photo")>();
  return { ...actual, fetchAerialPhoto: vi.fn(async () => null) };
});

vi.mock("@/lib/roof-drawing.functions", () => ({
  saveRoofDrawing: vi.fn(
    async (input: {
      data: {
        property_id: string;
        title: string;
        geometry: RoofDrawing;
        parent_id: string | null;
        media: unknown[];
        report_order_id?: string;
      };
    }) => {
      const row = {
        id: NEW_DRAWING_ID,
        property_id: input.data.property_id,
        revision: 2,
        geometry: input.data.geometry,
        media: input.data.media,
      };
      state.store.drawings = [...state.store.drawings, row];
      // The save_report_drawing RPC links the order to the new
      // revision and bumps its version in the same write.
      state.store.order = {
        ...state.store.order,
        drawing_id: NEW_DRAWING_ID,
        updated_at: "2026-11-27T18:05:00.000Z",
      };
      return row;
    },
  ),
}));
vi.mock("@/lib/roof-orders.functions", () => ({
  attachRoofOrderPdf: vi.fn(async (input: { data: { id: string; path: string } }) => {
    state.store.order = {
      ...state.store.order,
      file_path: input.data.path,
      updated_at: "2026-11-27T18:06:00.000Z",
    };
    return { id: input.data.id };
  }),
}));
vi.mock("@/lib/report-aerial.functions", () => ({
  loadReportAerial: vi.fn(async () => ({})),
}));
vi.mock("@tanstack/react-start", () => ({
  useServerFn: (fn: unknown) => fn,
}));

/** One list surface: the finisher hook plus the report's card
 * controls, both fed by the same shared queries the real surfaces
 * use — so the editor save's invalidations are what refresh them. */
function Surface() {
  const ordersQuery = useQuery({
    queryKey: ["roof-report-orders"],
    queryFn: async () => [state.store.order] as unknown as RoofOrder[],
  });
  const drawingsQuery = useQuery({
    queryKey: ["roof-drawings"],
    queryFn: async () => [...state.store.drawings] as unknown as RoofDrawingRow[],
  });
  const orders = ordersQuery.data;
  const drawings = drawingsQuery.data;
  useAutoFinishReports(orders, drawings, []);
  const order = orders?.[0];
  const drawingRow = drawings?.find((row) => row.id === order?.drawing_id) ?? null;
  if (!order) return null;
  const totals = drawingRow ? measureDrawing(drawingRow.geometry as unknown as RoofDrawing) : null;
  return (
    <div>
      <EditSketchButton report={order} drawingRow={drawingRow} />
      {totals && (
        <output data-testid="card-totals">
          {`area ${totals.area.toFixed(1)} · ridge ${totals.edges.ridge.toFixed(1)} · valley ${totals.edges.valley.toFixed(1)} · eave ${totals.edges.eave.toFixed(1)}`}
        </output>
      )}
    </div>
  );
}

const tick = (ms = 200) => new Promise((resolve) => setTimeout(resolve, ms));

beforeEach(() => {
  vi.clearAllMocks();
  state.store = freshStore();
  resetMeasurementActivityForTests();
});

afterEach(() => {
  cleanup();
  setMeasurementNotifier(null);
});

describe("Edit Sketch save → automatic update everywhere", () => {
  it("regenerates the PDF from the edited drawing exactly once and every surface follows the edit", async () => {
    const notices: MeasurementNotice[] = [];
    setMeasurementNotifier((notice) => notices.push(notice));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(
      <QueryClientProvider client={client}>
        <Surface />
      </QueryClientProvider>,
    );

    // A finished report idles: no intent, no finish, until the edit.
    await tick();
    expect(vi.mocked(attachRoofOrderPdf)).not.toHaveBeenCalled();
    const before = measureDrawing(detectedDrawing);
    expect(screen.getByTestId("card-totals").textContent).toContain(
      `valley ${before.edges.valley.toFixed(1)}`,
    );

    // Fredy's edit: open the sketch, retype the front eave as a
    // valley, press Done.
    fireEvent.click(screen.getByRole("button", { name: /edit sketch/i }));
    fireEvent.click(screen.getByRole("button", { name: "Edges" }));
    const hitLines = [...container.querySelectorAll("line")].filter(
      (line) => line.getAttribute("stroke") === "transparent",
    );
    expect(hitLines.length).toBeGreaterThan(0);
    fireEvent.pointerDown(hitLines[0]!);
    fireEvent.click(screen.getByRole("button", { name: "Valley" }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));

    // The editor saved exactly one new revision, and the engine —
    // not the editor — attached exactly one regenerated PDF.
    await waitFor(() => expect(vi.mocked(attachRoofOrderPdf)).toHaveBeenCalledTimes(1));
    expect(vi.mocked(saveRoofDrawing)).toHaveBeenCalledTimes(1);
    const savedGeometry = (
      vi.mocked(saveRoofDrawing).mock.calls[0]![0] as { data: { geometry: RoofDrawing } }
    ).data.geometry;
    const attached = vi.mocked(attachRoofOrderPdf).mock.calls[0]![0] as {
      data: { id: string; path: string };
    };
    expect(attached.data.id).toBe(ORDER_ID);
    expect(attached.data.path).toMatch(new RegExp(`^roof-report/${ORDER_ID}/`));
    expect(attached.data.path).not.toBe(OLD_PDF_PATH);
    expect(storageUpload).toHaveBeenCalledTimes(1);
    // The superseded PDF is removed and the refresh notifies once.
    expect(storageRemove).toHaveBeenCalledWith([OLD_PDF_PATH]);
    await waitFor(() =>
      expect(notices.filter((notice) => notice.id === ORDER_ID)).toEqual([
        { kind: "ready", id: ORDER_ID, address: state.store.order.address },
      ]),
    );
    expect(getMeasurementActivitySnapshot().find((entry) => entry.id === ORDER_ID)?.status).toBe(
      "ready",
    );

    // The card totals now come from the edited drawing — the retyped
    // edge moved from eave to valley — with no remount or reload.
    const edited = measureDrawing(savedGeometry);
    expect(edited.edges.valley).toBeGreaterThan(before.edges.valley);
    await waitFor(() =>
      expect(screen.getByTestId("card-totals").textContent).toContain(
        `valley ${edited.edges.valley.toFixed(1)}`,
      ),
    );
    expect(screen.getByTestId("card-totals").textContent).toContain(
      `eave ${edited.edges.eave.toFixed(1)}`,
    );

    // The material list follows the edited drawing too: the saved
    // revision retired the detection's edge totals, so its takeoff
    // derives from the edited geometry — where the unedited drawing
    // still (correctly) prefers the service's totals.
    expect(savedGeometry.service_edge_lengths_lf).toBeUndefined();
    expect(automaticMaterialList(detectedDrawing).report.valleys_lf).toBe(SERVICE_TOTALS.valley);
    expect(automaticMaterialList(savedGeometry).report.valleys_lf).toBeCloseTo(edited.edges.valley);
    expect(automaticMaterialList(savedGeometry).report.eaves_lf).toBeCloseTo(edited.edges.eave);
  });
});
