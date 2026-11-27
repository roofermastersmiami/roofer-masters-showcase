import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
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
// "report ready" notification. A surface can still pause the whole
// engine by mounting with enabled=false (its in-flight chains abort
// — the service jobs keep running server-side — their attempts are
// forgotten, and everything resumes when the surface re-enables or
// unmounts), but an open report workspace no longer does that: it
// claims only its own report (see the claims block below), so other
// reports keep finishing while Fredy works in a workspace. When the
// last surface unmounts (leaving the CRM), the browser-side chains
// stop the same way.
// ---------------------------------------------------------------------------

const startedAttempts = new Set<string>();
const MAX_CONCURRENT_FINISHES = 3;
let activeFinishCount = 0;
const controllers = new Map<string, AbortController>();
type QueueEntry = { id: string; refreshDrawingId?: string };
let queuedIds: QueueEntry[] = [];

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
// Per-report workspace claims (the one-finisher hand-off).
//
// The engine is the only component that generates and attaches
// report PDFs. A report's workspace owns the report while it is
// open — it runs the measurement Fredy watches and saves the
// drawing revision — so it CLAIMS the report here on mount: the
// engine never starts a claimed report, whatever surface mounted it
// and whatever any surface's enabled flag says. (This replaced
// #247's shell-level exclusion registry and the measurements tab's
// whole-engine suppression, which only prevented STARTING a chain:
// an engine chain already past its measuring phase kept writing
// after the workspace opened, and the two chains staled each
// other's attaches into a terminal error for a finished report.)
//
// Claiming hands off a finish already in flight for the report:
// the run aborts — and the finish chain now honors the abort
// between phases, so it stops writing promptly — its attempt is
// forgotten, never recorded as an error, and the service job keeps
// running server-side. The workspace releases its claim when its
// automatic save lands (the engine then takes the drawing-saved →
// PDF path while Fredy is still looking at the workspace) or on
// unmount; releasing re-queues the report, so if the workspace did
// not finish it, the engine picks it up.
// ---------------------------------------------------------------------------

const claimTokens = new Map<string, Set<object>>();

function isAutoFinishClaimed(id: string): boolean {
  return (claimTokens.get(id)?.size ?? 0) > 0;
}

/**
 * Claim a report for its open workspace: the background engine
 * leaves it entirely to the workspace until the returned release
 * runs. Releases are idempotent; the last release re-queues the
 * report with the engine.
 */
export function claimAutoFinishReport(reportId: string): () => void {
  let tokens = claimTokens.get(reportId);
  if (!tokens) {
    tokens = new Set();
    claimTokens.set(reportId, tokens);
  }
  const token = {};
  tokens.add(token);
  queuedIds = queuedIds.filter((entry) => entry.id !== reportId);
  controllers.get(reportId)?.abort();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    tokens.delete(token);
    if (tokens.size === 0) claimTokens.delete(reportId);
    syncQueue();
  };
}

/**
 * Hook form of claimAutoFinishReport for a report workspace: the
 * claim is held from mount until the workspace hands the PDF step
 * to the engine by calling the returned release (its automatic
 * save does), or until unmount — whichever comes first. A null id
 * (no linked report) claims nothing.
 */
export function useAutoFinishClaim(reportId: string | null): () => void {
  const releaseRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (!reportId) {
      releaseRef.current = null;
      return;
    }
    const release = claimAutoFinishReport(reportId);
    releaseRef.current = release;
    return () => {
      if (releaseRef.current === release) releaseRef.current = null;
      release();
    };
  }, [reportId]);
  return useCallback(() => {
    releaseRef.current?.();
    releaseRef.current = null;
  }, []);
}

// ---------------------------------------------------------------------------
// PDF refresh intents.
//
// When the workspace re-saves a drawing over a report that already
// carries a PDF, the on-file PDF no longer matches the current
// drawing. The workspace registers an intent here instead of
// regenerating the PDF itself (one finisher); the engine runs the
// drawing-saved → PDF path for exactly that drawing and replaces
// the file. Intents are consumed when their run starts and are
// keyed-attempted like normal finishes, so a failed refresh never
// loops silently — re-saving the drawing registers a fresh one.
// ---------------------------------------------------------------------------

const pdfRefreshIntents = new Map<string, string>();

export function requestReportPdfRefresh(reportId: string, drawingId: string) {
  pdfRefreshIntents.set(reportId, drawingId);
  syncQueue();
}

function refreshAttemptKey(reportId: string, drawingId: string): string {
  return `pdf:${reportId}:${drawingId}`;
}

