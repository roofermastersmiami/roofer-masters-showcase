import { useEffect, useRef, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  finishRoofReport,
  reportNeedsAutoFinish,
  type AutoFinishProgress,
} from "@/lib/auto-finish";
import {
  forgetMeasurementActivity,
  recordMeasurementProgress,
  recordMeasurementReady,
  recordMeasurementTerminal,
} from "@/lib/measurement-activity";
import { saveRoofDrawing } from "@/lib/roof-drawing.functions";
import { attachRoofOrderPdf } from "@/lib/roof-orders.functions";
import { loadReportAerial } from "@/lib/report-aerial.functions";
import type { RoofOrder } from "./roof-orders-data";
import type { Database } from "@/integrations/supabase/types";

type DrawingRow = Database["public"]["Tables"]["roof_drawings"]["Row"];
type CustomerRow = Database["public"]["Tables"]["crm_customers"]["Row"];

export type AutoFinishUiState =
  | { phase: "measuring"; percent: number; detail: string | null; elapsedSeconds: number }
  | { phase: "saving" }
  | { phase: "building-pdf" }
  | { phase: "candidates"; message: string }
  | { phase: "unmeasurable"; message: string }
  | { phase: "error"; message: string };

// ---------------------------------------------------------------------------
// One shared background engine for the whole CRM session.
//
// The engine is module-level on purpose: the Roof reports list, the
// Roof measurements tab and the CRM shell all mount
// useAutoFinishReports, and they must never run two finishes for the
// same report. Attempts are remembered per report version
// (id + updated_at) for the whole page session — a report whose
// automatic finish reached a terminal state (done, needs a building
// pick, unmeasurable, error) is never silently re-submitted on every
// refresh. The concurrency cap is shared too, so all surfaces
// together never run more than MAX_CONCURRENT_FINISHES finishes.
//
// Because the shell mount lives for the whole signed-in session, a
// finish keeps running while the user moves around the CRM (calendar,
// customers, …) and completes in the background; every transition is
// mirrored into the measurement activity store, which raises the
// "report ready" notification. A surface that hands its reports to an
// open workspace (the measurements tab passes enabled=false while a
// workspace is open) suppresses the engine: in-flight chains abort —
// the service jobs keep running server-side — their attempts are
// forgotten, and everything resumes when the surface re-enables or
// unmounts. When the last surface unmounts (leaving the CRM), the
// browser-side chains stop the same way.
// ---------------------------------------------------------------------------

const startedAttempts = new Set<string>();
const MAX_CONCURRENT_FINISHES = 3;
let activeFinishCount = 0;
const controllers = new Map<string, AbortController>();
let queuedIds: string[] = [];

type EngineInputs = {
  orders: RoofOrder[] | undefined;
  drawings: DrawingRow[] | undefined;
  customers: CustomerRow[] | undefined;
};
let latestInputs: EngineInputs = { orders: undefined, drawings: undefined, customers: undefined };

type EngineRuntime = {
  saveDrawing: Parameters<typeof finishRoofReport>[0]["saveDrawing"];
  attachPdf: Parameters<typeof finishRoofReport>[0]["attachPdf"];
  loadAerial: Parameters<typeof finishRoofReport>[0]["loadAerial"];
  invalidate: () => Promise<void>;
};
let engineRuntime: EngineRuntime | null = null;

type EngineMount = { enabled: boolean };
const mounts = new Set<EngineMount>();
let engineSuppressed = false;

const uiStates = new Map<string, AutoFinishUiState>();
const uiListeners = new Set<() => void>();
let uiSnapshot: ReadonlyMap<string, AutoFinishUiState> = new Map();

function attemptKey(order: RoofOrder): string {
  return `${order.id}:${order.updated_at}`;
}

function progressToUiState(update: AutoFinishProgress): AutoFinishUiState {
  if (update.phase === "measuring") {
    return {
      phase: "measuring",
      percent: update.percent,
      detail: update.detail,
      elapsedSeconds: update.elapsedSeconds,
    };
  }
  return { phase: update.phase };
}

function emitUiStates() {
  uiSnapshot = new Map(uiStates);
  for (const listener of uiListeners) listener();
}

function setUiState(id: string, next: AutoFinishUiState | null) {
  if (next === null) {
    if (!uiStates.delete(id)) return;
  } else {
    uiStates.set(id, next);
  }
  emitUiStates();
}

function subscribeUiStates(listener: () => void): () => void {
  uiListeners.add(listener);
  return () => {
    uiListeners.delete(listener);
  };
}

function getUiSnapshot(): ReadonlyMap<string, AutoFinishUiState> {
  return uiSnapshot;
}

/** Mirror a live progress state into the activity store so the
 * shell's activity list shows the same measurement ticking over,
 * whichever page is open. */
