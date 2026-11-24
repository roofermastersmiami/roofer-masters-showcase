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
  toMaterialReport,
  distance,
  EDGE_TYPES,
  suggestSharedEdgeClassifications,
  type RoofDrawing,
  type RoofShape,
} from "@/lib/roof-geometry";
import { calculateRoofSummary } from "@/lib/roof-calculations";
import { saveRoofDrawing } from "@/lib/roof-drawing.functions";
import { propertiesQuery, customersQuery } from "./foundation-data";
import { drawingsQuery } from "./roof-data";
import { jobsQuery } from "./operations-data";
import { materialOrder } from "@/lib/material-order";
import { Choice, Field, SectionHeading } from "./CrmControls";
import { useCrm } from "./CrmContext";
import type { RoofOrder } from "./roof-orders-data";
import type { Database } from "@/integrations/supabase/types";
import { RoofImageTrace } from "./RoofImageTrace";
import { SatelliteRoofTrace } from "./SatelliteRoofTrace";
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
type Media = {
  path: string;
  name: string;
  category: "aerial" | "before" | "after" | "diagram";
  source?: string;
  matched_address?: string;
  latitude?: number;
  longitude?: number;
};
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
    [shape, setShape] = useState<RoofShape>("gable"),
    [width, setWidth] = useState(startWidth),
    [length, setLength] = useState(startLength),
    [pitch, setPitch] = useState(startPitch),
    [jobId, setJobId] = useState(""),
    [media, setMedia] = useState<Media[]>(() => {
      const parsed = Array.isArray(initialDrawing?.media) ? initialDrawing.media : [];
      return parsed.flatMap((m) =>
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
                ...(typeof m["source"] === "string" ? { source: m["source"].slice(0, 80) } : {}),
                ...(typeof m["matched_address"] === "string"
                  ? { matched_address: m["matched_address"].slice(0, 250) }
                  : {}),
                ...(typeof m["latitude"] === "number" && Number.isFinite(m["latitude"])
                  ? { latitude: m["latitude"] }
                  : {}),
                ...(typeof m["longitude"] === "number" && Number.isFinite(m["longitude"])
                  ? { longitude: m["longitude"] }
                  : {}),
              },
            ]
          : [],
      );
    });
  function edit(next: RoofDrawing) {
    userEditedDrawing.current = true;
    setHistory((h) => [...h.slice(-29), d]);
    setFuture([]);
    setD({ ...next, verified: false });
    setDirty(true);
  }
  const plane = d.planes.find((p) => p.id === selected);
  const sharedEdgeSuggestions = suggestSharedEdgeClassifications(d);
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
        edges: d.planes.flatMap((p) =>
          p.points.map((point, i) => {
            const next = p.points[(i + 1) % p.points.length]!;
            const type = p.edges[i]!;
            const pointKey = (v: typeof point) =>
              [v.x, v.y, v.z].map((n) => Math.round(n * 100)).join(",");
            const id = [pointKey(point), pointKey(next)].sort().join("|");
            return { id, type, lengthFt: distance(point, next) };
          }),
        ),
        wastePercent: d.waste,
      })
    : null;
  const propertyRow = properties.data?.find((p) => p.id === property),
    customer = customers.data?.find((c) => c.id === propertyRow?.customer_id);
  const matchingJobs = (jobs.data ?? []).filter(
    (j) =>
      customer &&
      j.lead_id === customer.source_lead_id &&
      (!j.property_id || j.property_id === property),
  );
  async function save() {
    if (!measurement || !property) {
      toast.error("Choose a property and correct the drawing first");
      return;
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
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save drawing");
    } finally {
      setBusy(false);
    }
  }
  async function exportPdf(share = false) {
    if (!measurement) return;
    if (share && (!parent || dirty || !customer?.source_lead_id)) {
      toast.error("Save this drawing and link its customer first");
      return;
    }
    setBusy(true);
    let proposalId: string | null = null;
    try {
      const { roofDrawingPdf } = await import("@/lib/roof-drawing-pdf");
      const photos = [];
      for (const item of media) {
        const { data: blob, error: photoError } = await supabase.storage
          .from("roof-job-photos")
          .download(item.path);
        if (photoError || !blob) throw new Error("Photo could not load");
        let bytes = new Uint8Array(await blob.arrayBuffer());
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
          bytes = new Uint8Array(await converted.arrayBuffer());
          mime = "image/png";
        }
        photos.push({
          bytes,
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
        customer?.name ?? "",
        propertyRow?.address ?? "",
        photos,
      );
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
        if (error || !row) throw error;
        proposalId = row.id;
        const { uploadProposalPdf } = await import("./proposal-data");
        const path = await uploadProposalPdf(row.id, bytes);
        const { error: updateError } = await supabase
          .from("proposals")
          .update({ file_path: path })
          .eq("id", row.id);
        if (updateError) throw updateError;
        await qc.invalidateQueries({ queryKey: ["proposals"] });
        toast.success("Report added to documents; create a private sharing link");
        go("proposals");
      } else {
        const { downloadPdf } = await import("./proposal-data");
        downloadPdf(bytes, title);
      }
    } catch {
      if (proposalId) await supabase.from("proposals").delete().eq("id", proposalId);
      toast.error("Could not generate report");
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
      const lines = materialOrder(report);
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
      setD({ ...d, accuracy: "photo_estimate", image_credit: r.credit, verified: false });
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
      const candidate = result.footprints[0];
      if (candidate && report && !initialDrawing && !userEditedDrawing.current) {
        const plane = {
          ...footprintToDraftPlane(candidate),
          id: `osm-footprint-${candidate.id}-${Date.now()}`,
        };
        edit({ ...d, planes: [plane], accuracy: "photo_estimate", verified: false });
        setSelected(plane.id);
        setFit((value) => value + 1);
        toast.info(
          "Preliminary footprint measurements added. Confirm roof outline, pitch, and overhangs before using for an estimate.",
        );
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
        attemptedKey: autoAerialAttempted.current,
      })
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
      setMedia([...media, { path, name: file.name, category: "aerial" }]);
      setDirty(true);
      toast.success("Private image uploaded; save drawing to retain it");
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
            <Button disabled={busy || !measurement || !property} onClick={() => void save()}>
              <Save /> Save revision
            </Button>
          </div>
        }
      />
      {report && !initialDrawing && (
        <p className="mb-5 border-l-2 border-primary pl-3 text-sm text-muted-foreground">
          Starter geometry only — enter measured dimensions or trace a calibrated aerial image
          before reviewing this property.
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
          variant="ghost"
          title="Redo"
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
                3D
              </Button>
              <Button
                size="sm"
                variant={view === "plan" ? "secondary" : "ghost"}
                onClick={() => setView("plan")}
              >
                Plan
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
          <div className="h-[440px] min-w-0 bg-muted sm:h-[560px]">
            <DrawingErrorBoundary>
              <Suspense
                fallback={<p className="p-8 text-muted-foreground">Loading drawing workspace…</p>}
              >
                <Scene
                  drawing={d}
                  selected={selected}
                  onSelect={setSelected}
                  view={view}
                  fitKey={fit}
                  autoRotate={autoRotate}
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
                    {sharedEdgeSuggestions.length / 2} shared-edge suggestion
                    {sharedEdgeSuggestions.length === 2 ? "" : "s"} available
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Geometry-based ridge/valley suggestions only. Exterior eaves and rakes remain
                    manual. Review the drawing before applying; measurements stay unverified.
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
                      toast.success(
                        "Shared ridge/valley suggestions applied; review before saving",
                      );
                    }}
                  >
                    Apply shared-edge suggestions
                  </Button>
                </div>
              )}
              <div className="mt-4 grid gap-2">
                {plane.edges.map((type, i) => (
                  <div key={i} className="flex items-end gap-2">
                    <span
                      aria-hidden="true"
                      className="mb-2 h-1.5 w-7 shrink-0 rounded-full"
                      style={{ backgroundColor: ROOF_EDGE_STYLES[type].color }}
                    />
                    <div className="min-w-0 flex-1">
                      <Choice
                        label={`Edge ${i + 1} → ${i + 1 === plane.edges.length ? 1 : i + 2} · ${ROOF_EDGE_STYLES[type].label}`}
                        value={type}
                        onChange={(value) => {
                          const edge = EDGE_TYPES.find((e) => e === value);
                          if (edge)
                            edit({
                              ...d,
                              planes: d.planes.map((p) =>
                                p.id === selected
                                  ? { ...p, edges: p.edges.map((v, n) => (n === i ? edge : v)) }
                                  : p,
                              ),
                            });
                        }}
                        options={EDGE_TYPES.map((e) => ({
                          value: e,
                          label: ROOF_EDGE_STYLES[e].label,
                        }))}
                      />
                    </div>
                  </div>
                ))}
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="mt-3 text-destructive"
                disabled={d.planes.length <= 1}
                onClick={() => {
                  const next = d.planes.filter((p) => p.id !== selected);
                  edit({ ...d, planes: next });
                  setSelected(next[0]?.id ?? "");
                }}
              >
                <Trash2 /> Remove plane
              </Button>
            </div>
          )}
        </aside>
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
        <section className="my-5 rounded-lg border border-border p-5">
          <h3 className="mb-4 text-lg font-bold">Roof Calculator Summary</h3>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <p className="text-xs text-muted-foreground">Roof area</p>
              <p className="text-xl font-bold">
                {roofSummary.facetSurfaceAreaSqFt.toFixed(1)} sq ft
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Waste area</p>
              <p className="text-xl font-bold">{roofSummary.wasteAreaSqFt.toFixed(1)} sq ft</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Area with waste</p>
              <p className="text-xl font-bold">
                {roofSummary.totalAreaWithWasteSqFt.toFixed(1)} sq ft
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Order quantity</p>
              <p className="text-xl font-bold">{roofSummary.orderSquares.toFixed(2)} squares</p>
            </div>
          </div>
        </section>
      )}
      <section className="grid gap-6 py-6 lg:grid-cols-2">
        <div>
          <h3 className="mb-4 text-lg font-bold">Report details</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <Choice
              label="Roof system"
              value={d.roof_type}
              onChange={(v) => edit({ ...d, roof_type: v as RoofDrawing["roof_type"] })}
              options={["Metal Roof", "Shingle Roof", "Tile Roof", "TPO", "Flat Roof"].map((v) => ({
                value: v,
                label: v,
              }))}
            />
            <Field label="Waste (%)">
              <Input
                type="number"
                min={0}
                max={50}
                value={d.waste}
                onChange={(e) => edit({ ...d, waste: Number(e.target.value) })}
              />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Roof condition">
                <Input
                  value={d.condition}
                  onChange={(e) => edit({ ...d, condition: e.target.value })}
                />
              </Field>
            </div>
            <div className="sm:col-span-2">
              <Field label="Inspection notes">
                <Textarea value={d.notes} onChange={(e) => edit({ ...d, notes: e.target.value })} />
              </Field>
            </div>
            <label className="flex items-center gap-3 text-sm sm:col-span-2">
              <Checkbox
                checked={d.verified}
                onCheckedChange={(v) => {
                  setD({ ...d, verified: v === true });
                  setDirty(true);
                }}
              />{" "}
              Owner reviewed these measurements
            </label>
          </div>
        </div>
        <div>
          <h3 className="mb-4 text-lg font-bold">Penetrations</h3>
          {d.penetrations.map((p) => (
            <div
              key={p.id}
              className="mb-3 grid grid-cols-3 gap-2 rounded-md border border-border p-3"
            >
              <div className="col-span-3 flex items-center gap-2 text-xs text-muted-foreground">
                <span
                  aria-hidden="true"
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: PENETRATION_COLORS[p.kind] }}
                />
                {p.kind === "pipe"
                  ? "Pipe identification"
                  : `${p.kind[0]?.toUpperCase() ?? ""}${p.kind.slice(1)} identification`}
              </div>
              <Choice
                label="Type"
                value={p.kind}
                onChange={(v) =>
                  edit({
                    ...d,
                    penetrations: d.penetrations.map((x) =>
                      x.id === p.id ? { ...x, kind: v as typeof p.kind } : x,
                    ),
                  })
                }
                options={["chimney", "skylight", "vent", "pipe", "other"].map((v) => ({
                  value: v,
                  label: v,
                }))}
              />
              {(["x", "z", "width", "length"] as const).map((k) => (
                <Field key={k} label={`${k} (ft)`}>
                  <Input
                    type="number"
                    value={p[k]}
                    onChange={(e) =>
                      edit({
                        ...d,
                        penetrations: d.penetrations.map((x) =>
                          x.id === p.id ? { ...x, [k]: Number(e.target.value) } : x,
                        ),
                      })
                    }
                  />
                </Field>
              ))}
              <Button
                size="icon"
                variant="ghost"
                className="self-end"
                title="Remove penetration"
                aria-label="Remove penetration"
                onClick={() =>
                  edit({ ...d, penetrations: d.penetrations.filter((x) => x.id !== p.id) })
                }
              >
                <Trash2 />
              </Button>
            </div>
          ))}
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              edit({
                ...d,
                penetrations: [
                  ...d.penetrations,
                  { id: crypto.randomUUID(), kind: "pipe", x: 0, z: 0, width: 1, length: 1 },
                ],
              })
            }
          >
            <Plus /> Add penetration
          </Button>
        </div>
      </section>
      <section className="border-t border-border py-6">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-lg font-bold">Private report photos</h3>
          <Button variant="outline" asChild disabled={busy || !property}>
            <label>
              <Upload /> Add image
              <input
                type="file"
                className="sr-only"
                accept="image/jpeg,image/png,image/webp"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void upload(f);
                  e.target.value = "";
                }}
              />
            </label>
          </Button>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          {media.map((m, i) => (
            <div key={m.path}>
              <DrawingImage path={m.path} name={m.name} />
              {m.source && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {m.source}
                  {m.matched_address ? ` · Matched: ${m.matched_address}` : ""}
                  {typeof m.latitude === "number" && typeof m.longitude === "number"
                    ? ` · ${m.latitude.toFixed(5)}, ${m.longitude.toFixed(5)}`
                    : ""}
                </p>
              )}
              <Choice
                label="Photo type"
                value={m.category}
                onChange={(v) => {
                  setMedia(
                    media.map((x, n) => (n === i ? { ...x, category: v as Media["category"] } : x)),
                  );
                  setDirty(true);
                }}
                options={["aerial", "before", "after", "diagram"].map((v) => ({
                  value: v,
                  label: v,
                }))}
              />
            </div>
          ))}
        </div>
      </section>
      <section className="border-t border-border py-6">
        <h3 className="mb-2 text-lg font-bold">Free public aerial & accuracy</h3>
        {aerialError && (
          <p
            role="alert"
            className="mb-3 border-l-2 border-destructive pl-3 text-sm text-destructive"
          >
            {aerialError}
          </p>
        )}
        <p className="mb-3 text-sm text-muted-foreground">
          Looks up the address with the free US Census service and loads public USGS aerial imagery
          when coverage is available. Image dimensions do not establish ground scale: calibrate
          against a known measured distance before tracing. Results are estimates, never
          survey-grade. No paid provider is used.
        </p>
        {aerialStatus && (
          <p
            className="mb-3 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm"
            role="status"
            aria-live="polite"
          >
            {aerialStatus}
          </p>
        )}
        <div className="flex flex-wrap items-end gap-3">
          <Button
            variant="outline"
            disabled={busy || !property || !(report?.address?.trim() || propertyRow?.address)}
            onClick={() => void loadAerial()}
          >
            <Upload /> {busy && aerialStatus ? "Loading aerial…" : "Retry / load public aerial"}
          </Button>
          <div className="w-72">
            <Choice
              label="Measurement basis"
              value={d.accuracy ?? "photo_estimate"}
              onChange={(v) => {
                setD({
                  ...d,
                  accuracy: v as Accuracy,
                  verified: v === "site_verified" ? d.verified : d.verified,
                });
                setDirty(true);
              }}
              options={Object.entries(ACCURACY_LABELS).map(([value, label]) => ({ value, label }))}
            />
          </div>
          <Button
            variant="outline"
            disabled={
              footprintBusy || !property || !(report?.address?.trim() || propertyRow?.address)
            }
            onClick={() => void searchFootprints()}
          >
            {footprintBusy ? "Searching footprints…" : "Find mapped building outline"}
          </Button>
          {media.length > 1 && (
            <div className="w-56">
              <Choice
                label="Photo to trace"
                value={String(traceIndex)}
                onChange={(v) => setTraceIndex(Number(v))}
                options={media.map((m, i) => ({
                  value: String(i),
                  label: `${i + 1}. ${m.category} · ${m.name.slice(0, 30)}`,
                }))}
              />
            </div>
          )}
        </div>
        {footprintMessage && (
          <p
            className="mt-3 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm"
            role="status"
          >
            {footprintMessage}{" "}
            <a
              className="underline underline-offset-4"
              href="https://www.openstreetmap.org/copyright"
              target="_blank"
              rel="noopener noreferrer"
            >
              OpenStreetMap attribution and license
            </a>
          </p>
        )}
        {footprints.length > 0 && (
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {footprints.map((footprint) => (
              <div key={footprint.id} className="rounded-md border border-border p-3 text-sm">
                <p className="font-medium">Mapped building #{footprint.id}</p>
                <svg
                  viewBox="0 0 160 100"
                  role="img"
                  aria-label={`Approximate mapped ground outline for building ${footprint.id}`}
                  className="my-2 h-24 w-full rounded bg-muted/40"
                >
                  {(() => {
                    const cos = Math.cos((footprint.center.lat * Math.PI) / 180);
                    const xy = footprint.points.map((point) => ({
                      x: point.lon * cos,
                      y: -point.lat,
                    }));
                    const minX = Math.min(...xy.map((point) => point.x));
                    const maxX = Math.max(...xy.map((point) => point.x));
                    const minY = Math.min(...xy.map((point) => point.y));
                    const maxY = Math.max(...xy.map((point) => point.y));
                    const width = Math.max(maxX - minX, 1e-9);
                    const height = Math.max(maxY - minY, 1e-9);
                    const scale = Math.min(140 / width, 80 / height);
                    const offsetX = (160 - width * scale) / 2;
                    const offsetY = (100 - height * scale) / 2;
                    const points = xy
                      .map(
                        (point) =>
                          `${(offsetX + (point.x - minX) * scale).toFixed(1)},${(offsetY + (point.y - minY) * scale).toFixed(1)}`,
                      )
                      .join(" ");
                    return (
                      <polygon
                        points={points}
                        fill="currentColor"
                        fillOpacity="0.12"
                        stroke="currentColor"
                        strokeWidth="2"
                        vectorEffect="non-scaling-stroke"
                      />
                    );
                  })()}
                </svg>
                <p className="text-muted-foreground">
                  Approx. ground footprint: {footprint.areaSqFt.toLocaleString()} sq ft ·{" "}
                  {footprint.distanceMeters} m from address point
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {footprint.points.length} outline corners · OSM building type:{" "}
                  {footprint.buildingType}
                </p>
                <a
                  className="mt-2 inline-flex text-xs font-medium text-primary underline underline-offset-4"
                  href={`https://www.openstreetmap.org/way/${footprint.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Inspect source outline on OpenStreetMap
                </a>
              </div>
            ))}
          </div>
        )}
      </section>
      <SatelliteRoofTrace
        key={report?.id ?? initialDrawing?.id ?? property ?? "new-measurement"}
        initialAddress={report?.address?.trim() || propertyRow?.address || ""}
        onAdd={(p) => {
          // A new drawing starts with a sample gable so the workspace is never empty.
          // Replace that sample (or an auto-imported ground footprint) with the first
          // real roof trace; otherwise the sample overlaps the trace and blocks reports.
          const hasImportedFootprint = d.planes.some((item) =>
            item.id.startsWith("osm-footprint-"),
          );
          const replaceStarter =
            !initialDrawing && (!userEditedDrawing.current || hasImportedFootprint);
          const existingPlanes = replaceStarter
            ? []
            : d.planes.filter((item) => !item.id.startsWith("osm-footprint-"));
          edit({ ...d, planes: [...existingPlanes, p] });
          setSelected(p.id);
          setFit((f) => f + 1);
        }}
      />
      {media[traceIndex] && (
        <RoofImageTrace
          key={media[traceIndex].path}
          path={media[traceIndex].path}
          onAdd={(p, replace) => {
            if (replace && !confirm("Replace the current roof with this traced plane?")) return;
            edit({ ...d, planes: replace ? [p] : [...d.planes, p] });
            setSelected(p.id);
            setFit((f) => f + 1);
          }}
        />
      )}
      <section className="flex flex-wrap items-end gap-3 border-t border-border pt-5">
        <Button
          disabled={busy || dirty || !parent || !d.verified}
          onClick={() => void toEstimate()}
        >
          <ArrowRight /> Send to estimator
        </Button>
        <div className="w-64">
          <Choice
            label="Customer job"
            value={jobId || "none"}
            onChange={(v) => setJobId(v === "none" ? "" : v)}
            options={[
              { value: "none", label: "Choose job" },
              ...matchingJobs.map((j) => ({ value: j.id, label: j.title })),
            ]}
          />
        </div>
        <Button
          variant="outline"
          disabled={busy || dirty || !parent || !jobId || !d.verified}
          onClick={() => void toJob()}
        >
          Transfer material measurements
        </Button>
        <Button
          variant="outline"
          disabled={busy || dirty || !parent}
          onClick={() => void exportPdf(true)}
        >
          <FileText /> Prepare customer report
        </Button>
      </section>
    </div>
  );
}
function DrawingImage({ path, name }: { path: string; name: string }) {
  const image = useQuery({
    queryKey: ["drawing-image", path],
    queryFn: async () => {
      const { data, error } = await supabase.storage
        .from("roof-job-photos")
        .createSignedUrl(path, 300);
      if (error || !data) throw error;
      return data.signedUrl;
    },
  });
  return image.data ? (
    <img className="mb-2 aspect-[4/3] w-full rounded-md object-cover" src={image.data} alt={name} />
  ) : (
    <p className="p-4 text-xs text-muted-foreground">
      {image.error ? "Image unavailable" : "Loading image…"}
    </p>
  );
}
