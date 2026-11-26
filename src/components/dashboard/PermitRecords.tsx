import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, CalendarPlus, ClipboardList, Plus, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { createPermitPacketPdf } from "@/lib/permit-packet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  createPermitApplication,
  createPermitInspection,
  getPermitWorkspace,
  updatePermitApplication,
  updatePermitInspection,
  recordPermitRejection,
} from "@/lib/permitting.functions";

const inputClass = "h-9 w-full rounded-md border border-input bg-background px-3 text-sm";
const labelClass = "mb-1 block text-xs font-medium text-muted-foreground";

function localDateTime(value?: string | null) {
  if (!value) return "Not scheduled";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Invalid date"
    : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function PermitRecords() {
  const queryClient = useQueryClient();
  const workspace = useQuery({ queryKey: ["permit-workspace"], queryFn: () => getPermitWorkspace() });
  const [jobId, setJobId] = useState("");
  const [jurisdiction, setJurisdiction] = useState("Miami-Dade County");
  const [permitType, setPermitType] = useState("Roof replacement");
  const [portalUrl, setPortalUrl] = useState("");
  const [permitNumber, setPermitNumber] = useState("");
  const [permitFee, setPermitFee] = useState("");
  const [applicationNotes, setApplicationNotes] = useState("");
  const [applicationId, setApplicationId] = useState("");
  const [inspectionType, setInspectionType] = useState("Roof dry-in");
  const [inspectionDate, setInspectionDate] = useState("");
  const [inspectionNotes, setInspectionNotes] = useState("");
  const [scheduleDates, setScheduleDates] = useState<Record<string, string>>({});
  const [issuanceDates, setIssuanceDates] = useState<Record<string, string>>({});
  const [permitNumbers, setPermitNumbers] = useState<Record<string, string>>({});
  const [expiryDates, setExpiryDates] = useState<Record<string, string>>({});
  const [inspectionConfirmations, setInspectionConfirmations] = useState<Record<string, string>>({});
  const [rejectionReasons, setRejectionReasons] = useState<Record<string, string>>({});

  const refresh = async () => queryClient.invalidateQueries({ queryKey: ["permit-workspace"] });
  const createApplication = useMutation({
    mutationFn: () => createPermitApplication({
      roof_job_id: jobId,
      jurisdiction_name: jurisdiction,
      permit_type: permitType,
      application_status: "draft",
      portal_url: portalUrl.trim() || null,
      permit_number: permitNumber.trim() || null,
      fee_cents: permitFee.trim() ? Math.round(Number(permitFee) * 100) : null,
      notes: applicationNotes,
    }),
    onSuccess: async () => {
      toast.success("Permit application draft saved.");
      setPortalUrl("");
      setPermitNumber("");
      setPermitFee("");
      setApplicationNotes("");
      await refresh();
    },
    onError: (error) => toast.error(error.message || "Could not save permit application."),
  });
  const createInspection = useMutation({
    mutationFn: () => createPermitInspection({
      application_id: applicationId,
      inspection_type: inspectionType,
      scheduled_at: inspectionDate ? new Date(inspectionDate).toISOString() : null,
      scheduling_status: "requested",
      notes: inspectionNotes,
    }),
    onSuccess: async () => {
      toast.success("Inspection request recorded. It is not marked municipality-confirmed.");
      setInspectionNotes("");
      setInspectionDate("");
      await refresh();
    },
    onError: (error) => toast.error(error.message || "Could not save inspection."),
  });
  const applications = workspace.data?.applications ?? [];
  const inspections = workspace.data?.inspections ?? [];
  const jobs = workspace.data?.jobs ?? [];

  const markReady = useMutation({
    mutationFn: (id: string) => updatePermitApplication({ id, changes: { application_status: "ready_to_submit" } }),
    onSuccess: refresh,
    onError: (error) => toast.error(error.message || "Could not update application."),
  });
  const markSubmitted = useMutation({
    mutationFn: (id: string) => updatePermitApplication({
      id,
      changes: { application_status: "submitted", submitted_at: new Date().toISOString() },
    }),
    onSuccess: async () => { toast.success("Submission recorded. Confirm this was submitted externally."); await refresh(); },
    onError: (error) => toast.error(error.message || "Could not update application."),
  });
  const savePermitDetails = useMutation({
    mutationFn: ({ id, permitNumber, expiresAt }: { id: string; permitNumber: string; expiresAt: string }) =>
      updatePermitApplication({ id, changes: { permit_number: permitNumber.trim() || null, expires_at: expiresAt || null } }),
    onSuccess: async (_saved, variables) => { setPermitNumbers((current) => { const next = { ...current }; delete next[variables.id]; return next; }); setExpiryDates((current) => { const next = { ...current }; delete next[variables.id]; return next; }); toast.success("Permit details saved."); await refresh(); },
    onError: (error) => toast.error(error.message || "Could not save permit details."),
  });
  const recordRejection = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      recordPermitRejection({ id, reason }),
    onSuccess: async (_saved, variables) => {
      setRejectionReasons((current) => { const next = { ...current }; delete next[variables.id]; return next; });
      toast.success("Rejection recorded with the reason provided.");
      await refresh();
    },
    onError: (error) => toast.error(error.message || "Could not record rejection."),
  });
  const recordIssuance = useMutation({
    mutationFn: ({ id, issuedAt }: { id: string; issuedAt: string }) => {
      const application = applications.find((item) => item.id === id);
      if (!application?.permit_number?.trim()) throw new Error("Enter the official permit number before recording issuance.");
      if (!application.submitted_at) throw new Error("Record the actual submission date before recording issuance.");
      return updatePermitApplication({ id, changes: {
        application_status: "issued",
        issued_at: new Date(issuedAt + "T12:00:00").toISOString(),
      } });
    },
    onSuccess: async (_saved, variables) => { setIssuanceDates((current) => { const next = { ...current }; delete next[variables.id]; return next; }); toast.success("Permit issuance recorded from the official document."); await refresh(); },
    onError: (error) => toast.error(error.message || "Could not record permit issuance."),
  });
  const saveInspectionConfirmation = useMutation({
    mutationFn: ({ id, confirmationNumber }: { id: string; confirmationNumber: string }) =>
      updatePermitInspection({ id, changes: { confirmation_number: confirmationNumber.trim() || null } }),
    onSuccess: async (_saved, variables) => { setInspectionConfirmations((current) => { const next = { ...current }; delete next[variables.id]; return next; }); toast.success("Inspection confirmation details saved."); await refresh(); },
    onError: (error) => toast.error(error.message || "Could not save confirmation details."),
  });
  const downloadPermitPacket = async (application: (typeof applications)[number]) => {
    try {
      const job = jobs.find((candidate) => candidate.id === application.roof_job_id);
      const relatedInspections = inspections.filter((item) => item.application_id === application.id);
      const bytes = await createPermitPacketPdf({
        jobTitle: job?.title ?? "Roofing job",
        propertyAddress: job?.address ?? "",
        jurisdiction: application.jurisdiction_name,
        permitType: application.permit_type,
        permitNumber: application.permit_number,
        status: application.application_status,
        portalUrl: application.portal_url,
        submittedAt: application.submitted_at,
        issuedAt: application.issued_at,
        expiresAt: application.expires_at,
        feeCents: application.fee_cents,
        applicationNotes: application.notes,
        inspections: relatedInspections.map((item) => ({
          type: item.inspection_type,
          status: item.scheduling_status,
          scheduledAt: item.scheduled_at,
          completedAt: item.completed_at,
          confirmationNumber: item.confirmation_number,
          notes: item.notes,
        })),
      });
      const pdfBuffer = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(pdfBuffer).set(bytes);
      const blob = new Blob([pdfBuffer], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const safeNumber = String(application.permit_number || application.id.slice(0, 8)).replace(/[^a-zA-Z0-9_-]/g, "-");
      link.href = url;
      link.download = `roofer-masters-permit-summary-${safeNumber}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      toast.success("CRM permit summary PDF generated.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not generate permit summary.");
    }
  };

  const updateInspectionStatus = useMutation({
    mutationFn: ({ id, status, scheduledAt }: {
      id: string;
      status: "scheduled" | "passed" | "failed" | "cancelled";
      scheduledAt?: string;
    }) => updatePermitInspection({
      id,
      changes: {
        scheduling_status: status,
        ...(status === "scheduled" && scheduledAt ? { scheduled_at: new Date(scheduledAt).toISOString() } : {}),
        ...(["passed", "failed"].includes(status) ? { completed_at: new Date().toISOString() } : {}),
      },
    }),
    onSuccess: refresh,
    onError: (error) => toast.error(error.message || "Could not update inspection."),
  });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-xl font-semibold">Permit applications & inspections</h2>
          <p className="text-sm text-muted-foreground">Company-owned records linked to existing roof jobs.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={workspace.isFetching}>
          <RefreshCw className="mr-2 size-4" /> Refresh
        </Button>
      </div>

      {workspace.isLoading ? (
        <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">Loading permit records…</CardContent></Card>
      ) : workspace.error ? (
        <Card><CardContent className="flex items-center gap-2 py-6 text-sm text-destructive" role="alert">
          <AlertCircle className="size-4" /> {workspace.error.message}
        </CardContent></Card>
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base"><Plus className="size-4" /> New permit application</CardTitle>
                <CardDescription>Start a draft linked to a roofing job. Submission is always recorded manually after external confirmation.</CardDescription>
              </CardHeader>
              <CardContent>
                <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); createApplication.mutate(); }}>
                  <div>
                    <label className={labelClass} htmlFor="permit-job">Roofing job</label>
                    <select id="permit-job" className={inputClass} value={jobId} onChange={(event) => setJobId(event.target.value)} required>
                      <option value="">Choose a job…</option>
                      {jobs.map((job) => <option key={job.id} value={job.id}>{job.title}{job.address ? ` — ${job.address}` : ""}</option>)}
                    </select>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div><label className={labelClass} htmlFor="permit-jurisdiction">Jurisdiction</label><Input id="permit-jurisdiction" value={jurisdiction} onChange={(event) => setJurisdiction(event.target.value)} maxLength={160} required /></div>
                    <div><label className={labelClass} htmlFor="permit-type">Permit type</label><Input id="permit-type" value={permitType} onChange={(event) => setPermitType(event.target.value)} maxLength={120} required /></div>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div><label className={labelClass} htmlFor="permit-number">Permit number (if already assigned)</label><Input id="permit-number" value={permitNumber} onChange={(event) => setPermitNumber(event.target.value)} maxLength={120} /></div>
                    <div><label className={labelClass} htmlFor="permit-fee">Permit fee (USD)</label><Input id="permit-fee" type="number" min="0" step="0.01" value={permitFee} onChange={(event) => setPermitFee(event.target.value)} /></div>
                  </div>
                  <div><label className={labelClass} htmlFor="permit-portal">Official portal link (optional)</label><Input id="permit-portal" type="url" placeholder="https://" value={portalUrl} onChange={(event) => setPortalUrl(event.target.value)} /></div>
                  <div><label className={labelClass} htmlFor="permit-notes">Application notes / correction details</label><Input id="permit-notes" value={applicationNotes} onChange={(event) => setApplicationNotes(event.target.value)} maxLength={10000} /></div>
                  <Button type="submit" disabled={!jobId || !jurisdiction.trim() || !permitType.trim() || (permitFee.trim() !== "" && (!Number.isFinite(Number(permitFee)) || Number(permitFee) < 0)) || createApplication.isPending}>
                    {createApplication.isPending ? "Saving…" : "Save draft"}
                  </Button>
                </form>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base"><CalendarPlus className="size-4" /> Record an inspection</CardTitle>
                <CardDescription>Requests are not treated as confirmed appointments until you update them with the official details.</CardDescription>
              </CardHeader>
              <CardContent>
                <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); createInspection.mutate(); }}>
                  <div><label className={labelClass} htmlFor="inspection-application">Permit application</label>
                    <select id="inspection-application" className={inputClass} value={applicationId} onChange={(event) => setApplicationId(event.target.value)} required>
                      <option value="">Choose an application…</option>
                      {applications.map((item) => <option key={item.id} value={item.id}>{item.jurisdiction_name} — {item.permit_type}</option>)}
                    </select>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div><label className={labelClass} htmlFor="inspection-type">Inspection type</label><Input id="inspection-type" value={inspectionType} onChange={(event) => setInspectionType(event.target.value)} maxLength={120} required /></div>
                    <div><label className={labelClass} htmlFor="inspection-date">Requested date/time (optional)</label><Input id="inspection-date" type="datetime-local" value={inspectionDate} onChange={(event) => setInspectionDate(event.target.value)} /></div>
                  </div>
                  <div><label className={labelClass} htmlFor="inspection-notes">Notes</label><Input id="inspection-notes" value={inspectionNotes} onChange={(event) => setInspectionNotes(event.target.value)} maxLength={5000} /></div>
                  <Button type="submit" disabled={!applicationId || !inspectionType.trim() || createInspection.isPending}>
                    {createInspection.isPending ? "Saving…" : "Record request"}
                  </Button>
                </form>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2 text-base"><ClipboardList className="size-4" /> Application register</CardTitle><CardDescription>{applications.length} saved application{applications.length === 1 ? "" : "s"}</CardDescription></CardHeader>
            <CardContent>
              {applications.length === 0 ? <p className="py-5 text-sm text-muted-foreground">No permit applications yet. Create the first draft above.</p> : (
                <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm">
                  <thead><tr className="border-b text-xs text-muted-foreground"><th className="py-2 pr-3">Job</th><th className="py-2 pr-3">Jurisdiction / type</th><th className="py-2 pr-3">Permit number</th><th className="py-2 pr-3">Status</th><th className="py-2 pr-3">Next action</th></tr></thead>
                  <tbody>{applications.map((item) => {
                    const job = jobs.find((candidate) => candidate.id === item.roof_job_id);
                    return <tr key={item.id} className="border-b last:border-0">
                      <td className="py-3 pr-3"><div className="font-medium">{job?.title ?? "Roofing job"}</div><div className="text-xs text-muted-foreground">{job?.address ?? ""}</div></td>
                      <td className="py-3 pr-3">{item.jurisdiction_name}<div className="text-xs text-muted-foreground">{item.permit_type}</div></td>
                      <td className="py-3 pr-3"><div className="flex min-w-44 flex-col gap-1"><Input aria-label="Official permit number" placeholder="Permit number" value={permitNumbers[item.id] ?? item.permit_number ?? ""} onChange={(event) => setPermitNumbers((current) => ({ ...current, [item.id]: event.target.value }))} maxLength={120} /><Input aria-label="Permit expiration date" type="date" value={expiryDates[item.id] ?? item.expires_at ?? ""} onChange={(event) => setExpiryDates((current) => ({ ...current, [item.id]: event.target.value }))} /><div className="text-xs text-muted-foreground">{item.fee_cents == null ? "Fee not recorded" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(item.fee_cents / 100)}</div><Button size="sm" variant="ghost" disabled={savePermitDetails.isPending} onClick={() => savePermitDetails.mutate({ id: item.id, permitNumber: permitNumbers[item.id] ?? item.permit_number ?? "", expiresAt: expiryDates[item.id] ?? item.expires_at ?? "" })}>Save details</Button></div></td>
                      <td className="py-3 pr-3"><div className="flex flex-col items-start gap-2"><Badge variant={item.application_status === "issued" ? "default" : "secondary"}>{String(item.application_status).replaceAll("_", " ")}</Badge><Button size="sm" variant="ghost" onClick={() => void downloadPermitPacket(item)}>Print summary</Button></div></td>
                      <td className="py-3 pr-3">{item.application_status === "draft" ? <Button size="sm" variant="outline" disabled={markReady.isPending} onClick={() => markReady.mutate(item.id)}>Mark ready</Button> : item.application_status === "ready_to_submit" ? <Button size="sm" variant="outline" disabled={markSubmitted.isPending} onClick={() => markSubmitted.mutate(item.id)}>Record submitted</Button> : item.application_status === "submitted" ? <div className="flex min-w-52 flex-col gap-2"><Input aria-label="Official permit issue date" type="date" value={issuanceDates[item.id] ?? ""} onChange={(event) => setIssuanceDates((current) => ({ ...current, [item.id]: event.target.value }))} /><Button size="sm" variant="outline" disabled={!issuanceDates[item.id] || !item.permit_number?.trim() || recordIssuance.isPending} onClick={() => recordIssuance.mutate({ id: item.id, issuedAt: issuanceDates[item.id] })}>Record issued</Button><span className="text-xs text-muted-foreground">Requires official permit number and issue date.</span><Input aria-label="Municipal rejection reason" placeholder="Reason if rejected" value={rejectionReasons[item.id] ?? ""} onChange={(event) => setRejectionReasons((current) => ({ ...current, [item.id]: event.target.value }))} maxLength={4000} /><Button size="sm" variant="destructive" disabled={!rejectionReasons[item.id]?.trim() || recordRejection.isPending} onClick={() => recordRejection.mutate({ id: item.id, reason: rejectionReasons[item.id] })}>Record rejection</Button></div> : "—"}</td>
                    </tr>;
                  })}</tbody>
                </table></div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Inspection register</CardTitle><CardDescription>{inspections.length} recorded inspection{inspections.length === 1 ? "" : "s"}</CardDescription></CardHeader>
            <CardContent>
              {inspections.length === 0 ? <p className="py-5 text-sm text-muted-foreground">No inspection requests recorded yet.</p> : (
                <div className="space-y-3">{inspections.map((item) => {
                  const application = applications.find((candidate) => candidate.id === item.application_id);
                  return <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
                    <div><div className="font-medium">{item.inspection_type}</div><div className="text-xs text-muted-foreground">{application?.jurisdiction_name ?? "Permit"} · {localDateTime(item.scheduled_at)}</div><div className="mt-1"><Badge variant="secondary">{String(item.scheduling_status).replaceAll("_", " ")}</Badge></div><div className="mt-2 flex flex-wrap items-center gap-2"><Input aria-label="Municipal inspection confirmation number" placeholder="Confirmation number (optional)" className="h-8 w-56" value={inspectionConfirmations[item.id] ?? item.confirmation_number ?? ""} onChange={(event) => setInspectionConfirmations((current) => ({ ...current, [item.id]: event.target.value }))} maxLength={120} /><Button size="sm" variant="ghost" disabled={saveInspectionConfirmation.isPending} onClick={() => saveInspectionConfirmation.mutate({ id: item.id, confirmationNumber: inspectionConfirmations[item.id] ?? item.confirmation_number ?? "" })}>Save confirmation</Button></div></div>
                    <div className="flex flex-wrap gap-2">
                      {item.scheduling_status === "requested" && <div className="flex flex-wrap items-center gap-2"><Input aria-label="Confirmed inspection date and time" type="datetime-local" className="h-8 w-48" value={scheduleDates[item.id] ?? ""} onChange={(event) => setScheduleDates((current) => ({ ...current, [item.id]: event.target.value }))} /><Button size="sm" variant="outline" disabled={!scheduleDates[item.id]} onClick={() => updateInspectionStatus.mutate({ id: item.id, status: "scheduled", scheduledAt: scheduleDates[item.id] })}>Confirm scheduled</Button></div>}
                      {item.scheduling_status === "scheduled" && <><Button size="sm" variant="outline" onClick={() => updateInspectionStatus.mutate({ id: item.id, status: "passed" })}>Passed</Button><Button size="sm" variant="outline" onClick={() => updateInspectionStatus.mutate({ id: item.id, status: "failed" })}>Failed</Button></>}
                      {![ "passed", "failed", "cancelled" ].includes(item.scheduling_status) && <Button size="sm" variant="ghost" onClick={() => updateInspectionStatus.mutate({ id: item.id, status: "cancelled" })}>Cancel</Button>}
                    </div>
                  </div>;
                })}</div>
              )}
            </CardContent>
          </Card>
          <p className="text-xs text-muted-foreground">Important: “Record submitted,” “Mark scheduled,” and inspection outcomes are manual CRM updates. They do not contact a municipal portal or independently verify municipal status. Add the official permit number, confirmation number, and documents after receiving them.</p>
        </>
      )}
    </div>
  );
}
