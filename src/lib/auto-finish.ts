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
 *
 * This engine is the ONLY component that generates and attaches
 * report PDFs (the one-finisher rule, 2026-11-27). A report's
 * workspace measures and saves its drawing revision, then hands the
 * PDF step over (see use-auto-finish's claim registry and PDF
 * refresh intents); it never attaches a PDF itself. Two chains used
 * to run the same finish — the workspace's and this one — and every
 * write bumps the order's updated_at, so their optimistic-
 * concurrency attaches kept staling each other into terminal errors
 * for reports that had actually finished. With one writer left, the
 * attach below still reconciles against fresh reads, because a
 * drawing save (the workspace's one remaining write) can land while
 * a PDF is being generated.
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
  | { kind: "done"; filePath?: string }
  | { kind: "candidates"; candidates: BuildingCandidate[]; message: string }
  | { kind: "unmeasurable"; message: string }
  | { kind: "superseded" }
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

/** The stale-version rejection attachRoofOrderPdf raises when the
 * order's updated_at has moved since the caller read it (see
 * src/lib/roof-orders.functions.ts). The finish chain treats it as a
 * race to reconcile, not a failure — see attachReportPdf below. */
const STALE_ATTACH_MESSAGE = "Reload the report request before attaching this PDF";

function isStaleAttachError(cause: unknown): boolean {
  return cause instanceof Error && cause.message.includes(STALE_ATTACH_MESSAGE);
}

type OrderState = {
  updated_at: string;
  file_path: string | null;
  status: string;
  drawing_id: string | null;
};

/** Re-read the order fields the finish decisions need. */
async function readOrderState(orderId: string): Promise<OrderState> {
  const { data, error } = await supabase
    .from("roof_report_orders")
    .select("updated_at, file_path, status, drawing_id")
    .eq("id", orderId)
    .maybeSingle();
  if (error || !data) throw new Error("Could not refresh the roof report before attaching its PDF");
  return data as OrderState;
}

/** Load one saved drawing row by id (the fresh-read at chain start
 * can discover a drawing the caller's snapshot predates). */
async function readDrawingRow(drawingId: string): Promise<RoofDrawingRow | null> {
  const { data, error } = await supabase
    .from("roof_drawings")
    .select("*")
    .eq("id", drawingId)
    .maybeSingle();
  if (error || !data) return null;
  return data as RoofDrawingRow;
}

function throwIfAborted(signal: AbortSignal) {
  if (signal.aborted) throw new Error("Automatic measurement was handed off before it finished.");
}

type AttachResult =
  | { kind: "attached"; path: string; previousPath: string | null }
  | { kind: "already"; path: string }
  | { kind: "superseded" };

const MAX_ATTACH_ROUNDS = 4;

/**
 * Attach the generated PDF, reconciling against fresh order reads
 * until the report's state settles — the convergence loop that
 * replaced #247's single retry (which Fredy's live test defeated:
 * the workspace's chain kept writing, the report's version moved
 * under the first attach AND the retry, and the card recorded a
 * terminal error for a report that finished a moment later).
 *
 * Every round re-reads the order and decides from its CURRENT
 * state, never from the caller's snapshot:
 *  - the order already carries THIS chain's path → the attach
 *    landed (an earlier round's response was lost); done.
 *  - the order carries a PDF this chain did not produce, for the
 *    drawing still current → another finisher completed the
 *    report; resolve "already" (the caller drops its duplicate
 *    upload and the finish reports success — the report IS done).
 *  - the order's drawing moved past the one this PDF was generated
 *    from, with no newer PDF attached → this PDF is stale before it
 *    lands; resolve "superseded" so a fresh attempt PDFs the
 *    current drawing instead of overwriting it with an old one.
 *  - otherwise attach against the freshly read version; a stale
 *    rejection just starts the next round.
 * Only a report that is still unfinished, still on the same
 * drawing, and still moving after every round is a genuine
 * failure, worded honestly.
 */
async function attachReportPdf(
  deps: AutoFinishDeps,
  order: RoofReportOrderRow,
  path: string,
  drawingId: string | null,
  startFilePath: string | null,
  signal: AbortSignal,
): Promise<AttachResult> {
  for (let round = 0; round < MAX_ATTACH_ROUNDS; round++) {
    throwIfAborted(signal);
    const state = await readOrderState(order.id);
    if (state.file_path === path) {
      return { kind: "attached", path, previousPath: startFilePath };
    }
    const drawingMoved =
      state.drawing_id != null && drawingId != null && state.drawing_id !== drawingId;
    if (drawingMoved) {
      // A newer drawing is current. If a PDF this chain did not
      // start with is already attached, the report is finished for
      // that drawing — done. Otherwise this chain's PDF belongs to
      // a superseded drawing and must not land.
      if (state.file_path && state.file_path !== startFilePath) {
        return { kind: "already", path: state.file_path };
      }
      return { kind: "superseded" };
    }
    if (state.file_path && state.file_path !== startFilePath) {
      // Same drawing, but a PDF this chain did not produce is
      // attached (another finisher — a second tab, a resumed
      // session — completed the report): done, with their PDF.
      return { kind: "already", path: state.file_path };
    }
    try {
      await deps.attachPdf({ data: { id: order.id, path, updated_at: state.updated_at } });
      // The file this attach replaces: the one this round's read
      // saw on the order, or — when that read predates it — the one
      // the chain started with.
      return { kind: "attached", path, previousPath: state.file_path ?? startFilePath };
    } catch (cause) {
      if (!isStaleAttachError(cause)) throw cause;
      // The version moved under the attach; loop and reconcile
      // against the fresh state instead of giving up.
    }
  }
  const final = await readOrderState(order.id);
  if (final.file_path === path) return { kind: "attached", path, previousPath: startFilePath };
  if (final.file_path && final.file_path !== startFilePath) {
    return { kind: "already", path: final.file_path };
  }
  if (final.drawing_id != null && drawingId != null && final.drawing_id !== drawingId) {
    return { kind: "superseded" };
  }
  throw new Error(
    "The report changed while it was finishing — reload the report request before attaching this PDF.",
  );
}

/**
 * Generate the report PDF from a saved drawing and attach it to the
 * order. Returns the path of the PDF the report ends up carrying,
 * or "superseded" when a newer drawing replaced the one this PDF
 * was generated from (the caller lets a fresh attempt finish that
 * drawing). A superseded file from before this chain (a PDF-refresh
 * regenerating an on-file report) is removed once the new PDF is
 * attached, so storage never keeps orphaned report PDFs; this
 * chain's own upload is removed whenever it does not land.
 */
async function generateAndAttachReportPdf(
  deps: AutoFinishDeps,
  order: RoofReportOrderRow,
  drawing: RoofDrawing,
  media: RoofDrawingMedia[],
  title: string,
  customerName: string,
  drawingId: string | null,
  startFilePath: string | null,
  signal: AbortSignal,
): Promise<{ filePath: string } | { superseded: true }> {
  const photos = await collectReportPhotos(drawing, media, deps.loadAerial);
  const { roofDrawingPdf } = await import("@/lib/roof-drawing-pdf");
  const bytes = await roofDrawingPdf(
    title,
    drawing,
    order.title || customerName,
    order.address,
    photos,
    { phone: order.customer_phone ?? "", email: order.customer_email ?? "" },
    // Same generator defaults the workspace export used (RoofSnap
    // Classic theme, medium logo).
    { theme: "roofsnap", logoScale: 1 },
  );
  throwIfAborted(signal);
  const path = `roof-report/${order.id}/${crypto.randomUUID()}.pdf`;
  const removeOwnUpload = () =>
    supabase.storage
      .from("roofing-proposals")
      .remove([path])
      .then(undefined, () => undefined);
  try {
    const { error: uploadError } = await supabase.storage
      .from("roofing-proposals")
      .upload(path, new Blob([Uint8Array.from(bytes)], { type: "application/pdf" }), {
        contentType: "application/pdf",
      });
    if (uploadError) throw uploadError;
    const result = await attachReportPdf(deps, order, path, drawingId, startFilePath, signal);
    if (result.kind === "attached") {
      if (result.previousPath && result.previousPath !== path) {
        await supabase.storage
          .from("roofing-proposals")
          .remove([result.previousPath])
          .then(undefined, () => undefined);
      }
      return { filePath: path };
    }
    await removeOwnUpload();
    if (result.kind === "already") return { filePath: result.path };
    return { superseded: true };
  } catch (cause) {
    await removeOwnUpload();
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
  input: {
    order: RoofReportOrderRow;
    drawingRow: RoofDrawingRow | null;
    customerName: string;
    /** PDF-refresh mode: the workspace re-saved this drawing over a
     * report that already carries a PDF, and handed the regenerate +
     * re-attach step to the engine. The chain runs the drawing-saved
     * path for exactly this drawing even though a PDF is on file. */
    refreshDrawingId?: string;
  },
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
  input: {
    order: RoofReportOrderRow;
    drawingRow: RoofDrawingRow | null;
    customerName: string;
    refreshDrawingId?: string;
  },
  signal: AbortSignal,
): Promise<AutoFinishOutcome> {
  const { customerName } = input;
  const refreshDrawingId = input.refreshDrawingId ?? null;
  let order = input.order;
  let drawingRow = input.drawingRow;
  const title = order.title?.trim() ? order.title : "Roof measurement report";

  // Fresh read before any work: the caller's snapshot can predate a
  // write that already finished — or already measured — this report
  // (the workspace saved its drawing while this attempt sat in the
  // queue). Acting on the snapshot anyway is what submitted
  // duplicate measurements and re-saved drawings over fresher ones.
  // A failed read falls back to the snapshot; the attach loop
  // re-reads before writing regardless.
  let fresh: OrderState | null = null;
  try {
    fresh = await readOrderState(order.id);
  } catch {
    fresh = null;
  }
  if (fresh) {
    if (!refreshDrawingId && fresh.file_path) {
      // Finished while this attempt waited — nothing to do, and
      // certainly nothing to record as an error.
      return { kind: "done", filePath: fresh.file_path };
    }
    if (refreshDrawingId && fresh.drawing_id && fresh.drawing_id !== refreshDrawingId) {
      // A newer drawing landed before the refresh even started;
      // the caller re-queues for the current one. (A read without a
      // drawing id proves nothing — fall through and let the
      // caller's drawing drive.)
      return { kind: "superseded" };
    }
    const currentDrawingId = refreshDrawingId ?? fresh.drawing_id;
    if (currentDrawingId) {
      // Finish the order's CURRENT drawing, not the snapshot's:
      // reload the row whenever the snapshot's is missing or stale.
      if (!drawingRow || drawingRow.id !== currentDrawingId) {
        drawingRow = await readDrawingRow(currentDrawingId);
      }
      if (!drawingRow) {
        return {
          kind: "error",
          message: "The saved roof drawing could not be read. Open the report to review it.",
        };
      }
      if (order.drawing_id !== currentDrawingId) {
        order = { ...order, drawing_id: currentDrawingId };
      }
    }
  }

  // Drawing already saved (the workspace measured it and handed the
  // PDF step over): skip straight to generating and attaching the
  // PDF. This is also the refresh path — the drawing is the same,
  // only the on-file PDF predates it.
  if (order.drawing_id && drawingRow && drawingRow.id === order.drawing_id) {
    const parsed = drawingSchema.safeParse(drawingRow.geometry);
    if (!parsed.success) {
      return {
        kind: "error",
        message: "The saved roof drawing could not be read. Open the report to review it.",
      };
    }
    deps.onProgress?.({ phase: "building-pdf" });
    const attached = await generateAndAttachReportPdf(
      deps,
      order,
      parsed.data,
      restoreRoofDrawingMedia(drawingRow.media),
      title,
      customerName,
      drawingRow.id,
      order.file_path,
      signal,
    );
    if ("superseded" in attached) return { kind: "superseded" };
    return { kind: "done", filePath: attached.filePath };
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

  // A hand-off (the workspace opened, a claim landed) aborts the
  // signal; honor it between phases, not just during the service
  // measurement, so a handed-off chain stops writing promptly.
  throwIfAborted(signal);
  deps.onProgress?.({ phase: "saving" });
  const saved = (await deps.saveDrawing({
    data: {
      property_id: order.property_id,
      title,
      geometry: drawing,
      parent_id: order.drawing_id ?? null,
      media: [],
      report_order_id: order.id,
    },
  })) as { id?: string } | null;
  // The drawing this chain just saved is the one its PDF belongs
  // to; the attach loop reconciles against it. The save's return
  // carries the new revision's id; a fresh read is the fallback.
  let savedDrawingId = saved?.id ?? null;
  if (!savedDrawingId) {
    try {
      savedDrawingId = (await readOrderState(order.id)).drawing_id;
    } catch {
      savedDrawingId = null;
    }
  }

  throwIfAborted(signal);
  deps.onProgress?.({ phase: "building-pdf" });
  const attached = await generateAndAttachReportPdf(
    deps,
    order,
    drawing,
    [],
    title,
    customerName,
    savedDrawingId,
    order.file_path,
    signal,
  );
  if ("superseded" in attached) return { kind: "superseded" };
  return { kind: "done", filePath: attached.filePath };
}
