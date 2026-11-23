import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Package, Save, Printer, Mail, FileText } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ROOF_TYPES } from "@/lib/instant-estimate-schema";
import {
  materialOrder,
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
  const [busy, setBusy] = useState(false);
  const valid = reportSchema.safeParse(r);
  const lines: MaterialLine[] = useMemo(
    () => (valid.success ? materialOrder(valid.data) : []),
    [valid.success, r],
  );
  const text = `Material order – ${title}\n${r.roof_type}, ${r.area_sqft} sq ft (+${r.waste_pct}% waste)\n\n${lines.map((l) => `- ${l.item}: ${l.qty} ${l.unit}`).join("\n")}\n\nRoofer Masters · 305-942-3093`;

  async function save() {
    if (!valid.success) return;
    setBusy(true);
    const { error } = await supabase
      .from("roof_jobs")
      .update({
        material_order: {
          report: valid.data,
          lines,
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
      `<pre style="font:14px sans-serif;white-space:pre-wrap">${text.replace(/</g, "&lt;")}</pre>`,
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
        Enter the measurements from your roof report. Material quantities calculate automatically.
      </p>
      <div className="mb-4 flex gap-3 rounded-md border border-border bg-muted/30 p-4">
        <FileText className="mt-0.5 size-5 shrink-0 text-primary" />
        <div>
          <p className="text-sm font-medium">No paid AI or report-reading credits used</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Keep your EagleView, Hover or other report open and copy its measurements into the
            fields below. Automatic AI extraction is intentionally disabled to keep this CRM free
            of metered AI charges.
          </p>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        <Choice
          label="Roof type"
          value={r.roof_type}
          onChange={(v) => setR({ ...r, roof_type: v as RoofReport["roof_type"] })}
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
                onChange={(e) => setR({ ...r, [k]: Number(e.target.value) || 0 })}
              />
            </Field>
          ))}
      </div>
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
