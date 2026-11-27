// tenant-audit: reviewed — report mutations use the authenticated Supabase client and company membership; the only service-role operation is post-authorization cleanup of the exact report PDF path after the tenant-scoped row delete.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  ownRoofReportSchema,
  updateRoofOrderSchema,
  assertReportStatus,
  reviewedReport,
  roofOrderTransferRoles,
} from "./roof-order-schema";
import { materialOrder } from "./material-order";

export const createRoofOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ownRoofReportSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: id, error } = await context.supabase.rpc("create_roof_report_request", {
      p_address: data.address,
      p_title: data.title,
      p_provider: data.provider,
      p_notes: data.notes,
      p_customer_phone: data.customer_phone,
      p_customer_email: data.customer_email,
    });
    if (error) {
      // Preserve actionable Postgres/PostgREST diagnostics for the CRM toast.
      // Supabase error messages do not include the submitted customer address.
      if (error.message.includes("Access denied")) {
        throw new Error(
          "Your account does not have permission to create roof report requests. Ask the CRM owner to check your team role.",
        );
      }
      if (error.message.includes("Invalid report request")) {
        throw new Error(
          "The report details were rejected. Check the address, report title, provider, and notes.",
        );
      }
      throw new Error(
        `Could not save the customer report request: ${error.message} (${error.code ?? "database error"})`,
      );
    }
    if (!id)
      throw new Error(
        "Could not save the customer report request: the database did not return a report ID.",
      );
    return { id };
  });

export const updateRoofOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => updateRoofOrderSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: membership, error: membershipError } = await context.supabase
      .from("crm_company_memberships")
      .select("company_id,role")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (membershipError || !membership) throw new Error("A single company membership is required");
    if (!["owner", "admin", "office", "sales", "production_manager"].includes(membership.role))
      throw new Error("You do not have access to this action");

    const { data: current, error: currentError } = await context.supabase
      .from("roof_report_orders")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (currentError) throw new Error("Could not load report request");
    if (!current) throw new Error("Report request not found");
    assertReportStatus({ ...current, ...data });

    const { data: saved, error } = await context.supabase
      .from("roof_report_orders")
      .update({
        status: data.status,
        provider_reference: data.provider_reference,
        notes: data.notes,
        measurements: data.measurements,
        reviewed_at: data.status === "reviewed" ? new Date().toISOString() : null,
      })
      .eq("id", data.id)
      .eq("updated_at", data.updated_at)
      .select("id")
      .maybeSingle();
    if (error || !saved) throw new Error("This report changed. Reload it before saving again");
    return saved;
  });

export const attachRoofOrderPdf = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({ id: z.string().uuid(), path: z.string().max(300), updated_at: z.string() })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: membership, error: membershipError } = await context.supabase
      .from("crm_company_memberships")
      .select("company_id,role")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (membershipError || !membership) throw new Error("A single company membership is required");
    if (!["owner", "admin", "office", "sales", "production_manager"].includes(membership.role))
      throw new Error("You do not have access to this action");
    if (
      !data.path.startsWith(`roof-report/${data.id}/`) ||
      !/^roof-report\/[a-f0-9-]+\/[a-f0-9-]+\.pdf$/.test(data.path)
    )
      throw new Error("Invalid report file");

    const name = data.path.split("/").at(-1);
    const { data: files, error: fileError } = await context.supabase.storage
      .from("roofing-proposals")
      .list(`roof-report/${data.id}`, { search: name ?? "" });
    if (fileError || !files?.some((f) => f.name === name))
      throw new Error("Upload the report PDF first");

    const { data: saved, error } = await context.supabase
      .from("roof_report_orders")
      .update({ file_path: data.path, status: "received", reviewed_at: null })
      .eq("id", data.id)
      .eq("updated_at", data.updated_at)
      .neq("status", "cancelled")
      .select("id")
      .maybeSingle();
    if (error || !saved) throw new Error("Reload the report request before attaching this PDF");
    return saved;
  });

