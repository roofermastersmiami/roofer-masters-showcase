import { cleanup, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  finishRoofReport,
  reportNeedsAutoFinish,
  type AutoFinishDeps,
  type AutoFinishProgress,
  type RoofDrawingRow,
  type RoofReportOrderRow,
} from "@/lib/auto-finish";
import { useAutoFinishReports } from "@/components/dashboard/use-auto-finish";
import { drawingSchema, measureDrawing, roofPreset } from "@/lib/roof-geometry";
import { attachRoofOrderPdf } from "@/lib/roof-orders.functions";
import { saveRoofDrawing } from "@/lib/roof-drawing.functions";

// Storage + order-row seams the finish chain uses directly.
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
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: { updated_at: "2026-11-27T12:00:00.000Z" },
            error: null,
          }),
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
// Server functions, bound through useServerFn in the hook.
vi.mock("@/lib/roof-drawing.functions", () => ({
  saveRoofDrawing: vi.fn(async () => ({ id: "drawing-new" })),
}));
vi.mock("@/lib/roof-orders.functions", () => ({
  attachRoofOrderPdf: vi.fn(async () => ({ id: "order-1" })),
}));
vi.mock("@/lib/report-aerial.functions", () => ({
  loadReportAerial: vi.fn(async () => ({})),
}));
vi.mock("@tanstack/react-start", () => ({
  useServerFn: (fn: unknown) => fn,
}));

const ORDER_ID = "11111111-1111-4111-8111-111111111111";

function makeOrder(overrides: Record<string, unknown> = {}): RoofReportOrderRow {
  return {
    id: ORDER_ID,
    customer_id: "22222222-2222-4222-8222-222222222222",
    property_id: "33333333-3333-4333-8333-333333333333",
    address: "4311 SW 32nd Dr, West Park, FL 33023",
    title: "4311 SW 32nd Dr, West Park, FL, 33023",
    provider: "manual",
    status: "requested",
    provider_reference: "",
    file_path: null,
    measurements: null,
    notes: "",
    customer_phone: "",
    customer_email: "",
    drawing_id: null,
    reviewed_at: null,
    created_at: "2026-11-27T15:00:00.000Z",
    updated_at: "2026-11-27T15:00:00.000Z",
    ...overrides,
  } as RoofReportOrderRow;
}

const LIDAR_RESULT = {
  status: "lidar_facets",
  verification: "unverified_public_data",
  matched_address: "4311 SW 32nd Dr, West Park, FL 33023",
  location: { lat: 25.47, lon: -80.48 },
  footprint: {
    source: "OpenStreetMap",
    area_sqft: 1200,
    polygon_geojson: {
      type: "Polygon",
      coordinates: [
        [
          [-80.4801, 25.4699],
          [-80.4799, 25.4699],
          [-80.4799, 25.4701],
          [-80.4801, 25.4701],
          [-80.4801, 25.4699],
        ],
      ],
    },
  },
  roof: {
    facet_count: 1,
    area_sqft: 1200,
    total_squares: 12,
    dominant_pitch_rise_per_12: 6,
    edge_lengths_lf: { ridge: 10, hip: 0, valley: 0, eave: 40, rake: 20, pitch_change: 0 },
    facets: [
      {
        id: "facet-1",
        point_count: 200,
        pitch_degrees: 26.57,
        pitch_rise_per_12: 6,
        azimuth_degrees: 180,
        area_sqft: 1200,
        squares: 12,
        boundary_latlon: [
          [25.4699, -80.4801, 10],
          [25.4699, -80.4799, 11],
          [25.4701, -80.4799, 12],
          [25.4701, -80.4801, 11],
          [25.4699, -80.4801, 10],
        ],
      },
    ],
  },
  fallback: { available: false, mode: null, footprint_area_sqft: 1200, message: null },
  disclaimer: "Preliminary public-data result.",
};

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function mockDetectionService(behavior: { loseFirstJob?: boolean; alwaysLose?: boolean } = {}) {
  const calls = { submits: 0 };
  vi.mocked(fetch).mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.endsWith("/v1/roof/analyze/jobs") && init?.method === "POST") {
      calls.submits += 1;
      return jsonResponse(202, { job_id: `job-${calls.submits}`, status: "queued" });
    }
    const match = url.match(/\/v1\/roof\/analyze\/jobs\/(job-\d+)$/);
    if (match) {
      const jobId = match[1]!;
      if (behavior.alwaysLose || (behavior.loseFirstJob && jobId === "job-1")) {
        return jsonResponse(404, { detail: { code: "job_not_found", message: "resubmit" } });
      }
      return jsonResponse(200, { job_id: jobId, status: "complete", result: LIDAR_RESULT });
    }
    throw new Error(`unexpected fetch ${url}`);
  });
  return calls;
}

function makeDeps(): AutoFinishDeps & {
  saveDrawing: ReturnType<typeof vi.fn>;
  attachPdf: ReturnType<typeof vi.fn>;
  loadAerial: ReturnType<typeof vi.fn>;
} {
  return {
    saveDrawing: vi.fn(async () => ({ id: "drawing-new" })),
    attachPdf: vi.fn(async () => ({ id: ORDER_ID })),
    loadAerial: vi.fn(async () => ({})),
  };
}

