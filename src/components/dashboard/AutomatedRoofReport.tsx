import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  CloudDownload,
  Loader2,
  MapPin,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { analysisProgressPercent, formatElapsedClock } from "@/lib/analysis-progress";
import { detectedFacetsToDrawing, type RoofDetectionResponse } from "@/lib/roof-detection";
import type { RoofDrawing } from "@/lib/roof-geometry";

type Props = {
  address: string;
  roofType: RoofDrawing["roof_type"];
  onApply: (drawing: ReturnType<typeof detectedFacetsToDrawing>) => boolean;
};

type BuildingCandidate = {
  candidate_id: string;
  provider?: string;
  source_id?: string | number | null;
  area_sqft: number;
  address_point_inside_footprint: boolean;
  address_to_footprint_distance_m: number;
  centroid: { lat: number; lon: number };
  polygon_geojson: { type: "Polygon"; coordinates: number[][][] };
};

function CandidateOutline({ candidate }: { candidate: BuildingCandidate }) {
  const ring = candidate.polygon_geojson.coordinates[0] ?? [];
  const xs = ring.map(([x]) => x).filter(Number.isFinite);
  const ys = ring.map(([, y]) => y).filter(Number.isFinite);
  if (xs.length < 3 || ys.length < 3) return <div className="h-20 rounded bg-muted" />;
  const minX = Math.min(...xs),
    maxX = Math.max(...xs);
  const minY = Math.min(...ys),
    maxY = Math.max(...ys);
  const width = Math.max(maxX - minX, 1e-8),
    height = Math.max(maxY - minY, 1e-8);
  const points = ring
    .map(([x, y]) => `${10 + ((x - minX) / width) * 80},${60 - ((y - minY) / height) * 50}`)
    .join(" ");
  return (
    <svg
      viewBox="0 0 100 70"
      role="img"
      aria-label="Building outline preview"
      className="h-20 w-full rounded bg-muted/50"
    >
      <polygon
        points={points}
        fill="currentColor"
        fillOpacity="0.14"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </svg>
  );
}

// Keep the public free detection service reachable in published builds even when
// the frontend host has not been given a VITE_* build variable. The environment
// value remains an optional override for staging or a future service migration.
const DEFAULT_ROOF_DETECTION_API_URL = "https://roofer-masters-roof-detection-w909.onrender.com";

function apiBase() {
  const configuredBase = import.meta.env["VITE_ROOF_DETECTION_API_URL"]?.trim();
  return (configuredBase || DEFAULT_ROOF_DETECTION_API_URL).replace(/\/+$/, "");
}

type AnalysisProgress = {
  stage: string | null;
  detail: string | null;
  downloadFraction: number | null;
};

type AnalysisOutcome =
  | { kind: "result"; body: unknown }
  | { kind: "candidates"; candidates: BuildingCandidate[]; message: string }
  | { kind: "error"; message: string };

const POLL_INTERVAL_MS = 3000;
const JOB_DEADLINE_MS = 45 * 60 * 1000;
// A job can vanish mid-flight when the free-tier service restarts (job
// state is in-memory) or when a polling deadline passes; resubmission is
// automatic and cheap because finished tile downloads stay cached on the
// service, so the user never has to retry by hand.
const MAX_JOB_RESUBMITS = 3;

function candidatesFromDetail(detail: unknown): BuildingCandidate[] | null {
  if (
    detail &&
    typeof detail === "object" &&
    "candidates" in detail &&
    Array.isArray(detail.candidates) &&
    detail.candidates.length > 0
  ) {
    return detail.candidates as BuildingCandidate[];
  }
  return null;
}

function messageFromDetail(detail: unknown, fallback: string): string {
  if (typeof detail === "string") return detail;
  if (
    detail &&
    typeof detail === "object" &&
    "message" in detail &&
    typeof detail.message === "string"
  ) {
    return detail.message;
  }
  return fallback;
}

function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = window.setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      window.clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/** Run one address analysis hands-off: submit a background job and poll it
 * to completion, resubmitting automatically when the service loses the job
 * (restart) or stalls past the deadline. Services too old to have the jobs
 * API fall back to the original synchronous request, so the CRM keeps
 * working against any deployed version.
 */
