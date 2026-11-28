import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  finishRoofReport,
  type AutoFinishDeps,
  type RoofDrawingRow,
  type RoofReportOrderRow,
} from "@/lib/auto-finish";
import { roofPreset } from "@/lib/roof-geometry";
import { attachRoofOrderPdfGuarded, type RoofOrderAttachDeps } from "@/lib/roof-order-write.server";

/**
 * REPRODUCTION (2026-11-27, Fredy's 7:20 PM screenshot): with PR
 * #249's one-finisher build live, every drawing-saved / PDF-less
 * report on the Roof measurements grid records "Automatic
 * measurement stopped: The report changed while it was finishing —
 * reload the report request before attaching this PDF" on page
 * load, with nobody else touching the reports.
 *
 * PR #249's tests missed it because their attach fake succeeds
 * whenever it is called with a matching version and their stubbed
 * order reads are disconnected from the attach's writes. This file
 * models the REAL data layer instead:
 *
 *  - Reads of roof_report_orders run under the authenticated
 *    client; the live database's policy set for the table is the
 *    two legacy SELECT policies (migrations 0019 + 0024), so reads
 *    work.
 *  - The UPDATE policy ("Company staff update report requests")
 *    exists only in migration 0054, which the live database has
 *    NOT applied (proven 2026-11-27 during the PR #231 delete fix:
 *    no company_id column, only the legacy SELECT policies). Under
 *    PostgREST + RLS, an UPDATE with no UPDATE policy matches ZERO
 *    rows and returns NO error — so the authenticated attach update
 *    in attachRoofOrderPdf can never land, whatever version it is
 *    offered, and the handler reports that as the stale-version
 *    error. The engine's reconcile loop then re-reads the unchanged
 *    row four times and records the terminal "changed while it was
 *    finishing" outcome — deterministically, with ONE client.
 *  - A service-role update bypasses RLS (the PR #231 delete
 *    pattern); the updated_at version guard then decides honestly.
 *  - Every successful write bumps updated_at (the row's
 *    set_updated_at trigger, migration 0019).
 */

const ORDER_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "99999999-9999-4999-8999-999999999999";
const BASE_MS = Date.parse("2026-11-27T18:00:00.000Z");
const STALE_MESSAGE = "Reload the report request before attaching this PDF";

class FakeRoofReportStore {
  row = {
    id: ORDER_ID,
    updated_at: new Date(BASE_MS).toISOString(),
    file_path: null as string | null,
    status: "requested",
    drawing_id: "drawing-1" as string | null,
  };
  private tick = 0;
  /** Successful attach writes (the row updates that set file_path). */
  attachWrites = 0;

  private stamp(): string {
    this.tick += 1;
    return new Date(BASE_MS + this.tick * 1000).toISOString();
  }

  /** RLS-scoped read — the live SELECT policies allow it. */
  selectState() {
    return {
      updated_at: this.row.updated_at,
      file_path: this.row.file_path,
      status: this.row.status,
      drawing_id: this.row.drawing_id,
    };
  }

  /**
   * Authenticated UPDATE under the LIVE policy set: there is no
   * UPDATE policy, so PostgREST matches zero rows and reports no
   * error — the write never lands, whatever version is offered.
   */
  authUpdate(_expectedUpdatedAt: string, _path: string): boolean {
    return false;
  }

  /** Service-role UPDATE: bypasses RLS; the version guard decides. */
  adminUpdate(expectedUpdatedAt: string, path: string): boolean {
    if (this.row.updated_at !== expectedUpdatedAt || this.row.status === "cancelled") return false;
    this.row.file_path = path;
    this.row.status = "received";
    this.row.updated_at = this.stamp();
    this.attachWrites += 1;
    return true;
  }

  /** A drawing save landing on the order row (save_report_drawing
   * is SECURITY DEFINER, so this write works live and bumps the
   * version via the trigger). */
  applyDrawingSave(drawingId: string) {
    this.row.drawing_id = drawingId;
    this.row.updated_at = this.stamp();
  }
}

