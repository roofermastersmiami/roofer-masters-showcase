import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Check, Trash2, Clock, FileSignature } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { tasksQuery, allSharesQuery } from "./operations-data";
import { proposalsQuery } from "./proposal-data";
import { Field, CustomerSelect, Empty, SectionHeading, Choice } from "./CrmControls";
import type { Lead } from "./data";
export function FollowUps({
  leads,
  onOpenLead,
  onOpenProposals,
}: {
  leads: Lead[];
  onOpenLead: (lead: Lead) => void;
  onOpenProposals: () => void;
}) {
  const tasks = useQuery(tasksQuery);
  const shares = useQuery(allSharesQuery);
  const proposals = useQuery(proposalsQuery);
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [customer, setCustomer] = useState("");
  const [due, setDue] = useState("");
  const [filter, setFilter] = useState("open");
  const [busy, setBusy] = useState(false);
  async function mutate(fn: () => PromiseLike<{ error: unknown }>, message: string) {
    setBusy(true);
    try {
      const { error } = await fn();
      if (error) throw error;
      await qc.invalidateQueries({ queryKey: ["crm-tasks"] });
      toast.success(message);
    } catch {
      toast.error("Could not save follow-up");
    } finally {
      setBusy(false);
    }
  }
  const unsigned = (proposals.data ?? []).filter(
    (p) =>
      !p.is_template &&
      shares.data?.some(
        (s) =>
          s.proposal_id === p.id &&
          !s.signed_at &&
          !s.revoked_at &&
          Date.parse(s.expires_at) > Date.now(),
      ) &&
      !shares.data.some((s) => s.proposal_id === p.id && s.signed_at),
  );
  const visible = (tasks.data ?? []).filter(
    (t) =>
      filter === "all" ||
      (filter === "completed"
        ? !!t.completed_at
        : filter === "overdue"
          ? !t.completed_at && Date.parse(t.due_at) < Date.now()
          : !t.completed_at),
  );
  return (
    <div>
      <SectionHeading
        title="Follow-ups"
        action={
          <Button onClick={() => setAdding(!adding)}>
            <Plus /> Add follow-up
          </Button>
        }
      />
      {adding && (
        <form
          className="mb-6 grid gap-4 border-y border-border py-5 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            void mutate(async () => {
              const { data: auth } = await supabase.auth.getUser();
              if (!auth.user) throw new Error("Sign in to schedule a follow-up");
              let companyId: string | null = null;
              if (customer) {
                const { data: lead, error: leadError } = await supabase
                  .from("leads")
                  .select("company_id")
                  .eq("id", customer)
                  .maybeSingle();
                if (leadError || !lead?.company_id)
                  throw new Error("Could not verify customer company");
                companyId = lead.company_id;
              } else {
                const { data: memberships, error: membershipError } = await supabase
                  .from("crm_company_memberships")
                  .select("company_id,role")
                  .eq("user_id", auth.user.id)
                  .in("role", ["owner", "admin", "office", "sales"]);
                if (membershipError || memberships?.length !== 1)
                  throw new Error("A single office or sales company membership is required");
                companyId = memberships[0].company_id;
              }
              const { data: membership, error: membershipError } = await supabase
                .from("crm_company_memberships")
                .select("role")
                .eq("company_id", companyId)
                .eq("user_id", auth.user.id)
                .in("role", ["owner", "admin", "office", "sales"])
                .maybeSingle();
              if (membershipError || !membership)
                throw new Error("You cannot schedule follow-ups for this company");
              const result = await supabase.from("crm_tasks").insert({
                title: title.trim(),
                lead_id: customer || null,
                company_id: companyId,
                due_at: new Date(due).toISOString(),
              });
              if (!result.error) {
                setAdding(false);
                setTitle("");
              }
              return result;
            }, "Follow-up scheduled");
          }}
        >
          <Field label="Next action">
            <Input
              required
              maxLength={180}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Call about roof estimate"
            />
          </Field>
          <CustomerSelect leads={leads} value={customer} optional onChange={setCustomer} />
          <Field label="Reminder date & time">
            <Input
              required
              type="datetime-local"
              value={due}
              onChange={(e) => setDue(e.target.value)}
            />
          </Field>
          <Button type="submit" className="self-end" disabled={busy}>
            Schedule follow-up
          </Button>
        </form>
      )}
      <div className="mb-5 max-w-xs">
        <Choice
          label="Show tasks"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "open", label: "Open" },
            { value: "overdue", label: "Overdue" },
            { value: "completed", label: "Completed" },
            { value: "all", label: "All tasks" },
          ]}
        />
      </div>
      {tasks.error && <p className="text-destructive">Could not load follow-ups.</p>}
      {tasks.isLoading ? (
        <p>Loading follow-ups…</p>
      ) : !visible.length ? (
        <Empty>No {filter} follow-ups.</Empty>
      ) : (
        <div className="divide-y divide-border border-y border-border">
          {visible.map((t) => {
            const lead = leads.find((l) => l.id === t.lead_id);
            const overdue = !t.completed_at && Date.parse(t.due_at) < Date.now();
            return (
              <div key={t.id} className="flex items-center gap-3 py-4">
                <Clock
                  className={`size-5 shrink-0 ${overdue ? "text-destructive" : "text-primary"}`}
                />
                <div className="min-w-0 flex-1">
                  <p
                    className={`break-words font-semibold ${t.completed_at ? "text-muted-foreground line-through" : "text-foreground"}`}
                  >
                    {t.title}
                  </p>
                  <p
                    className={`text-xs ${overdue ? "text-destructive" : "text-muted-foreground"}`}
                  >
                    {new Date(t.due_at).toLocaleString()} {overdue ? "· Overdue" : ""}
                  </p>
                  {lead && (
                    <Button
                      variant="link"
                      className="h-auto p-0 text-xs"
                      onClick={() => onOpenLead(lead)}
                    >
                      {lead.name}
                    </Button>
                  )}
                </div>
                <Button
                  variant="outline"
                  size="icon"
                  title={t.completed_at ? "Reopen follow-up" : "Complete follow-up"}
                  aria-label={t.completed_at ? "Reopen follow-up" : "Complete follow-up"}
                  disabled={busy}
                  onClick={() =>
                    void mutate(
                      () =>
                        supabase
                          .from("crm_tasks")
                          .update({
                            completed_at: t.completed_at ? null : new Date().toISOString(),
                          })
                          .eq("id", t.id)
                          .eq("company_id", t.company_id),
                      t.completed_at ? "Follow-up reopened" : "Follow-up completed",
                    )
                  }
                >
                  <Check />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  title="Delete follow-up"
                  aria-label="Delete follow-up"
                  onClick={() => {
                    if (confirm("Delete this follow-up?"))
                      void mutate(
                        () =>
                          supabase
                            .from("crm_tasks")
                            .delete()
                            .eq("id", t.id)
                            .eq("company_id", t.company_id),
                        "Follow-up deleted",
                      );
                  }}
                >
                  <Trash2 />
                </Button>
              </div>
            );
          })}
        </div>
      )}
      <section className="mt-10 border-t border-border pt-6">
        <h3 className="mb-4 flex items-center gap-2 text-lg font-bold text-foreground">
          <FileSignature className="size-5 text-primary" /> Awaiting customer signature{" "}
          <span className="text-muted-foreground">({unsigned.length})</span>
        </h3>
        {unsigned.length ? (
          unsigned.map((p) => (
            <div
              key={p.id}
              className="flex flex-wrap items-center justify-between gap-3 border-b border-border py-3"
            >
              <div>
                <p className="font-semibold">{p.title}</p>
                <p className="text-sm text-muted-foreground">
                  {leads.find((l) => l.id === p.lead_id)?.name ?? "No customer"}
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={onOpenProposals}>
                View proposals
              </Button>
            </div>
          ))
        ) : (
          <p className="text-sm text-muted-foreground">No active proposals awaiting signature.</p>
        )}
      </section>
    </div>
  );
}
