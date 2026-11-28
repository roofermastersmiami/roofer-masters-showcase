import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import {
  canCreatePermitApplication,
  canCreatePermitInspection,
  canTransitionPermitApplication,
  canTransitionPermitInspection,
} from "@/lib/permitting-rules";
import {
  attemptPermitCustomerEmail,
  createPermitNotification,
  describePermit,
  documentAddedBody,
  inspectionRequestedBody,
  inspectionResultBody,
  inspectionResultEmail,
  inspectionResultNotification,
  inspectionScheduledBody,
  inspectionScheduledNotification,
  permitCreatedBody,
  permitStatusChangeEmail,
  permitStatusChangedBody,
  productApprovalRecordedBody,
  productApprovalVerifiedBody,
  recordPermitActivity,
  statusChangeNotification,
  sweepPermitExpirations,
  type PermitEmailTransport,
} from "@/lib/permit-notifications";
import type { SupabaseClient } from "@supabase/supabase-js";

const applicationStatuses = [
  "draft",
  "ready_to_submit",
  "submitted",
  "issued",
  "rejected",
  "expired",
  "cancelled",
] as const;
const inspectionStatuses = ["requested", "scheduled", "passed", "failed", "cancelled"] as const;

const applicationInput = z.object({
  roof_job_id: z.string().uuid(),
  jurisdiction_name: z.string().trim().min(1).max(160),
  jurisdiction_code: z.string().trim().max(80).nullable().optional(),
  permit_type: z.string().trim().min(1).max(120),
  application_status: z.enum(applicationStatuses).default("draft"),
  permit_number: z.string().trim().max(120).nullable().optional(),
  portal_url: z.string().url().max(2048).nullable().optional(),
  submitted_at: z.string().datetime().nullable().optional(),
  issued_at: z.string().datetime().nullable().optional(),
  expires_at: z.string().date().nullable().optional(),
  fee_cents: z.number().int().nonnegative().nullable().optional(),
  notes: z.string().max(10000).optional(),
});
const inspectionInput = z.object({
  application_id: z.string().uuid(),
  inspection_type: z.string().trim().min(1).max(120),
  scheduled_at: z.string().datetime().nullable().optional(),
  scheduling_status: z.enum(inspectionStatuses).default("requested"),
  confirmation_number: z.string().trim().max(120).nullable().optional(),
  completed_at: z.string().datetime().nullable().optional(),
  notes: z.string().max(5000).optional(),
});

// tenant-audit: reviewed — every server function is authenticated, resolves exactly one membership from the middleware-verified user ID, rejects non-admin roles, and applies company_id predicates to reads/writes. Job/application links are revalidated within that company; RLS and composite FKs remain defense in depth. Service-role access is never based on browser-supplied company IDs. The automation helpers below write crm_activity / crm_notifications rows only with the membership-derived companyId and a lead resolved through the company-scoped job link.
async function permitContext(userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as SupabaseClient;
  const { data: memberships, error } = await db
    .from("crm_company_memberships")
    .select("company_id,role")
    .eq("user_id", userId);
  if (error || !memberships?.length)
    throw new Error("No company membership is available for permitting.");
  if (memberships.length !== 1)
    throw new Error(
      "Permitting requires an active company selection; multiple company memberships were found.",
    );
  const membership = memberships[0];
  if (membership.role !== "owner" && membership.role !== "admin")
    throw new Error("Only company owners and administrators can manage permit records.");
  return { db, companyId: membership.company_id as string };
}

type PermitApplicationRow = {
  id: string;
  roof_job_id: string;
  permit_type: string | null;
  permit_number: string | null;
  jurisdiction_name: string | null;
  application_status: string;
  expires_at: string | null;
};

async function loadApplicationSummary(
  db: SupabaseClient,
  companyId: string,
  applicationId: string,
): Promise<PermitApplicationRow | null> {
  const { data } = await db
    .from("roof_permit_applications")
    .select(
      "id,roof_job_id,permit_type,permit_number,jurisdiction_name,application_status,expires_at",
    )
    .eq("id", applicationId)
    .eq("company_id", companyId)
    .maybeSingle();
  return (data as PermitApplicationRow | null) ?? null;
}

