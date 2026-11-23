import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Plus, Save, Mail } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, Choice } from "./CrmControls";
import { createChangeOrder } from "@/lib/change-orders.functions";
import { changeOrderSchema } from "@/lib/instant-estimate-schema";
import { money } from "@/lib/crm-schema";
export function ChangeOrders({ jobId, email }: { jobId: string; email: string }) {
  const qc = useQueryClient();
  const saveFn = useServerFn(createChangeOrder);
  const query = useQuery({
    queryKey: ["change-orders", jobId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("job_change_orders")
        .select("*")
        .eq("job_id", jobId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [scope, setScope] = useState("");
  const [amount, setAmount] = useState("0");
  const [days, setDays] = useState("0");
  const [status, setStatus] = useState("draft");
  const [signer, setSigner] = useState("");
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      const data = changeOrderSchema.parse({
        job_id: jobId,
        title,
        scope,
        amount_cents: Math.round(Number(amount) * 100),
        days_added: Number(days),
        status,
        approved_by: signer,
      });
      await saveFn({ data });
      await qc.invalidateQueries({ queryKey: ["change-orders", jobId] });
      setAdding(false);
      setTitle("");
      setScope("");
      setAmount("0");
      setDays("0");
      setStatus("draft");
      setSigner("");
      toast.success("Change order saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save change order");
    } finally {
      setBusy(false);
    }
  }
  const approved = (query.data ?? []).filter((o) => o.status === "approved");
  return (
    <section className="border-t border-border pt-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-bold">Change orders</h3>
        <Button size="sm" variant="outline" onClick={() => setAdding(!adding)}>
          <Plus />
          Add change
        </Button>
      </div>
      <p className="mt-3 text-sm text-muted-foreground">
        Approved changes: {money(approved.reduce((sum, o) => sum + o.amount_cents, 0))} ·{" "}
        {approved.reduce((sum, o) => sum + o.days_added, 0)} days. Invoices are not changed
        automatically.
      </p>
      {query.error && <p className="text-destructive">Could not load changes.</p>}
      {adding && (
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <Field label="Change title">
            <Input maxLength={180} value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Choice
            label="Approval status"
            value={status}
            onChange={setStatus}
            options={["draft", "pending", "approved", "rejected"].map((v) => ({
              value: v,
              label: v[0]?.toUpperCase() + v.slice(1),
            }))}
          />
          <div className="sm:col-span-2">
            <Field label="Scope and reason">
              <Textarea maxLength={4000} value={scope} onChange={(e) => setScope(e.target.value)} />
            </Field>
          </div>
          <Field label="Price change ($; negative for credit)">
            <Input
              type="number"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </Field>
          <Field label="Schedule change (days)">
            <Input
              type="number"
              step="1"
              min={-365}
              max={365}
              value={days}
              onChange={(e) => setDays(e.target.value)}
            />
          </Field>
          {status === "approved" && (
            <Field label="Customer who approved (recorded manually)">
              <Input value={signer} onChange={(e) => setSigner(e.target.value)} />
            </Field>
          )}
          <Button disabled={busy} onClick={() => void save()}>
            <Save />
            Save change order
          </Button>
        </div>
      )}
      <div className="mt-4 divide-y divide-border">
        {query.data?.map((o) => (
          <article key={o.id} className="py-4">
            <div className="flex flex-wrap justify-between gap-2">
              <h4 className="font-bold">{o.title}</h4>
              <span className="text-sm font-semibold">
                {money(o.amount_cents)} · {o.days_added} days · {o.status}
              </span>
            </div>
            <p className="mt-2 whitespace-pre-wrap text-sm">{o.scope}</p>
            {o.approved_at && (
              <p className="mt-2 text-xs text-muted-foreground">
                Approval recorded: {o.approved_by} · {new Date(o.approved_at).toLocaleDateString()}
              </p>
            )}
            <Button asChild variant="link" size="sm" className="mt-2 px-0">
              <a
                href={`mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent("Roofer Masters change order: " + o.title)}&body=${encodeURIComponent(`${o.title}\n\n${o.scope}\n\nPrice change: ${money(o.amount_cents)}\nSchedule change: ${o.days_added} days\n\nPlease reply to confirm approval. Your existing invoice remains unchanged until we issue the adjustment.`)}`}
              >
                <Mail />
                Email draft
              </a>
            </Button>
          </article>
        ))}
      </div>
    </section>
  );
}
