import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { analysisProgressPercent } from "@/lib/analysis-progress";
import { roofCoverFraming, type AerialPhoto } from "@/lib/aerial-photo";
import {
  requestAnalysis,
  roofDetectionApiBase,
  type AnalysisProgress,
  type BuildingCandidate,
} from "@/lib/roof-analysis";
import {
  detectedFacetsToDrawing,
  roofDetectionResponseSchema,
  structureToDrawing,
} from "@/lib/roof-detection";
import { restoreRoofDrawingMedia, type RoofDrawingMedia } from "@/lib/roof-drawing-media";
import {
  drawingSchema,
  measureDrawing,
  type DetachedStructure,
  type RoofDrawing,
} from "@/lib/roof-geometry";
import { parseIncludeOutbuilding, parseMeasurementPin } from "@/lib/roof-order-notes";

/**
 * Hands-off completion for roof report orders: a report that was
 * created by address but never opened (or whose measurement job was
 * lost before the workspace could finish it) completes itself —
 * measure through the detection jobs API, save the drawing revision,
 * generate the report PDF and attach it — with no click anywhere.
 * The steps mirror the report workspace's automatic chain
 * (AutomatedRoofReport applying into RoofMeasurements' armed save +
 * exportPdf) so a list-finished report is indistinguishable from a
 * workspace-finished one.
 */

export type RoofReportOrderRow = Database["public"]["Tables"]["roof_report_orders"]["Row"];
export type RoofDrawingRow = Database["public"]["Tables"]["roof_drawings"]["Row"];

export type AutoFinishProgress =
  | {
      phase: "measuring";
      stage: string | null;
      detail: string | null;
      percent: number;
      elapsedSeconds: number;
    }
  | { phase: "saving" }
  | { phase: "building-pdf" };

export type AutoFinishOutcome =
  | { kind: "done" }
  | { kind: "candidates"; candidates: BuildingCandidate[]; message: string }
  | { kind: "unmeasurable"; message: string }
  | { kind: "error"; message: string };

export type AutoFinishDeps = {
  /** Bound saveRoofDrawing server function (workspace uses the same). */
  saveDrawing: (args: {
    data: {
      property_id: string;
      title: string;
      geometry: RoofDrawing;
      parent_id: string | null;
      media: RoofDrawingMedia[];
      report_order_id: string;
    };
  }) => Promise<unknown>;
  /** Bound attachRoofOrderPdf server function. */
  attachPdf: (args: { data: { id: string; path: string; updated_at: string } }) => Promise<unknown>;
  /** Bound loadReportAerial server function (report cover photo). */
  loadAerial: (args: {
    data: { latitude: number; longitude: number; halfExtentMeters?: number };
  }) => Promise<unknown>;
  onProgress?: (update: AutoFinishProgress) => void;
};

/** A report still owes an automatic measurement: one of our own
 * address-created orders (external-provider orders are fulfilled by
 * the provider, never by the detection service), not cancelled or
 * already reviewed, with no report PDF attached yet. */
export function reportNeedsAutoFinish(order: {
  provider: string;
  status: string;
  file_path: string | null;
}): boolean {
  return order.provider === "manual" && order.status === "requested" && !order.file_path;
}

// A fresh report workspace starts from the gable preset, whose roof
// type is "Metal Roof"; a headless finish converts detected facets
// with the same type so the saved drawing matches what opening the
// report would have produced.
const FRESH_WORKSPACE_ROOF_TYPE: RoofDrawing["roof_type"] = "Metal Roof";

type ReportPhoto = {
  bytes: Uint8Array;
  mime: string;
  category: string;
  name: string;
  source?: string;
  matchedAddress?: string;
  latitude?: number;
  longitude?: number;
};

/** Assemble the report PDF photos exactly like the workspace export:
 * the drawing's stored job photos first, then a free aerial cover
 * photo fetched for the drawing's geographic origin when the job has
 * none. Imagery is best-effort and never blocks the report. */