/** Resolve the customer contact for a job through its company-scoped lead. */
async function customerContactForJob(
  db: SupabaseClient,
  companyId: string,
  jobId: string,
): Promise<{ leadId: string | null; name: string | null; email: string | null }> {
  const { data: job } = await db
    .from("roof_jobs")
    .select("lead_id")
    .eq("id", jobId)
    .eq("company_id", companyId)
    .maybeSingle();
  const leadId = (job?.lead_id as string | null) ?? null;
  if (!leadId) return { leadId: null, name: null, email: null };
  const { data: lead } = await db
    .from("leads")
    .select("name,email")
    .eq("id", leadId)
    .eq("company_id", companyId)
    .maybeSingle();
  const rawEmail = typeof lead?.email === "string" ? lead.email.trim() : "";
  return {
    leadId,
    name: (lead?.name as string | null) ?? null,
    email: rawEmail.includes("@") ? rawEmail : null,
  };
}

async function permitEmailTransport(): Promise<PermitEmailTransport> {
  const smtp = await import("@/lib/smtp.server");
  return {
    missingConfig: smtp.missingSmtpConfig,
    send: (input) => smtp.sendSmtpMessage({ ...input, attachments: [] }),
  };
}

/**
 * Automation for an application status change: audit row, in-app
 * notification, and a best-effort customer email whose real outcome is
 * itself recorded in the activity log. Never throws.
 */
async function onPermitStatusChanged(
  db: SupabaseClient,
  companyId: string,
  application: PermitApplicationRow,
  fromStatus: string,
  toStatus: string,
): Promise<void> {
  const contact = await customerContactForJob(db, companyId, application.roof_job_id);
  await recordPermitActivity(db, {
    companyId,
    leadId: contact.leadId,
    body: permitStatusChangedBody(application, fromStatus, toStatus),
  });
  const note = statusChangeNotification(application, fromStatus, toStatus);
  await createPermitNotification(db, {
    companyId,
    kind: note.kind,
    title: note.title,
    body: note.body,
    applicationId: application.id,
  });
  if (contact.email) {
    const email = permitStatusChangeEmail(application, toStatus, contact.name ?? "there");
    await attemptPermitCustomerEmail(db, {
      companyId,
      leadId: contact.leadId,
      to: contact.email,
      subject: email.subject,
      message: email.message,
      transport: await permitEmailTransport(),
    });
  }
}

/** Automation for a recorded inspection outcome (passed/failed). Never throws. */
async function onInspectionResult(
  db: SupabaseClient,
  companyId: string,
  application: PermitApplicationRow,
  inspection: { inspection_type: string | null; scheduled_at: string | null },
  result: "passed" | "failed",
): Promise<void> {
  const contact = await customerContactForJob(db, companyId, application.roof_job_id);
  await recordPermitActivity(db, {
    companyId,
    leadId: contact.leadId,
    body: inspectionResultBody(inspection, application, result),
  });
  const note = inspectionResultNotification(inspection, application, result);
  await createPermitNotification(db, {
    companyId,
    kind: note.kind,
    title: note.title,
    body: note.body,
    applicationId: application.id,
  });
  if (contact.email) {
    const email = inspectionResultEmail(inspection, application, result, contact.name ?? "there");
    await attemptPermitCustomerEmail(db, {
      companyId,
      leadId: contact.leadId,
      to: contact.email,
      subject: email.subject,
      message: email.message,
      transport: await permitEmailTransport(),
    });
  }
}