export const transferRoofOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        target: z.enum(["estimate", "materials"]),
        job_id: z.string().uuid().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    // Material handoff updates roof_jobs, whose RLS policy is production-manager-only.
    // Estimate handoff is a sales workflow and remains available to office and sales.
    const allowedRoles = roofOrderTransferRoles(data.target);
    const { data: membership, error: membershipError } = await context.supabase
      .from("crm_company_memberships")
      .select("company_id,role")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (membershipError || !membership) throw new Error("A single company membership is required");
    if (
      !allowedRoles.includes(membership.role as (typeof allowedRoles)[number]) &&
      membership.role !== "owner" &&
      membership.role !== "admin"
    )
      throw new Error("You do not have access to transfer this report to that destination");

    const { data: order, error: orderError } = await context.supabase
      .from("roof_report_orders")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (orderError) throw new Error("Could not load report request");
    if (!order) throw new Error("Report request not found");
    if (order.company_id !== membership.company_id)
      throw new Error("Report request belongs to another company");
    const report = reviewedReport(order);

    const { data: customer, error: customerError } = await context.supabase
      .from("crm_customers")
      .select("source_lead_id")
      .eq("id", order.customer_id)
      .maybeSingle();
    if (customerError) throw new Error("Could not verify report customer");
    if (!customer?.source_lead_id) throw new Error("Link the report to a customer first");

    if (data.target === "materials") {
      if (!data.job_id) throw new Error("Choose a customer project");
      const { data: job, error: jobError } = await context.supabase
        .from("roof_jobs")
        .select("id,lead_id,property_id")
        .eq("id", data.job_id)
        .maybeSingle();
      if (jobError) throw new Error("Could not verify customer project");
      if (
        !job ||
        job.lead_id !== customer.source_lead_id ||
        (job.property_id && job.property_id !== order.property_id)
      )
        throw new Error("Report and project must have the same customer and property");

      const { data: updatedJob, error } = await context.supabase
        .from("roof_jobs")
        .update({
          property_id: order.property_id,
          material_order: {
            report,
            lines: materialOrder(report),
            report_order_id: order.id,
            updated_at: new Date().toISOString(),
          },
        })
        .eq("id", job.id)
        .select("id")
        .maybeSingle();
      if (error || !updatedJob) throw new Error("Could not transfer the material measurements");
      return { id: job.id };
    }

    const { data: existing, error: existingError } = await context.supabase
      .from("roof_estimates")
      .select("id")
      .eq("report_order_id", order.id)
      .limit(1)
      .maybeSingle();
    if (existingError) throw new Error("Could not check for an existing estimate");
    if (existing) return existing;

    const { data: estimate, error } = await context.supabase
      .from("roof_estimates")
      .insert({
        title: `${order.title} — estimate`,
        category: report.roof_type,
        lead_id: customer.source_lead_id,
        property_id: order.property_id,
        report_order_id: order.id,
        company_id: membership.company_id,
        inputs: {
          sqft: report.area_sqft,
          waste: report.waste_pct,
          material: 0,
          labor: 0,
          permits: 0,
          other: 0,
          margin: 0,
        },
        total_cents: 0,
      })
      .select("id")
      .single();
    if (error || !estimate) throw new Error("Could not create the measurement-linked estimate");
    return estimate;
  });

/** Permanently remove one company-owned roof report while preserving the property and drawing history. */
export const deleteRoofOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: membership, error: membershipError } = await context.supabase
      .from("crm_company_memberships")
      .select("company_id,role")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (membershipError || !membership) throw new Error("A single company membership is required");
    if (!["owner", "admin", "office", "sales", "production_manager"].includes(membership.role))
      throw new Error("You do not have access to delete roof reports");

    const { data: current, error: readError } = await context.supabase
      .from("roof_report_orders")
      .select("id,file_path")
      .eq("id", data.id)
      .maybeSingle();
    if (readError) throw new Error("Could not load roof report");
    if (!current) throw new Error("Roof report was already deleted or does not exist");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (
      current.file_path &&
      (!current.file_path.startsWith(`roof-report/${data.id}/`) ||
        !/^roof-report\/[a-f0-9-]+\/[a-f0-9-]+\.pdf$/.test(current.file_path))
    ) {
      throw new Error(
        "The report contains an unexpected file path. Contact an administrator before deleting it.",
      );
    }

    // Delete the database record first. Removing the private PDF first could destroy
    // the only report copy if the subsequent database delete failed.
    const { data: deleted, error } = await context.supabase
      .from("roof_report_orders")
      .delete()
      .eq("id", data.id)
      .select("id")
      .maybeSingle();
    if (error || !deleted)
      throw new Error("Could not delete the roof report. The report PDF was left untouched.");

    let fileCleanupPending = false;
    if (current.file_path) {
      const { error: storageError } = await supabaseAdmin.storage
        .from("roofing-proposals")
        .remove([current.file_path]);
      fileCleanupPending = !!storageError;
    }
    return { id: deleted.id, fileCleanupPending };
  });
