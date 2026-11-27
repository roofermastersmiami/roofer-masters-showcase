import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RoofMeasurements } from "@/components/dashboard/RoofMeasurements";
import { useAutoFinishReports } from "@/components/dashboard/use-auto-finish";
import {
  getMeasurementActivitySnapshot,
  resetMeasurementActivityForTests,
  setMeasurementNotifier,
  type MeasurementNotice,
} from "@/lib/measurement-activity";
import type { RoofOrder } from "@/components/dashboard/roof-orders-data";

// Guards for the simplified workspace (PR following #232/#236):
//  - the old system's manual "Download PDF" header button is gone;
//  - the property address is rendered exactly once (address-created
//    reports are titled by their address, and the header subtitle
//    used to print it a second time — the tab header printed it
//    twice more on top of that);
//  - the hands-off chain still runs end to end: an applied automatic
//    measurement saves, generates + attaches the report PDF, and
//    builds the automatic material list with its Takeoff PDF export.

const ADDRESS = "4311 SW 32nd Dr, West Park, FL 33023";

const saveDrawingMock = vi.fn(async (_input?: unknown) => ({ id: "drawing-2", revision: 2 }));
const attachPdfMock = vi.fn(async (_input?: unknown) => ({ id: "report-1" }));
const storageUploadMock = vi.fn(async (..._args: unknown[]) => ({ error: null }));

// A tiny fake of the report-order row + its drawings, shared by the
// workspace, the background engine and the order-row reads in the
// convergence test below. It mirrors the real write semantics:
// saving a drawing bumps updated_at and links the drawing; the
// attach guard rejects a stale updated_at exactly like
// attachRoofOrderPdf does.
type FakeOrderRow = {
  updated_at: string;
  file_path: string | null;
  status: string;
  drawing_id: string | null;
};
const fakeStore = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  return {
    order: null as FakeOrderRow | null,
    drawings: [] as Array<{ id: string; geometry: unknown; media: unknown[] }>,
    version: 0,
    listeners,
    emit() {
      for (const listener of listeners) listener();
    },
    nextVersion() {
      this.version += 1;
      return `2026-11-27T19:00:${String(this.version).padStart(2, "0")}.000Z`;
    },
  };
});

vi.mock("@tanstack/react-start", () => ({
  useServerFn: (fn: unknown) => fn,
}));

vi.mock("@/lib/report-aerial.functions", () => ({
  loadReportAerial: vi.fn(async () => ({ error: "no imagery in test", stage: "imagery" })),
}));

vi.mock("@/lib/roof-drawing.functions", () => ({
  saveRoofDrawing: (input: unknown) => saveDrawingMock(input),
}));

vi.mock("@/lib/roof-orders.functions", () => ({
  attachRoofOrderPdf: (input: unknown) => attachPdfMock(input),
}));

vi.mock("@/lib/roof-drawing-pdf", () => ({
  roofDrawingPdf: vi.fn(async () => new Uint8Array([37, 80, 68, 70])),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    storage: {
      from: () => ({
        createSignedUrl: vi.fn(async () => ({
          data: { signedUrl: "https://signed.example/aerial.jpg" },
          error: null,
        })),
        download: vi.fn(async () => ({ data: null, error: new Error("not stored in test") })),
        upload: storageUploadMock,
        remove: vi.fn(async () => ({ data: [], error: null })),
      }),
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: fakeStore.order
              ? { ...fakeStore.order }
              : {
                  updated_at: "2026-11-27T12:00:00.000Z",
                  file_path: null,
                  status: "requested",
                  drawing_id: null,
                },
            error: null,
          }),
        }),
      }),
    }),
  },
}));

vi.mock("@/components/dashboard/foundation-data", () => ({
  propertiesQuery: {
    queryKey: ["properties"],
    queryFn: async () => [
      {
        id: "property-1",
        customer_id: "customer-1",
        address: "4311 SW 32nd Dr, West Park, FL 33023",
      },
    ],
  },
  customersQuery: {
    queryKey: ["customers"],
    queryFn: async () => [{ id: "customer-1", name: "West Park Owner", source_lead_id: "lead-1" }],
  },
}));

