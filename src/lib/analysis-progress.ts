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
  // Legacy synchronous fallback: the service predates the jobs API and
  // reports nothing, so the whole request is one wide elapsed-time band.
  measuring: { floor: 5, cap: 90 },
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
