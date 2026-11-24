import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Package, Save, Printer, Mail, FileUp } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { extractRoofReport } from "@/lib/roof-report.functions";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ROOF_TYPES } from "@/lib/instant-estimate-schema";
import {
  materialOrder,
  materialOrderWarnings,
  resolveMaterialOrderSource,
  type MaterialOrderSource,
  escapeMaterialOrderHtml,
  reportSchema,
  type RoofReport,
  type MaterialLine,
} from "@/lib/material-order";
import { Field, Choice } from "./CrmControls";
const fields: [keyof RoofReport, string][] = [
  ["area_sqft", "Roof area (sq ft)"],
  ["waste_pct", "Waste %"],
  ["ridge_lf", "Ridges (ft)"],
  ["hips_lf", "Hips (ft)"],
  ["valleys_lf", "Valleys (ft)"],
  ["eaves_lf", "Eaves (ft)"],
  ["rakes_lf", "Rakes (ft)"],
  ["pipes", "Pipes / vents"],
  ["panel_width_in", "Metal panel width (in)"],
];
export function MaterialOrder({
  jobId,
  title,
  saved,
}: {
  jobId: string;
  title: string;
  saved: Json | null;
}) {
  const qc = useQueryClient();
  const init = reportSchema.safeParse((saved as { report?: unknown } | null)?.report);
  const [r, setR] = useState<RoofReport>(
    init.success
      ? init.data
      : {
          roof_type: "Shingle Roof",
          area_sqft: 0,
          waste_pct: 10,
          ridge_lf: 0,
          hips_lf: 0,
          valleys_lf: 0,
          eaves_lf: 0,
          rakes_lf: 0,
          panel_width_in: 16,
          pipes: 0,
        },
  );
  const initialSource = resolveMaterialOrderSource(saved);
  const [source, setSource] = useState<MaterialOrderSource>(initialSource.source);
  const [drawingId, setDrawingId] = useState<string | undefined>(initialSource.drawingId);
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [aiNote, setAiNote] = useState("");
  const extract = useServerFn(extractRoofReport);
  async function readReport(file: File) {
    const types = ["application/pdf", "image/jpeg", "image/png", "image/webp"] as const;
    const mime = types.find((t) => t === file.type);
    if (!mime || file.size > 10 * 1024 * 1024) {
      toast.error("Upload a PDF, JPG, PNG or WebP under 10 MB");
      return;
    }
    setReading(true);
    try {
      const buf = new Uint8Array(await file.arrayBuffer());
      let bin = "";
      for (let i = 0; i < buf.length; i += 0x8000)
        bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      const res = await extract({ data: { filename: file.name, mime, base64: btoa(bin) } });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      const x = res.report;
      const next = { ...r };
      if (x.roof_type) next.roof_type = x.roof_type;
      (
        [
          "area_sqft",
          "waste_pct",
          "ridge_lf",
          "hips_lf",
          "valleys_lf",
          "eaves_lf",
          "rakes_lf",
          "pipes",
        ] as const
      ).forEach((k) => {
        const v = x[k];
        if (v !== null) next[k] = Math.round(v * 10) / 10;
      });
      setR(next);
      setSource("uploaded_report");
      setDrawingId(undefined);
      setAiNote([x.pitch ? `Pitch: ${x.pitch}` : "", x.notes].filter(Boolean).join(" — "));
      toast.success("Measurements filled in — please double-check them");
    } catch {
      toast.error("Could not read the report");
    } finally {
      setReading(false);
    }
  }
  const valid = reportSchema.safeParse(r);
  const lines: MaterialLine[] = useMemo(
    () => (valid.success ? materialOrder(valid.data) : []),
    [valid.success, r],
  );
  const warnings = valid.success ? materialOrderWarnings(valid.data) : [];
  const sourceLabel = resolveMaterialOrderSource({ source, ...(source === "drawing" && drawingId ? { drawing_id: drawingId } : {}) }).label;
  const text = `Material order – ${title}
Source: ${sourceLabel}
${r.roof_type}, ${r.area_sqft} sq ft (+${r.waste_pct}% waste)
${warnings.length ? `\nREVIEW REQUIRED:\n${warnings.map((warning) => `- ${warning}`).join("\n")}\n` : ""}
${lines.map((l) => `- ${l.item}: ${l.qty} ${l.unit}`).join("\n")}

Roofer Masters · 305-942-3093`;
  async function save() {
    if (!valid.success) return;
    setBusy(true);
    const { error } = await supabase
      .from("roof_jobs")
      .update({
        material_order: {
          report: valid.data,
          lines,
          source,
          ...(source === "drawing" && drawingId ? { drawing_id: drawingId } : {}),
          updated_at: new Date().toISOString(),
        } as unknown as Json,
      })
      .eq("id", jobId);
    setBusy(false);
    if (error) toast.error("Could not save order");
    else {
      toast.success("Material order saved");
      await qc.invalidateQueries({ queryKey: ["roof-jobs"] });
    }
  }
  function print() {
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(
      `<pre style="font:14px sans-serif;white-space:pre-wrap">${escapeMaterialOrderHtml(text)}</pre>`,
    );
    w.document.close();
    w.print();
  }
  return (
    <section className="border-t border-border pt-5">
      <h3 className="mb-1 flex items-center gap-2 font-bold">
        <Package className="size-5 text-primary" /> Material order
      </h3>
      <p className="mb-4 text-sm text-muted-foreground">
        Enter the roof size and measurements from the roof report — materials are calculated
        automatically.
      </p>
      <p className="mb-3 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs" role="status">Estimate source: <strong>{sourceLabel}</strong>{source === "drawing" ? " · Review drawing revision before ordering." : ""}</p>
      <div className="mb-4 rounded-md border border-dashed border-border p-4">
        <Button asChild variant="secondary" disabled={reading}>
          <label className="cursor-pointer">
            <FileUp /> {reading ? "Reading report…" : "Upload roof report (AI)"}
            <input
              type="file"
              accept="application/pdf,image/jpeg,image/png,image/webp"
              className="sr-only"
              disabled={reading}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void readReport(f);
                e.target.value = "";
              }}
            />
          </label>
        </Button>
        <p className="mt-2 text-xs text-muted-foreground">
          PDF or photo of an EagleView, Hover or similar report. AI fills in area, edges, valleys
          and pipes.
        </p>
        {aiNote && <p className="mt-2 text-sm">{aiNote}</p>}
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        <Choice
          label="Roof type"
          value={r.roof_type}
          onChange={(v) => { setR({ ...r, roof_type: v as RoofReport["roof_type"] }); setSource("manual"); setDrawingId(undefined); }}
          options={ROOF_TYPES.map((t) => ({ value: t, label: t }))}
        />
        {fields
          .filter(([k]) => k !== "panel_width_in" || r.roof_type === "Metal Roof")
          .map(([k, label]) => (
            <Field key={k} label={label}>
              <Input
                type="number"
                min={0}
                inputMode="decimal"
                value={(r[k] as number | undefined) ?? (k === "panel_width_in" ? 16 : 0)}
                onChange={(e) => { setR({ ...r, [k]: Number(e.target.value) || 0 }); setSource("manual"); setDrawingId(undefined); }}
              />
            </Field>
          ))}
      </div>
      {warnings.length > 0 && (
        <div
          role="note"
          className="mt-4 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm"
        >
          <p className="mb-1 font-semibold">Metal panel takeoff — review required</p>
          <ul className="list-disc space-y-1 pl-5">
            {warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      )}
      {lines.length ? (
        <table className="mt-4 w-full text-sm">
          <tbody>
            {lines.map((l) => (
              <tr key={l.item} className="border-b border-border">
                <td className="py-2">{l.item}</td>
                <td className="py-2 text-right font-semibold">
                  {l.qty} {l.unit}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">
          Enter the roof area to build the order.
        </p>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button onClick={() => void save()} disabled={busy || !lines.length}>
          <Save /> Save order
        </Button>
        <Button variant="outline" onClick={print} disabled={!lines.length}>
          <Printer /> Print
        </Button>
        <Button variant="outline" asChild disabled={!lines.length}>
          <a
            href={`mailto:?subject=${encodeURIComponent(`Material order – ${title}`)}&body=${encodeURIComponent(text)}`}
          >
            <Mail /> Email to supplier
          </a>
        </Button>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Quantities are estimates — confirm with your supplier before ordering.
      </p>
    </section>
  );
}