async function requestAnalysis(
  base: string,
  payload: Record<string, unknown>,
  signal: AbortSignal,
  onProgress: (progress: AnalysisProgress) => void,
): Promise<AnalysisOutcome> {
  const legacy = async (): Promise<AnalysisOutcome> => {
    // The legacy service reports no stages; the progress display creeps
    // on elapsed time in the wide "measuring" band instead.
    onProgress({ stage: "measuring", detail: null, downloadFraction: null });
    const legacyController = new AbortController();
    const linkAbort = () => legacyController.abort();
    if (signal.aborted) legacyController.abort();
    else signal.addEventListener("abort", linkAbort, { once: true });
    const timeoutId = window.setTimeout(() => legacyController.abort(), 90000);
    try {
      const response = await fetch(`${base}/v1/roof/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: legacyController.signal,
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const detail = body && typeof body === "object" && "detail" in body ? body.detail : null;
        const candidates = candidatesFromDetail(detail);
        if (candidates) {
          return {
            kind: "candidates",
            candidates,
            message: messageFromDetail(
              detail,
              "Select the correct building outline before running roof analysis.",
            ),
          };
        }
        return {
          kind: "error",
          message: messageFromDetail(detail, `Roof detection request failed (${response.status}).`),
        };
      }
      return { kind: "result", body };
    } finally {
      window.clearTimeout(timeoutId);
      signal.removeEventListener("abort", linkAbort);
    }
  };

  let resubmits = 0;
  let deadline = Date.now() + JOB_DEADLINE_MS;
  for (;;) {
    let jobId: string | null = null;
    try {
      const submit = await fetch(`${base}/v1/roof/analyze/jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal,
      });
      if (submit.status === 202) {
        const body: unknown = await submit.json().catch(() => null);
        if (body && typeof body === "object" && "job_id" in body) {
          jobId = String(body.job_id);
        }
      }
    } catch (cause) {
      if (signal.aborted) throw cause;
      jobId = null;
    }
    if (!jobId) return legacy();

    let lost = false;
    while (!lost) {
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      let job: import("@/lib/roof-detection").RoofAnalysisJob | null = null;
      let pollStatus = 0;
      try {
        const response = await fetch(`${base}/v1/roof/analyze/jobs/${jobId}`, {
          signal,
        });
        pollStatus = response.status;
        if (response.ok) {
          const body: unknown = await response.json().catch(() => null);
          const { roofAnalysisJobSchema } = await import("@/lib/roof-detection");
          const parsed = roofAnalysisJobSchema.safeParse(body);
          if (parsed.success) job = parsed.data;
        }
      } catch (cause) {
        if (signal.aborted) throw cause;
        // A network failure mid-poll usually means the service is
        // restarting; treat it like a stall, not a final error.
        job = null;
      }
      if (pollStatus === 404) {
        lost = true;
      } else if (job?.status === "complete" && job.result) {
        return { kind: "result", body: job.result };
      } else if (job?.status === "failed") {
        const candidates = candidatesFromDetail(job.error_detail);
        if (candidates) {
          return {
            kind: "candidates",
            candidates,
            message: messageFromDetail(
              job.error_detail,
              "Select the correct building outline before running roof analysis.",
            ),
          };
        }
        return {
          kind: "error",
          message:
            job.error ??
            messageFromDetail(job.error_detail, "Roof detection could not be completed."),
        };
      } else {
        if (job) {
          onProgress({
            stage: job.stage ?? null,
            detail: job.detail ?? null,
            downloadFraction: job.download_fraction ?? null,
          });
        }
        if (Date.now() > deadline) lost = true;
        else await abortableSleep(POLL_INTERVAL_MS, signal);
      }
    }

    resubmits += 1;
    if (resubmits > MAX_JOB_RESUBMITS) {
      return {
        kind: "error",
        message:
          "The measurement service kept restarting during this analysis. Wait a minute and use Retry.",
      };
    }
    onProgress({
      stage: "resubmitting",
      detail: "The measurement service restarted — resubmitting automatically…",
      downloadFraction: null,
    });
    deadline = Date.now() + JOB_DEADLINE_MS;
  }
}

const STAGE_LABELS: Record<string, string> = {
  queued: "Waiting for a measurement worker…",
  starting: "Starting the measurement…",
  geocoding: "Locating the address…",
  footprint: "Matching the building footprint…",
  lidar: "Reading public LiDAR coverage…",
  downloading_tiles: "Downloading USGS LiDAR tiles…",
  fitting_planes: "Fitting roof planes to the LiDAR points…",
  resubmitting: "Resubmitting the measurement…",
  measuring: "Measuring the roof…",
};

