import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getMeasurementActivitySnapshot,
  markAllMeasurementsSeen,
  recordMeasurementProgress,
  recordMeasurementReady,
  recordMeasurementTerminal,
  resetMeasurementActivityForTests,
  seedFinishedMeasurements,
  setMeasurementNotifier,
  type MeasurementNotice,
} from "@/lib/measurement-activity";
import { useAutoFinishReports } from "@/components/dashboard/use-auto-finish";
import { MeasurementActivityButton } from "@/components/dashboard/MeasurementActivity";
import { CrmContext, type CrmState } from "@/components/dashboard/CrmContext";
import type { RoofReportOrderRow } from "@/lib/auto-finish";
import { attachRoofOrderPdf } from "@/lib/roof-orders.functions";
import { saveRoofDrawing } from "@/lib/roof-drawing.functions";

// Same seams the auto-finish tests use: storage + the server
// functions bound through useServerFn.
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

const notices: MeasurementNotice[] = [];

function makeOrder(overrides: Record<string, unknown> = {}): RoofReportOrderRow {
  return {
    id: "55555555-5555-4555-8555-555555555551",
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
    created_at: "2026-11-27T17:00:00.000Z",
    updated_at: "2026-11-27T17:00:00.000Z",
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

/** Detection service mock: jobs for addresses on "Fail" streets lose
 * every job (the resubmit budget burns out); all others complete. */
function mockDetectionService() {
  const calls = { submits: 0 };
  const jobAddress = new Map<string, string>();
  vi.mocked(fetch).mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.endsWith("/v1/roof/analyze/jobs") && init?.method === "POST") {
      calls.submits += 1;
      const jobId = `job-${calls.submits}`;
      const body = JSON.parse(String(init.body ?? "{}")) as { street_address?: string };
      jobAddress.set(jobId, body.street_address ?? "");
      return jsonResponse(202, { job_id: jobId, status: "queued" });
    }
    const match = url.match(/\/v1\/roof\/analyze\/jobs\/(job-\d+)$/);
    if (match) {
      const jobId = match[1]!;
      if ((jobAddress.get(jobId) ?? "").includes("Fail")) {
        return jsonResponse(404, { detail: { code: "job_not_found", message: "resubmit" } });
      }
      return jsonResponse(200, { job_id: jobId, status: "complete", result: LIDAR_RESULT });
    }
    throw new Error(`unexpected fetch ${url}`);
  });
  return calls;
}