async function collectReportPhotos(
  drawing: RoofDrawing,
  media: RoofDrawingMedia[],
  loadAerial: AutoFinishDeps["loadAerial"],
): Promise<ReportPhoto[]> {
  const photos: ReportPhoto[] = [];
  for (const item of media) {
    const { data: blob, error: photoError } = await supabase.storage
      .from("roof-job-photos")
      .download(item.path);
    if (photoError || !blob) throw new Error("Photo could not load");
    let photoBytes = new Uint8Array(await blob.arrayBuffer());
    let mime = blob.type;
    if (mime === "image/webp") {
      const bitmap = await createImageBitmap(blob);
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Photo conversion failed");
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();
      const converted = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/png"),
      );
      if (!converted) throw new Error("Photo conversion failed");
      photoBytes = new Uint8Array(await converted.arrayBuffer());
      mime = "image/png";
    }
    photos.push({
      bytes: photoBytes,
      mime,
      category: item.category,
      name: item.name,
      ...(item.source ? { source: item.source } : {}),
      ...(item.matched_address ? { matchedAddress: item.matched_address } : {}),
      ...(typeof item.latitude === "number" ? { latitude: item.latitude } : {}),
      ...(typeof item.longitude === "number" ? { longitude: item.longitude } : {}),
    });
  }
  if (!photos.some((photo) => /aerial/i.test(photo.category)) && drawing.geo_reference) {
    const { originLatitude, originLongitude } = drawing.geo_reference;
    const framing = roofCoverFraming({
      planes: drawing.planes,
      geo_reference: drawing.geo_reference,
    });
    const coverLatitude = framing?.latitude ?? originLatitude;
    const coverLongitude = framing?.longitude ?? originLongitude;
    let aerial: AerialPhoto | null = null;
    try {
      const result = (await loadAerial({
        data: {
          latitude: coverLatitude,
          longitude: coverLongitude,
          ...(framing ? { halfExtentMeters: framing.halfExtentMeters } : {}),
        },
      })) as {
        imageBase64?: string;
        mime: string;
        source: string;
        latitude: number;
        longitude: number;
      } | null;
      if (result && "imageBase64" in result && result.imageBase64) {
        const binary = atob(result.imageBase64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        aerial = {
          bytes,
          mime: result.mime,
          category: "aerial",
          name: "Aerial photo (Esri World Imagery)",
          source: result.source,
          latitude: result.latitude,
          longitude: result.longitude,
        };
      }
    } catch {
      // Fall through to the client-side stitch.
    }
    if (!aerial) {
      try {
        const { fetchAerialPhoto } = await import("@/lib/aerial-photo");
        aerial = await fetchAerialPhoto(coverLatitude, coverLongitude, framing?.halfExtentMeters);
      } catch {
        // Imagery is best-effort; never block the report on it.
      }
    }
    if (aerial) photos.unshift(aerial);
  }
  return photos;
}

/** Generate the report PDF from a saved drawing and attach it to the
 * order, mirroring the workspace export's report branch: upload under
 * roof-report/<id>/, then attach against the order's fresh
 * updated_at so a concurrent edit wins honestly instead of being
 * overwritten. */
async function generateAndAttachReportPdf(
  deps: AutoFinishDeps,
  order: RoofReportOrderRow,
  drawing: RoofDrawing,
  media: RoofDrawingMedia[],
  title: string,
  customerName: string,
): Promise<void> {
  const photos = await collectReportPhotos(drawing, media, deps.loadAerial);
  const { roofDrawingPdf } = await import("@/lib/roof-drawing-pdf");
  const bytes = await roofDrawingPdf(
    title,
    drawing,
    order.title || customerName,
    order.address,
    photos,
    { phone: order.customer_phone ?? "", email: order.customer_email ?? "" },
    // Same generator defaults the workspace export uses (RoofSnap
    // Classic theme, medium logo).
    { theme: "roofsnap", logoScale: 1 },
  );
  let path: string | null = `roof-report/${order.id}/${crypto.randomUUID()}.pdf`;
  try {
    const { error: uploadError } = await supabase.storage
      .from("roofing-proposals")
      .upload(path, new Blob([Uint8Array.from(bytes)], { type: "application/pdf" }), {
        contentType: "application/pdf",
      });
    if (uploadError) throw uploadError;
    const { data: currentReport, error: currentReportError } = await supabase
      .from("roof_report_orders")
      .select("updated_at")
      .eq("id", order.id)
      .maybeSingle();
    if (currentReportError || !currentReport)
      throw new Error("Could not refresh the roof report before attaching its PDF");
    await deps.attachPdf({
      data: { id: order.id, path, updated_at: currentReport.updated_at },
    });
    path = null;
  } catch (cause) {
    if (path) {
      await supabase.storage
        .from("roofing-proposals")
        .remove([path])
        .then(undefined, () => undefined);
    }
    throw cause;
  }
}

/**
 * Finish one report end to end. Aborting the signal (the reports list
 * unmounted) rejects with the abort error so the caller can quietly
 * reset and let a later visit resume; every other failure is reported
 * as an outcome, never thrown.
 */
export async function finishRoofReport(
  deps: AutoFinishDeps,
  input: { order: RoofReportOrderRow; drawingRow: RoofDrawingRow | null; customerName: string },
  signal: AbortSignal,
): Promise<AutoFinishOutcome> {
  try {
    return await runFinish(deps, input, signal);
  } catch (cause) {
    if (signal.aborted) throw cause;
    return {
      kind: "error",
      message:
        cause instanceof Error ? cause.message : "Automatic measurement could not be completed.",
    };
  }
}

