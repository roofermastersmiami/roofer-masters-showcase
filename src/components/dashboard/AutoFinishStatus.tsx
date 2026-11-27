import { Loader2 } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { formatElapsedClock } from "@/lib/analysis-progress";
import type { AutoFinishUiState } from "./use-auto-finish";

/**
 * Live per-card state for a report the auto-finisher is completing:
 * the measuring percent and elapsed clock, the saving / building-PDF
 * steps, and the terminal outcomes that need Fredy's eyes (multiple
 * buildings to pick from, an unmeasurable roof, a stopped run).
 * Shared by the Roof reports list and the Roof measurements tab so
 * both surfaces describe an in-flight finish the same way.
 */
export function AutoFinishStatus({ state, date }: { state: AutoFinishUiState; date: string }) {
  if (state.phase === "measuring") {
    return (
      <div className="mt-3" role="status">
        <p className="flex items-center gap-1.5 text-xs font-medium text-foreground">
          <Loader2 className="size-3.5 animate-spin" />
          Measuring automatically · {state.percent}% · {formatElapsedClock(state.elapsedSeconds)}
          {" · "}
          {date}
        </p>
        <Progress
          value={state.percent}
          className="mt-2"
          aria-label="Automatic measurement progress"
        />
        {state.detail && <p className="mt-1.5 text-xs text-muted-foreground">{state.detail}</p>}
      </div>
    );
  }
  if (state.phase === "saving" || state.phase === "building-pdf") {
    return (
      <p
        className="mt-3 flex items-center gap-1.5 text-xs font-medium text-foreground"
        role="status"
      >
        <Loader2 className="size-3.5 animate-spin" />
        {state.phase === "saving" ? "Saving the measurement…" : "Generating the report PDF…"} ·{" "}
        {date}
      </p>
    );
  }
  if (state.phase === "candidates") {
    return (
      <p className="mt-3 text-xs text-amber-700" role="status">
        The measurement found more than one building at this address — open the report to pick the
        right one. · {date}
      </p>
    );
  }
  if (state.phase === "unmeasurable") {
    return (
      <p className="mt-3 text-xs text-amber-700" role="status">
        This roof could not be measured automatically: {state.message} · {date}
      </p>
    );
  }
  return (
    <p className="mt-3 text-xs text-destructive" role="status">
      Automatic measurement stopped: {state.message} Open the report to try from the workspace. ·{" "}
      {date}
    </p>
  );
}