export const getPermitWorkspace = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { db, companyId } = await permitContext(context.userId);
    const [{ data: applications, error: applicationsError }, { data: jobs, error: jobsError }] =
      await Promise.all([
        db
          .from("roof_permit_applications")
          .select("*")
          .eq("company_id", companyId)
          .order("updated_at", { ascending: false }),
        db
          .from("roof_jobs")
          .select("id,title,status,property_id,company_id")
          .eq("company_id", companyId)
          .order("created_at", { ascending: false }),
      ]);
    if (applicationsError || jobsError) throw new Error("Could not load company permit records.");
    // Expiration sweep: runs whenever the permits workspace loads and
    // creates each threshold notification once per permit (dedupe key).
    // Best-effort — the writers never throw, and a workspace load must not
    // fail because the notifications table is not migrated yet.
    try {
      await sweepPermitExpirations(
        db,
        companyId,
        (applications ?? []) as PermitApplicationRow[],
        new Date().toISOString().slice(0, 10),
      );
    } catch {
      // Notifications are additive; ignore sweep failures on load.
    }
    const applicationIds = (applications ?? []).map((item) => item.id);
    const { data: inspections, error: inspectionsError } = applicationIds.length
      ? await db
          .from("roof_permit_inspections")
          .select("*")
          .eq("company_id", companyId)
          .in("application_id", applicationIds)
          .order("scheduled_at", { ascending: true })
      : { data: [], error: null };
    if (inspectionsError) throw new Error("Could not load permit inspections.");
    const { data: approvals, error: approvalsError } = await db
      .from("roof_product_approvals")
      .select("*")
      .eq("company_id", companyId)
      .order("updated_at", { ascending: false });
    if (approvalsError) throw new Error("Could not load roof product approval records.");
    const { data: nocTracking, error: nocError } = await db
      .from("roof_permit_noc_tracking")
      .select("*")
      .eq("company_id", companyId)
      .order("updated_at", { ascending: false });
    if (nocError) throw new Error("Could not load Notice of Commencement tracking records.");
    const propertyIds = [...new Set((jobs ?? []).map((job) => job.property_id).filter(Boolean))];
    const { data: properties, error: propertiesError } = propertyIds.length
      ? await db.from("crm_properties").select("id,address").in("id", propertyIds)
      : { data: [], error: null };
    if (propertiesError) throw new Error("Could not load roof-job properties.");
    type PermitNotificationRow = {
      id: string;
      company_id: string;
      kind: string;
      title: string;
      body: string;
      permit_application_id: string | null;
      dedupe_key: string | null;
      read_at: string | null;
      created_at: string;
    };
    let notifications: PermitNotificationRow[] = [];
    try {
      const { data: notificationRows } = await db
        .from("crm_notifications")
        .select("*")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false })
        .limit(50);
      notifications = (notificationRows ?? []) as PermitNotificationRow[];
    } catch {
      notifications = [];
    }
    return {
      notifications,
      applications: applications ?? [],
      inspections: inspections ?? [],
      approvals: approvals ?? [],
      nocTracking: nocTracking ?? [],
      jobs: (jobs ?? []).map((job) => ({
        ...job,
        address: properties?.find((property) => property.id === job.property_id)?.address ?? "",
      })),
    };
  });

export const createPermitApplication = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => applicationInput.parse(raw))
  .handler(async ({ data, context }) => {
    if (!canCreatePermitApplication(data.application_status, data)) {
      throw new Error(
        "New permit applications must start as drafts. Record submission and issuance through the permit workflow.",
      );
    }
    const { db, companyId } = await permitContext(context.userId);
    const { data: job } = await db
      .from("roof_jobs")
      .select("id,lead_id")
      .eq("id", data.roof_job_id)
      .eq("company_id", companyId)
      .maybeSingle();
    if (!job) throw new Error("Select a roofing job belonging to your company.");
    const { data: saved, error } = await db
      .from("roof_permit_applications")
      .insert({ ...data, company_id: companyId, created_by: context.userId })
      .select("*")
      .single();
    if (error || !saved) throw new Error("Could not save the permit application.");
    await recordPermitActivity(db, {
      companyId,
      leadId: (job.lead_id as string | null) ?? null,
      body: permitCreatedBody(saved as PermitApplicationRow),
    });
    return saved;
  });

