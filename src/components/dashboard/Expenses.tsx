import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Save, Upload } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { money } from "@/lib/crm-schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { expensesQuery } from "./cost-data";
import { EXPENSE_CATEGORIES, prepareExpenseRecord } from "@/lib/expense-validation";
import { jobsQuery } from "./operations-data";
import { Field, Choice, SectionHeading } from "./CrmControls";
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
    let record: ReturnType<typeof prepareExpenseRecord>;
    try {
      record = prepareExpenseRecord(form);
      if (
        receipt &&
        (receipt.size > 10 * 1024 * 1024 ||
          !["application/pdf", "image/jpeg", "image/png", "image/webp"].includes(receipt.type))
      )
        throw new Error("Receipt must be a PDF or image under 10 MB");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Enter valid expense details");
      return;
    }
    setBusy(true);
    let expenseId: string | null = null;
    let uploadedPath: string | null = null;
    try {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) throw new Error("Sign in to record an expense");
      let companyId: string | null = null;
      if (record.job_id) {
        const { data: job, error: jobError } = await supabase
          .from("roof_jobs")
          .select("company_id")
          .eq("id", record.job_id)
          .maybeSingle();
        if (jobError || !job?.company_id) throw new Error("Could not verify project company");
        companyId = job.company_id;
      } else {
        const { data: memberships, error: membershipError } = await supabase
          .from("crm_company_memberships")
          .select("company_id,role")
          .eq("user_id", auth.user.id)
          .in("role", ["owner", "admin", "accounting"]);
        if (membershipError || memberships?.length !== 1)
          throw new Error("A single accounting company membership is required");
        companyId = memberships[0].company_id;
      }
      const { data: membership, error: membershipError } = await supabase
        .from("crm_company_memberships")
        .select("role")
        .eq("company_id", companyId)
        .eq("user_id", auth.user.id)
        .in("role", ["owner", "admin", "accounting"])
        .maybeSingle();
      if (membershipError || !membership)
        throw new Error("You cannot record expenses for this company");

      // Persist the financial record first. A receipt failure must never erase it.
      const { data: expense, error: insertError } = await supabase
        .from("crm_expenses")
        .insert({ ...record, company_id: companyId, receipt_path: null })
        .select("id")
        .single();
      if (insertError || !expense) throw insertError ?? new Error("Could not save expense");
      expenseId = expense.id;

      if (receipt) {
        const filename = receipt.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120) || "receipt";
        uploadedPath = `expense/${companyId}/${expense.id}/${crypto.randomUUID()}-${filename}`;
        const { error: uploadError } = await supabase.storage
          .from("roofing-proposals")
          .upload(uploadedPath, receipt, { upsert: false });
        if (uploadError) throw uploadError;
        const { data: attached, error: attachError } = await supabase
          .from("crm_expenses")
          .update({ receipt_path: uploadedPath })
          .eq("id", expense.id)
          .eq("company_id", companyId)
          .select("id")
          .maybeSingle();
        if (attachError || !attached)
          throw attachError ?? new Error("Could not attach receipt to expense");
      }
      await qc.invalidateQueries({ queryKey: ["crm-expenses"] });
      setForm({ ...form, description: "", amount: 0 });
      setReceipt(null);
      toast.success("Recorded expense saved");
    } catch (e) {
      if (uploadedPath) await supabase.storage.from("roofing-proposals").remove([uploadedPath]);
      if (expenseId) {
        await qc.invalidateQueries({ queryKey: ["crm-expenses"] });
        toast.error(
          "Expense was saved, but its receipt could not be attached. The expense record was preserved.",
        );
      } else toast.error(e instanceof Error ? e.message : "Could not record expense");
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
