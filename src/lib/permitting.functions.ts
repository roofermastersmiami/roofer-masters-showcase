import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { canCreatePermitApplication, canCreatePermitInspection, canTransitionPermitApplication, canTransitionPermitInspection } from "@/lib/permitting-rules";
import type { SupabaseClient } from "@supabase/supabase-js";

const applicationStatuses = [
  "draft", "ready_to_submit", "submitted", "issued", "rejected", "expired", "cancelled",
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

// tenant-audit: reviewed — every server function is authenticated, resolves exactly one membership from the middleware-verified user ID, rejects non-admin roles, and applies company_id predicates to reads/writes. Job/application links are revalidated within that company; RLS and composite FKs remain defense in depth. Service-role access is never based on browser-supplied company IDs.
async function permitContext(userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as SupabaseClient;
  const { data: memberships, error } = await db
    .from("crm_company_memberships")
    .select("company_id,role")
    .eq("user_id", userId);
  if (error || !memberships?.length) throw new Error("No company membership is available for permitting.");
  if (memberships.length !== 1)
    throw new Error("Permitting requires an active company selection; multiple company memberships were found.");
  const membership = memberships[0];
  if (membership.role !== "owner" && membership.role !== "admin")
    throw new Error("Only company owners and administrators can manage permit records.");
  return { db, companyId: membership.company_id as string };
}

export const getPermitWorkspace = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { db, companyId } = await permitContext(context.userId);
    const [{ data: applications, error: applicationsError }, { data: jobs, error: jobsError }] =
      await Promise.all([
        db.from("roof_permit_applications").select("*").eq("company_id", companyId).order("updated_at", { ascending: false }),
        db.from("roof_jobs").select("id,title,status,property_id,company_id").eq("company_id", companyId).order("created_at", { ascending: false }),
      ]);
    if (applicationsError || jobsError) throw new Error("Could not load company permit records.");
    const applicationIds = (applications ?? []).map((item) => item.id);
    const { data: inspections, error: inspectionsError } = applicationIds.length
      ? await db.from("roof_permit_inspections").select("*").eq("company_id", companyId).in("application_id", applicationIds).order("scheduled_at", { ascending: true })
      : { data: [], error: null };
    if (inspectionsError) throw new Error("Could not load permit inspections.");
    const { data: approvals, error: approvalsError } = await db.from("roof_product_approvals")
      .select("*").eq("company_id", companyId).order("updated_at", { ascending: false });
    if (approvalsError) throw new Error("Could not load roof product approval records.");
    const { data: nocTracking, error: nocError } = await db.from("roof_permit_noc_tracking")
      .select("*").eq("company_id", companyId).order("updated_at", { ascending: false });
    if (nocError) throw new Error("Could not load Notice of Commencement tracking records.");
    const propertyIds = [...new Set((jobs ?? []).map((job) => job.property_id).filter(Boolean))];
    const { data: properties, error: propertiesError } = propertyIds.length
      ? await db.from("crm_properties").select("id,address").in("id", propertyIds)
      : { data: [], error: null };
    if (propertiesError) throw new Error("Could not load roof-job properties.");
    return {
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
      throw new Error("New permit applications must start as drafts. Record submission and issuance through the permit workflow.");
    }
    const { db, companyId } = await permitContext(context.userId);
    const { data: job } = await db.from("roof_jobs").select("id").eq("id", data.roof_job_id).eq("company_id", companyId).maybeSingle();
    if (!job) throw new Error("Select a roofing job belonging to your company.");
    const { data: saved, error } = await db.from("roof_permit_applications")
      .insert({ ...data, company_id: companyId, created_by: context.userId })
      .select("*").single();
    if (error || !saved) throw new Error("Could not save the permit application.");
    return saved;
  });