/**
 * The CURRENT production attach (src/lib/roof-orders.functions.ts),
 * modeled operation-for-operation: membership/role pass, the PDF
 * exists in storage, then the authenticated UPDATE guarded by
 * id + updated_at + status <> cancelled; zero matched rows (or an
 * error) becomes the stale-version error. In production the zero
 * rows come from the missing UPDATE policy, modeled here by the
 * store's authUpdate.
 */
async function attachViaCurrentWiring(
  store: FakeRoofReportStore,
  args: { data: { id: string; path: string; updated_at: string } },
): Promise<{ id: string }> {
  const landed = store.authUpdate(args.data.updated_at, args.data.path);
  if (!landed) throw new Error(STALE_MESSAGE);
  return { id: args.data.id };
}

// --- Engine harness (supabase seams backed by the fake store) ---

const storeHolder = vi.hoisted(() => ({ current: null as FakeRoofReportStore | null }));
const uploadedPaths = vi.hoisted(() => ({ list: [] as string[] }));
const removedPaths = vi.hoisted(() => ({ list: [] as string[] }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    storage: {
      from: () => ({
        upload: async (path: string) => {
          uploadedPaths.list.push(path);
          return { error: null };
        },
        remove: async (paths: string[]) => {
          removedPaths.list.push(...paths);
          return { data: [], error: null };
        },
        download: async () => ({ data: null, error: new Error("no photo in test") }),
      }),
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: storeHolder.current!.selectState(), error: null }),
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

function makeOrder(store: FakeRoofReportStore): RoofReportOrderRow {
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
    drawing_id: store.row.drawing_id,
    reviewed_at: null,
    created_at: "2026-11-27T15:00:00.000Z",
    updated_at: store.row.updated_at,
  } as RoofReportOrderRow;
}

const drawingRow = {
  id: "drawing-1",
  geometry: roofPreset("gable"),
  media: [],
} as unknown as RoofDrawingRow;

function engineDeps(
  store: FakeRoofReportStore,
  attachPdf: AutoFinishDeps["attachPdf"],
): AutoFinishDeps {
  return {
    saveDrawing: vi.fn(async () => ({ id: "drawing-1" })),
    attachPdf,
    loadAerial: vi.fn(async () => ({})),
  };
}

beforeEach(() => {
  storeHolder.current = new FakeRoofReportStore();
  uploadedPaths.list.length = 0;
  removedPaths.list.length = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the current production attach wiring against live data-layer semantics", () => {
  it("rejects with the stale-version error even with the exact current version and no rival writer", async () => {
    const store = storeHolder.current!;
    await expect(
      attachViaCurrentWiring(store, {
        data: {
          id: ORDER_ID,
          path: `roof-report/${ORDER_ID}/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.pdf`,
          updated_at: store.row.updated_at,
        },
      }),
    ).rejects.toThrow(STALE_MESSAGE);
    expect(store.attachWrites).toBe(0);
    expect(store.row.file_path).toBeNull();
  });

  it("makes the engine record Fredy's terminal error for a drawing-saved report, untouched by anyone", async () => {
    const store = storeHolder.current!;
    const outcome = await finishRoofReport(
      engineDeps(store, (args) => attachViaCurrentWiring(store, args)),
      { order: makeOrder(store), drawingRow, customerName: "" },
      new AbortController().signal,
    );
    // The exact failure on Fredy's 7:20 PM screenshot: the terminal
    // "changed while it was finishing" outcome, recorded on page
    // load by the background runner, with zero rival writers and
    // zero successful writes.
    expect(outcome.kind).toBe("error");
    if (outcome.kind === "error") {
      expect(outcome.message).toContain("The report changed while it was finishing");
    }
    expect(store.attachWrites).toBe(0);
    expect(store.row.file_path).toBeNull();
  });
});

/** The fixed wiring: the real guarded attach, with its write on the
 * service-role semantics (RLS bypassed, version guard decides). */