beforeEach(() => {
  vi.stubEnv("VITE_ROOF_DETECTION_API_URL", "https://roof-detection.example.com");
  vi.stubGlobal("fetch", vi.fn());
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("reportNeedsAutoFinish", () => {
  it("selects only our own still-awaiting reports", () => {
    expect(reportNeedsAutoFinish(makeOrder())).toBe(true);
    expect(reportNeedsAutoFinish(makeOrder({ file_path: "roof-report/x/y.pdf" }))).toBe(false);
    expect(reportNeedsAutoFinish(makeOrder({ provider: "eagleview" }))).toBe(false);
    expect(reportNeedsAutoFinish(makeOrder({ status: "received" }))).toBe(false);
    expect(reportNeedsAutoFinish(makeOrder({ status: "reviewed" }))).toBe(false);
    expect(reportNeedsAutoFinish(makeOrder({ status: "cancelled" }))).toBe(false);
  });
});

describe("finishRoofReport", () => {
  it("measures an awaiting report with exactly one job submission and runs the whole chain", async () => {
    const calls = mockDetectionService();
    const deps = makeDeps();
    const phases: AutoFinishProgress["phase"][] = [];
    deps.onProgress = (update) => phases.push(update.phase);

    const outcome = await finishRoofReport(
      deps,
      { order: makeOrder(), drawingRow: null, customerName: "West Park Owner" },
      new AbortController().signal,
    );

    expect(outcome.kind).toBe("done");
    expect(calls.submits).toBe(1);
    // Drawing saved against the report, with geometry that parses and
    // measures like a workspace-produced drawing.
    expect(deps.saveDrawing).toHaveBeenCalledTimes(1);
    const saved = deps.saveDrawing.mock.calls[0]![0] as {
      data: { report_order_id: string; property_id: string; geometry: unknown };
    };
    expect(saved.data.report_order_id).toBe(ORDER_ID);
    expect(saved.data.property_id).toBe("33333333-3333-4333-8333-333333333333");
    const geometry = drawingSchema.parse(saved.data.geometry);
    expect(measureDrawing(geometry).area).toBeGreaterThan(0);
    // PDF uploaded under the report's folder and attached against the
    // order's fresh updated_at.
    expect(storageUpload).toHaveBeenCalledTimes(1);
    const uploadedPath = (storageUpload.mock.calls[0] as unknown as [string])[0];
    expect(uploadedPath).toMatch(new RegExp(`^roof-report/${ORDER_ID}/[a-f0-9-]+\\.pdf$`));
    expect(deps.attachPdf).toHaveBeenCalledTimes(1);
    expect(deps.attachPdf.mock.calls[0]![0]).toEqual({
      data: { id: ORDER_ID, path: uploadedPath, updated_at: "2026-11-27T12:00:00.000Z" },
    });
    expect(phases).toContain("measuring");
    expect(phases).toContain("saving");
    expect(phases).toContain("building-pdf");
  });

  it("resubmits automatically when the service loses the job", async () => {
    const calls = mockDetectionService({ loseFirstJob: true });
    const deps = makeDeps();

    const outcome = await finishRoofReport(
      deps,
      { order: makeOrder(), drawingRow: null, customerName: "" },
      new AbortController().signal,
    );

    expect(outcome.kind).toBe("done");
    expect(calls.submits).toBe(2);
    expect(deps.saveDrawing).toHaveBeenCalledTimes(1);
    expect(deps.attachPdf).toHaveBeenCalledTimes(1);
  });

  it("stops at the resubmit cap when the service keeps losing jobs", async () => {
    const calls = mockDetectionService({ alwaysLose: true });
    const deps = makeDeps();

    const outcome = await finishRoofReport(
      deps,
      { order: makeOrder(), drawingRow: null, customerName: "" },
      new AbortController().signal,
    );

    expect(outcome.kind).toBe("error");
    // Initial submission plus the existing budget of 3 resubmits.
    expect(calls.submits).toBe(4);
    expect(deps.saveDrawing).not.toHaveBeenCalled();
    expect(deps.attachPdf).not.toHaveBeenCalled();
  });

  it("skips measurement entirely when a drawing is already saved and only builds the PDF", async () => {
    const deps = makeDeps();
    const drawingRow = {
      id: "drawing-1",
      geometry: roofPreset("gable"),
      media: [],
    } as unknown as RoofDrawingRow;

    const outcome = await finishRoofReport(
      deps,
      {
        order: makeOrder({ drawing_id: "drawing-1" }),
        drawingRow,
        customerName: "Ricardo Rodriguez",
      },
      new AbortController().signal,
    );

    expect(outcome.kind).toBe("done");
    expect(fetch).not.toHaveBeenCalled();
    expect(deps.saveDrawing).not.toHaveBeenCalled();
    expect(storageUpload).toHaveBeenCalledTimes(1);
    expect(deps.attachPdf).toHaveBeenCalledTimes(1);
  });
});

describe("useAutoFinishReports on the reports list", () => {
  function Harness({ orders }: { orders: RoofReportOrderRow[] }) {
    useAutoFinishReports(orders, [], []);
    return null;
  }

  it("submits an awaiting report exactly once on list load, even across refetches", async () => {
    const calls = mockDetectionService();
    const order = makeOrder();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const tree = (rows: RoofReportOrderRow[]) => (
      <QueryClientProvider client={client}>
        <Harness orders={rows} />
      </QueryClientProvider>
    );
    const view = render(tree([order]));

    await waitFor(() => expect(vi.mocked(attachRoofOrderPdf)).toHaveBeenCalledTimes(1));
    expect(calls.submits).toBe(1);
    expect(vi.mocked(saveRoofDrawing)).toHaveBeenCalledTimes(1);

    // A refetch hands the hook a fresh array with the same report:
    // the attempt guard must keep it from submitting a second job.
    view.rerender(tree([makeOrder()]));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(calls.submits).toBe(1);
    expect(vi.mocked(saveRoofDrawing)).toHaveBeenCalledTimes(1);
  });
});