export const updatePermitApplication = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ id: z.string().uuid(), changes: applicationInput.partial().omit({ roof_job_id: true }) }).parse(raw))
  .handler(async ({ data, context }) => {
    const { db, companyId } = await permitContext(context.userId);
    const { data: current, error: currentError } = await db.from("roof_permit_applications")
      .select("application_status,permit_number,submitted_at,issued_at,expires_at,notes,updated_at").eq("id", data.id).eq("company_id", companyId).maybeSingle();
    if (currentError || !current) throw new Error("Permit application was not found in your company.");
    const nextStatus = data.changes.application_status;
    if (nextStatus && !canTransitionPermitApplication(
      current.application_status as import("@/lib/permitting-rules").PermitApplicationStatus,
      nextStatus,
    )) {
      throw new Error("Invalid permit application status transition.");
    }
    const resultingApplication = { ...current, ...data.changes };
    // Validate invariants against the resulting record, not only an explicit
    // status transition. Detail-only edits must not invalidate an issued permit.
    if (resultingApplication.application_status === "issued" &&
      (!(resultingApplication.permit_number ?? "").trim() || !resultingApplication.issued_at)) {
      throw new Error("An issued permit must retain its official permit number and issue date.");
    }
    if (nextStatus === "rejected" && !data.changes.notes?.trim()) {
      throw new Error("Recording a rejection requires the municipality rejection reason in the notes.");
    }
    if (resultingApplication.application_status === "submitted" && !resultingApplication.submitted_at) {
      throw new Error("A submitted application must retain its actual submission timestamp.");
    }
    if (resultingApplication.application_status === "expired" && !resultingApplication.issued_at) {
      throw new Error("An expired permit must retain its issue date.");
    }
    const { data: saved, error } = await db.from("roof_permit_applications")
      .update(data.changes).eq("id", data.id).eq("company_id", companyId).eq("updated_at", current.updated_at).select("*").maybeSingle();
    if (error) throw new Error("Could not update this permit application.");
    if (!saved) throw new Error("This permit application changed in another session. Reload it and retry your update.");
    return saved;
  });

export const recordPermitRejection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({
    id: z.string().uuid(),
    reason: z.string().trim().min(1).max(4000),
  }).parse(raw))
  .handler(async ({ data, context }) => {
    const { db, companyId } = await permitContext(context.userId);
    const { data: current, error: currentError } = await db.from("roof_permit_applications")
      .select("application_status,notes,updated_at")
      .eq("id", data.id).eq("company_id", companyId).maybeSingle();
    if (currentError || !current) throw new Error("Permit application was not found in your company.");
    if (!canTransitionPermitApplication(
      current.application_status as import("@/lib/permitting-rules").PermitApplicationStatus,
      "rejected",
    )) throw new Error("Only a submitted permit application can be recorded as rejected.");
    const timestamp = new Date().toISOString();
    const existingNotes = String(current.notes ?? "").trim();
    const notes = existingNotes
      ? `${existingNotes}\n\nRejection reason (recorded ${timestamp}): ${data.reason}`
      : `Rejection reason (recorded ${timestamp}): ${data.reason}`;
    const { data: saved, error } = await db.from("roof_permit_applications")
      .update({ application_status: "rejected", notes })
      .eq("id", data.id).eq("company_id", companyId)
      .eq("updated_at", current.updated_at).select("*").maybeSingle();
    if (error) throw new Error("Could not record the permit rejection.");
    if (!saved) throw new Error("This permit application changed in another session. Reload it and retry recording the rejection.");
    return saved;
  });

export const createPermitInspection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => inspectionInput.parse(raw))
  .handler(async ({ data, context }) => {
    if (!canCreatePermitInspection(data.scheduling_status, data)) {
      throw new Error("New inspections must start as requested. Confirm an appointment before recording an outcome.");
    }
    const { db, companyId } = await permitContext(context.userId);
    const { data: application } = await db.from("roof_permit_applications").select("id")
      .eq("id", data.application_id).eq("company_id", companyId).maybeSingle();
    if (!application) throw new Error("Select a permit application belonging to your company.");
    const { data: saved, error } = await db.from("roof_permit_inspections")
      .insert({ ...data, company_id: companyId, created_by: context.userId })
      .select("*").single();
    if (error || !saved) throw new Error("Could not save the inspection.");
    return saved;
  });

export const updatePermitInspection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ id: z.string().uuid(), changes: inspectionInput.partial().omit({ application_id: true }) }).parse(raw))
  .handler(async ({ data, context }) => {
    const { db, companyId } = await permitContext(context.userId);
    const { data: current, error: currentError } = await db.from("roof_permit_inspections")
      .select("scheduling_status,scheduled_at,completed_at,updated_at").eq("id", data.id).eq("company_id", companyId).maybeSingle();
    if (currentError || !current) throw new Error("Inspection was not found in your company.");
    const nextStatus = data.changes.scheduling_status;
    if (nextStatus && !canTransitionPermitInspection(
      current.scheduling_status as import("@/lib/permitting-rules").PermitInspectionStatus,
      nextStatus,
    )) {
      throw new Error("Invalid inspection status transition.");
    }
    const resultingInspection = { ...current, ...data.changes };
    // Keep required dates intact during detail-only edits as well as transitions.
    if (["scheduled", "passed", "failed"].includes(resultingInspection.scheduling_status) &&
      !resultingInspection.scheduled_at) {
      throw new Error("A scheduled inspection or recorded outcome must retain its confirmed appointment date and time.");
    }
    if (["passed", "failed"].includes(resultingInspection.scheduling_status) && !resultingInspection.completed_at) {
      throw new Error("A recorded inspection outcome must retain its completion timestamp.");
    }
    const { data: saved, error } = await db.from("roof_permit_inspections")
      .update(data.changes).eq("id", data.id).eq("company_id", companyId).eq("updated_at", current.updated_at).select("*").maybeSingle();
    if (error) throw new Error("Could not update this inspection.");
    if (!saved) throw new Error("This inspection changed in another session. Reload it and retry your update.");
    return saved;
  });