function mirrorProgress(order: RoofOrder, state: AutoFinishUiState) {
  if (state.phase === "measuring") {
    recordMeasurementProgress(order.id, order.address, {
      percent: state.percent,
      detail: state.detail,
    });
  } else if (state.phase === "saving") {
    recordMeasurementProgress(order.id, order.address, {
      percent: null,
      detail: "Saving the measurement…",
    });
  } else if (state.phase === "building-pdf") {
    recordMeasurementProgress(order.id, order.address, {
      percent: null,
      detail: "Generating the report PDF…",
    });
  }
}

function applyState(order: RoofOrder, next: AutoFinishUiState | null) {
  setUiState(order.id, next);
  if (next === null) return;
  if (next.phase === "candidates") {
    recordMeasurementTerminal(
      order.id,
      order.address,
      attemptKey(order),
      "attention",
      "The measurement found more than one building at this address — open the report to pick the right one.",
    );
  } else if (next.phase === "unmeasurable") {
    recordMeasurementTerminal(
      order.id,
      order.address,
      attemptKey(order),
      "attention",
      next.message,
    );
  } else if (next.phase === "error") {
    recordMeasurementTerminal(order.id, order.address, attemptKey(order), "failed", next.message);
  } else {
    mirrorProgress(order, next);
  }
}

function stopAllRuns() {
  for (const controller of controllers.values()) controller.abort();
  controllers.clear();
  queuedIds = [];
}

function refreshSuppression() {
  const next = [...mounts].some((mount) => !mount.enabled);
  if (next === engineSuppressed) return;
  engineSuppressed = next;
  if (engineSuppressed) stopAllRuns();
  else syncQueue();
}

// ---------------------------------------------------------------------------
// Per-report workspace exclusions (the shell-level hand-off).
//
// The measurements tab hands a report to its open workspace by
// disabling its own mount, which suppresses the whole engine. The
// CRM shell has no mount it can disable — it is the always-on
// runner — but it knows which report's workspace is open (the
// measurements section's selected report in CrmContext) and
// registers that report here. An excluded report is never STARTED by
// the engine: the workspace's own chain owns it, mirroring the tab's
// hand-off one report at a time instead of stopping everything.
// Registering an exclusion also hands off a finish already in
// flight for that report: the run aborts (its attempt is forgotten,
// never recorded as an error — the same interruption semantics as
// the tab's suppression), the service job keeps running server-side,
// and if the aborted chain was already attaching its PDF, that
// attach reconciles through the finish chain's stale-attach
// recovery instead of failing the report. Lifting the exclusion
// re-queues the report, so the engine picks it up if the workspace
// did not finish it.
// ---------------------------------------------------------------------------

const exclusionSources = new Set<ReadonlySet<string>>();

function isAutoFinishExcluded(id: string): boolean {
  for (const source of exclusionSources) if (source.has(id)) return true;
  return false;
}

/**
 * Register report ids the background engine must not start (their
 * workspace is open in the shell). Returns an unregister function;
 * unregistering re-queues the reports.
 */
export function setAutoFinishExclusions(reportIds: readonly string[]): () => void {
  const source: ReadonlySet<string> = new Set(reportIds);
  exclusionSources.add(source);
  if (source.size > 0) {
    queuedIds = queuedIds.filter((id) => !source.has(id));
    for (const id of source) controllers.get(id)?.abort();
  }
  return () => {
    exclusionSources.delete(source);
    syncQueue();
  };
}

/** Hook form of setAutoFinishExclusions for the CRM shell. The
 * effect re-registers only when the id set actually changes. */
export function useAutoFinishExclusions(reportIds: readonly string[]) {
  const joined = reportIds.join("\n");
  useEffect(() => {
    if (!joined) return;
    return setAutoFinishExclusions(joined.split("\n"));
  }, [joined]);
}

function pump() {
  if (engineSuppressed || !engineRuntime) return;
  const runtime = engineRuntime;
  while (activeFinishCount < MAX_CONCURRENT_FINISHES && queuedIds.length > 0) {
    const id = queuedIds.shift()!;
    const order = latestInputs.orders?.find((item) => item.id === id);
    if (!order || !reportNeedsAutoFinish(order)) continue;
    // A report whose workspace is open belongs to the workspace's
    // own chain — the engine never starts it (shell hand-off).
    if (isAutoFinishExcluded(order.id)) continue;
    // Another surface may have started this report version while it
    // waited in the queue — never submit it twice.
    if (startedAttempts.has(attemptKey(order))) continue;
    startedAttempts.add(attemptKey(order));
    const drawingRow =
      latestInputs.drawings?.find((drawing) => drawing.id === order.drawing_id) ?? null;
    const customerName =
      latestInputs.customers?.find((customer) => customer.id === order.customer_id)?.name ?? "";
    const controller = new AbortController();
    controllers.set(id, controller);
    activeFinishCount += 1;
    applyState(order, { phase: "measuring", percent: 0, detail: null, elapsedSeconds: 0 });
    void (async () => {
      try {
        const outcome = await finishRoofReport(
          {
            saveDrawing: runtime.saveDrawing,
            attachPdf: runtime.attachPdf,
            loadAerial: runtime.loadAerial,
            onProgress: (update) => {
              if (!controller.signal.aborted) applyState(order, progressToUiState(update));
            },
          },
          { order, drawingRow, customerName },
          controller.signal,
        );
        if (controller.signal.aborted) {
          startedAttempts.delete(attemptKey(order));
          setUiState(id, null);
          forgetMeasurementActivity(id);
        } else if (outcome.kind === "done") {
          setUiState(id, null);
          recordMeasurementReady(order.id, order.address, attemptKey(order));
          await runtime.invalidate();
        } else if (outcome.kind === "candidates") {
          applyState(order, { phase: "candidates", message: outcome.message });
        } else if (outcome.kind === "unmeasurable") {
          applyState(order, { phase: "unmeasurable", message: outcome.message });
        } else {
          applyState(order, { phase: "error", message: outcome.message });
        }
      } catch (cause) {
        if (controller.signal.aborted) {
          startedAttempts.delete(attemptKey(order));
          setUiState(id, null);
          forgetMeasurementActivity(id);
        } else {
          applyState(order, {
            phase: "error",
            message:
              cause instanceof Error
                ? cause.message
                : "Automatic measurement could not be completed.",
          });
        }
      } finally {
        controllers.delete(id);
        activeFinishCount -= 1;
        pump();
      }
    })();
  }
}

