import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Save, FileText } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  advancedOptionSchema,
  priceOption,
  materialSystem,
  COST_CATEGORIES,
  type EstimateOption,
} from "@/lib/advanced-estimate";
import { drawingSchema, toMaterialReport } from "@/lib/roof-geometry";
import { materialOrder } from "@/lib/material-order";
import { money } from "@/lib/crm-schema";
import { ROOF_CATEGORIES } from "@/lib/proposal-schema";
import { costCatalogQuery } from "./cost-data";
import { drawingsQuery } from "./roof-data";
import { customersQuery, propertiesQuery } from "./foundation-data";
import { estimatesQuery } from "./operations-data";
import { Choice, Field, SectionHeading } from "./CrmControls";
import { useCrm } from "./CrmContext";
const blank = (index = 1): EstimateOption => ({
  id: crypto.randomUUID(),
  name: `Option ${index}`,
  system: "Metal Roof",
  lines: [],
  overhead_pct: 0,
  margin_pct: 0,
  discount_cents: 0,
  tax_pct: 0,
  deposit_pct: 0,
});
export function AdvancedEstimator() {
  const catalog = useQuery(costCatalogQuery),
    drawings = useQuery(drawingsQuery),
    customers = useQuery(customersQuery),
    properties = useQuery(propertiesQuery),
    estimates = useQuery(estimatesQuery),
    qc = useQueryClient();
  const { go } = useCrm();
  const [options, setOptions] = useState<EstimateOption[]>(() => [blank()]),
    [selected, setSelected] = useState(0),
    [drawingId, setDrawingId] = useState(""),
    [title, setTitle] = useState("Roofing estimate options"),
    [savedId, setSavedId] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [dirty, setDirty] = useState(true);
  const o = options[selected];
  const drawing = drawings.data?.find((d) => d.id === drawingId),
    property = properties.data?.find((p) => p.id === drawing?.property_id),
    customer = customers.data?.find((c) => c.id === property?.customer_id);
  let totals: ReturnType<typeof priceOption> | null = null;
  try {
    if (o) totals = priceOption(o);
  } catch {}
  function update(next: EstimateOption) {
    setOptions(options.map((v, i) => (i === selected ? next : v)));
    setDirty(true);
  }
  async function save() {
    if (
      !drawing ||
      !customer?.source_lead_id ||
      options.some((v) => !advancedOptionSchema.safeParse(v).success)
    ) {
      toast.error("Choose a drawing and complete each option");
      return;
    }
    let prices;
    try {
      prices = options.map(priceOption);
    } catch {
      toast.error("Correct pricing values");
      return;
    }
    setBusy(true);
    const data = {
      title,
      lead_id: customer.source_lead_id,
      property_id: property?.id ?? null,
      drawing_id: drawing.id,
      category: options[0]?.system ?? "Roofing",
      inputs: { measurement: drawing.measurements },
      options: options as unknown as Json,
      total_cents: prices[0]?.total ?? 0,
    };
    const result = savedId
      ? await supabase.from("roof_estimates").update(data).eq("id", savedId).select("id").single()
      : await supabase.from("roof_estimates").insert(data).select("id").single();
    setBusy(false);
    if (result.error || !result.data) {
      toast.error("Could not save estimate options");
      return;
    }
    setSavedId(result.data.id);
    setDirty(false);
    await qc.invalidateQueries({ queryKey: ["roof-estimates"] });
    toast.success("Estimate options saved");
  }
  function importMaterials() {
    if (!o || !drawing) return;
    const parsed = drawingSchema.safeParse(drawing.geometry);
    if (!parsed.success || !parsed.data.verified) {
      toast.error("Review and save drawing measurements first");
      return;
    }
    const system = materialSystem(o.system);
    if (!system) {
      toast.error("Add catalog or manual items for this roofing system");
      return;
    }
    if (o.lines.length && !confirm("Replace this option’s cost items with measured materials?"))
      return;
    try {
      const report = toMaterialReport({ ...parsed.data, roof_type: system });
      update({
        ...o,
        lines: materialOrder(report)
          .filter((l) => l.qty > 0 && !l.item.includes("Average panel length"))
          .map((l) => {
            const price = catalog.data?.find((c) => c.system === o.system && c.item === l.item);
            return {
              id: crypto.randomUUID(),
              description: l.item,
              category: "materials",
              unit: l.unit,
              quantity: l.qty,
              unit_cents: price?.unit_cents ?? 0,
            };
          }),
      });
      toast.success("Measured quantities added; review all unit prices");
    } catch {
      toast.error("Drawing measurements are invalid");
    }
  }
  async function proposal() {
    if (!savedId || dirty || !o || !totals || !customer?.source_lead_id) {
      toast.error("Save the estimate before preparing a proposal");
      return;
    }
    const unpricedItems = o.lines.filter((line) => line.quantity > 0 && line.unit_cents <= 0);
    if (unpricedItems.length) {
      toast.error(
        `Add approved unit prices for ${unpricedItems.length} cost item(s) before creating a customer proposal`,
      );
      return;
    }
    setBusy(true);
    let id: string | null = null;
    try {
      const scope = `${o.system}\n${drawing ? `${Number((drawing.measurements as Record<string, Json>)["area"]).toFixed(1)} square feet\n` : ""}${o.lines.map((l) => `${l.description}: ${l.quantity} ${l.unit}`).join("\n")}\nDeposit: ${money(totals.deposit)}\nBalance: ${money(totals.balance)}\nTax included: ${money(totals.tax)}`;
      const details = {
        title: `${title} — ${o.name}`,
        category: ROOF_CATEGORIES.find((c) => c === o.system) ?? "Other",
        is_template: false,
        lead_id: customer.source_lead_id,
        scope,
        terms: "",
        amount: totals.total / 100,
      };
      const { data: row, error } = await supabase
        .from("proposals")
        .insert({ ...details, property_id: property?.id ?? null, drawing_id: drawingId })
        .select("id")
        .single();
      if (error || !row) throw error;
      id = row.id;
      const { generateProposalPdf } = await import("@/lib/proposal-pdf");
      const bytes = await generateProposalPdf(details, {
        name: customer.name,
        address: property?.address ?? "",
        email: customer.email,
      });
      const { uploadProposalPdf } = await import("./proposal-data");
      const file = await uploadProposalPdf(row.id, bytes);
      const { error: updated } = await supabase
        .from("proposals")
        .update({ file_path: file })
        .eq("id", row.id);
      if (updated) throw updated;
      await qc.invalidateQueries({ queryKey: ["proposals"] });
      toast.success("Customer proposal created without internal costs");
      go("proposals");
    } catch {
      if (id) await supabase.from("proposals").delete().eq("id", id);
      toast.error("Could not create customer proposal");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      <SectionHeading
        title="Detailed roofing estimator"
        action={
          <Button disabled={busy} onClick={() => void save()}>
            <Save /> Save options
          </Button>
        }
      />
      <div className="mb-5 grid gap-4 md:grid-cols-3">
        <Field label="Estimate title">
          <Input
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              setDirty(true);
            }}
          />
        </Field>
        <Choice
          label="Measurement drawing"
          value={drawingId || "none"}
          onChange={(v) => {
            setDrawingId(v === "none" ? "" : v);
            setDirty(true);
          }}
          options={[
            { value: "none", label: "Choose saved drawing" },
            ...(drawings.data ?? []).map((d) => ({
              value: d.id,
              label: `${d.title} · revision ${d.revision}`,
            })),
          ]}
        />
        <Choice
          label="Saved estimates"
          value={savedId ?? "new"}
          onChange={(v) => {
            if (v === "new") {
              setOptions([blank()]);
              setSelected(0);
              setSavedId(null);
              setTitle("Roofing estimate options");
              setDirty(true);
              return;
            }
            const row = estimates.data?.find((e) => e.id === v);
            if (!row || !Array.isArray(row.options)) return;
            const parsed = row.options.map((x) => advancedOptionSchema.safeParse(x));
            if (parsed.some((x) => !x.success)) {
              toast.error("Estimate options are invalid");
              return;
            }
            const next = parsed.flatMap((x) => (x.success ? [x.data] : []));
            if (!next.length) return;
            setOptions(next);
            setSelected(0);
            setDrawingId(row.drawing_id ?? "");
            setTitle(row.title);
            setSavedId(row.id);
            setDirty(false);
          }}
          options={[
            { value: "new", label: "New estimate" },
            ...(estimates.data ?? [])
              .filter((e) => Array.isArray(e.options) && e.options.length)
              .map((e) => ({ value: e.id, label: e.title })),
          ]}
        />
      </div>
      <div className="mb-5 flex flex-wrap gap-2">
        {options.map((option, i) => (
          <Button
            key={option.id}
            variant={i === selected ? "secondary" : "outline"}
            onClick={() => setSelected(i)}
          >
            {option.name}
          </Button>
        ))}
        <Button
          variant="ghost"
          onClick={() => {
            setOptions([...options, blank(options.length + 1)]);
            setSelected(options.length);
            setDirty(true);
          }}
        >
          <Plus /> Comparison option
        </Button>
      </div>
      {o && (
        <>
          <div className="mb-5 grid gap-4 md:grid-cols-3">
            <Field label="Option name">
              <Input value={o.name} onChange={(e) => update({ ...o, name: e.target.value })} />
            </Field>
            <Field label="Roof system">
              <Input
                list="roof-system-options"
                value={o.system}
                onChange={(e) => update({ ...o, system: e.target.value })}
              />
              <datalist id="roof-system-options">
                {[
                  "Metal Roof",
                  "Standing seam",
                  "Tile Roof",
                  "Shingle Roof",
                  "TPO",
                  "Flat Roof",
                  "Modified bitumen",
                  "Built-up",
                  "Coatings",
                  "Gutters",
                  "Fascia",
                  "Soffit",
                  "Repairs",
                  "Waterproofing",
                ].map((v) => (
                  <option key={v} value={v} />
                ))}
              </datalist>
            </Field>
            <Button
              variant="outline"
              className="self-end"
              disabled={!drawing}
              onClick={importMaterials}
            >
              Import measured materials
            </Button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px] text-sm">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="py-3">Item</th>
                  <th>Category</th>
                  <th>Quantity</th>
                  <th>Unit</th>
                  <th>Unit cost $</th>
                  <th>Total</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {o.lines.map((l, i) => (
                  <tr key={l.id} className="border-t border-border">
                    <td className="w-56 py-2 pr-2">
                      <Input
                        aria-label={`Item ${i + 1}`}
                        value={l.description}
                        onChange={(e) =>
                          update({
                            ...o,
                            lines: o.lines.map((x, n) =>
                              n === i ? { ...x, description: e.target.value } : x,
                            ),
                          })
                        }
                      />
                    </td>
                    <td className="w-40 pr-2">
                      <Choice
                        label=""
                        value={l.category}
                        onChange={(v) =>
                          update({
                            ...o,
                            lines: o.lines.map((x, n) =>
                              n === i ? { ...x, category: v as typeof l.category } : x,
                            ),
                          })
                        }
                        options={COST_CATEGORIES.map((v) => ({
                          value: v,
                          label: v.replaceAll("_", " "),
                        }))}
                      />
                    </td>
                    <td className="w-24 pr-2">
                      <Input
                        aria-label={`Quantity ${i + 1}`}
                        type="number"
                        min={0.01}
                        step="0.01"
                        value={l.quantity}
                        onChange={(e) =>
                          update({
                            ...o,
                            lines: o.lines.map((x, n) =>
                              n === i ? { ...x, quantity: Number(e.target.value) } : x,
                            ),
                          })
                        }
                      />
                    </td>
                    <td className="w-24 pr-2">
                      <Input
                        value={l.unit}
                        onChange={(e) =>
                          update({
                            ...o,
                            lines: o.lines.map((x, n) =>
                              n === i ? { ...x, unit: e.target.value } : x,
                            ),
                          })
                        }
                      />
                    </td>
                    <td className="w-28 pr-2">
                      <Input
                        aria-label={`Unit cost ${i + 1}`}
                        type="number"
                        min={0}
                        step="0.01"
                        value={l.unit_cents / 100}
                        onChange={(e) =>
                          update({
                            ...o,
                            lines: o.lines.map((x, n) =>
                              n === i
                                ? { ...x, unit_cents: Math.round(Number(e.target.value) * 100) }
                                : x,
                            ),
                          })
                        }
                      />
                    </td>
                    <td className="whitespace-nowrap">
                      {money(Math.round(l.quantity * l.unit_cents))}
                    </td>
                    <td>
                      <Button
                        size="icon"
                        variant="ghost"
                        title="Remove estimate item"
                        aria-label="Remove estimate item"
                        onClick={() => update({ ...o, lines: o.lines.filter((_, n) => n !== i) })}
                      >
                        <Trash2 />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="my-4 flex flex-wrap gap-3">
            <Button
              variant="outline"
              onClick={() =>
                update({
                  ...o,
                  lines: [
                    ...o.lines,
                    {
                      id: crypto.randomUUID(),
                      description: "",
                      category: "materials",
                      quantity: 1,
                      unit: "each",
                      unit_cents: 0,
                    },
                  ],
                })
              }
            >
              <Plus /> Add cost item
            </Button>
            <div className="w-64">
              <Choice
                label="Add catalog item"
                value="none"
                onChange={(id) => {
                  const c = catalog.data?.find((c) => c.id === id);
                  if (c)
                    update({
                      ...o,
                      lines: [
                        ...o.lines,
                        {
                          id: crypto.randomUUID(),
                          description: c.item,
                          category: COST_CATEGORIES.find((k) => k === c.category) ?? "other",
                          quantity: 1,
                          unit: c.unit,
                          unit_cents: c.unit_cents,
                        },
                      ],
                    });
                }}
                options={[
                  { value: "none", label: "Choose catalog price" },
                  ...(catalog.data ?? []).map((c) => ({
                    value: c.id,
                    label: `${c.item} · ${money(c.unit_cents)}`,
                  })),
                ]}
              />
            </div>
          </div>
          <div className="grid gap-4 border-t border-border py-6 sm:grid-cols-3 lg:grid-cols-5">
            {(
              ["overhead_pct", "margin_pct", "tax_pct", "deposit_pct", "discount_cents"] as const
            ).map((k) => (
              <Field
                key={k}
                label={
                  k === "discount_cents"
                    ? "Discount ($)"
                    : `${k.replace("_pct", "").replace("_", " ")} (%)`
                }
              >
                <Input
                  aria-label={k}
                  type="number"
                  min={0}
                  max={k === "margin_pct" ? 95 : k === "discount_cents" ? undefined : 100}
                  step="0.01"
                  value={k === "discount_cents" ? o[k] / 100 : o[k]}
                  onChange={(e) =>
                    update({
                      ...o,
                      [k]:
                        k === "discount_cents"
                          ? Math.round(Number(e.target.value) * 100)
                          : Number(e.target.value),
                    })
                  }
                />
              </Field>
            ))}
          </div>
          {totals ? (
            <div className="grid gap-5 border-y border-border py-6 sm:grid-cols-3">
              {[
                ["Internal cost", totals.cost],
                ["Internal profit before tax", totals.profit],
                ["Customer total", totals.total],
                ["Deposit", totals.deposit],
                ["Balance", totals.balance],
                ["Tax", totals.tax],
              ].map(([label, value]) => (
                <div key={label}>
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className="mt-1 text-xl font-bold">{money(Number(value))}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="py-4 text-sm text-muted-foreground">
              Complete valid cost items to calculate this option.
            </p>
          )}
          <div className="mt-5 flex gap-3">
            <Button
              disabled={busy || dirty || !savedId || !totals || totals.total <= 0}
              onClick={() => void proposal()}
            >
              <FileText /> Customer proposal
            </Button>
            {options.length > 1 && (
              <Button
                variant="ghost"
                className="text-destructive"
                onClick={() => {
                  setOptions(options.filter((_, i) => i !== selected));
                  setSelected(0);
                  setDirty(true);
                }}
              >
                <Trash2 /> Remove option
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