export const updatePermitApplication = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        changes: applicationInput.partial().omit({ roof_job_id: true }),
      })
      .parse(raw),
  )
  .handler(async ({ data, context }) => {
    const { db, companyId } = await permitContext(context.userId);
    const { data: current, error: currentError } = await db
      .from("roof_permit_applications")
      .select(
        "application_status,permit_number,submitted_at,issued_at,expires_at,notes,updated_at,roof_job_id,permit_type,jurisdiction_name",
      )
      .eq("id", data.id)
      .eq("company_id", companyId)
      .maybeSingle();
    if (currentError || !current)
      throw new Error("Permit application was not found in your company.");
    const nextStatus = data.changes.application_status;
    if (
      nextStatus &&
      !canTransitionPermitApplication(
        current.application_status as import("@/lib/permitting-rules").PermitApplicationStatus,
        nextStatus,
      )
    ) {
      throw new Error("Invalid permit application status transition.");
    }
    const resultingApplication = { ...current, ...data.changes };
    // Validate invariants against the resulting record, not only an explicit
    // status transition. Detail-only edits must not invalidate an issued permit.
    if (
      resultingApplication.application_status === "issued" &&
      (!(resultingApplication.permit_number ?? "").trim() || !resultingApplication.issued_at)
    ) {
      throw new Error("An issued permit must retain its official permit number and issue date.");
    }
    if (nextStatus === "rejected" && !data.changes.notes?.trim()) {
      throw new Error(
        "Recording a rejection requires the municipality rejection reason in the notes.",
      );
    }
    if (
      resultingApplication.application_status === "submitted" &&
      !resultingApplication.submitted_at
    ) {
      throw new Error("A submitted application must retain its actual submission timestamp.");
    }
    if (resultingApplication.application_status === "expired" && !resultingApplication.issued_at) {
      throw new Error("An expired permit must retain its issue date.");
    }
    const { data: saved, error } = await db
      .from("roof_permit_applications")
      .update(data.changes)
      .eq("id", data.id)
      .eq("company_id", companyId)
      .eq("updated_at", current.updated_at)
      .select("*")
      .maybeSingle();
    if (error) throw new Error("Could not update this permit application.");
    if (!saved)
      throw new Error(
        "This permit application changed in another session. Reload it and retry your update.",
      );
    if (nextStatus && nextStatus !== current.application_status) {
      await onPermitStatusChanged(
        db,
        companyId,
        saved as PermitApplicationRow,
        current.application_status as string,
        nextStatus,
      );
    }
    return saved;
  });

export const recordPermitRejection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        reason: z.string().trim().min(1).max(4000),
      })
      .parse(raw),
  )
  .handler(async ({ data, context }) => {
    const { db, companyId } = await permitContext(context.userId);
    const { data: current, error: currentError } = await db
      .from("roof_permit_applications")
      .select(
        "application_status,notes,updated_at,roof_job_id,permit_type,permit_number,jurisdiction_name",
      )
      .eq("id", data.id)
      .eq("company_id", companyId)
      .maybeSingle();
    if (currentError || !current)
      throw new Error("Permit application was not found in your company.");
    if (
      !canTransitionPermitApplication(
        current.application_status as import("@/lib/permitting-rules").PermitApplicationStatus,
        "rejected",
      )
    )
      throw new Error("Only a submitted permit application can be recorded as rejected.");
    const timestamp = new Date().toISOString();
    const existingNotes = String(current.notes ?? "").trim();
    const notes = existingNotes
      ? `${existingNotes}\n\nRejection reason (recorded ${timestamp}): ${data.reason}`
      : `Rejection reason (recorded ${timestamp}): ${data.reason}`;
    const { data: saved, error } = await db
      .from("roof_permit_applications")
      .update({ application_status: "rejected", notes })
      .eq("id", data.id)
      .eq("company_id", companyId)
      .eq("updated_at", current.updated_at)
      .select("*")
      .maybeSingle();
    if (error) throw new Error("Could not record the permit rejection.");
    if (!saved)
      throw new Error(
        "This permit application changed in another session. Reload it and retry recording the rejection.",
      );
    await onPermitStatusChanged(
      db,
      companyId,
      saved as PermitApplicationRow,
      current.application_status as string,
      "rejected",
    );
    return saved;
  });