/** Enqueue every eligible report the mounted surfaces currently
 * show; the guards make this idempotent across surfaces, re-renders
 * and query refetches, so each report version is submitted once. */
function syncQueue() {
  if (!latestInputs.orders) return;
  for (const order of latestInputs.orders) {
    if (!reportNeedsAutoFinish(order)) continue;
    if (isAutoFinishExcluded(order.id)) continue;
    if (startedAttempts.has(attemptKey(order))) continue;
    if (controllers.has(order.id) || queuedIds.includes(order.id)) continue;
    queuedIds.push(order.id);
  }
  pump();
}

/**
 * Watch the roof reports and finish every still-awaiting one in the
 * background: each eligible report starts or resumes its measurement
 * through the detection jobs API and runs the full automatic chain —
 * drawing saved, report PDF generated and attached — with shared
 * per-report live state for whichever surface is showing it. No
 * "Continue measurements" click is involved.
 *
 * The same hook backs the Roof reports list, the Roof measurements
 * tab grid and the CRM shell's background runner. `enabled` lets a
 * surface hand over to an open report workspace: the tab passes false
 * while a workspace is open, which suppresses the shared engine
 * exactly like every surface unmounting, so the workspace owns the
 * report until Fredy returns to the grid. The shell cannot disable
 * its always-on mount, so it hands over one report at a time through
 * useAutoFinishExclusions instead (see the exclusions block above).
 */
export function useAutoFinishReports(
  orders: RoofOrder[] | undefined,
  drawings: DrawingRow[] | undefined,
  customers: CustomerRow[] | undefined,
  enabled = true,
): ReadonlyMap<string, AutoFinishUiState> {
  const qc = useQueryClient();
  const saveFn = useServerFn(saveRoofDrawing);
  const attachPdfFn = useServerFn(attachRoofOrderPdf);
  const aerialFn = useServerFn(loadReportAerial);
  const mountRef = useRef<EngineMount | null>(null);
  if (mountRef.current === null) mountRef.current = { enabled };

  // Join the shared engine for as long as this surface is mounted.
  // Leaving one surface never stops a finish — the shell's mount
  // keeps the engine alive across in-app navigation — but when the
  // last surface goes (leaving the CRM) the chains stop, and their
  // attempts are forgotten on abort so a later visit resumes them.
  useEffect(() => {
    const mount = mountRef.current!;
    mounts.add(mount);
    refreshSuppression();
    syncQueue();
    return () => {
      mounts.delete(mount);
      if (mounts.size === 0) {
        stopAllRuns();
        engineSuppressed = false;
      } else {
        refreshSuppression();
      }
    };
  }, []);

  useEffect(() => {
    mountRef.current!.enabled = enabled;
    refreshSuppression();
    if (!engineSuppressed) syncQueue();
  }, [enabled]);

  // The bound server functions are interchangeable across surfaces
  // (same QueryClient, same session); the latest registration wins.
  useEffect(() => {
    engineRuntime = {
      saveDrawing: (args) => saveFn(args),
      attachPdf: (args) => attachPdfFn(args),
      loadAerial: (args) => aerialFn(args),
      invalidate: async () => {
        await Promise.all([
          qc.invalidateQueries({ queryKey: ["roof-report-orders"] }),
          qc.invalidateQueries({ queryKey: ["roof-drawings"] }),
        ]);
      },
    };
    syncQueue();
  }, [saveFn, attachPdfFn, aerialFn, qc]);

  // Feed this surface's view of the reports into the shared engine.
  useEffect(() => {
    latestInputs = { orders, drawings, customers };
    syncQueue();
  }, [orders, drawings, customers]);

  return useSyncExternalStore(subscribeUiStates, getUiSnapshot, getUiSnapshot);
}
