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
      p_customer_id: data.customer_id,
      p_address: data.address,
      p_title: data.title,
      p_provider: data.provider,
      p_notes: data.notes,
    });
    if (error || !id) throw new Error("Could not save the customer report request");
    return { id };
  });

export const updateRoofOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => updateRoofOrderSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: owner, error: roleError } = await context.supabase.rpc("has_any_role", {
      _user_id: context.userId,
      _roles: ["office", "sales", "production_manager"],
    });
    if (roleError) throw new Error("Could not verify report permissions");
    if (!owner) throw new Error("You do not have access to this action");

    const { data: current, error: currentError } = await context.supabase
      .from("roof_report_orders")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (currentError) throw new Error("Could not load report request");
    if (!current) throw new Error("Report request not found");
    assertReportStatus({ ...current, ...data });

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: saved, error } = await supabaseAdmin
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
    const { data: owner, error: roleError } = await context.supabase.rpc("has_any_role", {
      _user_id: context.userId,
      _roles: ["office", "sales", "production_manager"],
    });
    if (roleError) throw new Error("Could not verify report permissions");
    if (!owner) throw new Error("You do not have access to this action");
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

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: saved, error } = await supabaseAdmin
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
    const { data: owner, error: roleError } = await context.supabase.rpc("has_any_role", {
      _user_id: context.userId,
      _roles: [...allowedRoles],
    });
    if (roleError) throw new Error("Could not verify report permissions");
    if (!owner) throw new Error("You do not have access to transfer this report to that destination");

    const { data: order, error: orderError } = await context.supabase
      .from("roof_report_orders")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (orderError) throw new Error("Could not load report request");
    if (!order) throw new Error("Report request not found");
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