export const createPermitInspection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => inspectionInput.parse(raw))
  .handler(async ({ data, context }) => {
    if (!canCreatePermitInspection(data.scheduling_status, data)) {
      throw new Error(
        "New inspections must start as requested. Confirm an appointment before recording an outcome.",
      );
    }
    const { db, companyId } = await permitContext(context.userId);
    const { data: application } = await db
      .from("roof_permit_applications")
      .select("id")
      .eq("id", data.application_id)
      .eq("company_id", companyId)
      .maybeSingle();
    if (!application) throw new Error("Select a permit application belonging to your company.");
    const { data: saved, error } = await db
      .from("roof_permit_inspections")
      .insert({ ...data, company_id: companyId, created_by: context.userId })
      .select("*")
      .single();
    if (error || !saved) throw new Error("Could not save the inspection.");
    const applicationSummary = await loadApplicationSummary(db, companyId, data.application_id);
    if (applicationSummary) {
      const contact = await customerContactForJob(db, companyId, applicationSummary.roof_job_id);
      await recordPermitActivity(db, {
        companyId,
        leadId: contact.leadId,
        body: inspectionRequestedBody(saved, applicationSummary),
      });
    }
    return saved;
  });

export const updatePermitInspection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        changes: inspectionInput.partial().omit({ application_id: true }),
      })
      .parse(raw),
  )
  .handler(async ({ data, context }) => {
    const { db, companyId } = await permitContext(context.userId);
    const { data: current, error: currentError } = await db
      .from("roof_permit_inspections")
      .select(
        "scheduling_status,scheduled_at,completed_at,updated_at,application_id,inspection_type",
      )
      .eq("id", data.id)
      .eq("company_id", companyId)
      .maybeSingle();
    if (currentError || !current) throw new Error("Inspection was not found in your company.");
    const nextStatus = data.changes.scheduling_status;
    if (
      nextStatus &&
      !canTransitionPermitInspection(
        current.scheduling_status as import("@/lib/permitting-rules").PermitInspectionStatus,
        nextStatus,
      )
    ) {
      throw new Error("Invalid inspection status transition.");
    }
    const resultingInspection = { ...current, ...data.changes };
    // Keep required dates intact during detail-only edits as well as transitions.
    if (
      ["scheduled", "passed", "failed"].includes(resultingInspection.scheduling_status) &&
      !resultingInspection.scheduled_at
    ) {
      throw new Error(
        "A scheduled inspection or recorded outcome must retain its confirmed appointment date and time.",
      );
    }
    if (
      ["passed", "failed"].includes(resultingInspection.scheduling_status) &&
      !resultingInspection.completed_at
    ) {
      throw new Error("A recorded inspection outcome must retain its completion timestamp.");
    }
    const { data: saved, error } = await db
      .from("roof_permit_inspections")
      .update(data.changes)
      .eq("id", data.id)
      .eq("company_id", companyId)
      .eq("updated_at", current.updated_at)
      .select("*")
      .maybeSingle();
    if (error) throw new Error("Could not update this inspection.");
    if (!saved)
      throw new Error(
        "This inspection changed in another session. Reload it and retry your update.",
      );
    if (nextStatus && nextStatus !== current.scheduling_status) {
      const application = await loadApplicationSummary(
        db,
        companyId,
        current.application_id as string,
      );
      if (application) {
        if (nextStatus === "scheduled") {
          const contact = await customerContactForJob(db, companyId, application.roof_job_id);
          await recordPermitActivity(db, {
            companyId,
            leadId: contact.leadId,
            body: inspectionScheduledBody(saved, application),
          });
          const note = inspectionScheduledNotification(saved, application);
          await createPermitNotification(db, {
            companyId,
            kind: note.kind,
            title: note.title,
            body: note.body,
            applicationId: application.id,
          });
        } else if (nextStatus === "passed" || nextStatus === "failed") {
          await onInspectionResult(db, companyId, application, saved, nextStatus);
        } else if (nextStatus === "cancelled") {
          const contact = await customerContactForJob(db, companyId, application.roof_job_id);
          await recordPermitActivity(db, {
            companyId,
            leadId: contact.leadId,
            body: `${(saved.inspection_type as string) || "Inspection"} inspection cancelled for ${describePermit(application)}.`,
          });
        }
      }
    }
    return saved;
  });

