import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, CalendarClock, ClipboardCheck, FileCheck2, MapPinned } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { jobsQuery } from "./operations-data";
import type { Lead } from "./data";
import { requiresNoticeOfCommencement } from "@/lib/permitting-rules";

const permitStatuses = [
  { value: "not_started", label: "Not started" },
  { value: "submitted", label: "Submitted" },
  { value: "approved", label: "Approved" },
  { value: "not_required", label: "Not required" },
] as const;

const jobStatuses: Record<string, string> = {
  scheduled: "Scheduled",
  in_progress: "In progress",
  on_hold: "On hold",
  completed: "Completed",
};

function permitLabel(status: string) {
  return permitStatuses.find((item) => item.value === status)?.label ?? "Unknown";
}

function formatDate(value: string | null) {
  if (!value) return "Not scheduled";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Invalid date"
    : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function PermitCount({ title, value, description }: { title: string; value: number; description: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>{title}</CardDescription>
        <CardTitle className="text-3xl tabular-nums">{value}</CardTitle>
      </CardHeader>
      <CardContent className="text-xs text-muted-foreground">{description}</CardContent>
    </Card>
  );
}

export function Permitting({ leads }: { leads: Lead[] }) {
  const jobs = useQuery({ ...jobsQuery, refetchInterval: 30_000 });
  const [filter, setFilter] = useState("active");
  const records = jobs.data ?? [];
  const counts = useMemo(() => ({
    total: records.length,
    notStarted: records.filter((job) => job.permit_status === "not_started").length,
    submitted: records.filter((job) => job.permit_status === "submitted").length,
    approved: records.filter((job) => job.permit_status === "approved").length,
    inspections: records.filter((job) => !!job.inspection_at).length,
    nocReview: records.filter((job) => requiresNoticeOfCommencement(job.budget_cents).required).length,
    nocValueMissing: records.filter((job) => requiresNoticeOfCommencement(job.budget_cents).reason === "value_unknown").length,
  }), [records]);

  const visible = records.filter((job) => {
    if (filter === "active") return job.permit_status !== "approved" && job.permit_status !== "not_required";
    if (filter === "all") return true;
    return job.permit_status === filter;
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Sales & production</p>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Permitting</h1>
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
            Live permit-status overview from existing roofing jobs. Update a job's permit status and
            inspection date in Projects & production; this view reflects those saved records.
          </p>
        </div>
        <Badge variant="outline" className="gap-1.5"><ClipboardCheck className="size-3.5" />Existing job data</Badge>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <PermitCount title="Roofing jobs" value={counts.total} description="Jobs currently in the CRM" />
        <PermitCount title="Not started" value={counts.notStarted} description="Permit status needs review" />
        <PermitCount title="Submitted" value={counts.submitted} description="Marked submitted in job records" />
        <PermitCount title="Approved" value={counts.approved} description="Marked approved in job records" />
        <PermitCount title="NOC review" value={counts.nocReview} description="Job value exceeds the $5,000 default threshold" />
        <PermitCount title="Value missing" value={counts.nocValueMissing} description="Cannot assess NOC threshold without a job value" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Permit status pipeline</CardTitle>
          <CardDescription>
            This is a view of the existing job-level status only. It does not yet track permit IDs,
            jurisdiction application records, correction notices, or official portal responses. The NOC flag is a preliminary $5,000 value-threshold reminder only; verify the applicable jurisdiction rule before relying on it.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-sm">
              <span className="font-medium">Show</span>
              <select aria-label="Filter permits" className="h-9 rounded-md border border-input bg-background px-3 text-sm" value={filter} onChange={(event) => setFilter(event.target.value)}>
                <option value="active">Needs action</option>
                <option value="all">All jobs</option>
                {permitStatuses.map((status) => <option key={status.value} value={status.value}>{status.label}</option>)}
              </select>
            </label>
            <div className="flex items-center gap-2 text-xs text-muted-foreground"><CalendarClock className="size-4" />{counts.inspections} inspection dates recorded</div>
          </div>

          {jobs.isLoading ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Loading permit statuses…</p>
          ) : jobs.error ? (
            <div role="alert" className="flex items-center gap-2 py-6 text-sm text-destructive"><AlertCircle className="size-4" />Could not load job permit statuses. Check your access and try again.</div>
          ) : visible.length === 0 ? (
            <div className="py-10 text-center">
              <MapPinned className="mx-auto mb-3 size-8 text-muted-foreground" />
              <p className="font-medium">No jobs match this filter</p>
              <p className="mt-1 text-sm text-muted-foreground">Create or update a roofing job in Projects & production to track its permit status here.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[780px] text-left text-sm">
                <thead><tr className="border-b text-xs text-muted-foreground">
                  <th className="px-3 py-3 font-medium">Job / customer</th>
                  <th className="px-3 py-3 font-medium">Job status</th>
                  <th className="px-3 py-3 font-medium">Permit status</th>
                  <th className="px-3 py-3 font-medium">Inspection</th>
                  <th className="px-3 py-3 font-medium">NOC threshold</th>
                </tr></thead>
                <tbody>
                  {visible.map((job) => {
                    const noc = requiresNoticeOfCommencement(job.budget_cents);
                    return <tr key={job.id} className="border-b last:border-0">
                      <td className="px-3 py-3">
                        <p className="font-medium">{job.title}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">{leads.find((lead) => lead.id === job.lead_id)?.name ?? "Customer not linked"}</p>
                      </td>
                      <td className="px-3 py-3 text-muted-foreground">{jobStatuses[job.status] ?? job.status}</td>
                      <td className="px-3 py-3"><Badge variant={job.permit_status === "approved" ? "default" : "secondary"}>{permitLabel(job.permit_status)}</Badge></td>
                      <td className="px-3 py-3 text-muted-foreground">{formatDate(job.inspection_at)}</td>
                      <td className="px-3 py-3">
                        {noc.required ? <Badge variant="outline">Review NOC</Badge> : noc.reason === "value_unknown" ? <Badge variant="secondary">Value missing — review</Badge> : <span className="text-xs text-muted-foreground">Below default threshold</span>}
                      </td>
                    </tr>;
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-amber-500/30 bg-amber-500/5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base"><FileCheck2 className="size-4" />Next permitting capabilities</CardTitle>
          <CardDescription className="leading-relaxed">
            Detailed permit applications, jurisdiction directories, verified NOA / Florida Product
            Approval records, NOC tracking, and saved PDF packets require dedicated company-scoped
            records and private document storage. They are not represented as active until those
            foundations and access policies are implemented and tested.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