const productApprovalInput = z.object({
  permit_application_id: z.string().uuid(),
  approval_kind: z.enum(["miami_dade_noa", "florida_product_approval", "ul_listing", "fire_directory"]),
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
}).superRefine((value, context) => {
  if (value.code_edition !== "unknown" && !value.code_edition_source_url) {
    context.addIssue({ code: "custom", path: ["code_edition_source_url"], message: "Cite the source that identifies the code edition for this approval." });
  }
});

export const createRoofProductApproval = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => productApprovalInput.parse(raw))
  .handler(async ({ data, context }) => {
    const { db, companyId } = await permitContext(context.userId);
    const { data: application } = await db.from("roof_permit_applications")
      .select("id").eq("id", data.permit_application_id).eq("company_id", companyId).maybeSingle();
    if (!application) throw new Error("Select a permit application belonging to your company.");
    const { data: saved, error } = await db.from("roof_product_approvals")
      .insert({ ...data, company_id: companyId, created_by: context.userId, approval_status: "unverified" })
      .select("*").single();
    if (error || !saved) throw new Error("Could not save the product approval reference.");
    return saved;
  });

export const verifyRoofProductApproval = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ id: z.string().uuid() }).parse(raw))
  .handler(async ({ data, context }) => {
    const { db, companyId } = await permitContext(context.userId);
    const { data: current, error: currentError } = await db.from("roof_product_approvals")
      .select("approval_status,expires_on,updated_at").eq("id", data.id).eq("company_id", companyId).maybeSingle();
    if (currentError || !current) throw new Error("Product approval record was not found in your company.");
    if (current.approval_status === "revoked") throw new Error("A revoked approval cannot be marked verified.");
    const today = new Date().toISOString().slice(0, 10);
    if (current.expires_on && current.expires_on < today) {
      throw new Error("This approval is past its recorded expiration date. Confirm its current status with the issuing authority before changing the record.");
    }
    const { data: saved, error } = await db.from("roof_product_approvals")
      .update({ approval_status: "verified", verified_at: new Date().toISOString(), verified_by: context.userId })
      .eq("id", data.id).eq("company_id", companyId).eq("updated_at", current.updated_at)
      .select("*").maybeSingle();
    if (error) throw new Error("Could not verify this product approval record.");
    if (!saved) throw new Error("This approval record changed in another session. Reload and retry.");
    return saved;
  });


const permitNocInput = z.object({
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
}).superRefine((value, context) => {
  if (value.recording_status === "recorded" && value.assessment_status !== "required") {
    context.addIssue({ code: "custom", path: ["assessment_status"], message: "A recorded NOC must have an assessment marked required." });
  }
  if (value.recording_status === "recorded" && (
    !value.recording_county?.trim() || !value.instrument_number?.trim() || !value.recorded_on
  )) {
    context.addIssue({ code: "custom", path: ["recording_status"], message: "A recorded NOC requires county, instrument number, and recording date." });
  }
  if (value.assessment_status !== "not_assessed" && (!value.assessment_basis?.trim() || !value.threshold_source_url)) {
    context.addIssue({ code: "custom", path: ["assessment_basis"], message: "A required / not-required decision must cite the current jurisdiction source and assessment basis." });
  }
  if (value.assessment_status === "required" && (value.contract_value_cents == null || value.threshold_amount_cents == null)) {
    context.addIssue({ code: "custom", path: ["threshold_amount_cents"], message: "A required NOC assessment must record both contract value and the verified threshold." });
  }
});

export const savePermitNocTracking = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => permitNocInput.parse(raw))
  .handler(async ({ data, context }) => {
    const { db, companyId } = await permitContext(context.userId);
    const { data: application } = await db.from("roof_permit_applications")
      .select("id").eq("id", data.permit_application_id).eq("company_id", companyId).maybeSingle();
    if (!application) throw new Error("Select a permit application belonging to your company.");
    const { data: saved, error } = await db.from("roof_permit_noc_tracking")
      .upsert({ ...data, company_id: companyId, created_by: context.userId }, { onConflict: "permit_application_id" })
      .select("*").single();
    if (error || !saved) throw new Error("Could not save the NOC tracking record.");
    return saved;
  });