const productApprovalInput = z
  .object({
    permit_application_id: z.string().uuid(),
    approval_kind: z.enum([
      "miami_dade_noa",
      "florida_product_approval",
      "ul_listing",
      "fire_directory",
    ]),
    approval_number: z.string().trim().min(1).max(120),
    manufacturer: z.string().trim().min(1).max(160),
    product_name: z.string().trim().min(1).max(200),
    product_category: z.string().trim().max(120).optional(),
    expires_on: z.string().date().nullable().optional(),
    hvhz_status: z.enum(["yes", "no", "unknown"]).default("unknown"),
    system_description: z.string().max(4000).optional(),
    installation_limitations: z.string().max(4000).optional(),
    source_url: z.string().url().max(2048).nullable().optional(),
    code_edition: z.enum(["2023_8th", "2026_9th", "legacy", "unknown"]).default("unknown"),
    code_edition_source_url: z.string().url().max(2048).nullable().optional(),
    code_edition_notes: z.string().max(2000).optional(),
  })
  .superRefine((value, context) => {
    if (value.code_edition !== "unknown" && !value.code_edition_source_url) {
      context.addIssue({
        code: "custom",
        path: ["code_edition_source_url"],
        message: "Cite the source that identifies the code edition for this approval.",
      });
    }
  });

export const createRoofProductApproval = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => productApprovalInput.parse(raw))
  .handler(async ({ data, context }) => {
    const { db, companyId } = await permitContext(context.userId);
    const { data: application } = await db
      .from("roof_permit_applications")
      .select("id")
      .eq("id", data.permit_application_id)
      .eq("company_id", companyId)
      .maybeSingle();
    if (!application) throw new Error("Select a permit application belonging to your company.");
    const { data: saved, error } = await db
      .from("roof_product_approvals")
      .insert({
        ...data,
        company_id: companyId,
        created_by: context.userId,
        approval_status: "unverified",
      })
      .select("*")
      .single();
    if (error || !saved) throw new Error("Could not save the product approval reference.");
    const applicationSummary = await loadApplicationSummary(
      db,
      companyId,
      data.permit_application_id,
    );
    if (applicationSummary) {
      const contact = await customerContactForJob(db, companyId, applicationSummary.roof_job_id);
      await recordPermitActivity(db, {
        companyId,
        leadId: contact.leadId,
        body: productApprovalRecordedBody(saved, applicationSummary),
      });
    }
    return saved;
  });

export const verifyRoofProductApproval = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ id: z.string().uuid() }).parse(raw))
  .handler(async ({ data, context }) => {
    const { db, companyId } = await permitContext(context.userId);
    const { data: current, error: currentError } = await db
      .from("roof_product_approvals")
      .select("approval_status,expires_on,updated_at,permit_application_id,approval_number")
      .eq("id", data.id)
      .eq("company_id", companyId)
      .maybeSingle();
    if (currentError || !current)
      throw new Error("Product approval record was not found in your company.");
    if (current.approval_status === "revoked")
      throw new Error("A revoked approval cannot be marked verified.");
    const today = new Date().toISOString().slice(0, 10);
    if (current.expires_on && current.expires_on < today) {
      throw new Error(
        "This approval is past its recorded expiration date. Confirm its current status with the issuing authority before changing the record.",
      );
    }
    const { data: saved, error } = await db
      .from("roof_product_approvals")
      .update({
        approval_status: "verified",
        verified_at: new Date().toISOString(),
        verified_by: context.userId,
      })
      .eq("id", data.id)
      .eq("company_id", companyId)
      .eq("updated_at", current.updated_at)
      .select("*")
      .maybeSingle();
    if (error) throw new Error("Could not verify this product approval record.");
    if (!saved)
      throw new Error("This approval record changed in another session. Reload and retry.");
    const applicationSummary = await loadApplicationSummary(
      db,
      companyId,
      current.permit_application_id as string,
    );
    if (applicationSummary) {
      const contact = await customerContactForJob(db, companyId, applicationSummary.roof_job_id);
      await recordPermitActivity(db, {
        companyId,
        leadId: contact.leadId,
        body: productApprovalVerifiedBody(saved, applicationSummary),
      });
    }
    return saved;
  });

