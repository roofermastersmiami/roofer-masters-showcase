import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Save, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { getStripeEnvironment } from "@/lib/stripe";
import { money } from "@/lib/crm-schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { expensesQuery } from "./cost-data";
import { jobsQuery } from "./operations-data";
import { Field, Choice, SectionHeading } from "./CrmControls";
export const EXPENSE_CATEGORIES = [
  "materials",
  "labor",
  "subcontractors",
  "fuel",
  "equipment",
  "permits",
  "disposal",
  "insurance",
  "advertising",
  "office",
  "other",
];
export function Expenses() {
  const expenses = useQuery(expensesQuery),
    jobs = useQuery(jobsQuery),
    qc = useQueryClient();
  const [form, setForm] = useState({
      description: "",
      category: "materials",
      amount: 0,
      job_id: "",
      incurred_at: new Date().toISOString().slice(0, 10),
      payee: "",
    }),
    [busy, setBusy] = useState(false),
    [receipt, setReceipt] = useState<File | null>(null);
  async function save() {
    if (!form.description.trim() || form.amount <= 0 || !form.incurred_at) {
      toast.error("Enter a description, amount and date");
      return;
    }
    setBusy(true);
    let path: string | null = null;
    try {
      if (receipt) {
        if (
          receipt.size > 10 * 1024 * 1024 ||
          !["application/pdf", "image/jpeg", "image/png", "image/webp"].includes(receipt.type)
        )
          throw new Error("Receipt must be a PDF or image under 10 MB");
        path = `expense-${crypto.randomUUID()}/${receipt.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
        const { error } = await supabase.storage.from("roofing-proposals").upload(path, receipt);
        if (error) throw error;
      }
      const { error } = await supabase
        .from("crm_expenses")
        .insert({
          description: form.description.trim(),
          category: form.category,
          amount_cents: Math.round(form.amount * 100),
          job_id: form.job_id || null,
          incurred_at: form.incurred_at,
          environment: getStripeEnvironment(),
          payee: form.payee,
          receipt_path: path,
        });
      if (error) throw error;
      await qc.invalidateQueries({ queryKey: ["crm-expenses"] });
      setForm({ ...form, description: "", amount: 0 });
      setReceipt(null);
      toast.success("Recorded expense saved");
    } catch (e) {
      if (path) await supabase.storage.from("roofing-proposals").remove([path]);
      toast.error(e instanceof Error ? e.message : "Could not record expense");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      <SectionHeading title="Recorded expenses" />
      <form
        className="grid gap-4 border-b border-border pb-8 sm:grid-cols-3"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Field label="Expense description">
          <Input
            required
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </Field>
        <Choice
          label="Category"
          value={form.category}
          onChange={(v) => setForm({ ...form, category: v })}
          options={EXPENSE_CATEGORIES.map((v) => ({ value: v, label: v }))}
        />
        <Field label="Amount ($)">
          <Input
            required
            type="number"
            min={0.01}
            step="0.01"
            value={form.amount}
            onChange={(e) => setForm({ ...form, amount: Number(e.target.value) })}
          />
        </Field>
        <Choice
          label="Project allocation"
          value={form.job_id || "none"}
          onChange={(v) => setForm({ ...form, job_id: v === "none" ? "" : v })}
          options={[
            { value: "none", label: "Business expense" },
            ...(jobs.data ?? []).map((j) => ({ value: j.id, label: j.title })),
          ]}
        />
        <Field label="Expense date">
          <Input
            required
            type="date"
            value={form.incurred_at}
            onChange={(e) => setForm({ ...form, incurred_at: e.target.value })}
          />
        </Field>
        <Field label="Supplier / payee">
          <Input value={form.payee} onChange={(e) => setForm({ ...form, payee: e.target.value })} />
        </Field>
        <Button variant="outline" type="button" asChild>
          <label>
            <Upload />
            {receipt ? receipt.name : "Attach receipt"}
            <input
              className="sr-only"
              type="file"
              accept="application/pdf,image/jpeg,image/png,image/webp"
              onChange={(e) => setReceipt(e.target.files?.[0] ?? null)}
            />
          </label>
        </Button>
        <Button type="submit" disabled={busy}>
          <Save /> Record expense
        </Button>
      </form>
      {expenses.error && <p className="mt-4 text-destructive">Expense records unavailable.</p>}
      <div className="mt-6 overflow-x-auto">
        <table className="w-full min-w-[580px] text-sm">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th>Date</th>
              <th>Expense</th>
              <th>Project</th>
              <th>Amount</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {expenses.data?.map((e) => (
              <tr key={e.id} className="border-b border-border">
                <td className="py-4">{e.incurred_at}</td>
                <td>
                  <p className="font-semibold">{e.description}</p>
                  <p className="text-xs text-muted-foreground">
                    {e.category} · {e.payee}
                  </p>
                </td>
                <td>{jobs.data?.find((j) => j.id === e.job_id)?.title ?? "Business"}</td>
                <td className="font-bold">{money(e.amount_cents)}</td>
                <td>
                  {e.receipt_path && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={async () => {
                        if (!e.receipt_path) return;
                        const { data, error } = await supabase.storage
                          .from("roofing-proposals")
                          .createSignedUrl(e.receipt_path, 60);
                        if (error || !data) toast.error("Receipt unavailable");
                        else window.open(data.signedUrl, "_blank", "noopener,noreferrer");
                      }}
                    >
                      Receipt
                    </Button>
                  )}
                  <Button
                    size="icon"
                    variant="ghost"
                    title="Remove recorded expense"
                    aria-label="Remove recorded expense"
                    onClick={async () => {
                      if (!confirm("Remove this recorded expense? Financial totals will change."))
                        return;
                      const { error } = await supabase.from("crm_expenses").delete().eq("id", e.id);
                      if (error) toast.error("Could not remove expense");
                      else {
                        if (e.receipt_path)
                          await supabase.storage.from("roofing-proposals").remove([e.receipt_path]);
                        await qc.invalidateQueries({ queryKey: ["crm-expenses"] });
                      }
                    }}
                  >
                    <Trash2 />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!expenses.data?.length && (
        <p className="py-8 text-sm text-muted-foreground">No expenses recorded.</p>
      )}
    </div>
  );
}
