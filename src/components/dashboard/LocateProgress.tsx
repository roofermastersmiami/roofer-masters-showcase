import { useCallback, useEffect, useRef, useState } from "react";
import { Progress } from "@/components/ui/progress";
import {
  LOCATE_PROGRESS_PHASES,
  locateProgressPercent,
  type LocateProgressPhase,
} from "@/lib/analysis-progress";

/**
 * Loading state for the order dialog's Locate address step. Without
 * it the dialog sat silent for as long as the footprint lookup took
 * (tens of seconds on a cold service) and looked frozen. The hook
 * drives a visible 0–100% from the real phase transitions — address
 * lookup, then the detection service's building lookup — plus the
 * monotonic asymptotic creep from locateProgressPercent while a
 * phase waits: the number never runs backwards, never sits at 100
 * early, and shows exactly 100 only via complete(), briefly, before
 * clearing. cancel() clears at once so an error or a not-found
 * fallback never leaves a stuck percentage behind.
 */

export type LocateProgressState = {
  phase: LocateProgressPhase;
  percent: number;
} | null;

const TICK_MS = 200;
/** How long the finished 100% stays on screen before clearing. */
const COMPLETE_LINGER_MS = 700;

export function useLocateProgress() {
  const [state, setState] = useState<LocateProgressState>(null);
  const runRef = useRef<{ phase: LocateProgressPhase; startedAt: number; percent: number } | null>(
    null,
  );
  const intervalRef = useRef<number | null>(null);
  const lingerRef = useRef<number | null>(null);

  const stopTimers = useCallback(() => {
    if (intervalRef.current !== null) {
      window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (lingerRef.current !== null) {
      window.clearTimeout(lingerRef.current);
      lingerRef.current = null;
    }
  }, []);

  const tick = useCallback(() => {
    const run = runRef.current;
    if (!run) return;
    const percent = locateProgressPercent(
      run.phase,
      (Date.now() - run.startedAt) / 1000,
      run.percent,
    );
    if (percent !== run.percent) {
      run.percent = percent;
      setState({ phase: run.phase, percent });
    }
  }, []);

  /** Begin a fresh locate run in its first phase (0%). */
  const start = useCallback(
    (phase: LocateProgressPhase) => {
      stopTimers();
      const percent = locateProgressPercent(phase, 0, 0);
      runRef.current = { phase, startedAt: Date.now(), percent };
      setState({ phase, percent });
      intervalRef.current = window.setInterval(tick, TICK_MS);
    },
    [stopTimers, tick],
  );

  /** Move to the next real step; the percent jumps to at least the
   * new phase's floor and never below where the last phase left it. */
  const advance = useCallback((phase: LocateProgressPhase) => {
    const run = runRef.current;
    if (!run) return;
    run.phase = phase;
    run.startedAt = Date.now();
    run.percent = locateProgressPercent(phase, 0, run.percent);
    setState({ phase, percent: run.percent });
  }, []);

  /** The locate finished (pin placed or fallback shown): show
   * exactly 100% briefly, then clear. */
  const complete = useCallback(() => {
    const run = runRef.current;
    stopTimers();
    if (!run) {
      setState(null);
      return;
    }
    run.percent = 100;
    setState({ phase: run.phase, percent: 100 });
    lingerRef.current = window.setTimeout(() => {
      runRef.current = null;
      setState(null);
    }, COMPLETE_LINGER_MS);
  }, [stopTimers]);

  /** Abandon the run (error / not found): clear immediately. */
  const cancel = useCallback(() => {
    stopTimers();
    runRef.current = null;
    setState(null);
  }, [stopTimers]);

  useEffect(() => stopTimers, [stopTimers]);

  return { state, start, advance, complete, cancel };
}

export function LocateProgressIndicator({ state }: { state: NonNullable<LocateProgressState> }) {
  const label = LOCATE_PROGRESS_PHASES[state.phase].label;
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={`${label} ${state.percent}%`}
      className="w-72 max-w-full rounded-md bg-background p-5 text-center shadow-lg"
    >
      <p className="text-4xl font-bold tabular-nums">{state.percent}%</p>
      <p className="mt-1 text-sm font-medium">{label}</p>
      <Progress
        className="mt-3"
        value={state.percent}
        aria-label={`Locating the address: ${state.percent}%`}
      />
    </div>
  );
}
