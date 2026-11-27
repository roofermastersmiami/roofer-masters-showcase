import type { RoofAnalysisJob } from "@/lib/roof-detection";

/**
 * Hands-off roof analysis against the detection service's background
 * jobs API: submit a job, poll it to completion, and resubmit
 * automatically when the service loses the job (restart) or stalls
 * past the deadline. This is the single analysis path for the CRM —
 * the pre-jobs synchronous `/v1/roof/analyze` fallback was removed
 * with the rest of the old system, so a measurement either runs
 * through the jobs API or reports that the service is unavailable.
 */

// Keep the public free detection service reachable in published builds even when
// the frontend host has not been given a VITE_* build variable. The environment
// value remains an optional override for staging or a future service migration.
const DEFAULT_ROOF_DETECTION_API_URL = "https://roofer-masters-roof-detection-w909.onrender.com";

export function roofDetectionApiBase() {
  const configuredBase = import.meta.env["VITE_ROOF_DETECTION_API_URL"]?.trim();
  return (configuredBase || DEFAULT_ROOF_DETECTION_API_URL).replace(/\/+$/, "");
}

export type BuildingCandidate = {
  candidate_id: string;
  provider?: string;
  source_id?: string | number | null;
  area_sqft: number;
  address_point_inside_footprint: boolean;
  address_to_footprint_distance_m: number;
  centroid: { lat: number; lon: number };
  polygon_geojson: { type: "Polygon"; coordinates: number[][][] };
};

export type AnalysisProgress = {
  stage: string | null;
  detail: string | null;
  downloadFraction: number | null;
};

export type AnalysisOutcome =
  | { kind: "result"; body: unknown }
  | { kind: "candidates"; candidates: BuildingCandidate[]; message: string }
  | { kind: "error"; message: string };

export const POLL_INTERVAL_MS = 3000;
export const JOB_DEADLINE_MS = 45 * 60 * 1000;
// A job can vanish mid-flight when the free-tier service restarts (job
// state is in-memory) or when a polling deadline passes; resubmission is
// automatic and cheap because finished tile downloads stay cached on the
// service, so the user never has to retry by hand.
export const MAX_JOB_RESUBMITS = 3;

export function candidatesFromDetail(detail: unknown): BuildingCandidate[] | null {
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

export function messageFromDetail(detail: unknown, fallback: string): string {
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

export function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
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

/** Run one address analysis hands-off through the jobs API. A failed
 * submission (service restarting, network drop) is retried inside the
 * same resubmit budget as a lost job instead of falling back to the
 * removed synchronous endpoint. */
export async function requestAnalysis(
  base: string,
  payload: Record<string, unknown>,
  signal: AbortSignal,
  onProgress: (progress: AnalysisProgress) => void,
): Promise<AnalysisOutcome> {
  let resubmits = 0;
  let deadline = Date.now() + JOB_DEADLINE_MS;
  let lastSubmitMessage: string | null = null;
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
      } else {
        const body: unknown = await submit.json().catch(() => null);
        const detail = body && typeof body === "object" && "detail" in body ? body.detail : null;
        lastSubmitMessage = messageFromDetail(
          detail,
          `Roof detection request failed (${submit.status}).`,
        );
      }
    } catch (cause) {
      if (signal.aborted) throw cause;
      jobId = null;
    }
    if (!jobId) {
      resubmits += 1;
      if (resubmits > MAX_JOB_RESUBMITS) {
        return {
          kind: "error",
          message:
            lastSubmitMessage ??
            "The measurement service could not accept the measurement job. Wait a minute and try again.",
        };
      }
      onProgress({
        stage: "resubmitting",
        detail: "The measurement service is restarting — resubmitting automatically…",
        downloadFraction: null,
      });
      deadline = Date.now() + JOB_DEADLINE_MS;
      continue;
    }

    let lost = false;
    while (!lost) {
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      let job: RoofAnalysisJob | null = null;
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
