import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
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
    const propertyIds = [...new Set((jobs ?? []).map((job) => job.property_id).filter(Boolean))];
    const { data: properties, error: propertiesError } = propertyIds.length
      ? await db.from("crm_properties").select("id,address").in("id", propertyIds)
      : { data: [], error: null };
    if (propertiesError) throw new Error("Could not load roof-job properties.");
    return {
      applications: applications ?? [],
      inspections: inspections ?? [],
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
      .select("application_status,permit_number,submitted_at,issued_at").eq("id", data.id).eq("company_id", companyId).maybeSingle();
    if (currentError || !current) throw new Error("Permit application was not found in your company.");
    const nextStatus = data.changes.application_status;
    const transitions: Record<string, string[]> = {
      draft: ["ready_to_submit", "cancelled"],
      ready_to_submit: ["submitted", "cancelled"],
      submitted: ["issued", "rejected", "cancelled"],
      issued: ["expired"], rejected: [], expired: [], cancelled: [],
    };
    if (nextStatus && nextStatus !== current.application_status &&
      !transitions[current.application_status]?.includes(nextStatus)) {
      throw new Error("Invalid permit application status transition.");
    }
    if (nextStatus === "issued" &&
      (!(data.changes.permit_number ?? current.permit_number)?.trim() || !data.changes.issued_at)) {
      throw new Error("Issuance requires an official permit number and issue date.");
    }
    if (nextStatus === "submitted" && !(data.changes.submitted_at ?? current.submitted_at)) {
      throw new Error("Submission requires the actual submission timestamp.");
    }
    if (nextStatus === "expired" && !(data.changes.issued_at ?? current.issued_at)) {
      throw new Error("Expiration can only be recorded for a permit that has been issued.");
    }
    const { data: saved, error } = await db.from("roof_permit_applications")
      .update(data.changes).eq("id", data.id).eq("company_id", companyId).select("*").maybeSingle();
    if (error || !saved) throw new Error("Could not update this permit application.");
    return saved;
  });

export const createPermitInspection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => inspectionInput.parse(raw))
  .handler(async ({ data, context }) => {
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
      .select("scheduling_status").eq("id", data.id).eq("company_id", companyId).maybeSingle();
    if (currentError || !current) throw new Error("Inspection was not found in your company.");
    const nextStatus = data.changes.scheduling_status;
    const transitions: Record<string, string[]> = {
      requested: ["scheduled", "cancelled"],
      scheduled: ["passed", "failed", "cancelled"],
      passed: [], failed: [], cancelled: [],
    };
    if (nextStatus && nextStatus !== current.scheduling_status &&
      !transitions[current.scheduling_status]?.includes(nextStatus)) {
      throw new Error("Invalid inspection status transition.");
    }
    if (nextStatus === "scheduled" && !data.changes.scheduled_at) {
      throw new Error("Scheduling requires the confirmed appointment date and time.");
    }
    if ((nextStatus === "passed" || nextStatus === "failed") && !data.changes.completed_at) {
      throw new Error("An inspection outcome requires its completion timestamp.");
    }
    const { data: saved, error } = await db.from("roof_permit_inspections")
      .update(data.changes).eq("id", data.id).eq("company_id", companyId).select("*").maybeSingle();
    if (error || !saved) throw new Error("Could not update this inspection.");
    return saved;
  });