function pump() {
  if (engineSuppressed || !engineRuntime) return;
  const runtime = engineRuntime;
  while (activeFinishCount < MAX_CONCURRENT_FINISHES && queuedIds.length > 0) {
    const entry = queuedIds.shift()!;
    const id = entry.id;
    const order = latestInputs.orders?.find((item) => item.id === id);
    if (!order) continue;
    // A report whose workspace is open belongs to the workspace —
    // the engine never starts it (the workspace claims it).
    if (isAutoFinishClaimed(order.id)) continue;
    const refreshDrawingId = entry.refreshDrawingId;
    if (!refreshDrawingId && !reportNeedsAutoFinish(order)) continue;
    // Another surface may have started this report version while it
    // waited in the queue — never submit it twice.
    const key = refreshDrawingId ? refreshAttemptKey(id, refreshDrawingId) : attemptKey(order);
    if (startedAttempts.has(key)) continue;
    startedAttempts.add(key);
    const drawingRow = refreshDrawingId
      ? (latestInputs.drawings?.find((drawing) => drawing.id === refreshDrawingId) ?? null)
      : (latestInputs.drawings?.find((drawing) => drawing.id === order.drawing_id) ?? null);
    const customerName =
      latestInputs.customers?.find((customer) => customer.id === order.customer_id)?.name ?? "";
    const controller = new AbortController();
    controllers.set(id, controller);
    activeFinishCount += 1;
    applyState(
      order,
      refreshDrawingId
        ? { phase: "building-pdf" }
        : { phase: "measuring", percent: 0, detail: null, elapsedSeconds: 0 },
    );
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
          {
            order,
            drawingRow,
            customerName,
            ...(refreshDrawingId ? { refreshDrawingId } : {}),
          },
          controller.signal,
        );
        if (controller.signal.aborted) {
          startedAttempts.delete(key);
          setUiState(id, null);
          forgetMeasurementActivity(id);
        } else if (outcome.kind === "done") {
          setUiState(id, null);
          // Keyed by the PDF the report now carries, so the same
          // completion never notifies twice — however many chains
          // reconciled into it — while a genuinely new PDF (a
          // refresh after a re-save) notifies once more.
          recordMeasurementReady(
            order.id,
            order.address,
            outcome.filePath ? `${order.id}:${outcome.filePath}` : attemptKey(order),
          );
          await runtime.invalidate();
        } else if (outcome.kind === "superseded") {
          // A newer drawing replaced the one this chain worked on
          // mid-flight. Not an error and not a completion: forget
          // the attempt and let the current version be finished
          // fresh — through the normal path when it still needs a
          // PDF, or a refresh intent when it already carries one.
          // The intent is re-registered ONLY for a drawing this
          // chain did not just work on; re-registering the same one
          // would re-run the same supersede forever.
          startedAttempts.delete(key);
          setUiState(id, null);
          forgetMeasurementActivity(id);
          const workedDrawingId = refreshDrawingId ?? order.drawing_id;
          const current = latestInputs.orders?.find((item) => item.id === id);
          if (current?.drawing_id && current.file_path && current.drawing_id !== workedDrawingId) {
            pdfRefreshIntents.set(id, current.drawing_id);
          }
          syncQueue();
        } else if (outcome.kind === "candidates") {
          applyState(order, { phase: "candidates", message: outcome.message });
        } else if (outcome.kind === "unmeasurable") {
          applyState(order, { phase: "unmeasurable", message: outcome.message });
        } else {
          applyState(order, { phase: "error", message: outcome.message });
        }
      } catch (cause) {
        if (controller.signal.aborted) {
          startedAttempts.delete(key);
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
    if (isAutoFinishClaimed(order.id)) continue;
    if (startedAttempts.has(attemptKey(order))) continue;
    if (controllers.has(order.id) || queuedIds.some((entry) => entry.id === order.id)) continue;
    queuedIds.push({ id: order.id });
  }
  // PDF refresh intents (the workspace re-saved a drawing over a
  // report that already carries a PDF): run once the save is
  // visible in the surfaces' data, for exactly that drawing.
  for (const [reportId, drawingId] of pdfRefreshIntents) {
    if (isAutoFinishClaimed(reportId)) continue;
    if (controllers.has(reportId) || queuedIds.some((entry) => entry.id === reportId)) continue;
    if (startedAttempts.has(refreshAttemptKey(reportId, drawingId))) {
      pdfRefreshIntents.delete(reportId);
      continue;
    }
    const order = latestInputs.orders.find((item) => item.id === reportId);
    if (!order || order.drawing_id !== drawingId) continue;
    pdfRefreshIntents.delete(reportId);
    queuedIds.push({ id: reportId, refreshDrawingId: drawingId });
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
 * surface pause the whole engine (a surface that unmounts or
 * disables itself hands everything back). An open report workspace
 * does NOT pause the engine — other companies' reports keep
 * finishing — it claims just its own report through
 * useAutoFinishClaim (see the claims block above), and hands the
 * PDF step back by releasing the claim when its drawing save lands.
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
