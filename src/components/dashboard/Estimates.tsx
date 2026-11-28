import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Calculator, Save, FileText, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  calculateEstimate,
  estimateInputSchema,
  money,
  type EstimateInputs,
} from "@/lib/crm-schema";
import { ROOF_CATEGORIES, proposalSchema } from "@/lib/proposal-schema";
import { instantInputSchema } from "@/lib/instant-estimate-schema";
import { estimatesQuery } from "./operations-data";
import { Field, NumberField, CustomerSelect, Choice, SectionHeading } from "./CrmControls";
import { uploadProposalPdf } from "./proposal-data";
import type { Lead } from "./data";
const initial: EstimateInputs = {
  sqft: 0,
  waste: 10,
  material: 0,
  labor: 0,
  permits: 0,
  other: 0,
  margin: 0,
};
export function Estimates({
  leads,
  onOpenProposals,
}: {
  leads: Lead[];
  onOpenProposals: () => void;
}) {
  const [input, setInput] = useState(initial);
  const [title, setTitle] = useState("Roofing estimate");
  const [category, setCategory] = useState("Metal Roof");
  const [customer, setCustomer] = useState("");
  const [selectedEstimateId, setSelectedEstimateId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const estimates = useQuery(estimatesQuery);
  const qc = useQueryClient();
  const parsed = estimateInputSchema.safeParse(input);
  const result = parsed.success ? calculateEstimate(parsed.data) : null;
  const fields: [keyof EstimateInputs, string][] = [
    ["sqft", "Roof area (sq ft)"],
    ["waste", "Material waste (%)"],
    ["material", "Material ($ / square)"],
    ["labor", "Labor ($ / square)"],
    ["permits", "Permits ($)"],
    ["other", "Other costs ($)"],
    ["margin", "Profit margin (%)"],
  ];
  async function save() {
    if (!result || result.total <= 0) {
      toast.error("Enter roof area and costs first");
      return;
    }
    setBusy(true);
    try {
      const selectedLead = leads.find((lead) => lead.id === customer);
      const existingEstimate = estimates.data?.find((estimate) => estimate.id === selectedEstimateId);
      const companyId = selectedLead?.company_id ?? (!customer ? existingEstimate?.company_id : null);
      if (!companyId) throw new Error("Select a customer or load an estimate with verified company ownership");
      if (existingEstimate && existingEstimate.company_id !== companyId)
        throw new Error("The selected customer does not belong to this estimate's company");
      const payload = {
        title,
        category,
        lead_id: customer || null,
        company_id: companyId,
        inputs: input,
        total_cents: result.total,
      };
      const query = selectedEstimateId
        ? supabase.from("roof_estimates").update(payload).eq("id", selectedEstimateId).eq("company_id", companyId)
        : supabase.from("roof_estimates").insert(payload);
      const { data, error } = await query.select("id").single();
      if (error || !data) throw error;
      setSelectedEstimateId(data.id);
      await qc.invalidateQueries({ queryKey: ["roof-estimates"] });
      toast.success(selectedEstimateId ? "Estimate updated" : "Estimate saved");
    } catch {
      toast.error("Could not save estimate");
    } finally {
      setBusy(false);
    }
  }
  async function toProposal() {
    if (!result || result.total <= 0 || !customer) {
      toast.error("Choose a customer and enter costs first");
      return;
    }
    setBusy(true);
    let id: string | null = null;
    let pdfPath: string | null = null;
    try {
      const proposalLead = leads.find((item) => item.id === customer);
      if (!proposalLead?.company_id) throw new Error("Customer company ownership could not be verified");
      const linkedEstimate = estimates.data?.find((e) => e.id === selectedEstimateId);
      if (linkedEstimate && linkedEstimate.company_id !== proposalLead.company_id)
        throw new Error("The estimate and customer belong to different companies");
      const scope = `${input.sqft} sq ft (${result.squares.toFixed(2)} roofing squares).\nMaterial allowance: ${result.materialSquares.toFixed(2)} squares, including ${input.waste}% waste.\n${category} roofing work; final scope and measurements subject to inspection. Internal costs and profit are excluded from this customer-facing proposal.`;
      const details = proposalSchema.parse({
        title,
        category,
        is_template: false,
        lead_id: customer,
        scope,
        terms: "",
        amount: result.total / 100,
      });
      const { data, error } = await supabase
        .from("proposals")
        .insert({
          ...details,
          company_id: proposalLead.company_id,
          ...(linkedEstimate?.property_id ? { property_id: linkedEstimate.property_id } : {}),
          ...(linkedEstimate?.drawing_id ? { drawing_id: linkedEstimate.drawing_id } : {}),
        })
        .select("id")
        .single();
      if (error || !data) throw error;
      id = data.id;
      const { generateProposalPdf } = await import("@/lib/proposal-pdf");
      const bytes = await generateProposalPdf(
        details,
        proposalLead ? { name: proposalLead.name, address: proposalLead.address, email: proposalLead.email } : undefined,
      );
      pdfPath = await uploadProposalPdf(id, bytes);
      const { error: updateError } = await supabase
        .from("proposals")
        .update({ file_path: pdfPath })
        .eq("id", id)
        .eq("company_id", proposalLead.company_id);
      if (updateError) throw updateError;
      await qc.invalidateQueries({ queryKey: ["proposals"] });
      toast.success("Proposal created from estimate");
      onOpenProposals();
    } catch {
      if (pdfPath) await supabase.storage.from("roofing-proposals").remove([pdfPath]);
      if (id) await supabase.from("proposals").delete().eq("id", id).eq("company_id", leads.find((proposalLead) => proposalLead.id === customer)?.company_id ?? "");
      toast.error("Could not create proposal");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      <SectionHeading title="Roofing estimates" />
      <div className="grid gap-8 lg:grid-cols-[1fr_320px]">
        <form
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <Field label="Estimate title">
            <Input required value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Choice
            label="Roof category"
            value={category}
            onChange={setCategory}
            options={ROOF_CATEGORIES.map((c) => ({ value: c, label: c }))}
          />
          <div className="sm:col-span-2">
            <CustomerSelect leads={leads} value={customer} optional onChange={setCustomer} />
          </div>
          {fields.map(([key, label]) => (
            <NumberField
              key={key}
              label={label}
              value={input[key]}
              onChange={(v) => setInput({ ...input, [key]: v })}
              {...(key === "margin" ? { max: 95 } : key === "waste" ? { max: 100 } : {})}
            />
          ))}
          <div className="flex flex-wrap gap-2 sm:col-span-2">
            <Button type="submit" disabled={busy}>
              <Save /> Save estimate
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy || !customer}
              onClick={() => void toProposal()}
            >
              <FileText /> Create proposal
            </Button>
          </div>
        </form>
        <aside className="border-t border-border pt-5 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
          <h3 className="mb-5 flex items-center gap-2 font-bold">
            <Calculator className="size-5 text-primary" /> Estimate breakdown
          </h3>
          {result ? (
            <dl className="grid grid-cols-2 gap-4 text-sm">
              <dt>Roof squares</dt>
              <dd className="text-right">{result.squares.toFixed(2)}</dd>
              <dt>Material squares</dt>
              <dd className="text-right">{result.materialSquares.toFixed(2)}</dd>
              <dt>Materials</dt>
              <dd className="text-right">{money(result.materialCents)}</dd>
              <dt>Labor</dt>
              <dd className="text-right">{money(result.laborCents)}</dd>
              <dt>Job cost</dt>
              <dd className="text-right">{money(result.cost)}</dd>
              <dt>Estimated profit</dt>
              <dd className="text-right">{money(result.profit)}</dd>
              <dt className="border-t border-border pt-4 font-bold">Proposal total</dt>
              <dd className="border-t border-border pt-4 text-right text-xl font-bold text-primary">
                {money(result.total)}
              </dd>
            </dl>
          ) : (
            <p className="text-sm text-muted-foreground">Enter a positive roof area.</p>
          )}
        </aside>
      </div>
      <section className="mt-10 border-t border-border pt-6">
        <h3 className="mb-4 text-lg font-bold">Saved estimates</h3>
        {estimates.error && <p className="text-destructive">Could not load estimates.</p>}
        {estimates.data?.map((e) => (
          <div key={e.id} className="flex flex-wrap items-center gap-3 border-b border-border py-4">
            <div className="min-w-0 flex-1">
              <p className="font-semibold">{e.title}</p>
              <p className="text-sm text-muted-foreground">
                {e.category} · {leads.find((l) => l.id === e.lead_id)?.name ?? "Unassigned"}
              </p>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                {e.property_id && e.drawing_id && (
                  <span className="rounded-full border border-primary/30 bg-primary/5 px-2 py-0.5 text-primary">
                    Linked roof report
                  </span>
                )}
                {(() => {
                  const roofInputs = estimateInputSchema.safeParse(e.inputs);
                  return roofInputs.success ? (
                    <span className="text-muted-foreground">
                      {roofInputs.data.sqft.toLocaleString()} sq ft · {roofInputs.data.waste}% waste
                    </span>
                  ) : null;
                })()}
                {e.total_cents === 0 && (
                  <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-muted-foreground">
                    Pricing needed
                  </span>
                )}
              </div>
            </div>
            <p className="font-bold">{money(e.total_cents)}</p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                const parsed = estimateInputSchema.safeParse(e.inputs);
                const instant = instantInputSchema.safeParse(e.inputs);
                if (parsed.success) {
                  setInput(parsed.data);
                } else if (instant.success) {
                  setInput({ ...initial, sqft: instant.data.sqft });
                  toast.info(
                    `Preliminary budget: ${money(e.total_cents)}. Add inspected costs before creating a final proposal.`,
                  );
                } else {
                  toast.error("This estimate cannot be loaded");
                  return;
                }
                setTitle(e.title);
                setCategory(e.category);
                setCustomer(e.lead_id ?? "");
                setSelectedEstimateId(e.id);
              }}
            >
              Load
            </Button>
            <Button
              size="icon"
              variant="ghost"
              title="Delete estimate"
              aria-label="Delete estimate"
              onClick={async () => {
                if (!confirm("Delete this saved estimate?")) return;
                const { error } = await supabase.from("roof_estimates").delete().eq("id", e.id).eq("company_id", e.company_id);
                if (error) toast.error("Could not delete estimate");
                else await qc.invalidateQueries({ queryKey: ["roof-estimates"] });
              }}
            >
              <Trash2 />
            </Button>
          </div>
        ))}
        {!estimates.data?.length && (
          <p className="text-sm text-muted-foreground">No saved estimates.</p>
        )}
      </section>
    </div>
  );
}
