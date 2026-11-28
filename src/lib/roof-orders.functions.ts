// tenant-audit: reviewed — report mutations are authorized through the authenticated Supabase client and company membership; the service-role operations are (a) inside deleteRoofOrder, the delete of the exact report row proven visible by the preceding RLS-scoped read (the live database carries no DELETE RLS policy on roof_report_orders — verified 2026-11-27, only the legacy SELECT policies exist — so an authenticated delete can never match a row) plus the post-authorization cleanups, which touch solely the drawing revisions, drawing_id references, and storage files collected through the tenant-scoped reads of the report being deleted; (b) inside attachRoofOrderPdf, the version-guarded update of the exact report row proven visible by the preceding RLS-scoped proof read in roof-order-write.server.ts (the live database likewise carries no UPDATE policy on roof_report_orders, so an authenticated attach update silently matched zero rows and every automatic finish failed as a false stale-version error); and (c) inside updateRoofOrder, the version-guarded update of the exact report row its preceding RLS-scoped read just loaded, for the same missing-UPDATE-policy reason.
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

    // Service-role write on purpose: authorization is already proven
    // by the membership/role gate and the RLS-scoped read of this
    // exact report above — the live database has no UPDATE RLS
    // policy on roof_report_orders (only the legacy SELECT
    // policies), so an authenticated update silently matches zero
    // rows and every save failed as a false "report changed" error.
    // The update re-checks the caller's version in its WHERE clause.
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
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { attachRoofOrderPdfGuarded } = await import("./roof-order-write.server");
    const auth = context.supabase;
    return attachRoofOrderPdfGuarded(
      {
        getMembership: async (userId) => {
          const { data: membership, error } = await auth
            .from("crm_company_memberships")
            .select("company_id,role")
            .eq("user_id", userId)
            .maybeSingle();
          if (error) throw new Error("A single company membership is required");
          return membership;
        },
        reportPdfExists: async (reportId, fileName) => {
          const { data: files, error } = await auth.storage
            .from("roofing-proposals")
            .list(`roof-report/${reportId}`, { search: fileName });
          return !error && !!files?.some((f) => f.name === fileName);
        },
        getReport: async (reportId) => {
          const { data: report, error } = await auth
            .from("roof_report_orders")
            .select("updated_at,status,file_path")
            .eq("id", reportId)
            .maybeSingle();
          if (error) throw new Error("Could not load report request");
          return report;
        },
        writeAttachedPdf: async ({ id, path, expectedUpdatedAt }) => {
          // Service-role on purpose: authorization is already proven
          // by the membership/role gate and the RLS-scoped proof read
          // above — another company's report is invisible there and
          // never reaches this point. The live database has no UPDATE
          // RLS policy on roof_report_orders, so an authenticated
          // update silently matches zero rows (see
          // roof-order-write.server.ts). The update targets the exact
          // proven report id and re-checks the proven version.
          const { data: saved, error } = await supabaseAdmin
            .from("roof_report_orders")
            .update({ file_path: path, status: "received", reviewed_at: null })
            .eq("id", id)
            .eq("updated_at", expectedUpdatedAt)
            .neq("status", "cancelled")
            .select("id")
            .maybeSingle();
          if (error) throw new Error("Could not attach the report PDF");
          return !!saved;
        },
      },
      { userId: context.userId, id: data.id, path: data.path, updated_at: data.updated_at },
    );
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

/**
 * Permanently remove one company-owned roof report together with its
 * drawing revisions and stored files. The customer and property records
 * are preserved. All authorization and record reads run through the
 * authenticated client (RLS); the service-role client deletes the exact
 * report row those reads proved visible (no DELETE RLS policy exists on
 * roof_report_orders in the live database, so the row delete cannot run
 * under RLS) and cleans up the exact records and files collected from
 * those tenant-scoped reads.
 */
export const deleteRoofOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { deleteRoofReportCascade } = await import("./roof-report-delete.server");
    const auth = context.supabase;
    return deleteRoofReportCascade(
      {
        getMembership: async (userId) => {
          const { data: membership, error } = await auth
            .from("crm_company_memberships")
            .select("company_id,role")
            .eq("user_id", userId)
            .maybeSingle();
          if (error) throw new Error("A single company membership is required");
          return membership;
        },
        getReport: async (reportId) => {
          const { data: current, error } = await auth
            .from("roof_report_orders")
            .select("id,file_path")
            .eq("id", reportId)
            .maybeSingle();
          if (error) throw new Error("Could not load roof report");
          return current;
        },
        listReportDrawings: async (reportId) => {
          const { data: rows, error } = await auth
            .from("roof_drawings")
            .select("id,parent_id,media")
            .eq("report_order_id", reportId);
          if (error) throw new Error("Could not load the report's saved drawings");
          return rows ?? [];
        },
        deleteReportRow: async (reportId) => {
          // Service-role on purpose: authorization is already proven by the
          // membership/role gate and the RLS-scoped getReport read above —
          // another company's report is invisible there and never reaches
          // this point. The live database has no DELETE RLS policy on
          // roof_report_orders, so an authenticated delete silently matches
          // zero rows; the service-role delete targets the exact proven id.
          const { data: deleted, error } = await supabaseAdmin
            .from("roof_report_orders")
            .delete()
            .eq("id", reportId)
            .select("id")
            .maybeSingle();
          if (error)
            throw new Error("Could not delete the roof report. The report PDF was left untouched.");
          return !!deleted;
        },
        listReportPdfPaths: async (reportId) => {
          const { data: files, error } = await supabaseAdmin.storage
            .from("roofing-proposals")
            .list(`roof-report/${reportId}`);
          if (error || !files) return null;
          return files
            .filter((file) => !!file.name)
            .map((file) => `roof-report/${reportId}/${file.name}`);
        },
        removeStorageFiles: async (bucket, paths) => {
          if (!paths.length) return true;
          const { error } = await supabaseAdmin.storage.from(bucket).remove(paths);
          return !error;
        },
        clearDrawingReferences: async (drawingIds) => {
          let ok = true;
          for (const table of ["roof_estimates", "roof_jobs", "proposals"] as const) {
            const { error } = await supabaseAdmin
              .from(table)
              .update({ drawing_id: null })
              .in("drawing_id", drawingIds);
            if (error) ok = false;
          }
          return ok;
        },
        deleteDrawingRows: async (drawingIds) => {
          const { error } = await supabaseAdmin.from("roof_drawings").delete().in("id", drawingIds);
          return !error;
        },
        mediaStillReferenced: async (path) => {
          const { data: rows, error } = await supabaseAdmin
            .from("roof_drawings")
            .select("id")
            .contains("media", [{ path }])
            .limit(1);
          // Fail closed: when the check itself fails, keep the file.
          if (error) return true;
          return (rows?.length ?? 0) > 0;
        },
      },
      { userId: context.userId, reportId: data.id },
    );
  });
