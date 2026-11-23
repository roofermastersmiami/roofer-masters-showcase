import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, HardHat, Save, Camera, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { CHECKLIST } from "@/lib/crm-schema";
import { ChangeOrders } from "./ChangeOrders";
import { MaterialOrder } from "./MaterialOrder";
import { jobsQuery, allSharesQuery, type Job } from "./operations-data";
import { proposalsQuery } from "./proposal-data";
import { SectionHeading, Choice, Field, CustomerSelect, Empty } from "./CrmControls";
import type { Lead } from "./data";
import { useRoles } from "./RolesContext";
import { seesMoney } from "@/lib/team-roles";
const statuses = [
  { value: "scheduled", label: "Scheduled" },
  { value: "in_progress", label: "In progress" },
  { value: "on_hold", label: "On hold" },
  { value: "completed", label: "Completed" },
];
const permits = [
  { value: "not_started", label: "Not started" },
  { value: "submitted", label: "Submitted" },
  { value: "approved", label: "Approved" },
  { value: "not_required", label: "Not required" },
];
const checklistSchema = z.array(z.object({ title: z.string(), done: z.boolean() }));
const photoSchema = z.array(z.object({ path: z.string(), name: z.string() }));
export function Jobs({ leads }: { leads: Lead[] }) {
  const jobs = useQuery(jobsQuery);
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState("all");
  const job = jobs.data?.find((j) => j.id === selected);
  const visible = (jobs.data ?? []).filter((j) => filter === "all" || j.status === filter);
  return (
    <div>
      <SectionHeading
        title="Roofing jobs"
        action={
          <Button onClick={() => setAdding(true)}>
            <Plus /> New job
          </Button>
        }
      />
      <div className="mb-5 max-w-xs">
        <Choice
          label="Job status"
          value={filter}
          onChange={setFilter}
          options={[{ value: "all", label: "All jobs" }, ...statuses]}
        />
      </div>
      {jobs.error && <p className="text-destructive">Could not load jobs.</p>}
      {jobs.isLoading ? (
        <p>Loading jobs…</p>
      ) : !visible.length ? (
        <Empty>No jobs found.</Empty>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visible.map((j) => {
            const list = checklistSchema.safeParse(j.checklist);
            return (
              <article key={j.id} className="rounded-lg border border-border bg-card p-5">
                <div className="flex items-center justify-between gap-3">
                  <HardHat className="size-5 text-primary" />
                  <span className="text-xs font-semibold text-muted-foreground">
                    {statuses.find((s) => s.value === j.status)?.label}
                  </span>
                </div>
                <h3 className="mt-3 break-words text-lg font-bold">{j.title}</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  {leads.find((l) => l.id === j.lead_id)?.name ?? "Unassigned"}
                </p>
                <dl className="mt-4 grid grid-cols-2 gap-2 text-xs">
                  <dt className="text-muted-foreground">Crew</dt>
                  <dd className="break-words text-right">{j.crew || "Unassigned"}</dd>
                  <dt className="text-muted-foreground">Start</dt>
                  <dd className="text-right">{j.start_date || "Not scheduled"}</dd>
                  <dt className="text-muted-foreground">Permit</dt>
                  <dd className="text-right">
                    {permits.find((p) => p.value === j.permit_status)?.label}
                  </dd>
                  <dt className="text-muted-foreground">Checklist</dt>
                  <dd className="text-right">
                    {list.success
                      ? `${list.data.filter((i) => i.done).length}/${list.data.length}`
                      : "0/0"}
                  </dd>
                </dl>
                <Button className="mt-5 w-full" variant="outline" onClick={() => setSelected(j.id)}>
                  Open job
                </Button>
              </article>
            );
          })}
        </div>
      )}
      {adding && (
        <NewJob
          leads={leads}
          onClose={() => setAdding(false)}
          onCreated={(id) => {
            setAdding(false);
            setSelected(id);
          }}
        />
      )}
      {job && <JobDetail key={job.id} job={job} leads={leads} onClose={() => setSelected(null)} />}
    </div>
  );
}
function NewJob({
  leads,
  onClose,
  onCreated,
}: {
  leads: Lead[];
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const proposals = useQuery(proposalsQuery);
  const shares = useQuery(allSharesQuery);
  const qc = useQueryClient();
  const [title, setTitle] = useState("Roof installation");
  const [customer, setCustomer] = useState("");
  const [proposal, setProposal] = useState("none");
  const [busy, setBusy] = useState(false);
  const accepted = (proposals.data ?? []).filter(
    (p) =>
      !p.is_template &&
      p.lead_id === customer &&
      shares.data?.some((s) => s.proposal_id === p.id && !!s.signed_at),
  );
  async function submit() {
    setBusy(true);
    try {
      const { data, error } = await supabase
        .from("roof_jobs")
        .insert({
          title,
          lead_id: customer,
          proposal_id: proposal === "none" ? null : proposal,
          checklist: CHECKLIST.map((title) => ({ title, done: false })),
        })
        .select("id")
        .single();
      if (error || !data) throw error;
      await qc.invalidateQueries({ queryKey: ["roof-jobs"] });
      toast.success("Job created");
      onCreated(data.id);
    } catch {
      toast.error("Could not create job");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create job</DialogTitle>
          <DialogDescription>Roofer Masters</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <Field label="Job title">
            <Input
              required
              maxLength={180}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </Field>
          <CustomerSelect
            leads={leads}
            value={customer}
            onChange={(v) => {
              setCustomer(v);
              setProposal("none");
            }}
          />
          <Choice
            label="Accepted proposal"
            value={proposal}
            onChange={(id) => {
              setProposal(id);
              const p = accepted.find((p) => p.id === id);
              if (p) setTitle(p.title);
            }}
            options={[
              { value: "none", label: "Create without proposal" },
              ...accepted.map((p) => ({ value: p.id, label: p.title })),
            ]}
          />
          <Button type="submit" disabled={busy || !customer}>
            <HardHat /> {busy ? "Creating…" : "Create job"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
function JobDetail({ job, leads, onClose }: { job: Job; leads: Lead[]; onClose: () => void }) {
  const money = seesMoney(useRoles());
  const qc = useQueryClient();
  const [title, setTitle] = useState(job.title);
  const [status, setStatus] = useState(job.status);
  const [crew, setCrew] = useState(job.crew);
  const [permit, setPermit] = useState(job.permit_status);
  const [start, setStart] = useState(job.start_date ?? "");
  const [inspection, setInspection] = useState(
    job.inspection_at ? localDateTime(job.inspection_at) : "",
  );
  const [notes, setNotes] = useState(job.notes);
  const [busy, setBusy] = useState(false);
  const list = checklistSchema.safeParse(job.checklist);
  const photos = photoSchema.safeParse(job.photos);
  const check = list.success ? list.data : [];
  const images = photos.success ? photos.data : [];
  async function patch(value: Database["public"]["Tables"]["roof_jobs"]["Update"]) {
    const { error } = await supabase.from("roof_jobs").update(value).eq("id", job.id);
    if (error) throw error;
    await qc.invalidateQueries({ queryKey: ["roof-jobs"] });
  }
  async function save() {
    setBusy(true);
    try {
      await patch({
        title,
        status,
        crew,
        permit_status: permit,
        start_date: start || null,
        inspection_at: inspection ? new Date(inspection).toISOString() : null,
        notes,
      });
      toast.success("Job updated");
    } catch {
      toast.error("Could not save job");
    } finally {
      setBusy(false);
    }
  }
  async function upload(file: File) {
    if (
      !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
      file.size > 10 * 1024 * 1024
    ) {
      toast.error("Choose a JPG, PNG or WebP image under 10 MB");
      return;
    }
    setBusy(true);
    const path = `${job.id}/${crypto.randomUUID()}.${file.type.split("/")[1]}`;
    try {
      const { error } = await supabase.storage.from("roof-job-photos").upload(path, file);
      if (error) throw error;
      await patch({ photos: [...images, { path, name: file.name }] });
      toast.success("Job photo uploaded");
    } catch {
      await supabase.storage.from("roof-job-photos").remove([path]);
      toast.error("Could not upload photo");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{job.title}</DialogTitle>
          <DialogDescription>
            {leads.find((l) => l.id === job.lead_id)?.name ?? "Roofer Masters"}
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <Field label="Job title">
            <Input required value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Choice label="Status" value={status} onChange={setStatus} options={statuses} />
          <Field label="Assigned crew">
            <Input value={crew} onChange={(e) => setCrew(e.target.value)} />
          </Field>
          <Choice label="Permit status" value={permit} onChange={setPermit} options={permits} />
          <Field label="Start date">
            <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
          </Field>
          <Field label="Inspection date & time">
            <Input
              type="datetime-local"
              value={inspection}
              onChange={(e) => setInspection(e.target.value)}
            />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Job notes">
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Field>
          </div>
          <Button type="submit" disabled={busy}>
            <Save /> Save job
          </Button>
        </form>
        <section className="border-t border-border pt-5">
          <h3 className="mb-3 font-bold">Completion checklist</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {check.map((item, index) => (
              <label key={item.title} className="flex items-center gap-3 text-sm">
                <Checkbox
                  checked={item.done}
                  disabled={busy}
                  onCheckedChange={async (value) => {
                    setBusy(true);
                    try {
                      await patch({
                        checklist: check.map((c, i) =>
                          i === index ? { ...c, done: value === true } : c,
                        ),
                      });
                    } catch {
                      toast.error("Could not update checklist");
                    } finally {
                      setBusy(false);
                    }
                  }}
                />
                {item.title}
              </label>
            ))}
          </div>
        </section>
        <section className="border-t border-border pt-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h3 className="font-bold">Progress photos</h3>
            <Button asChild variant="outline" size="sm" disabled={busy}>
              <label className="cursor-pointer">
                <Camera /> Add photo
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="sr-only"
                  disabled={busy}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void upload(file);
                    e.target.value = "";
                  }}
                />
              </label>
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {images.map((image) => (
              <div key={image.path} className="min-w-0">
                <JobPhoto path={image.path} name={image.name} />
                <div className="mt-1 flex items-center gap-1">
                  <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                    {image.name}
                  </p>
                  <Button
                    size="icon"
                    variant="ghost"
                    title="Remove photo"
                    aria-label="Remove photo"
                    disabled={busy}
                    onClick={async () => {
                      if (!confirm("Remove this photo?")) return;
                      setBusy(true);
                      try {
                        await patch({ photos: images.filter((p) => p.path !== image.path) });
                        await supabase.storage.from("roof-job-photos").remove([image.path]);
                      } catch {
                        toast.error("Could not remove photo");
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </div>
            ))}
          </div>
          {!images.length && <p className="text-sm text-muted-foreground">No job photos yet.</p>}
        </section>
        <MaterialOrder jobId={job.id} title={job.title} saved={job.material_order} />
        {money && (
          <ChangeOrders
            jobId={job.id}
            email={leads.find((l) => l.id === job.lead_id)?.email ?? ""}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
function JobPhoto({ path, name }: { path: string; name: string }) {
  const photo = useQuery({
    queryKey: ["job-photo", path],
    queryFn: async () => {
      const { data, error } = await supabase.storage
        .from("roof-job-photos")
        .createSignedUrl(path, 300);
      if (error) throw error;
      return data.signedUrl;
    },
    staleTime: 240000,
  });
  return photo.data ? (
    <a href={photo.data} target="_blank" rel="noreferrer">
      <img src={photo.data} alt={name} className="aspect-[4/3] w-full rounded-md object-cover" />
    </a>
  ) : (
    <div className="flex aspect-[4/3] items-center justify-center rounded-md bg-muted text-xs text-muted-foreground">
      {photo.error ? "Photo unavailable" : "Loading…"}
    </div>
  );
}
function localDateTime(iso: string) {
  const date = new Date(iso);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