const permitNocInput = z
  .object({
    permit_application_id: z.string().uuid(),
    assessment_status: z.enum(["not_assessed", "required", "not_required"]),
    recording_status: z.enum(["not_started", "draft", "recorded"]),
    contract_value_cents: z.number().int().nonnegative().nullable().optional(),
    threshold_amount_cents: z.number().int().nonnegative().nullable().optional(),
    assessment_basis: z.string().max(3000).optional(),
    threshold_source_url: z.string().url().max(2048).nullable().optional(),
    recording_county: z.string().trim().max(100).optional(),
    instrument_number: z.string().trim().max(120).nullable().optional(),
    recorded_on: z.string().date().nullable().optional(),
    clerk_receipt_url: z.string().url().max(2048).nullable().optional(),
    notes: z.string().max(4000).optional(),
  })
  .superRefine((value, context) => {
    if (value.recording_status === "recorded" && value.assessment_status !== "required") {
      context.addIssue({
        code: "custom",
        path: ["assessment_status"],
        message: "A recorded NOC must have an assessment marked required.",
      });
    }
    if (
      value.recording_status === "recorded" &&
      (!value.recording_county?.trim() || !value.instrument_number?.trim() || !value.recorded_on)
    ) {
      context.addIssue({
        code: "custom",
        path: ["recording_status"],
        message: "A recorded NOC requires county, instrument number, and recording date.",
      });
    }
    if (
      value.assessment_status !== "not_assessed" &&
      (!value.assessment_basis?.trim() || !value.threshold_source_url)
    ) {
      context.addIssue({
        code: "custom",
        path: ["assessment_basis"],
        message:
          "A required / not-required decision must cite the current jurisdiction source and assessment basis.",
      });
    }
    if (
      value.assessment_status === "required" &&
      (value.contract_value_cents == null || value.threshold_amount_cents == null)
    ) {
      context.addIssue({
        code: "custom",
        path: ["threshold_amount_cents"],
        message:
          "A required NOC assessment must record both contract value and the verified threshold.",
      });
    }
  });

export const savePermitNocTracking = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => permitNocInput.parse(raw))
  .handler(async ({ data, context }) => {
    const { db, companyId } = await permitContext(context.userId);
    const { data: application } = await db
      .from("roof_permit_applications")
      .select("id")
      .eq("id", data.permit_application_id)
      .eq("company_id", companyId)
      .maybeSingle();
    if (!application) throw new Error("Select a permit application belonging to your company.");
    const { data: saved, error } = await db
      .from("roof_permit_noc_tracking")
      .upsert(
        { ...data, company_id: companyId, created_by: context.userId },
        { onConflict: "permit_application_id,company_id" },
      )
      .select("*")
      .single();
    if (error || !saved) throw new Error("Could not save the NOC tracking record.");
    return saved;
  });

/**
 * Record a completed permit-document upload in the audit trail. Uploads go
 * straight from the browser to the private permit-documents bucket, so the
 * client calls this after a successful upload; the storage path must match
 * the company/application folder the bucket policy enforces.
 */
export const recordPermitDocumentUpload = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) =>
    z
      .object({
        application_id: z.string().uuid(),
        file_name: z.string().trim().min(1).max(255),
        storage_path: z.string().trim().min(1).max(1024),
      })
      .parse(raw),
  )
  .handler(async ({ data, context }) => {
    const { db, companyId } = await permitContext(context.userId);
    const application = await loadApplicationSummary(db, companyId, data.application_id);
    if (!application) throw new Error("Permit application was not found in your company.");
    const expectedPrefix = `${companyId}/${data.application_id}/`;
    if (!data.storage_path.startsWith(expectedPrefix))
      throw new Error("Document path does not match this permit application.");
    const contact = await customerContactForJob(db, companyId, application.roof_job_id);
    await recordPermitActivity(db, {
      companyId,
      leadId: contact.leadId,
      body: documentAddedBody(application, data.file_name),
    });
    return { recorded: true };
  });

export const markPermitNotificationRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ id: z.string().uuid() }).parse(raw))
  .handler(async ({ data, context }) => {
    const { db, companyId } = await permitContext(context.userId);
    const { error } = await db
      .from("crm_notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("id", data.id)
      .eq("company_id", companyId);
    if (error) throw new Error("Could not mark this notification as read.");
    return { ok: true };
  });