function guardedDeps(
  store: FakeRoofReportStore,
  overrides: Partial<RoofOrderAttachDeps> = {},
): RoofOrderAttachDeps {
  return {
    getMembership: async () => ({ company_id: "company-1", role: "owner" }),
    reportPdfExists: async () => true,
    getReport: async () => {
      const state = store.selectState();
      return { updated_at: state.updated_at, status: state.status, file_path: state.file_path };
    },
    writeAttachedPdf: async ({ path, expectedUpdatedAt }) =>
      store.adminUpdate(expectedUpdatedAt, path),
    ...overrides,
  };
}

function fixedAttach(store: FakeRoofReportStore): AutoFinishDeps["attachPdf"] {
  return (args) => attachRoofOrderPdfGuarded(guardedDeps(store), { userId: USER_ID, ...args.data });
}

const PDF_PATH = `roof-report/${ORDER_ID}/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.pdf`;

describe("attachRoofOrderPdfGuarded with the service-role write", () => {
  it("attaches with exactly one write when the version matches", async () => {
    const store = storeHolder.current!;
    const result = await attachRoofOrderPdfGuarded(guardedDeps(store), {
      userId: USER_ID,
      id: ORDER_ID,
      path: PDF_PATH,
      updated_at: store.row.updated_at,
    });
    expect(result).toEqual({ id: ORDER_ID });
    expect(store.attachWrites).toBe(1);
    expect(store.row.file_path).toBe(PDF_PATH);
    expect(store.row.status).toBe("received");
  });

  it("still rejects a genuinely stale version, writing nothing", async () => {
    const store = storeHolder.current!;
    await expect(
      attachRoofOrderPdfGuarded(guardedDeps(store), {
        userId: USER_ID,
        id: ORDER_ID,
        path: PDF_PATH,
        updated_at: "2026-11-27T17:59:00.000Z",
      }),
    ).rejects.toThrow(STALE_MESSAGE);
    expect(store.attachWrites).toBe(0);
  });

  it("rejects when a rival write lands between the proof read and the write, then converges on the fresh version", async () => {
    const store = storeHolder.current!;
    const racing = guardedDeps(store, {
      writeAttachedPdf: async ({ path, expectedUpdatedAt }) => {
        // A rival write (a drawing save) bumps the row's version in
        // the gap between this attach's proof read and its write.
        store.applyDrawingSave("drawing-1");
        return store.adminUpdate(expectedUpdatedAt, path);
      },
    });
    await expect(
      attachRoofOrderPdfGuarded(racing, {
        userId: USER_ID,
        id: ORDER_ID,
        path: PDF_PATH,
        updated_at: store.row.updated_at,
      }),
    ).rejects.toThrow(STALE_MESSAGE);
    expect(store.attachWrites).toBe(0);
    // The engine's reconcile loop retries against the fresh version
    // and the attach lands — exactly one write in total.
    const result = await attachRoofOrderPdfGuarded(guardedDeps(store), {
      userId: USER_ID,
      id: ORDER_ID,
      path: PDF_PATH,
      updated_at: store.row.updated_at,
    });
    expect(result).toEqual({ id: ORDER_ID });
    expect(store.attachWrites).toBe(1);
  });

  it("does not leak or touch a report the RLS proof read cannot see", async () => {
    const store = storeHolder.current!;
    await expect(
      attachRoofOrderPdfGuarded(guardedDeps(store, { getReport: async () => null }), {
        userId: USER_ID,
        id: ORDER_ID,
        path: PDF_PATH,
        updated_at: store.row.updated_at,
      }),
    ).rejects.toThrow(STALE_MESSAGE);
    expect(store.attachWrites).toBe(0);
  });

  it("refuses cancelled reports, non-staff roles, and unuploaded files", async () => {
    const store = storeHolder.current!;
    store.row.status = "cancelled";
    await expect(
      attachRoofOrderPdfGuarded(guardedDeps(store), {
        userId: USER_ID,
        id: ORDER_ID,
        path: PDF_PATH,
        updated_at: store.row.updated_at,
      }),
    ).rejects.toThrow(STALE_MESSAGE);
    store.row.status = "requested";
    await expect(
      attachRoofOrderPdfGuarded(
        guardedDeps(store, { getMembership: async () => ({ company_id: "c", role: "crew" }) }),
        { userId: USER_ID, id: ORDER_ID, path: PDF_PATH, updated_at: store.row.updated_at },
      ),
    ).rejects.toThrow("You do not have access to this action");
    await expect(
      attachRoofOrderPdfGuarded(guardedDeps(store, { reportPdfExists: async () => false }), {
        userId: USER_ID,
        id: ORDER_ID,
        path: PDF_PATH,
        updated_at: store.row.updated_at,
      }),
    ).rejects.toThrow("Upload the report PDF first");
    expect(store.attachWrites).toBe(0);
  });
});

