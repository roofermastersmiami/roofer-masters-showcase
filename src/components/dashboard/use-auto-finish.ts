import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  finishRoofReport,
  reportNeedsAutoFinish,
  type AutoFinishProgress,
} from "@/lib/auto-finish";
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

// Attempts are remembered per report version (id + updated_at) for
// the whole page session: a report whose automatic finish reached a
// terminal state (done, needs a building pick, unmeasurable, error)
// is never silently re-submitted on every list refresh. A run that
// was aborted because the list unmounted forgets its attempt, so
// coming back to Roof reports resumes it.
const startedAttempts = new Set<string>();
const MAX_CONCURRENT_FINISHES = 3;

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

/**
 * Watch the roof reports list and finish every still-awaiting report
 * by itself: when the list loads (and while it stays open), each
 * eligible report starts or resumes its measurement through the
 * detection jobs API and runs the full automatic chain — drawing
 * saved, report PDF generated and attached — with per-card live
 * state for the UI. No "Continue measurements" click is involved.
 */
export function useAutoFinishReports(
  orders: RoofOrder[] | undefined,
  drawings: DrawingRow[] | undefined,
  customers: CustomerRow[] | undefined,
): ReadonlyMap<string, AutoFinishUiState> {
  const qc = useQueryClient();
  const saveFn = useServerFn(saveRoofDrawing);
  const attachPdfFn = useServerFn(attachRoofOrderPdf);
  const aerialFn = useServerFn(loadReportAerial);
  const [states, setStates] = useState<ReadonlyMap<string, AutoFinishUiState>>(new Map());
  const controllers = useRef(new Map<string, AbortController>());
  const queuedIds = useRef<string[]>([]);
  const runningCount = useRef(0);
  const latest = useRef({ orders, drawings, customers });
  latest.current = { orders, drawings, customers };

  const setState = useCallback((id: string, next: AutoFinishUiState | null) => {
    setStates((previous) => {
      const copy = new Map(previous);
      if (next === null) copy.delete(id);
      else copy.set(id, next);
      return copy;
    });
  }, []);

  const pump = useCallback(() => {
    while (runningCount.current < MAX_CONCURRENT_FINISHES && queuedIds.current.length > 0) {
      const id = queuedIds.current.shift()!;
      const order = latest.current.orders?.find((item) => item.id === id);
      if (!order || !reportNeedsAutoFinish(order)) continue;
      startedAttempts.add(attemptKey(order));
      const drawingRow =
        latest.current.drawings?.find((drawing) => drawing.id === order.drawing_id) ?? null;
      const customerName =
        latest.current.customers?.find((customer) => customer.id === order.customer_id)?.name ?? "";
      const controller = new AbortController();
      controllers.current.set(id, controller);
      runningCount.current += 1;
      setState(id, { phase: "measuring", percent: 0, detail: null, elapsedSeconds: 0 });
      void (async () => {
        try {
          const outcome = await finishRoofReport(
            {
              saveDrawing: (args) => saveFn(args),
              attachPdf: (args) => attachPdfFn(args),
              loadAerial: (args) => aerialFn(args),
              onProgress: (update) => {
                if (!controller.signal.aborted) setState(id, progressToUiState(update));
              },
            },
            { order, drawingRow, customerName },
            controller.signal,
          );
          if (controller.signal.aborted) {
            startedAttempts.delete(attemptKey(order));
            setState(id, null);
          } else if (outcome.kind === "done") {
            setState(id, null);
            await Promise.all([
              qc.invalidateQueries({ queryKey: ["roof-report-orders"] }),
              qc.invalidateQueries({ queryKey: ["roof-drawings"] }),
            ]);
          } else if (outcome.kind === "candidates") {
            setState(id, { phase: "candidates", message: outcome.message });
          } else if (outcome.kind === "unmeasurable") {
            setState(id, { phase: "unmeasurable", message: outcome.message });
          } else {
            setState(id, { phase: "error", message: outcome.message });
          }
        } catch (cause) {
          if (controller.signal.aborted) {
            startedAttempts.delete(attemptKey(order));
            setState(id, null);
          } else {
            setState(id, {
              phase: "error",
              message:
                cause instanceof Error
                  ? cause.message
                  : "Automatic measurement could not be completed.",
            });
          }
        } finally {
          controllers.current.delete(id);
          runningCount.current -= 1;
          pump();
        }
      })();
    }
  }, [attachPdfFn, aerialFn, qc, saveFn, setState]);

  // Enqueue every eligible report the list shows; guards make this
  // idempotent across re-renders and query refetches, so each report
  // is submitted exactly once.
  useEffect(() => {
    if (!orders) return;
    let added = false;
    for (const order of orders) {
      if (!reportNeedsAutoFinish(order)) continue;
      if (startedAttempts.has(attemptKey(order))) continue;
      if (controllers.current.has(order.id) || queuedIds.current.includes(order.id)) continue;
      queuedIds.current.push(order.id);
      added = true;
    }
    if (added) pump();
  }, [orders, pump]);

  // Leaving Roof reports stops the browser-side chain (the service
  // job itself keeps running server-side); the attempt is forgotten
  // on abort above, so returning to the list resumes the finish.
  useEffect(
    () => () => {
      for (const controller of controllers.current.values()) controller.abort();
      controllers.current.clear();
      queuedIds.current = [];
    },
    [],
  );

  return states;
}
