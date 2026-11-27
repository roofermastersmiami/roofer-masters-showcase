import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Download, Play, Pause, RotateCcw, FileDown, Package, ZoomIn, ZoomOut } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import {
  drawingSchema,
  roofPreset,
  measureDrawing,
  addressPinPosition,
  type RoofDrawing,
} from "@/lib/roof-geometry";
import { calculateRoofSummary, measuredEdgeTotalsToInputs } from "@/lib/roof-calculations";
import { roofCoverFraming } from "@/lib/aerial-photo";
import { saveRoofDrawing } from "@/lib/roof-drawing.functions";
import { restoreRoofDrawingMedia, type RoofDrawingMedia } from "@/lib/roof-drawing-media";
import { attachRoofOrderPdf } from "@/lib/roof-orders.functions";
import { propertiesQuery, customersQuery } from "./foundation-data";
import { automaticMaterialList, type AutomaticMaterialList } from "@/lib/material-order";
import { useCrm } from "./CrmContext";
import type { RoofOrder } from "./roof-orders-data";
import type { Database } from "@/integrations/supabase/types";
import { AutomatedRoofReport } from "./AutomatedRoofReport";
import { parseMeasurementPin } from "@/lib/roof-order-notes";
import { REPORT_STATUS_LABELS } from "@/lib/roof-order-schema";
import { loadReportAerial } from "@/lib/report-aerial.functions";
import type { AerialPhoto } from "@/lib/aerial-photo";
import { ROOF_FEATURE_LEGEND } from "@/lib/roof-feature-styles";
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
  const properties = useQuery(propertiesQuery),
    customers = useQuery(customersQuery),
    qc = useQueryClient();
  const saveFn = useServerFn(saveRoofDrawing);
  const attachPdfFn = useServerFn(attachRoofOrderPdf);
  const reportAerialFn = useServerFn(loadReportAerial);
  const userEditedDrawing = useRef(false);
  // Hands-off flow: when the automated measurement applies a drawing
  // inside a report workspace, the revision save (which also generates
  // and attaches the report PDF) runs by itself and the material list
  // is built from the saved drawing — no Save click needed.
  const autoSaveArmed = useRef(false);
  const [autoSaving, setAutoSaving] = useState(false);
  const [autoMaterials, setAutoMaterials] = useState<AutomaticMaterialList | null>(null);
  const { go } = useCrm();
  const [d, setD] = useState<RoofDrawing>(starting),
    [selected, setSelected] = useState(starting.planes[0]?.id ?? ""),
    [property] = useState(report?.property_id ?? ""),
    [title] = useState(report?.title ?? "Roof measurement report"),
    [parent, setParent] = useState<string | null>(initialDrawing?.id ?? null),
    [dirty, setDirty] = useState(!initialDrawing),
    [busy, setBusy] = useState(false),
    [view, setView] = useState<"3d" | "plan">("3d"),
    [autoRotate, setAutoRotate] = useState(true),
    [fit, setFit] = useState(0),
    [zoomDirection, setZoomDirection] = useState<"in" | "out">("in"),
    [zoomKey, setZoomKey] = useState(0),
    [media] = useState<Media[]>(() => restoreRoofDrawingMedia(initialDrawing?.media));
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
    setD({ ...next, verified: false });
    setDirty(true);
  }
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
  async function save(): Promise<boolean> {
    if (report && !initialDrawing && !parent && !userEditedDrawing.current) {
      toast.error("Run the automatic measurement before saving this report");
      return false;
    }
    if (!measurement || !property) {
      toast.error("Choose a property and correct the drawing first");
      return false;
    }
    setBusy(true);
    try {
      const row = await saveFn({
        data: {
          property_id: property,
          title,
          geometry: d,
          parent_id: parent,
          media,
          ...(report ? { report_order_id: report.id } : {}),
        },
      });
      setParent(row.id);
      setDirty(false);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["roof-drawings"] }),
        qc.invalidateQueries({ queryKey: ["roof-report-orders"] }),
      ]);
      toast.success(`Drawing revision ${row.revision} saved`);
      if (report) await exportPdf(false, true);
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save drawing");
      return false;
    } finally {
      setBusy(false);
    }
  }
  const saveRef = useRef(save);
  saveRef.current = save;
  // Run the armed hands-off save once the automated drawing is in the
  // editor and measurable. The flag is consumed before saving so the
  // effect cannot loop; a failed save is surfaced by save()'s toast.
  useEffect(() => {
    if (!autoSaveArmed.current || !report || !dirty || busy || autoSaving) return;
    if (!measurement || !property) return;
    autoSaveArmed.current = false;
    setAutoSaving(true);
    void (async () => {
      const saved = await saveRef.current();
      if (saved) {
        try {
          setAutoMaterials(automaticMaterialList(d));
        } catch {
          setAutoMaterials(null);
        }
        toast.success(
          "Measurement saved, report PDF generated, and material list built automatically.",
        );
      }
      setAutoSaving(false);
    })();
  }, [autoSaving, busy, d, dirty, measurement, property, report]);
  async function downloadAutoTakeoff() {
    if (!autoMaterials || !autoMaterials.lines.length) return;
    try {
      const [{ materialTakeoffPdf }, { downloadPdf }] = await Promise.all([
        import("@/lib/material-order-pdf"),
        import("./proposal-data"),
      ]);
      const bytes = await materialTakeoffPdf({
        title,
        source: "Automatic measurement — generated from the saved roof drawing",
        report: autoMaterials.report,
        lines: autoMaterials.lines,
        warnings: autoMaterials.warnings,
      });
      downloadPdf(bytes, `Material Takeoff - ${title}`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not generate material takeoff PDF",
      );
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
      // Hands-off cover photo: when the job has no stored aerial,
      // fetch free Esri World Imagery for the drawing's geographic
      // origin automatically. The server-side export fetch goes
      // first (no browser CORS dependency — the step-7 client-side
      // tile stitch was never proven in a real export); the client
      // stitch remains as a fallback. Any failure leaves photos
      // unchanged and the report falls back to its sketch cover.
      if (!photos.some((photo) => /aerial/i.test(photo.category)) && d.geo_reference) {
        const { originLatitude, originLongitude } = d.geo_reference;
        // Frame the cover on the roof itself: the geocode origin
        // can sit a house away from the roof centre (Miramar: ~64
        // ft), which left the subject house small and off-centre in
        // a fixed ±42 m window. Both fetch paths get the same
        // roof-centred framing.
        const framing = roofCoverFraming(d);
        const coverLatitude = framing?.latitude ?? originLatitude;
        const coverLongitude = framing?.longitude ?? originLongitude;
        let aerial: AerialPhoto | null = null;
        try {
          const result = await reportAerialFn({
            data: {
              latitude: coverLatitude,
              longitude: coverLongitude,
              ...(framing ? { halfExtentMeters: framing.halfExtentMeters } : {}),
            },
          });
          if ("imageBase64" in result && result.imageBase64) {
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
            aerial = await fetchAerialPhoto(
              coverLatitude,
              coverLongitude,
              framing?.halfExtentMeters,
            );
          } catch {
            // Imagery is best-effort; never block the report on it.
          }
        }
        if (aerial) photos.unshift(aerial);
      }
      const bytes = await roofDrawingPdf(
        title,
        d,
        report?.title || customer?.name || "",
        workspaceAddress,
        photos,
        { phone: report?.customer_phone ?? "", email: report?.customer_email ?? "" },
        // The workspace no longer exposes theme/logo pickers; the PDF
        // keeps the generator defaults it already used (RoofSnap
        // Classic theme, medium logo).
        { theme: "roofsnap", logoScale: 1 },
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
  const statusLabel = report
    ? (REPORT_STATUS_LABELS[report.status as keyof typeof REPORT_STATUS_LABELS] ?? report.status)
    : null;
  const reportDate = report
    ? new Date(report.created_at).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : null;
  return (
    <div>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-xl font-bold">{title}</h2>
          <p className="mt-1 flex flex-wrap gap-x-2 text-sm text-muted-foreground">
            {customer?.name && <span>{customer.name}</span>}
            {workspaceAddress && <span>· {workspaceAddress}</span>}
            {statusLabel && <span>· {statusLabel}</span>}
            {reportDate && <span>· {reportDate}</span>}
          </p>
        </div>
        <Button variant="outline" disabled={busy || !measurement} onClick={() => void exportPdf()}>
          <Download /> Download PDF
        </Button>
      </div>
      <div className="min-w-0 border-b border-border">
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
          roof from directly above. The building shape is generated from measured roof geometry, not
          a photorealistic model of the actual home.
        </p>
        <div className="h-[440px] min-w-0 bg-muted sm:h-[560px]">
          <DrawingErrorBoundary>
            <Suspense
              fallback={<p className="p-8 text-muted-foreground">Loading drawing workspace…</p>}
            >
              <Scene
                drawing={d}
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
            <div key={feature.id} className="flex items-center gap-2 text-xs text-muted-foreground">
              <span
                aria-hidden="true"
                className="inline-block h-1 w-6 rounded-full"
                style={{ backgroundColor: feature.color }}
              />
              <span>{feature.label}</span>
            </div>
          ))}
        </div>
      </div>
      {error && (
        <p
          role="alert"
          className="my-4 border-l-2 border-destructive pl-3 text-sm text-destructive"
        >
          {error}
        </p>
      )}
      {measurement && (
        <div className="grid grid-cols-2 gap-4 border-b border-border py-5 sm:grid-cols-4">
          <div>
            <p className="text-xs text-muted-foreground">Measured roof area</p>
            <p className="text-xl font-bold">{measurement.area.toFixed(1)} sq ft</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Roofing squares</p>
            <p className="text-xl font-bold">{measurement.squares.toFixed(2)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Ridge / hip / valley</p>
            <p className="text-sm font-bold">
              {measurement.edges.ridge.toFixed(1)} / {measurement.edges.hip.toFixed(1)} /{" "}
              {measurement.edges.valley.toFixed(1)} ft
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Eaves / rakes</p>
            <p className="text-sm font-bold">
              {measurement.edges.eave.toFixed(1)} / {measurement.edges.rake.toFixed(1)} ft
            </p>
          </div>
        </div>
      )}
      {roofSummary && (
        <p className="mt-2 text-xs text-muted-foreground">
          Including {d.waste}% waste: {roofSummary.orderSquares.toFixed(2)} order squares
        </p>
      )}
      {measurement && (
        <section className="my-5 rounded-lg border border-border p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-lg font-bold">Roof plane measurements</h3>
            <span className="text-xs text-muted-foreground">
              Measured automatically from the roof drawing
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Roof plane</th>
                  <th className="py-2 pr-3 text-right font-medium">Pitch</th>
                  <th className="py-2 pr-3 text-right font-medium">Area (sq ft)</th>
                  <th className="py-2 text-right font-medium">Squares</th>
                </tr>
              </thead>
              <tbody>
                {measurement.planes.map((facet) => (
                  <tr key={facet.id} className="border-b border-border/60">
                    <td className="py-2 pr-3 font-medium">{facet.name}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {facet.pitch.toFixed(2)}:12
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">{facet.area.toFixed(1)}</td>
                    <td className="py-2 text-right tabular-nums">
                      {(facet.area / 100).toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-semibold">
                  <td className="py-2 pr-3">Total</td>
                  <td className="py-2 pr-3 text-right">—</td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {measurement.area.toFixed(1)}
                  </td>
                  <td className="py-2 text-right tabular-nums">{measurement.squares.toFixed(2)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Preliminary geometry-based quantities only. Confirm roof dimensions, pitch, and
            classifications with field measurements before ordering materials or pricing work.
          </p>
        </section>
      )}
      <AutomatedRoofReport
        address={workspaceAddress}
        pointHint={report ? parseMeasurementPin(report.notes) : null}
        roofType={d.roof_type}
        onApply={(detectedDrawing) => {
          const hasExistingWork =
            Boolean(initialDrawing) || userEditedDrawing.current || d.planes.length > 1;
          if (
            hasExistingWork &&
            !confirm(
              "Replace the current roof planes with public LiDAR candidates? Existing planes and penetrations will be removed.",
            )
          )
            return false;
          try {
            const nextDrawing: RoofDrawing = {
              ...detectedDrawing,
              roof_type: d.roof_type,
              waste: d.waste,
              condition: d.condition,
            };
            // Validate externally sourced geometry before it enters the editable report.
            measureDrawing(nextDrawing);
            edit(nextDrawing);
            setSelected(nextDrawing.planes[0]?.id ?? "");
            setFit((value) => value + 1);
            toast.success(
              "Preliminary LiDAR facets loaded. Review every plane and classify all edges before generating a takeoff.",
            );
            // Hands-off: the save + report PDF + material list chain
            // runs by itself for a drawing the automated measurement
            // just produced inside a report workspace.
            if (report) autoSaveArmed.current = true;
            return true;
          } catch (cause) {
            toast.error(
              cause instanceof Error
                ? cause.message
                : "LiDAR facets failed roof geometry validation.",
            );
            return false;
          }
        }}
      />
      {(autoSaving || autoMaterials) && (
        <section className="space-y-3 rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-2">
            <Package className="size-5 text-primary" />
            <h3 className="font-semibold">Material list — generated automatically</h3>
          </div>
          {autoSaving ? (
            <p className="text-sm text-muted-foreground" role="status">
              Saving the measurement, generating the report PDF, and building the material list…
            </p>
          ) : autoMaterials ? (
            <>
              <p className="text-sm text-muted-foreground">
                {autoMaterials.report.roof_type} · {autoMaterials.report.area_sqft.toLocaleString()}{" "}
                sq ft · +{autoMaterials.wastePct}% waste. Quantities come straight from the
                automated measurement — the same takeoff printed in the saved report PDF.
              </p>
              {autoMaterials.warnings.length > 0 && (
                <div
                  role="note"
                  className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm"
                >
                  <ul className="list-disc space-y-1 pl-5">
                    {autoMaterials.warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                </div>
              )}
              {autoMaterials.lines.length ? (
                <table className="w-full text-sm">
                  <tbody>
                    {autoMaterials.lines.map((line) => (
                      <tr key={line.item} className="border-b border-border">
                        <td className="py-2">
                          <div>{line.item}</div>
                          {line.notes && (
                            <p className="mt-1 text-xs text-muted-foreground">{line.notes}</p>
                          )}
                        </td>
                        <td className="py-2 text-right font-semibold">
                          {line.qty} {line.unit}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No order-ready quantities yet — see the review note above.
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  disabled={!autoMaterials.lines.length}
                  onClick={() => void downloadAutoTakeoff()}
                >
                  <FileDown /> Takeoff PDF
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Quantities are estimates — confirm with your supplier before ordering. You can edit
                them any time in the job's Material Order.
              </p>
            </>
          ) : null}
        </section>
      )}
    </div>
  );
}