async function runFinish(
  deps: AutoFinishDeps,
  input: { order: RoofReportOrderRow; drawingRow: RoofDrawingRow | null; customerName: string },
  signal: AbortSignal,
): Promise<AutoFinishOutcome> {
  const { order, drawingRow, customerName } = input;
  const title = order.title?.trim() ? order.title : "Roof measurement report";

  // Drawing already saved (the workspace measured it but the PDF step
  // never ran): skip straight to generating and attaching the PDF.
  if (order.drawing_id && drawingRow && drawingRow.id === order.drawing_id) {
    const parsed = drawingSchema.safeParse(drawingRow.geometry);
    if (!parsed.success) {
      return {
        kind: "error",
        message: "The saved roof drawing could not be read. Open the report to review it.",
      };
    }
    deps.onProgress?.({ phase: "building-pdf" });
    await generateAndAttachReportPdf(
      deps,
      order,
      parsed.data,
      restoreRoofDrawingMedia(drawingRow.media),
      title,
      customerName,
    );
    return { kind: "done" };
  }

  if (!order.property_id) {
    return {
      kind: "error",
      message: "This report has no linked property, so it cannot be measured automatically.",
    };
  }

  // Measure: run the detection jobs API with the same overall-progress
  // clock the workspace shows (stage bands + elapsed creep), so the
  // reports list can display the same honest percent.
  const clock = {
    stage: "queued" as string | null,
    stageSince: Date.now(),
    percent: analysisProgressPercent({ status: "queued", stage: "queued" }),
    downloadFraction: null as number | null,
  };
  const runStartedAt = Date.now();
  let lastDetail: string | null = null;
  const emitProgress = () => {
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
    deps.onProgress?.({
      phase: "measuring",
      stage: clock.stage,
      detail: lastDetail,
      percent: next,
      elapsedSeconds: Math.max(0, (Date.now() - runStartedAt) / 1000),
    });
  };
  const handleProgress = (next: AnalysisProgress) => {
    if (next.stage === "resubmitting") {
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
    lastDetail = next.detail;
    emitProgress();
  };
  emitProgress();
  const ticker = window.setInterval(emitProgress, 1000);
  let outcome;
  try {
    const pin = parseMeasurementPin(order.notes);
    outcome = await requestAnalysis(
      roofDetectionApiBase(),
      {
        street_address: order.address.trim(),
        ...(pin ? { pin_lat: pin.lat, pin_lon: pin.lon } : {}),
        ...(parseIncludeOutbuilding(order.notes) ? { include_outbuilding: true } : {}),
      },
      signal,
      handleProgress,
    );
  } finally {
    window.clearInterval(ticker);
  }
  if (outcome.kind === "candidates") {
    // Picking the right building is a genuine human decision; the
    // report stays put and the card says what is needed.
    return { kind: "candidates", candidates: outcome.candidates, message: outcome.message };
  }
  if (outcome.kind === "error") return { kind: "error", message: outcome.message };

  const result = roofDetectionResponseSchema.parse(outcome.body);
  if (result.status !== "lidar_facets" || result.roof.facets.length === 0) {
    return {
      kind: "unmeasurable",
      message:
        result.fallback.message ??
        "Public LiDAR data could not measure this roof, so there is nothing to save automatically.",
    };
  }

  // Convert exactly like the workspace's apply step: detached
  // structures ride inside the main drawing, each converted through
  // the shared converter, failures skipped individually.
  const detachedStructures: DetachedStructure[] = [];
  for (const structure of result.structures ?? []) {
    if (structure.role !== "detached" || structure.status !== "lidar_facets") continue;
    try {
      detachedStructures.push({
        label: structure.label,
        candidate_id: structure.candidate_id,
        drawing: structureToDrawing(result, structure, FRESH_WORKSPACE_ROOF_TYPE),
      });
    } catch {
      // Skip the unconvertible structure; the main drawing applies.
    }
  }
  const detected = detectedFacetsToDrawing(result, FRESH_WORKSPACE_ROOF_TYPE);
  const drawing: RoofDrawing = {
    ...detected,
    ...(detachedStructures.length
      ? {
          detached_structures: detachedStructures.map((structure) => ({
            ...structure,
            drawing: {
              ...structure.drawing,
              roof_type: detected.roof_type,
              waste: detected.waste,
              condition: detected.condition,
            },
          })),
        }
      : {}),
  };
  // Validate externally sourced geometry before it is saved, exactly
  // as the workspace does before arming its automatic save.
  measureDrawing(drawing);

  deps.onProgress?.({ phase: "saving" });
  await deps.saveDrawing({
    data: {
      property_id: order.property_id,
      title,
      geometry: drawing,
      parent_id: order.drawing_id ?? null,
      media: [],
      report_order_id: order.id,
    },
  });

  deps.onProgress?.({ phase: "building-pdf" });
  await generateAndAttachReportPdf(deps, order, drawing, [], title, customerName);
  return { kind: "done" };
}