beforeEach(() => {
  vi.stubEnv("VITE_ROOF_DETECTION_API_URL", "https://roof-detection.example.com");
  vi.stubGlobal("fetch", vi.fn());
  vi.clearAllMocks();
  localStorage.clear();
  resetMeasurementActivityForTests();
  notices.length = 0;
  setMeasurementNotifier((notice) => notices.push(notice));
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("measurement activity store", () => {
  it("tracks two reports independently: one finishing and one failing leave each other untouched", () => {
    recordMeasurementProgress("a", "1 A Street", { percent: 40, detail: "Downloading tiles" });
    recordMeasurementProgress("b", "2 B Street", { percent: 10, detail: null });

    recordMeasurementReady("a", "1 A Street", "a:v1");
    let entries = getMeasurementActivitySnapshot();
    expect(entries.find((e) => e.id === "a")?.status).toBe("ready");
    expect(entries.find((e) => e.id === "b")?.status).toBe("running");
    expect(entries.find((e) => e.id === "b")?.percent).toBe(10);

    recordMeasurementTerminal("b", "2 B Street", "b:v1", "failed", "Service unavailable");
    entries = getMeasurementActivitySnapshot();
    expect(entries.find((e) => e.id === "b")?.status).toBe("failed");
    expect(entries.find((e) => e.id === "b")?.message).toBe("Service unavailable");
    expect(entries.find((e) => e.id === "a")?.status).toBe("ready");
    expect(notices).toEqual([
      { kind: "ready", id: "a", address: "1 A Street" },
      { kind: "failed", id: "b", address: "2 B Street", message: "Service unavailable" },
    ]);
  });

  it("emits exactly one notification per completion, even when the outcome is recorded again", () => {
    recordMeasurementReady("a", "1 A Street", "a:v1");
    recordMeasurementReady("a", "1 A Street", "a:v1");
    recordMeasurementTerminal("b", "2 B Street", "b:v1", "failed", "Boom");
    recordMeasurementTerminal("b", "2 B Street", "b:v1", "failed", "Boom");
    expect(notices.filter((n) => n.kind === "ready")).toHaveLength(1);
    expect(notices.filter((n) => n.kind === "failed")).toHaveLength(1);
    // A genuinely new version of the same report notifies again.
    recordMeasurementReady("a", "1 A Street", "a:v2");
    expect(notices.filter((n) => n.kind === "ready")).toHaveLength(2);
  });

  it("seeds reports that finished while the user was away — and only those", () => {
    localStorage.setItem("crm-measurements-last-seen", "2026-11-27T15:00:00.000Z");
    seedFinishedMeasurements([
      {
        id: "away",
        address: "9 Away Road",
        file_path: "roof-report/away/x.pdf",
        updated_at: "2026-11-27T16:00:00.000Z",
      },
      {
        id: "old",
        address: "8 Old Road",
        file_path: "roof-report/old/x.pdf",
        updated_at: "2026-11-27T14:00:00.000Z",
      },
      {
        id: "pending",
        address: "7 Pending Road",
        file_path: null,
        updated_at: "2026-11-27T16:30:00.000Z",
      },
    ]);
    const entries = getMeasurementActivitySnapshot();
    expect(entries.map((e) => e.id)).toEqual(["away"]);
    expect(entries[0]).toMatchObject({ status: "ready", seen: false });
    expect(notices).toHaveLength(0);

    markAllMeasurementsSeen();
    expect(getMeasurementActivitySnapshot()[0]?.seen).toBe(true);
  });
});

describe("background measurements through the shared engine", () => {
  function ShellHarness({ orders }: { orders: RoofReportOrderRow[] }) {
    // The shell runner mount: stays mounted while pages come and go.
    useAutoFinishReports(orders, [], []);
    return null;
  }
  function ListHarness({ orders }: { orders: RoofReportOrderRow[] }) {
    useAutoFinishReports(orders, [], []);
    return null;
  }
  function tree(client: QueryClient, children: React.ReactNode) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  const newClient = () =>
    new QueryClient({ defaultOptions: { queries: { retry: false } } });

  it("keeps finishing after the reports page unmounts, and notifies exactly once", async () => {
    const calls = mockDetectionService();
    const order = makeOrder({
      id: "55555555-5555-4555-8555-5555555555a1",
      updated_at: "2026-11-27T17:05:00.000Z",
    });
    const client = newClient();
    const view = render(
      tree(
        client,
        <>
          <ShellHarness orders={[order]} />
          <ListHarness orders={[order]} />
        </>,
      ),
    );

    // The user navigates away (list unmounts) mid-flight; the shell
    // mount keeps the background finish alive to completion.
    view.rerender(tree(client, <ShellHarness orders={[order]} />));
    await waitFor(() => expect(vi.mocked(attachRoofOrderPdf)).toHaveBeenCalledTimes(1));
    expect(calls.submits).toBe(1);
    expect(vi.mocked(saveRoofDrawing)).toHaveBeenCalledTimes(1);

    const entry = getMeasurementActivitySnapshot().find((e) => e.id === order.id);
    expect(entry?.status).toBe("ready");
    expect(notices.filter((n) => n.kind === "ready" && n.id === order.id)).toHaveLength(1);

    // A later refetch / re-mount must not re-notify or re-submit.
    view.rerender(
      tree(
        client,
        <>
          <ShellHarness orders={[makeOrder({ ...order })]} />
          <ListHarness orders={[makeOrder({ ...order })]} />
        </>,
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(calls.submits).toBe(1);
    expect(notices.filter((n) => n.kind === "ready")).toHaveLength(1);
  });

  it("runs two reports concurrently and independently: one burns out, the other completes", async () => {
    const calls = mockDetectionService();
    const good = makeOrder({
      id: "55555555-5555-4555-8555-5555555555a2",
      updated_at: "2026-11-27T17:10:00.000Z",
      address: "100 Good Lane, Miami, FL 33101",
    });
    const bad = makeOrder({
      id: "55555555-5555-4555-8555-5555555555a3",
      updated_at: "2026-11-27T17:10:00.000Z",
      address: "200 Fail Court, Miami, FL 33101",
    });
    const client = newClient();
    render(tree(client, <ShellHarness orders={[good, bad]} />));

    await waitFor(() =>
      expect(
        getMeasurementActivitySnapshot().find((e) => e.id === good.id)?.status,
      ).toBe("ready"),
    );
    await waitFor(() =>
      expect(
        getMeasurementActivitySnapshot().find((e) => e.id === bad.id)?.status,
      ).toBe("failed"),
    );
    // Good: 1 submission. Bad: initial + 3 resubmits, then it stops —
    // without touching the good report's single clean run.
    expect(calls.submits).toBe(5);
    expect(vi.mocked(attachRoofOrderPdf)).toHaveBeenCalledTimes(1);
    expect(notices.filter((n) => n.kind === "ready" && n.id === good.id)).toHaveLength(1);
    expect(notices.filter((n) => n.kind === "failed" && n.id === bad.id)).toHaveLength(1);
  });
});

describe("measurement activity popover", () => {
  function crmValue(openRoofMeasurements: (id: string | null) => void): CrmState {
    return {
      leads: [],
      onOpen: () => undefined,
      openProposals: () => undefined,
      proposalLeadId: null,
      clearProposalLead: () => undefined,
      go: () => undefined,
      roofReportRequest: null,
      clearRoofReportRequest: () => undefined,
      selectedRoofReportId: null,
      openRoofMeasurements,
      pdfStudioRequest: null,
      openPdfStudio: () => undefined,
      clearPdfStudioRequest: () => undefined,
    };
  }

  it("lists in-progress and ready entries, and a ready click opens the report", async () => {
    recordMeasurementProgress("run-1", "10 Running Road", {
      percent: 55,
      detail: "Fitting roof planes",
    });
    recordMeasurementReady("done-1", "11 Done Drive", "done-1:v1");
    const openSpy = vi.fn();
    render(
      <CrmContext.Provider value={crmValue(openSpy)}>
        <MeasurementActivityButton />
      </CrmContext.Provider>,
    );

    fireEvent.click(screen.getByRole("button", { name: /Roof measurements/ }));
    expect(await screen.findByText("10 Running Road")).toBeTruthy();
    expect(screen.getByText(/Measuring automatically · 55%/)).toBeTruthy();
    expect(screen.getByText("11 Done Drive")).toBeTruthy();
    expect(screen.getByText(/Roof report ready/)).toBeTruthy();
    expect(screen.getByText("Notify me when a measurement is ready")).toBeTruthy();

    fireEvent.click(screen.getByText("11 Done Drive"));
    expect(openSpy).toHaveBeenCalledWith("done-1");
  });
});

describe("shell wiring", () => {
  it("mounts the background runner and the activity button in the CRM shell", () => {
    const shell = readFileSync(
      resolve(process.cwd(), "src/components/dashboard/CrmShell.tsx"),
      "utf8",
    );
    expect(shell).toContain("useMeasurementRunner()");
    expect(shell).toContain("<MeasurementActivityButton />");
  });
});