// Stands in for the automatic measurement: one click applies a
// measured gable drawing, exactly like a finished LiDAR run does.
vi.mock("@/components/dashboard/AutomatedRoofReport", async () => {
  const { createElement } = await import("react");
  const plane = (id: string, name: string, points: { x: number; y: number; z: number }[]) => ({
    id,
    name,
    points,
    edges: ["eave", "rake", "ridge", "rake"],
  });
  const detectedDrawing = {
    planes: [
      plane("front", "Front slope", [
        { x: 0, y: 0, z: 15 },
        { x: 40, y: 0, z: 15 },
        { x: 40, y: 7.5, z: 0 },
        { x: 0, y: 7.5, z: 0 },
      ]),
      plane("back", "Back slope", [
        { x: 40, y: 0, z: -15 },
        { x: 0, y: 0, z: -15 },
        { x: 0, y: 7.5, z: 0 },
        { x: 40, y: 7.5, z: 0 },
      ]),
    ],
    penetrations: [],
    waste: 10,
    roof_type: "Shingle Roof",
    notes: "",
    condition: "",
    verified: false,
  };
  return {
    AutomatedRoofReport: ({ onApply }: { onApply: (drawing: typeof detectedDrawing) => boolean }) =>
      createElement(
        "button",
        { onClick: () => onApply(detectedDrawing) },
        "Apply automatic measurement",
      ),
  };
});

