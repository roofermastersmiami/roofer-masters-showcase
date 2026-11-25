import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Plus,
  Save,
  Download,
  Undo2,
  Redo2,
  RotateCcw,
  Play,
  Pause,
  Trash2,
  ArrowRight,
  FileText,
  Upload,
  MapPin,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import {
  drawingSchema,
  roofPreset,
  measureDrawing,
  auditRoofReport,
  toMaterialReport,
  distance,
  addressPinPosition,
  rebaseRoofPlanes,
  EDGE_TYPES,
  suggestSharedEdgeClassifications,
  type RoofDrawing,
  type RoofShape,
} from "@/lib/roof-geometry";
import { calculateRoofSummary, measuredEdgeTotalsToInputs } from "@/lib/roof-calculations";
import { saveRoofDrawing } from "@/lib/roof-drawing.functions";
import { restoreRoofDrawingMedia, type RoofDrawingMedia } from "@/lib/roof-drawing-media";
import { attachRoofOrderPdf } from "@/lib/roof-orders.functions";
import { propertiesQuery, customersQuery } from "./foundation-data";
import { drawingsQuery } from "./roof-data";
import { jobsQuery } from "./operations-data";
import { materialOrderForTransfer } from "@/lib/material-order";
import { Choice, Field, SectionHeading } from "./CrmControls";
import { useCrm } from "./CrmContext";
import type { RoofOrder } from "./roof-orders-data";
import type { Database } from "@/integrations/supabase/types";
import { RoofImageTrace } from "./RoofImageTrace";
import { SatelliteRoofTrace } from "./SatelliteRoofTrace";
import { AutomatedRoofReport } from "./AutomatedRoofReport";
import { loadPublicAerial } from "@/lib/public-aerial.functions";
import { findBuildingFootprints } from "@/lib/building-footprint.functions";
import {
  footprintToDraftPlane,
  shouldAutoSearchFootprint,
  type BuildingFootprint,
} from "@/lib/building-footprint";
import {
  uploadAerialImage,
  aerialInvocationError,
  shouldAutoLoadAddressAerial,
  addressAerialRequestKey,
} from "@/lib/public-aerial-import";
import { ACCURACY_LABELS, type Accuracy } from "@/lib/public-aerial";
import {
  PENETRATION_COLORS,
  ROOF_EDGE_STYLES,
  ROOF_FEATURE_LEGEND,
} from "@/lib/roof-feature-styles";
import { DrawingErrorBoundary } from "./DrawingErrorBoundary";
const Scene = lazy(() => import("./RoofScene"));
const initial = roofPreset("gable");
type Media = RoofDrawingMedia;
export function RoofMeasurements({
  report,
  initialDrawing = null,
}: {
  report?: RoofOrder;
  initialDrawing?: Database["public"]["Tables"]["roof_drawings"]["Row"] | null;
}) {
  const stored = drawingSchema.safeParse(initialDrawing?.geometry);
  const starting = stored.success ? stored.data : { ...initial, notes: report?.notes ?? "" };
  const vertices = starting.planes.flatMap((p) => p.points);
  const startWidth = Math.max(...vertices.map((v) => v.x)) - Math.min(...vertices.map((v) => v.x));
  const startLength = Math.max(...vertices.map((v) => v.z)) - Math.min(...vertices.map((v) => v.z));
  let startPitch = 6;
  try {
    startPitch = measureDrawing(starting).planes[0]?.pitch ?? 6;
  } catch {
    // Keep the default pitch when saved geometry cannot be measured.
  }
  const properties = useQuery(propertiesQuery),
    customers = useQuery(customersQuery),
    drawings = useQuery(drawingsQuery),
    jobs = useQuery(jobsQuery),
    qc = useQueryClient();
  const saveFn = useServerFn(saveRoofDrawing);
  const attachPdfFn = useServerFn(attachRoofOrderPdf);
  const aerialFn = useServerFn(loadPublicAerial);
  const footprintFn = useServerFn(findBuildingFootprints);
  const [traceIndex, setTraceIndex] = useState(0);
  const userEditedDrawing = useRef(false);
  const { go } = useCrm();
  const [d, setD] = useState<RoofDrawing>(starting),
    [history, setHistory] = useState<RoofDrawing[]>([]),
    [future, setFuture] = useState<RoofDrawing[]>([]),
    [selected, setSelected] = useState(starting.planes[0]?.id ?? ""),
    [property, setProperty] = useState(report?.property_id ?? ""),
    [title, setTitle] = useState(report?.title ?? "Roof measurement report"),
    [parent, setParent] = useState<string | null>(initialDrawing?.id ?? null),
    [dirty, setDirty] = useState(!initialDrawing),
    [busy, setBusy] = useState(false),
    [view, setView] = useState<"3d" | "plan">("3d"),
    [autoRotate, setAutoRotate] = useState(true),
    [fit, setFit] = useState(0),
    [zoomDirection, setZoomDirection] = useState<"in" | "out">("in"),
    [zoomKey, setZoomKey] = useState(0),
    [shape, setShape] = useState<RoofShape>("gable"),
    [width, setWidth] = useState(startWidth),
    [length, setLength] = useState(startLength),
    [pitch, setPitch] = useState(startPitch),
    [jobId, setJobId] = useState(""),
    [media, setMedia] = useState<Media[]>(() => restoreRoofDrawingMedia(initialDrawing?.media));
  const [aerialImageUrl, setAerialImageUrl] = useState("");
  const aerialGroundImage = media.find(
    (item) =>
      item.category === "aerial" &&
      item.source === "USGS National Map NAIP imagery" &&
      Number.isFinite(item.latitude) &&
      Number.isFinite(item.longitude),
  );
  const aerialImageCenter =
    aerialGroundImage && d.geo_reference
      ? addressPinPosition({
          addressLatitude: aerialGroundImage.latitude!,
          addressLongitude: aerialGroundImage.longitude!,
          originLatitude: d.geo_reference.originLatitude,
          originLongitude: d.geo_reference.originLongitude,
        })
      : null;
  useEffect(() => {
    const aerial = media.find((item) => item.category === "aerial");
    if (!aerial) {
      setAerialImageUrl("");
      return;
    }
    let active = true;
    void supabase.storage
      .from("roof-job-photos")
      .createSignedUrl(aerial.path, 300)
      .then(({ data, error }) => {
        if (active) setAerialImageUrl(error ? "" : (data?.signedUrl ?? ""));
      });
    return () => {
      active = false;
    };
  }, [media]);
  function edit(next: RoofDrawing) {
    userEditedDrawing.current = true;
    setHistory((h) => [...h.slice(-29), d]);
    setFuture([]);
    setD({ ...next, verified: false });
    setDirty(true);
  }
  const plane = d.planes.find((p) => p.id === selected);
  const sharedEdgeSuggestions = suggestSharedEdgeClassifications(d);
  const reportAudit = auditRoofReport(d);
  let measurement: ReturnType<typeof measureDrawing> | null = null;
  let error = "";
  try {
    measurement = measureDrawing(d);
  } catch (e) {
    error = e instanceof Error ? e.message : "Check drawing geometry";
  }
  const roofSummary = measurement
    ? calculateRoofSummary({
        facets: measurement.planes.map((p) => ({
          id: p.id,
          name: p.name,
          surfaceAreaSqFt: p.area,
          pitchRisePer12: p.pitch,
        })),
        edges: measuredEdgeTotalsToInputs(measurement.edges),
        wastePercent: d.waste,
      })
    : null;
  const propertyRow = properties.data?.find((p) => p.id === property),
    customer = customers.data?.find((c) => c.id === propertyRow?.customer_id);
  const workspaceAddress = report?.address?.trim() || propertyRow?.address?.trim() || "";
  const matchingJobs = (jobs.data ?? []).filter(
    (j) =>
      customer &&
      j.lead_id === customer.source_lead_id &&
      (!j.property_id || j.property_id === property),
  );
  async function save() {
    if (report && !initialDrawing && !parent && !userEditedDrawing.current) {
      toast.error(
        "Add a measured roof dimension or trace the actual roof before saving this report",
      );
      return;
    }
    if (!measurement || !property) {
      toast.error("Choose a property and correct the drawing first");
      return;
    }
    // Keep the exact revision being saved. Edits made while the request is
    // in flight must remain dirty after this older snapshot is persisted.
    const drawingSnapshot = d;
    const mediaSnapshot = media;
    setBusy(true);
    try {
      const row = await saveFn({
        data: {
          property_id: property,
          title,
          geometry: drawingSnapshot,
          parent_id: parent,
          media: mediaSnapshot,
          ...(report ? { report_order_id: report.id } : {}),
        },
      });
      setParent(row.id);
      if (d === drawingSnapshot && media === mediaSnapshot) {
        setDirty(false);
      } else {
        setDirty(true);
        toast.info("A newer edit is still unsaved. Save again to create the next revision.");
      }
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["roof-drawings"] }),
        qc.invalidateQueries({ queryKey: ["roof-report-orders"] }),
      ]);
      toast.success(`Drawing revision ${row.revision} saved`);
      if (report) await exportPdf(false, true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save drawing");
    } finally {
      setBusy(false);
    }
  }
  async function exportPdf(share = false, savedSnapshot = false) {
    if (report && !initialDrawing && !parent && !userEditedDrawing.current) {
      toast.error("Add measured roof geometry before exporting this property report");
      return;
    }
    if (!measurement) return;
    if (report && (!parent || dirty) && !savedSnapshot) {
      toast.error("Save the current roof drawing revision before generating its report PDF");
      return;
    }
    if (share && (!parent || dirty || !customer?.source_lead_id)) {
      toast.error("Save this drawing and link its customer first");
      return;
    }
    setBusy(true);
    let proposalId: string | null = null;
    let roofReportPdfPath: string | null = null;
    try {
      const { roofDrawingPdf } = await import("@/lib/roof-drawing-pdf");
      const photos = [];
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
      const bytes = await roofDrawingPdf(
        title,
        d,
        report?.title || customer?.name || "",
        workspaceAddress,
        photos,
        { phone: report?.customer_phone ?? "", email: report?.customer_email ?? "" },
      );
      if (report) {
        roofReportPdfPath = `roof-report/${report.id}/${crypto.randomUUID()}.pdf`;
        const { error: uploadError } = await supabase.storage
          .from("roofing-proposals")
          .upload(
            roofReportPdfPath,
            new Blob([Uint8Array.from(bytes)], { type: "application/pdf" }),
            { contentType: "application/pdf" },
          );
        if (uploadError) throw uploadError;
        const { data: currentReport, error: currentReportError } = await supabase
          .from("roof_report_orders")
          .select("updated_at")
          .eq("id", report.id)
          .maybeSingle();
        if (currentReportError || !currentReport)
          throw new Error("Could not refresh the roof report before attaching its PDF");
        await attachPdfFn({
          data: {
            id: report.id,
            path: roofReportPdfPath,
            updated_at: currentReport.updated_at,
          },
        });
        roofReportPdfPath = null;
        if (report.file_path)
          await supabase.storage.from("roofing-proposals").remove([report.file_path]);
        await qc.invalidateQueries({ queryKey: ["roof-report-orders"] });
      }

      if (share) {
        const { data: row, error } = await supabase
          .from("proposals")
          .insert({
            title,
            category: d.roof_type,
            lead_id: customer?.source_lead_id ?? null,
            property_id: property,
            drawing_id: parent,
            scope: "Roof measurement report",
            terms: "",
            amount: null,
          })
          .select("id")
          .single();
        if (error || !row) throw error ?? new Error("Could not create customer report");
        proposalId = row.id;
        const { uploadProposalPdf } = await import("./proposal-data");
        const path = await uploadProposalPdf(row.id, bytes);
        const { error: updateError } = await supabase
          .from("proposals")
          .update({ file_path: path })
          .eq("id", row.id);
        if (updateError) throw updateError;
        await qc.invalidateQueries({ queryKey: ["proposals"] });
        toast.success(
          report
            ? "Measurement PDF saved to Roof reports and customer documents"
            : "Report added to documents; create a private sharing link",
        );
        go("proposals");
      } else if (savedSnapshot && report) {
        toast.success("Updated measurement PDF was automatically saved to Roof reports");
      } else {
        const { downloadPdf } = await import("./proposal-data");
        downloadPdf(bytes, title);
        toast.success(
          report
            ? "Measurement PDF saved to Roof reports and downloaded"
            : "Roof measurement PDF downloaded",
        );
      }
    } catch (error) {
      if (proposalId) await supabase.from("proposals").delete().eq("id", proposalId);
      if (roofReportPdfPath)
        await supabase.storage.from("roofing-proposals").remove([roofReportPdfPath]);
      toast.error(error instanceof Error ? error.message : "Could not generate report");
    } finally {
      setBusy(false);
    }
  }
  async function toJob() {
    if (!parent || dirty || !d.verified || !jobId) {
      toast.error("Save reviewed measurements and select a job first");
      return;
    }
    const target = matchingJobs.find((j) => j.id === jobId);
    if (!target) return;
    setBusy(true);
    try {
      const report = toMaterialReport(d);
      const lines = materialOrderForTransfer(report);
      const { error } = await supabase
        .from("roof_jobs")
        .update({
          property_id: property,
          drawing_id: parent,
          material_order: {
            report,
            lines,
            source: "drawing",
            drawing_id: parent,
            updated_at: new Date().toISOString(),
          },
        })
        .eq("id", target.id);
      if (error) throw error;
      await qc.invalidateQueries({ queryKey: ["roof-jobs"] });
      toast.success("Reviewed measurements transferred to material order");
      go("jobs");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not transfer measurements");
    } finally {
      setBusy(false);
    }
  }
  async function toEstimate() {
    if (!parent || dirty || !d.verified || !measurement || !customer?.source_lead_id) {
      toast.error("Save reviewed measurements and select a customer property first");
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.from("roof_estimates").insert({
        lead_id: customer.source_lead_id,
        property_id: property,
        drawing_id: parent,
        ...(report ? { report_order_id: report.id } : {}),
        title: `${title} — estimate`,
        category: d.roof_type,
        inputs: {
          sqft: measurement.area,
          waste: d.waste,
          material: 0,
          labor: 0,
          permits: 0,
          other: 0,
          margin: 0,
        },
        total_cents: 0,
      });
      if (error) throw error;
      await qc.invalidateQueries({ queryKey: ["roof-estimates"] });
      toast.success("Measurements transferred; load the estimate to add pricing");
      go("estimates");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create linked estimate");
    } finally {
      setBusy(false);
    }
  }
  const [aerialError, setAerialError] = useState("");
  const [aerialStatus, setAerialStatus] = useState("");
  const [footprintBusy, setFootprintBusy] = useState(false);
  const [footprintMessage, setFootprintMessage] = useState("");
  const [footprints, setFootprints] = useState<BuildingFootprint[]>([]);
  const [footprintAddressCoordinates, setFootprintAddressCoordinates] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);
  async function loadAerial() {
    const address = report?.address?.trim() || propertyRow?.address;
    if (!property || !address) return;
    setBusy(true);
    setAerialError("");
    setAerialStatus("Looking up the property address with the free public mapping service…");
    let stage = "request";
    try {
      const r = await aerialFn({ data: { address, spanMeters: 120 } });
      if ("error" in r) {
        setAerialError(r.error);
        setAerialStatus(
          "The aerial lookup needs attention. You can retry or upload your own image.",
        );
        toast.error(r.error);
        return;
      }
      stage = "upload";
      setAerialStatus("Address located. Downloading and securely saving the public aerial image…");
      const path = `drawing-${property}/${crypto.randomUUID()}.png`;
      await uploadAerialImage(r.image, (blob) =>
        supabase.storage.from("roof-job-photos").upload(path, blob, { contentType: "image/png" }),
      );
      const next = [
        ...media,
        {
          path,
          name: `Public aerial · ${r.matchedAddress}`.slice(0, 200),
          category: "aerial" as const,
          source: "USGS National Map NAIP imagery",
          matched_address: r.matchedAddress,
          latitude: r.lat,
          longitude: r.lon,
        },
      ];
      setMedia(next);
      setTraceIndex(next.length - 1);
      setD({
        ...d,
        accuracy: "photo_estimate",
        image_credit: r.credit,
        geo_reference: {
          // Always refresh the address marker from the latest successful geocode.
          // Preserve the drawing origin so existing traced geometry stays in place.
          addressLatitude: r.lat,
          addressLongitude: r.lon,
          originLatitude: d.geo_reference?.originLatitude ?? r.lat,
          originLongitude: d.geo_reference?.originLongitude ?? r.lon,
        },
        verified: false,
      });
      setDirty(true);
      setAerialStatus(
        `Aerial image ready for ${r.matchedAddress}. This resampled public image has no dependable pixel-level measurement scale. Calibrate against a known distance before tracing; review all measurements on site.`,
      );
      toast.success("Free public aerial loaded; calibrate a known distance before tracing");
    } catch (e) {
      const message =
        stage === "upload" && e instanceof Error ? e.message : aerialInvocationError(e);
      setAerialError(message);
      setAerialStatus("Aerial loading did not finish. Correct the issue and retry.");
      toast.error(message);
    } finally {
      setBusy(false);
    }
  }
  function applyBuildingFootprint(
    candidate: BuildingFootprint,
    addressCoordinates = footprintAddressCoordinates,
  ) {
    const hasImportedFootprint = d.planes.some((item) => item.id.startsWith("osm-footprint-"));
    const replaceStarter = !initialDrawing && (!userEditedDrawing.current || hasImportedFootprint);
    const existingPlanes = replaceStarter
      ? []
      : d.planes.filter((item) => !item.id.startsWith("osm-footprint-"));
    const plane = {
      ...footprintToDraftPlane(candidate),
      id: `osm-footprint-${candidate.id}-${Date.now()}`,
    };
    edit({
      ...d,
      planes: [...existingPlanes, plane],
      ...(addressCoordinates
        ? {
            geo_reference: {
              addressLatitude: addressCoordinates.latitude,
              addressLongitude: addressCoordinates.longitude,
              originLatitude: candidate.center.lat,
              originLongitude: candidate.center.lon,
            },
          }
        : {}),
      accuracy: "photo_estimate",
      verified: false,
    });
    setSelected(plane.id);
    setFit((value) => value + 1);
    toast.info(
      "Preliminary ground outline added. Confirm the actual roof edge, overhangs, and pitch before using quantities.",
    );
  }
  async function searchFootprints() {
    const address = report?.address?.trim() || propertyRow?.address;
    if (!address) return;
    setFootprintBusy(true);
    setFootprintMessage("Checking free OpenStreetMap building data near this address…");
    setFootprints([]);
    try {
      const result = await footprintFn({ data: { address } });
      if ("error" in result) {
        setFootprintMessage(result.error);
        return;
      }
      setFootprints(result.footprints);
      setFootprintAddressCoordinates(result.addressCoordinates);
      const candidate = result.footprints[0];
      if (candidate && report && !initialDrawing && !parent && !userEditedDrawing.current) {
        applyBuildingFootprint(candidate, result.addressCoordinates);
      }
      setFootprintMessage(
        result.footprints.length
          ? `Found ${result.footprints.length} nearby mapped building footprint(s). ${result.attribution}. These are ground outlines only.`
          : `No mapped building outline was found within 100 meters. ${result.attribution}. You can still trace the aerial manually.`,
      );
    } catch {
      setFootprintMessage("The free footprint lookup could not complete. Try again later.");
    } finally {
      setFootprintBusy(false);
    }
  }
  const autoAerialAttempted = useRef("");
  useEffect(() => {
    const address = report?.address?.trim() || propertyRow?.address;
    const requestKey = addressAerialRequestKey(report?.id ?? property, address);
    if (
      shouldAutoLoadAddressAerial({
        address,
        requestKey: report?.id ?? property,
        hasAerial: media.some((item) => item.category === "aerial"),
        attemptedKey: autoAerialAttempted.current,      })
    ) {
      autoAerialAttempted.current = requestKey;
      void loadAerial();
    }
  }, [
    report?.id,
    report?.address,
    property,
    propertyRow?.address,
    initialDrawing?.id,
    media,
    loadAerial,
  ]);

  // Automatically check the free OSM ground outline for address-linked reports.
  // This is a reference footprint only, never a roof measurement or roof plan.
  const autoFootprintAttempted = useRef("");
  useEffect(() => {
    const address = report?.address?.trim() || propertyRow?.address;
    const requestKey = report?.id ?? property ?? "";
    if (!shouldAutoSearchFootprint(address, requestKey, autoFootprintAttempted.current)) return;
    autoFootprintAttempted.current = requestKey;
    void searchFootprints();
  }, [report?.id, report?.address, property, propertyRow?.address, initialDrawing?.id]);

  async function upload(file: File) {
    if (
      !property ||
      !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
      file.size > 10 * 1024 * 1024
    ) {
      toast.error("Choose a property and a JPG, PNG or WebP under 10 MB");
      return;
    }
    setBusy(true);
    const path = `drawing-${property}/${crypto.randomUUID()}.${file.type.split("/")[1]}`;
    const { error } = await supabase.storage.from("roof-job-photos").upload(path, file);
    setBusy(false);
    if (error) toast.error("Could not upload image");
    else {
      const uploadedPhoto: Media = { path, name: file.name, category: "aerial" };
      setTraceIndex(media.length);
      setMedia([...media, uploadedPhoto]);
      setDirty(true);
      toast.success(
        "Photo uploaded and selected for manual roof tracing. Save drawing to retain it.",
      );
    }
  }
  return (
    <div>
      <SectionHeading
        title="Roof reports & 3D drawings"
        action={
          <div className="flex gap-2">
            <Button
              variant="outline"
              disabled={busy || !measurement}
              onClick={() => void exportPdf()}
            >
              <Download /> PDF report
            </Button>
            <Button
              disabled={
                busy ||
                !measurement ||
                !property ||
                (!!report && !initialDrawing && !parent && !userEditedDrawing.current)
              }
              onClick={() => void save()}
            >
              <Save /> Save revision
            </Button>
          </div>
        }
      />
      <div
        className="mb-4 rounded-lg border border-border bg-muted/20 p-4"
        role="status"
        aria-live="polite"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-semibold">Automated report quality check</h2>
            <p className="text-xs text-muted-foreground">
              {reportAudit.planeCount} roof plane(s) · {reportAudit.unclassifiedEdges} unclassified
              edge(s)
            </p>
          </div>
          <span
            className={
              reportAudit.status === "ready"
                ? "rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800"
                : reportAudit.status === "blocked"
                  ? "rounded-full bg-red-100 px-3 py-1 text-xs font-semibold text-red-800"
                  : "rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800"
            }
          >
            {reportAudit.status === "ready"
              ? "Ready for review"
              : reportAudit.status === "blocked"
                ? "Report blocked"
                : "Review required"}
          </span>
        </div>
        {(reportAudit.blockers.length > 0 || reportAudit.warnings.length > 0) && (
          <ul className="mt-3 grid gap-1 text-sm">
            {reportAudit.blockers.map((item) => (
              <li key={item} className="text-destructive">
                Blocker: {item}
              </li>
            ))}
            {reportAudit.warnings.map((item) => (
              <li key={item} className="text-muted-foreground">
                Review: {item}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-muted-foreground">
          Saving a linked property report automatically refreshes its PDF. Quality checks validate
          drawing consistency and disclosures; they do not independently certify roof dimensions or
          pitch.
        </p>
      </div>
      \n{" "}
      {workspaceAddress && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-muted/30 px-3 py-2.5">
          <div className="flex min-w-0 items-center gap-2">
            <MapPin className="size-4 shrink-0 text-primary" aria-hidden="true" />
            <div className="min-w-0">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Active property · roof workspace
              </p>
              <p className="break-words text-sm font-semibold">{workspaceAddress}</p>
            </div>
          </div>
          <a
            className="shrink-0 text-sm font-medium text-primary underline underline-offset-4"
            href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(workspaceAddress)}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            Verify map location
          </a>
        </div>
      )}
      {report && !initialDrawing && (
        <p className="mb-5 border-l-2 border-primary pl-3 text-sm text-muted-foreground">
          Starter geometry only — add measured dimensions or trace the actual roof outline and set
          its pitch before saving or exporting this property report. Satellite traces are estimates
          and must be checked against field measurements.
        </p>
      )}
      <div className="mb-5 grid gap-3 md:grid-cols-3">
        <Choice
          label="Property"
          value={property || "none"}
          onChange={(v) => {
            if (parent && v !== property && !confirm("Start a new drawing for this property?"))
              return;
            if (report && v !== report.property_id) {
              toast.error("Open or create a report for the other property first");
              return;
            }
            setProperty(v === "none" ? "" : v);
            setParent(null);
            setMedia([]);
            setD({ ...d, verified: false });
            setDirty(true);
          }}
          options={[
            { value: "none", label: "Choose customer property" },
            ...(properties.data ?? []).map((p) => ({
              value: p.id,
              label: `${customers.data?.find((c) => c.id === p.customer_id)?.name ?? "Customer"} · ${p.label}`,
            })),
          ]}
        />
        <Field label="Report title">
          <Input
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              setDirty(true);
            }}
          />
        </Field>
        <Choice
          label="Saved drawing"
          value={parent ?? "new"}
          onChange={(v) => {
            if (dirty && !confirm("Discard unsaved changes and load this drawing?")) return;
            const row = drawings.data?.find((r) => r.id === v);
            if (!row) return;
            const parsed = drawingSchema.safeParse(row.geometry);
            if (!parsed.success) {
              toast.error("Drawing data could not load");
              return;
            }
            setD(parsed.data);
            setProperty(row.property_id);
            setTitle(row.title);
            setParent(row.id);
            setDirty(false);
            setHistory([]);
            setFuture([]);
            setSelected(parsed.data.planes[0]?.id ?? "");
            setMedia(
              Array.isArray(row.media)
                ? row.media.flatMap((m) =>
                    m &&
                    typeof m === "object" &&
                    !Array.isArray(m) &&
                    typeof m["path"] === "string" &&
                    typeof m["name"] === "string" &&
                    ["aerial", "before", "after", "diagram"].includes(String(m["category"]))
                      ? [
                          {
                            path: m["path"],
                            name: m["name"],
                            category: m["category"] as Media["category"],
                          },
                        ]
                      : [],
                  )
                : [],
            );
          }}
          options={[
            { value: "new", label: "Unsaved drawing" },
            ...(drawings.data ?? [])
              .filter((r) => !report || r.report_order_id === report.id)
              .map((r) => ({ value: r.id, label: `${r.title} · revision ${r.revision}` })),
          ]}
        />
      </div>
      <div className="flex flex-wrap items-end gap-3 border-y border-border py-4">
        <div className="w-36">
          <Choice
            label="Roof configuration"
            value={shape}
            onChange={(v) => setShape(v as RoofShape)}
            options={["gable", "hip", "flat", "shed", "mansard", "complex"].map((v) => ({
              value: v,
              label: v[0]?.toUpperCase() + v.slice(1),
            }))}
          />
        </div>
        {(
          [
            ["Width (ft)", width, setWidth],
            ["Length (ft)", length, setLength],
            ["Pitch (rise / 12)", pitch, setPitch],
          ] as const
        ).map(([label, value, set]) => (
          <Field key={label} label={label}>
            <Input
              className="w-28"
              type="number"
              min={label.includes("Pitch") ? 0 : 1}
              max={label.includes("Pitch") ? 24 : 500}
              value={value}
              onChange={(e) => set(Number(e.target.value))}
            />
          </Field>
        ))}
        <Button
          variant="outline"
          disabled={width <= 0 || length <= 0 || pitch < 0}
          onClick={() => {
            const next = roofPreset(shape, width, length, pitch);
            edit(next);
            setSelected(next.planes[0]?.id ?? "");
            setFit((f) => f + 1);
          }}
        >
          Apply shape
        </Button>
        <Button
          size="icon"
          variant="ghost"
          title="Undo"
          aria-label="Undo drawing"
          disabled={!history.length}
          onClick={() => {
            const prev = history[history.length - 1];
            if (!prev) return;
            setFuture((f) => [d, ...f]);
            setD({ ...prev, verified: false });
            setHistory((h) => h.slice(0, -1));
            setDirty(true);
          }}
        >
          <Undo2 />
        </Button>
        <Button
          size="icon"
          variant="ghost"          title="Redo"
          aria-label="Redo drawing"
          disabled={!future.length}
          onClick={() => {
            const next = future[0];
            if (!next) return;
            setHistory((h) => [...h, d]);
            setD({ ...next, verified: false });
            setFuture((f) => f.slice(1));
            setDirty(true);
          }}
        >
          <Redo2 />
        </Button>
      </div>
      <div className="grid min-w-0 gap-0 border-b border-border xl:grid-cols-[1fr_300px]">
        <div className="min-w-0">
          <div className="flex items-center justify-between border-b border-border py-3">
            <div className="flex gap-2">
              <Button
                size="sm"
                variant={view === "3d" ? "secondary" : "ghost"}
                onClick={() => setView("3d")}
              >
                3D House
              </Button>
              <Button
                size="sm"
                variant={view === "plan" ? "secondary" : "ghost"}
                onClick={() => setView("plan")}
              >
                2D Plan
              </Button>
              <Button
                size="icon"
                variant="outline"
                title="Zoom in"
                aria-label="Zoom in on roof drawing"
                onClick={() => {
                  setZoomDirection("in");
                  setZoomKey((key) => key + 1);
                }}
              >
                <ZoomIn />
              </Button>
              <Button
                size="icon"
                variant="outline"
                title="Zoom out"
                aria-label="Zoom out on roof drawing"
                onClick={() => {
                  setZoomDirection("out");
                  setZoomKey((key) => key + 1);
                }}
              >
                <ZoomOut />
              </Button>
            </div>
            {view === "3d" && (
              <Button
                size="sm"
                variant={autoRotate ? "secondary" : "outline"}
                onClick={() => setAutoRotate((value) => !value)}
                aria-label={
                  autoRotate ? "Pause automatic 3D rotation" : "Start automatic 3D rotation"
                }
                title={autoRotate ? "Pause automatic rotation" : "Start automatic rotation"}
              >
                {autoRotate ? <Pause /> : <Play />}
                {autoRotate ? "Pause rotation" : "Auto rotate"}
              </Button>
            )}
            <span className="text-xs text-muted-foreground">
              {dirty ? "Unsaved changes" : "Saved revision"} ·{" "}
              {d.verified ? "Owner reviewed" : "Unverified"}
            </span>
            <Button
              size="icon"
              variant="ghost"
              title="Fit drawing"
              aria-label="Fit drawing"
              onClick={() => setFit((f) => f + 1)}
            >
              <RotateCcw />
            </Button>
          </div>
          <p className="px-3 py-2 text-xs text-muted-foreground">
            3D House shows a simplified building mass beneath the measured roof. 2D Plan shows the
            roof from directly above. The building shape is generated from traced roof geometry, not
            a photorealistic model of the actual home.
          </p>
          <div className="h-[440px] min-w-0 bg-muted sm:h-[560px]">
            <DrawingErrorBoundary>
              <Suspense
                fallback={<p className="p-8 text-muted-foreground">Loading drawing workspace…</p>}
              >
                <Scene
                  drawing={d}
                  edgeSuggestions={sharedEdgeSuggestions}
                  aerialImageUrl={aerialGroundImage ? aerialImageUrl : ""}
                  aerialImageCenter={
                    aerialImageCenter ? [aerialImageCenter.x, 0.05, aerialImageCenter.z] : undefined
                  }
                  selected={selected}
                  onSelect={setSelected}
                  view={view}
                  fitKey={fit}
                  autoRotate={autoRotate}
                  zoomDirection={zoomDirection}
                  zoomKey={zoomKey}
                />
              </Suspense>
            </DrawingErrorBoundary>
          </div>
          <div
            className="flex flex-wrap gap-x-4 gap-y-2 border-t border-border bg-background px-3 py-3"
            aria-label="Roof feature color legend"
          >
            {ROOF_FEATURE_LEGEND.map((feature) => (
              <div
                key={feature.id}
                className="flex items-center gap-2 text-xs text-muted-foreground"
              >
                <span
                  aria-hidden="true"
                  className="inline-block h-1 w-6 rounded-full"
                  style={{ backgroundColor: feature.color }}
                />
                <span>{feature.label}</span>
              </div>
            ))}
            {sharedEdgeSuggestions.length > 0 && (
              <span className="text-xs font-medium text-amber-600">
                Thicker colored edges are geometry-based suggestions — review before applying
              </span>
            )}
          </div>
        </div>
        <aside className="min-w-0 border-t border-border py-5 xl:border-l xl:border-t-0 xl:pl-5">
          <h3 className="mb-4 text-lg font-bold">Roof planes</h3>
          <div className="mb-4 flex flex-wrap gap-2">
            {d.planes.map((p) => (
              <Button
                key={p.id}
                size="sm"
                variant={p.id === selected ? "secondary" : "outline"}
                onClick={() => setSelected(p.id)}
              >
                {p.name}
              </Button>
            ))}
          </div>
          <div className="mb-3 rounded-md border border-border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-medium">Geometry-based edge suggestions</p>
                <p className="text-xs text-muted-foreground">
                  {sharedEdgeSuggestions.length} suggested classifications. Review highlighted edges
                  in the drawing before applying.
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={sharedEdgeSuggestions.length === 0}
                onClick={() => {
                  const nextPlanes = d.planes.map((roofPlane) => ({
                    ...roofPlane,
                    edges: roofPlane.edges.map((edge, edgeIndex) => {
                      const suggestion = sharedEdgeSuggestions.find(
                        (item) => item.planeId === roofPlane.id && item.edgeIndex === edgeIndex,
                      );
                      return suggestion?.type ?? edge;
                    }),
                  }));
                  edit({ ...d, planes: nextPlanes });
                  toast.success(
                    `Applied ${sharedEdgeSuggestions.length} geometry-based edge suggestions. Review before using the takeoff.`,
                  );
                }}
              >
                Apply suggestions
              </Button>
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              const id = crypto.randomUUID();
              edit({
                ...d,
                planes: [
                  ...d.planes,
                  {
                    id,
                    name: `Plane ${d.planes.length + 1}`,
                    points: [
                      { x: 50, y: 10, z: 0 },
                      { x: 60, y: 10, z: 0 },
                      { x: 60, y: 10, z: 10 },
                      { x: 50, y: 10, z: 10 },
                    ],
                    edges: ["eave", "eave", "eave", "eave"],
                  },
                ],
              });
              setSelected(id);
            }}
          >
            <Plus /> Add plane
          </Button>
          {plane && (
            <div className="mt-4">
              <Field label="Plane name">
                <Input
                  value={plane.name}
                  onChange={(e) =>
                    edit({
                      ...d,
                      planes: d.planes.map((p) =>
                        p.id === selected ? { ...p, name: e.target.value } : p,
                      ),
                    })
                  }
                />
              </Field>
              <div className="mt-4 max-h-80 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr>
                      <th>Vertex</th>
                      <th>X ft</th>
                      <th>Height ft</th>
                      <th>Z ft</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plane.points.map((point, i) => (
                      <tr key={i}>
                        <td className="pr-1">{i + 1}</td>
                        {(["x", "y", "z"] as const).map((axis) => (
                          <td key={axis}>
                            <Input
                              className="h-8 px-1 text-xs"
                              aria-label={`Vertex ${i + 1} ${axis}`}
                              type="number"
                              step="0.1"
                              value={point[axis]}
                              onChange={(e) =>
                                edit({
                                  ...d,
                                  planes: d.planes.map((p) =>
                                    p.id === selected
                                      ? {
                                          ...p,
                                          points: p.points.map((v, n) =>
                                            n === i ? { ...v, [axis]: Number(e.target.value) } : v,
                                          ),
                                        }
                                      : p,
                                  ),
                                })
                              }
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {sharedEdgeSuggestions.length > 0 && (
                <div className="my-4 rounded-md border border-border p-3">
                  <p className="text-sm font-semibold">
                    {sharedEdgeSuggestions.length} roof-edge classification
                    {sharedEdgeSuggestions.length === 1 ? " suggestion" : " suggestions"} available
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Geometry-based ridge, valley, hip, eave, and rake suggestions. Review every
                    highlighted edge before applying; these suggestions do not verify measurements.
                  </p>
                  <Button
                    className="mt-3"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      const next = {
                        ...d,
                        planes: d.planes.map((facet) => ({
                          ...facet,
                          edges: facet.edges.map((edge, index) => {
                            const suggestion = sharedEdgeSuggestions.find(
                              (item) => item.planeId === facet.id && item.edgeIndex === index,
                            );
                            return suggestion?.type ?? edge;
                          }),
                        })),
                      };
                      edit(next);