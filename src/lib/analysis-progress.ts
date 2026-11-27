/** Overall 0–100 progress for an automated roof measurement, derived from
 * the detection service's real job state.
 *
 * The jobs API reports coarse stages, and only one of them carries a true
 * fraction: `downloading_tiles` (the USGS LiDAR tile download, by far the
 * longest part of a cold measurement) reports `download_fraction` 0–1.
 * Every other stage is mapped to a percentage band sized by how much of a
 * typical run it represents. Within a band the number creeps slowly toward
 * the cap the longer the stage lasts, so a stuck-looking stage still
 * visibly moves — but it never crosses the cap until the service actually
 * advances, and it never reaches 100 until the job completes. The result
 * is monotonic within one attempt: callers pass the previous percent back
 * in and the returned value never goes below it.
 *
 * Stage names are the exact strings the service emits from
 * `_run_analysis` / `_execute_job` in services/roof-detection/main.py:
 * queued → starting → geocoding → footprint → lidar →
 * downloading_tiles (TNM fallback only) → fitting_planes → complete.
 * The COPC path never emits downloading_tiles/fitting_planes — its
 * fitting happens inside the `lidar` stage — so `lidar` creeps in its own
 * band until the job completes.
 */
export type AnalysisProgressSnapshot = {
  status?: string | null;
  stage?: string | null;
  downloadFraction?: number | null;
  /** Seconds spent in the current stage (client-measured). */
  stageElapsedSeconds?: number | null;
};

type StageBand = { floor: number; cap: number };

const STAGE_BANDS: Record<string, StageBand> = {
  queued: { floor: 1, cap: 3 },
  starting: { floor: 3, cap: 5 },
  geocoding: { floor: 5, cap: 8 },
  footprint: { floor: 8, cap: 10 },
  lidar: { floor: 10, cap: 14 },
  downloading_tiles: { floor: 14, cap: 76 },
  fitting_planes: { floor: 76, cap: 95 },
};

/** How fast the in-band creep approaches the cap (asymptotic time
 * constant, seconds). Slow enough that a stage doing real work advances
 * the job long before the creep alone could pin the number at the cap. */
const CREEP_TAU_SECONDS = 90;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const creepFactor = (elapsedSeconds: number) =>
  1 - Math.exp(-Math.max(0, elapsedSeconds) / CREEP_TAU_SECONDS);

/**
 * Map one job snapshot to an overall percent.
 *
 * `previousPercent` is the last value shown for this attempt; the result
 * never goes below it (monotonic) and never exceeds 99 until the job is
 * actually complete. A failed job keeps the previous value — the caller
 * replaces the progress display with the error anyway.
 */
export function analysisProgressPercent(
  snapshot: AnalysisProgressSnapshot,
  previousPercent = 0,
): number {
  if (snapshot.status === "complete" || snapshot.stage === "complete") return 100;
  const previous = clamp(Math.floor(previousPercent) || 0, 0, 99);
  if (snapshot.status === "failed" || snapshot.stage === "failed") return previous;

  const stageElapsed = snapshot.stageElapsedSeconds ?? 0;
  const band = snapshot.stage ? STAGE_BANDS[snapshot.stage] : undefined;
  if (!band) {
    // Unknown stage (a newer service, or no poll yet): keep the number
    // moving gently from wherever it is, never inventing a position.
    if (previous <= 0) return 1;
    return clamp(Math.max(previous, previous + (99 - previous) * creepFactor(stageElapsed)), 0, 99);
  }

  let target: number;
  if (snapshot.stage === "downloading_tiles" && snapshot.downloadFraction != null) {
    const fraction = clamp(snapshot.downloadFraction, 0, 1);
    target = band.floor + fraction * (band.cap - band.floor);
  } else {
    target = band.floor + (band.cap - band.floor) * creepFactor(stageElapsed);
  }
  return clamp(Math.round(Math.max(previous, target)), 0, 99);
}

/** "0:07", "3:24", "12:05" — elapsed clock for the progress display. */
export function formatElapsedClock(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds) || 0);
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Timed-phase progress: the same honesty rules as the measurement
// progress above, for waits that have no server-side fraction to
// report (a single request that is simply in flight). Each phase owns
// a percentage band; within the band the number creeps asymptotically
// toward the cap the longer the phase lasts, so a slow step still
// visibly moves — but it never crosses the cap until the caller
// advances the phase, never goes backwards across a phase change
// (callers pass the previous percent back in), and reaches exactly
// 100 only when the caller says the work completed.
// ---------------------------------------------------------------------------

export type TimedProgressPhase = {
  /** First percent of the phase's band. */
  floor: number;
  /** Percent the in-phase creep approaches but the phase never passes. */
  cap: number;
  /** Asymptotic creep time constant for this phase, seconds. */
  tauSeconds: number;
};

export function timedProgressPercent(
  phase: TimedProgressPhase,
  phaseElapsedSeconds: number,
  previousPercent = 0,
  complete = false,
): number {
  if (complete) return 100;
  const previous = clamp(Math.floor(previousPercent) || 0, 0, 99);
  const tau = phase.tauSeconds > 0 ? phase.tauSeconds : CREEP_TAU_SECONDS;
  const factor = 1 - Math.exp(-Math.max(0, phaseElapsedSeconds) / tau);
  const target = phase.floor + (phase.cap - phase.floor) * factor;
  return clamp(Math.round(Math.max(previous, target)), 0, 99);
}

/** The two real steps of the order dialog's Locate address flow: the
 * address lookup (usually a few seconds), then the detection
 * service's footprint lookup behind locateBuildingPin (tens of
 * seconds, slower on a cold service). The building band therefore
 * gets the larger share and the slower creep. */
export const LOCATE_PROGRESS_PHASES = {
  geocoding: { label: "Finding the address…", floor: 0, cap: 40, tauSeconds: 6 },
  building: { label: "Finding the building on the map…", floor: 40, cap: 97, tauSeconds: 20 },
} as const satisfies Record<string, TimedProgressPhase & { label: string }>;

export type LocateProgressPhase = keyof typeof LOCATE_PROGRESS_PHASES;

/** Percent for one in-flight Locate step. Exactly 100 only when
 * `complete` is set — the caller does that once the pin is placed or
 * the fallback is shown, never before. */
export function locateProgressPercent(
  phase: LocateProgressPhase,
  phaseElapsedSeconds: number,
  previousPercent = 0,
  complete = false,
): number {
  return timedProgressPercent(
    LOCATE_PROGRESS_PHASES[phase],
    phaseElapsedSeconds,
    previousPercent,
    complete,
  );
}