vi.mock("@/components/dashboard/RoofScene", () => ({
  default: ({ view }: { view: string }) => <div data-testid="roof-scene">scene-{view}</div>,
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// An address-created report: its title IS the property address.
const report = {
  id: "report-1",
  title: ADDRESS,
  property_id: "property-1",
  address: ADDRESS,
  notes: "",
  status: "requested",
  created_at: "2026-11-27T12:00:00.000Z",
  customer_phone: "",
  customer_email: "",
  file_path: null,
} as unknown as RoofOrder;

function renderWorkspace() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <RoofMeasurements report={report} initialDrawing={null} />
    </QueryClientProvider>,
  );
}

function addressOccurrences(container: HTMLElement) {
  return (container.textContent ?? "").split(ADDRESS).length - 1;
}

beforeEach(() => {
  saveDrawingMock.mockClear();
  attachPdfMock.mockClear();
  storageUploadMock.mockClear();
  // Applying a measurement over the starter preset asks for
  // confirmation in the real UI; accept it here.
  vi.stubGlobal("confirm", () => true);
  URL.createObjectURL = vi.fn(() => "blob:test");
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("RoofMeasurements workspace header", () => {
  it("renders no Download PDF action and shows the address exactly once", async () => {
    const { container } = renderWorkspace();
    // The views still render.
    expect(
      screen
        .getAllByRole("button", { name: /^(House photo|3D House|2D Plan)$/ })
        .map((button) => button.textContent),
    ).toEqual(["House photo", "3D House", "2D Plan"]);
    // The old system's manual download is gone.
    expect(screen.queryByRole("button", { name: /Download PDF/i })).toBeNull();
    // The title is the address; the subtitle must not repeat it.
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe(ADDRESS);
    await waitFor(() => expect(addressOccurrences(container)).toBe(1));
  });

  it("still finishes hands-off: saves the drawing, hands the PDF step to the engine, and builds the material list", async () => {
    const { container } = renderWorkspace();
    fireEvent.click(screen.getByRole("button", { name: "Apply automatic measurement" }));
    // The automatic chain runs without any further click.
    expect(await screen.findByText("Material list — generated automatically")).toBeTruthy();
    await waitFor(() => expect(saveDrawingMock).toHaveBeenCalledTimes(1));
    // One finisher: the workspace itself never attaches a report
    // PDF — that step belongs to the background engine (mounted
    // alongside in the convergence describe below, where the single
    // attach is pinned).
    expect(attachPdfMock).not.toHaveBeenCalled();
    // The material list's own Takeoff PDF export survives.
    await waitFor(() => expect(screen.getByRole("button", { name: /Takeoff PDF/i })).toBeTruthy());
    // And still: no workspace Download PDF, address shown once.
    expect(screen.queryByRole("button", { name: /Download PDF/i })).toBeNull();
    expect(addressOccurrences(container)).toBe(1);
  });
});

describe("workspace + background engine convergence (Fredy's 2026-11-27 ~6:18 PM sequence)", () => {
  // Fredy watched the workspace's automatic measurement finish; at
  // the finish moment the card recorded the engine's double-stale
  // terminal error and the finisher kept cycling. The two chains —
  // the workspace's own save+attach and the background engine's —
  // wrote the same report row and staled each other. This harness
  // mounts BOTH in one tree over a fake order store with the real
  // write semantics, and pins the one-finisher architecture: the
  // workspace measures and saves its drawing, the engine alone
  // generates + attaches the PDF, exactly once, with no duplicate
  // measurement submission and no error outcome.
  const fetchMock = vi.fn(async (input: unknown, init?: { method?: string }) => {
    const url = String(input);
    if (url.includes("/v1/roof/analyze/jobs") && init?.method === "POST") {
      return {
        ok: true,
        status: 202,
        json: async () => ({ job_id: "job-1", status: "queued" }),
      } as Response;
    }
    // A job that never completes: any chain that submits a duplicate
    // measurement just sits there — the assertions count submissions.
    return {
      ok: true,
      status: 200,
      json: async () => ({
        job_id: "job-1",
        status: "running",
        stage: "fitting_planes",
        detail: "Fitting roof planes",
        download_fraction: null,
      }),
    } as Response;
  });

  function EngineHarness() {
    const [, setTick] = useState(0);
    useEffect(() => {
      const listener = () => setTick((tick) => tick + 1);
      fakeStore.listeners.add(listener);
      return () => {
        fakeStore.listeners.delete(listener);
      };
    }, []);
    const order = {
      ...report,
      provider: "manual",
      customer_id: "customer-1",
      updated_at: fakeStore.order?.updated_at ?? "2026-11-27T19:00:00.000Z",
      file_path: fakeStore.order?.file_path ?? null,
      status: fakeStore.order?.status ?? "requested",
      drawing_id: fakeStore.order?.drawing_id ?? null,
    } as unknown as RoofOrder;
    useAutoFinishReports([order], fakeStore.drawings as never, []);
    return null;
  }

  beforeEach(() => {
    fakeStore.order = {
      updated_at: "2026-11-27T19:00:00.000Z",
      file_path: null,
      status: "requested",
      drawing_id: null,
    };
    fakeStore.drawings = [];
    fakeStore.version = 0;
    fetchMock.mockClear();
    vi.stubGlobal("fetch", fetchMock);
    // The fake store's write semantics, shared by both chains.
    saveDrawingMock.mockImplementation(async (input?: unknown) => {
      const geometry = (input as { data: { geometry: unknown } }).data.geometry;
      fakeStore.order = {
        ...fakeStore.order!,
        drawing_id: "drawing-2",
        updated_at: fakeStore.nextVersion(),
      };
      fakeStore.drawings = [{ id: "drawing-2", geometry, media: [] }];
      fakeStore.emit();
      return { id: "drawing-2", revision: 2 };
    });
    attachPdfMock.mockImplementation(async (input?: unknown) => {
      const data = (input as { data: { id: string; path: string; updated_at: string } }).data;
      if (!fakeStore.order || data.updated_at !== fakeStore.order.updated_at) {
        throw new Error("Reload the report request before attaching this PDF");
      }
      fakeStore.order = {
        ...fakeStore.order,
        file_path: data.path,
        status: "received",
        updated_at: fakeStore.nextVersion(),
      };
      fakeStore.emit();
      return { id: "report-1" };
    });
  });

  afterEach(() => {
    saveDrawingMock.mockReset();
    saveDrawingMock.mockImplementation(async () => ({ id: "drawing-2", revision: 2 }));
    attachPdfMock.mockReset();
    attachPdfMock.mockImplementation(async () => ({ id: "report-1" }));
    fakeStore.order = null;
    fakeStore.drawings = [];
    setMeasurementNotifier(null);
  });

  it("converges: the workspace saves once, the engine attaches exactly one PDF, nothing re-measures, no error is recorded", async () => {
    resetMeasurementActivityForTests();
    const notices: MeasurementNotice[] = [];
    setMeasurementNotifier((notice) => notices.push(notice));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    // The workspace mounts first — mirroring the real order-form
    // flow, where creating a report opens its workspace (claiming
    // it) before the background engine ever sees the new order.
    render(
      <QueryClientProvider client={client}>
        <RoofMeasurements report={report} initialDrawing={null} />
        <EngineHarness />
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Apply automatic measurement" }));

    // The finish lands on the fake order exactly once.
    await waitFor(() => expect(fakeStore.order?.file_path).toMatch(/^roof-report\/report-1\//), {
      timeout: 10000,
    });
    expect(fakeStore.order?.status).toBe("received");
    // One drawing save (the workspace's), one attach (the engine's),
    // and no measurement job was ever submitted to the service.
    expect(saveDrawingMock).toHaveBeenCalledTimes(1);
    expect(attachPdfMock).toHaveBeenCalledTimes(1);
    const jobPosts = fetchMock.mock.calls.filter(
      ([input, init]) =>
        String(input).includes("/v1/roof/analyze/jobs") &&
        (init as { method?: string } | undefined)?.method === "POST",
    );
    expect(jobPosts).toHaveLength(0);
    // Exactly one ready notification, and no failure was recorded.
    expect(notices.filter((notice) => notice.id === "report-1")).toEqual([
      { kind: "ready", id: "report-1", address: ADDRESS },
    ]);
    expect(getMeasurementActivitySnapshot().find((entry) => entry.id === "report-1")?.status).toBe(
      "ready",
    );
  }, 20000);
});