describe("the engine with the guarded attach", () => {
  it("(a) finishes a drawing-saved report with exactly one attach — Fredy's screenshot scenario", async () => {
    const store = storeHolder.current!;
    const outcome = await finishRoofReport(
      engineDeps(store, fixedAttach(store)),
      { order: makeOrder(store), drawingRow, customerName: "" },
      new AbortController().signal,
    );
    expect(outcome.kind).toBe("done");
    expect(store.attachWrites).toBe(1);
    if (outcome.kind === "done") {
      expect(outcome.filePath).toBe(store.row.file_path);
    }
    expect(store.row.status).toBe("received");
  });

  it("(b) converges under two concurrent clients: both done, exactly one attach write, the loser's upload removed", async () => {
    const store = storeHolder.current!;
    const order = makeOrder(store);
    const [first, second] = await Promise.all([
      finishRoofReport(
        engineDeps(store, fixedAttach(store)),
        { order, drawingRow, customerName: "" },
        new AbortController().signal,
      ),
      finishRoofReport(
        engineDeps(store, fixedAttach(store)),
        { order, drawingRow, customerName: "" },
        new AbortController().signal,
      ),
    ]);
    expect(first.kind).toBe("done");
    expect(second.kind).toBe("done");
    expect(store.attachWrites).toBe(1);
    expect(uploadedPaths.list).toHaveLength(2);
    const winner = store.row.file_path!;
    expect(winner).toBeTruthy();
    if (first.kind === "done") expect(first.filePath).toBe(winner);
    if (second.kind === "done") expect(second.filePath).toBe(winner);
    const loserUpload = uploadedPaths.list.find((path) => path !== winner)!;
    expect(removedPaths.list).toContain(loserUpload);
  });

  it("(c) finishes when the chain's own drawing save bumped the version past its snapshot", async () => {
    const store = storeHolder.current!;
    store.row.drawing_id = null;
    vi.stubEnv("VITE_ROOF_DETECTION_API_URL", "https://roof-detection.example.com");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown, init?: { method?: string }) => {
        const url = String(input);
        if (url.endsWith("/v1/roof/analyze/jobs") && init?.method === "POST") {
          return {
            ok: true,
            status: 202,
            json: async () => ({ job_id: "job-1", status: "queued" }),
          } as Response;
        }
        if (url.endsWith("/v1/roof/analyze/jobs/job-1")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ job_id: "job-1", status: "complete", result: LIDAR_RESULT }),
          } as Response;
        }
        throw new Error(`unexpected fetch ${url}`);
      }),
    );
    try {
      const deps = engineDeps(store, fixedAttach(store));
      // The real save_report_drawing RPC also writes the order row
      // (drawing_id), bumping updated_at past the chain's snapshot.
      deps.saveDrawing = vi.fn(async () => {
        store.applyDrawingSave("drawing-new");
        return { id: "drawing-new" };
      });
      const outcome = await finishRoofReport(
        deps,
        { order: makeOrder(store), drawingRow: null, customerName: "" },
        new AbortController().signal,
      );
      expect(outcome.kind).toBe("done");
      expect(store.attachWrites).toBe(1);
      expect(store.row.drawing_id).toBe("drawing-new");
      expect(store.row.status).toBe("received");
    } finally {
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
    }
  });
});

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