export function AutomatedRoofReport({ address, roofType, onApply }: Props) {
  const [result, setResult] = useState<RoofDetectionResponse | null>(null);
  const [candidates, setCandidates] = useState<BuildingCandidate[]>([]);
  const [progress, setProgress] = useState<AnalysisProgress | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [resultAddress, setResultAddress] = useState("");
  const [errorAddress, setErrorAddress] = useState("");
  const [loadingAddress, setLoadingAddress] = useState("");
  const requestId = useRef(0);
  const activeController = useRef<AbortController | null>(null);
  const autoAnalyzedAddress = useRef("");
  const autoAppliedAddress = useRef("");
  // Overall-progress clock: the percent is derived from the job's stage
  // (see analysis-progress.ts) and must never rewind within one attempt,
  // so the last shown value and the current stage's start are kept here.
  const progressClock = useRef({
    stage: null as string | null,
    stageSince: 0,
    percent: 0,
    downloadFraction: null as number | null,
  });
  const runStartedAt = useRef(0);
  const [percent, setPercent] = useState(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  const refreshPercent = useCallback(() => {
    const clock = progressClock.current;
    if (!clock.stageSince) return;
    const next = analysisProgressPercent(
      {
        status: "running",
        stage: clock.stage,
        downloadFraction: clock.downloadFraction,
        stageElapsedSeconds: (Date.now() - clock.stageSince) / 1000,
      },
      clock.percent,
    );
    clock.percent = next;
    setPercent(next);
    setElapsedSeconds(Math.max(0, (Date.now() - runStartedAt.current) / 1000));
  }, []);

  const handleProgress = useCallback(
    (next: AnalysisProgress) => {
      const clock = progressClock.current;
      if (next.stage === "resubmitting") {
        // A fresh attempt starts: the number restarts honestly with it.
        clock.stage = "queued";
        clock.stageSince = Date.now();
        clock.percent = 0;
        clock.downloadFraction = null;
      } else if (next.stage !== clock.stage) {
        clock.stage = next.stage;
        clock.stageSince = Date.now();
        clock.downloadFraction = next.downloadFraction;
      } else if (next.downloadFraction != null) {
        clock.downloadFraction = next.downloadFraction;
      }
      setProgress(next);
      refreshPercent();
    },
    [refreshPercent],
  );

  // Keep the number creeping (and the elapsed clock ticking) between the
  // ~3s job polls, so a long stage never looks frozen.
  useEffect(() => {
    if (!loading) return;
    const timer = window.setInterval(refreshPercent, 1000);
    return () => window.clearInterval(timer);
  }, [loading, refreshPercent]);

  // Cancel work for the previous property and prevent stale responses or loading state.
  useEffect(() => {
    requestId.current += 1;
    activeController.current?.abort();
    activeController.current = null;
    setLoading(false);
    return () => {
      requestId.current += 1;
      activeController.current?.abort();
      activeController.current = null;
      autoAnalyzedAddress.current = "";
    };
  }, [address]);

  const currentAddress = address.trim();
  const visibleResult = resultAddress === currentAddress ? result : null;
  const visibleError = errorAddress === currentAddress ? error : "";
  const visibleCandidates = errorAddress === currentAddress ? candidates : [];
  const isLoading = loading && loadingAddress === currentAddress;
  const isMiramarBenchmark =
    currentAddress.toLowerCase().includes("3062") &&
    currentAddress.toLowerCase().includes("189") &&
    currentAddress.toLowerCase().includes("miramar");

  const analyze = useCallback(
    async (candidateId?: string) => {
      if (!address.trim()) {
        setError("Select a property with a complete street address first.");
        setErrorAddress(currentAddress);
        return;
      }
      activeController.current?.abort();
      const controller = new AbortController();
      activeController.current = controller;
      const activeRequest = ++requestId.current;
      const requestedAddress = address.trim();
      setLoading(true);
      setLoadingAddress(requestedAddress);
      progressClock.current = {
        stage: "queued",
        stageSince: Date.now(),
        percent: 0,
        downloadFraction: null,
      };
      runStartedAt.current = Date.now();
      setPercent(analysisProgressPercent({ status: "queued", stage: "queued" }));
      setElapsedSeconds(0);
      setProgress(null);
      setError("");
      setErrorAddress("");
      setCandidates([]);
      setResult(null);
      setResultAddress("");
      try {
        const outcome = await requestAnalysis(
          apiBase(),
          {
            street_address: requestedAddress,
            ...(candidateId ? { footprint_candidate_id: candidateId } : {}),
          },
          controller.signal,
          (next) => {
            if (activeRequest === requestId.current) handleProgress(next);
          },
        );
        if (activeRequest !== requestId.current) return;
        if (outcome.kind === "candidates") {
          if (!candidateId) {
            setCandidates(outcome.candidates);
            setError(outcome.message);
            setErrorAddress(requestedAddress);
          } else {
            throw new Error(outcome.message);
          }
          return;
        }
        if (outcome.kind === "error") throw new Error(outcome.message);
        // Parse at the boundary; never allow unchecked API data into editable roof geometry.
        const { roofDetectionResponseSchema } = await import("@/lib/roof-detection");
        if (activeRequest !== requestId.current) return;
        setCandidates([]);
        setResult(roofDetectionResponseSchema.parse(outcome.body));
        setResultAddress(requestedAddress);
      } catch (cause) {
        if (activeRequest !== requestId.current) return;
        setError(cause instanceof Error ? cause.message : "Roof detection could not be completed.");
        setErrorAddress(requestedAddress);
      } finally {
        if (activeRequest === requestId.current) {
          setLoading(false);
          setProgress(null);
          if (activeController.current === controller) activeController.current = null;
        }
      }
    },
    [address, currentAddress, handleProgress],
  );

  // Start public-data analysis once when a new property address is loaded.
  // The manual button remains available for retries; valid LiDAR facets are applied once per address.
  useEffect(() => {
    if (!currentAddress || autoAnalyzedAddress.current === currentAddress) return;
    autoAnalyzedAddress.current = currentAddress;
    void analyze();
  }, [analyze, currentAddress]);

  // Load valid LiDAR facets into a fresh measurement automatically.
  // Existing drawings are protected by the parent workflow's replacement confirmation.
  useEffect(() => {
    if (
      !visibleResult ||
      visibleResult.status !== "lidar_facets" ||
      visibleResult.roof.facets.length === 0 ||
      autoAppliedAddress.current === currentAddress
    )
      return;
    try {
      const accepted = onApply(detectedFacetsToDrawing(visibleResult, roofType));
      if (accepted) autoAppliedAddress.current = currentAddress;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Detected facets could not be added.");
      setErrorAddress(currentAddress);
    }
  }, [visibleResult, currentAddress, roofType, onApply]);

  return (
    <section className="space-y-3 rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold">Automatic roof measurement</h3>
          <p className="text-sm text-muted-foreground">
            Checking free public elevation data for this address.
          </p>
        </div>
        <Button onClick={() => void analyze()} disabled={isLoading || !address.trim()}>
          {isLoading ? <Loader2 className="animate-spin" /> : <CloudDownload />}
          {isLoading ? "Measuring…" : "Retry"}
        </Button>
      </div>
      {isLoading && (
        <div className="space-y-2" role="status">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Activity className="size-4 shrink-0" />
              <span>
                {progress?.detail ??
                  (progress?.stage ? STAGE_LABELS[progress.stage] : undefined) ??
                  "Finding available roof data…"}
              </span>
            </div>
            <span className="text-lg font-semibold tabular-nums">{percent}%</span>
          </div>
          <Progress value={percent} aria-label="Measurement progress percent" />
          <p className="text-xs text-muted-foreground">
            Elapsed {formatElapsedClock(elapsedSeconds)} · Large LiDAR downloads can take several
            minutes on a first measurement — the analysis keeps running on the service, no need to
            retry.
          </p>
        </div>
      )}
      {visibleError && (
        <p role="alert" className="text-sm text-destructive">
          {visibleError}
        </p>
      )}
      {visibleCandidates.length > 0 && (
        <div className="space-y-3 rounded-md border border-amber-500/40 p-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <MapPin className="size-4" /> Choose the correct building
          </div>
          <p className="text-xs text-muted-foreground">
            Review each outline and distance. Selecting confirms only the building footprint; LiDAR
            must still detect the roof planes.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {visibleCandidates.map((candidate, index) => (
              <div
                key={candidate.candidate_id}
                className="space-y-2 rounded-md border border-border p-3"
              >
                <CandidateOutline candidate={candidate} />
                <div className="text-sm font-medium">Building option {index + 1}</div>
                <div className="text-xs text-muted-foreground">
                  {candidate.area_sqft.toLocaleString()} sq ft ground footprint ·{" "}
                  {candidate.address_to_footprint_distance_m.toFixed(1)} m from address pin
                </div>
                {candidate.address_point_inside_footprint && (
                  <div className="text-xs text-emerald-700">Address pin is inside this outline</div>
                )}
                <Button
                  className="w-full"
                  size="sm"
                  onClick={() => void analyze(candidate.candidate_id)}
                  disabled={isLoading}
                >
                  {isLoading ? <Loader2 className="animate-spin" /> : null} Select this building
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}
      {visibleResult && (
        <div className="space-y-3">
          {visibleResult.footprint.address_point_inside_footprint === false && (
            <div
              role="alert"
              className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm text-amber-800"
            >
              <strong>Verify the selected building before using these measurements.</strong>
              <p className="mt-1">
                The geocoded address point is outside the selected building outline
                {visibleResult.footprint.address_to_footprint_distance_m !== undefined
                  ? ` by ${visibleResult.footprint.address_to_footprint_distance_m.toFixed(1)} m`
                  : ""}
                . The match is approximate; confirm this is the correct property.
              </p>
            </div>
          )}
          {visibleResult.status === "lidar_facets" ? (
            <div className="flex items-start gap-2 text-sm">
              <CheckCircle2 className="mt-0.5 size-4 text-emerald-600" />
              <div>
                <strong>{visibleResult.roof.facet_count} candidate roof facets detected</strong>
                <p className="text-muted-foreground">
                  {visibleResult.roof.total_squares?.toFixed(2)} squares · Dominant pitch{" "}
                  {visibleResult.roof.dominant_pitch_rise_per_12?.toFixed(1)}:12 · Preliminary LiDAR
                  result
                </p>
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-2 text-sm">
              <AlertTriangle className="mt-0.5 size-4 text-amber-600" />
              <div>
                <strong>Footprint found; roof facets were not measurable</strong>
                <p className="text-muted-foreground">{visibleResult.fallback.message}</p>
                <p className="mt-1">
                  Ground footprint: {visibleResult.fallback.footprint_area_sqft.toLocaleString()} sq
                  ft. This is not roof surface area.
                </p>
              </div>
            </div>
          )}
          <details className="rounded-md border border-border px-3 py-2">
            <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
              View technical detection details
            </summary>
            {visibleResult.lidar && (
              <div className="rounded-md border border-border/70 bg-muted/20 p-3 text-sm">
                <strong>Source-data coverage</strong>
                <p className="mt-1 text-muted-foreground">
                  {visibleResult.lidar.building_class_points !== undefined
                    ? `${visibleResult.lidar.building_class_points.toLocaleString()} unique ASPRS class-6 building points${visibleResult.lidar.raw_building_class_points !== undefined ? ` from ${visibleResult.lidar.raw_building_class_points.toLocaleString()} raw tile returns` : ""}`
                    : "Classified building-point total unavailable"}
                  {visibleResult.lidar.tiles_used !== undefined
                    ? ` · ${visibleResult.lidar.tiles_used} LiDAR tiles used`
                    : ""}
                  {visibleResult.lidar.stac_items !== undefined
                    ? ` · ${visibleResult.lidar.stac_items} coverage records searched`
                    : ""}
                </p>
                {visibleResult.lidar.tile_ids_used &&
                  visibleResult.lidar.tile_ids_used.length > 0 && (
                    <div className="mt-2 text-xs">
                      <strong>USGS 3DEP COPC tiles actually read</strong>
                      <ul className="mt-1 list-inside list-disc break-all text-muted-foreground">
                        {visibleResult.lidar.tile_ids_used.map((tileId) => (
                          <li key={tileId}>{tileId}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                {visibleResult.lidar.duplicate_points_removed !== undefined &&
                  visibleResult.lidar.duplicate_points_removed > 0 && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {visibleResult.lidar.duplicate_points_removed.toLocaleString()} overlapping
                      tile duplicates removed before plane fitting
                    </p>
                  )}
                <p className="mt-1 text-xs text-muted-foreground">
                  Point counts describe available source data, not a measurement-confidence score.
                </p>
              </div>
            )}
            {visibleResult.roof.facets.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b text-muted-foreground">
                      <th className="py-2 pr-3">Facet</th>
                      <th className="py-2 pr-3">LiDAR points</th>
                      <th className="py-2 pr-3">Fit RMSE</th>
                      <th className="py-2 pr-3">Area SF</th>
                      <th className="py-2 pr-3">Squares</th>
                      <th className="py-2 pr-3">Pitch</th>
                      <th className="py-2">Azimuth</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleResult.roof.facets.map((facet) => (
                      <Fragment key={facet.id}>
                        <tr className="border-b border-border/60">
                          <td className="py-2 pr-3">{facet.id}</td>
                          <td className="py-2 pr-3 tabular-nums">
                            {facet.point_count.toLocaleString()}
                          </td>
                          <td className="py-2 pr-3 tabular-nums">
                            {facet.fit_rmse_m !== undefined
                              ? `${(facet.fit_rmse_m * 100).toFixed(1)} cm`
                              : "—"}
                          </td>
                          <td className="py-2 pr-3 tabular-nums">{facet.area_sqft.toFixed(1)}</td>
                          <td className="py-2 pr-3 tabular-nums">{facet.squares.toFixed(2)}</td>
                          <td className="py-2 pr-3 tabular-nums">
                            {facet.pitch_rise_per_12.toFixed(1)}:12 (
                            {facet.pitch_degrees.toFixed(1)}°)
                          </td>
                          <td className="py-2 tabular-nums">{facet.azimuth_degrees.toFixed(0)}°</td>
                        </tr>
                        <tr className="border-b border-border/60">
                          <td colSpan={7} className="pb-3 pt-1">
                            <details className="text-xs">
                              <summary className="cursor-pointer text-muted-foreground">
                                View measured facet boundary geometry (latitude, longitude,
                                elevation m)
                              </summary>
                              <pre className="mt-2 max-h-48 overflow-auto rounded bg-muted p-2 text-[11px]">
                                {JSON.stringify(facet.boundary_latlon, null, 2)}
                              </pre>
                            </details>
                          </td>
                        </tr>
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </details>
          {isMiramarBenchmark && (
            <div className="rounded-md border border-border p-3 text-sm">
              <strong>RoofSnap benchmark comparison</strong>
              <p className="mt-1 text-muted-foreground">
                RoofSnap reference: 4,748 sq ft (47.48 squares), main pitch 6/12.
              </p>
              {visibleResult.status === "lidar_facets" &&
              visibleResult.roof.area_sqft !== null &&
              visibleResult.roof.dominant_pitch_rise_per_12 !== null ? (
                <div className="mt-2 grid gap-1 sm:grid-cols-2">
                  <p>
                    LiDAR: <strong>{visibleResult.roof.area_sqft.toLocaleString()} sq ft</strong>
                  </p>
                  <p>
                    Area difference:{" "}
                    <strong>
                      {(visibleResult.roof.area_sqft - 4748).toLocaleString(undefined, {
                        maximumFractionDigits: 1,
                      })}{" "}
                      sq ft ({(((visibleResult.roof.area_sqft - 4748) / 4748) * 100).toFixed(2)}%)
                    </strong>
                  </p>
                  <p>
                    LiDAR dominant pitch:{" "}
                    <strong>{visibleResult.roof.dominant_pitch_rise_per_12.toFixed(1)}:12</strong>
                  </p>
                  <p>
                    Pitch difference:{" "}
                    <strong>
                      {(visibleResult.roof.dominant_pitch_rise_per_12 - 6).toFixed(1)} rise/12
                    </strong>
                  </p>
                </div>
              ) : (
                <p className="mt-2 text-amber-700">
                  Comparison pending: actual LiDAR facets and roof surface area are not available
                  for this run.
                </p>
              )}
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            {visibleResult.disclaimer} Edge classifications are estimated from the LiDAR facet
            geometry; review them in the measurement editor before relying on the report.
          </p>
          {visibleResult.roof.facets.length > 0 && (
            <p className="text-sm text-muted-foreground" role="status">
              Preliminary roof planes added. Review the drawing before saving.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
