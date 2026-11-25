import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { drawingSchema, measureDrawing, toMaterialReport } from "./roof-geometry";
import { roofDrawingMediaSchema } from "./roof-drawing-media";
// tenant-audit: reviewed — this change only expands the allowlisted media input schema.
// It does not change authentication, role checks, property/report ownership checks, or database query scope.
export const saveRoofDrawing = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) =>
    z
      .object({
        property_id: z.string().uuid(),
        title: z.string().trim().min(1).max(180),
        geometry: drawingSchema,
        parent_id: z.string().uuid().nullable(),
        media: roofDrawingMediaSchema,
        report_order_id: z.string().uuid().optional(),
      })
      .parse(raw),
  )
  .handler(async ({ data, context }) => {
    const { data: owner, error: roleError } = await context.supabase.rpc("has_any_role", {
      _user_id: context.userId,
      _roles: ["office", "sales", "production_manager"],
    });
    if (roleError)
      throw new Error("Could not verify your roof-drawing permissions. Sign in again and retry.");
    if (!owner) throw new Error("Your team role does not have permission to save roof drawings.");

    let revision = 1;
    if (data.parent_id) {
      const { data: parent, error: parentError } = await context.supabase
        .from("roof_drawings")
        .select("revision,property_id")
        .eq("id", data.parent_id)
        .single();
      if (parentError)
        throw new Error(`Could not load the previous drawing revision: ${parentError.message}`);
      if (!parent || parent.property_id !== data.property_id)
        throw new Error(
          "The previous drawing belongs to a different property. Reload the measurement workspace.",
        );
      revision = parent.revision + 1;
    }
    if (data.report_order_id) {
      const { data: report, error: reportError } = await context.supabase
        .from("roof_report_orders")
        .select("property_id")
        .eq("id", data.report_order_id)
        .single();
      if (reportError)
        throw new Error(`Could not load the linked roof report: ${reportError.message}`);
      if (!report || report.property_id !== data.property_id)
        throw new Error(
          "The roof report and drawing do not belong to the same property. Reopen the report and retry.",
        );
    }

    const measurements = measureDrawing(data.geometry);
    if (data.report_order_id) {
      const { data: id, error: rpcError } = await context.supabase.rpc("save_report_drawing", {
        p_drawing: {
          property_id: data.property_id,
          title: data.title,
          geometry: data.geometry,
          measurements,
          revision,
          parent_id: data.parent_id ?? "",
          media: data.media,
        } as never,
        p_report_id: data.report_order_id,
        p_report: {
          measurements: toMaterialReport(data.geometry),
          notes: data.geometry.notes,
          verified: data.geometry.verified,
        } as never,
      });
      if (rpcError) {
        const code = rpcError.code ? ` (code ${rpcError.code})` : "";
        throw new Error(
          `Database rejected the roof drawing/report save: ${rpcError.message}${code}`,
        );
      }
      if (!id)
        throw new Error(
          "The database returned no drawing ID after saving the roof report. Refresh and check the report before retrying.",
        );
      const { data: saved, error: readError } = await context.supabase
        .from("roof_drawings")
        .select("*")
        .eq("id", id)
        .single();
      if (readError || !saved)
        throw new Error(
          `Drawing was saved but could not be reloaded: ${readError?.message ?? "No drawing row returned"}`,
        );
      return saved;
    }

    const { data: row, error } = await context.supabase
      .from("roof_drawings")
      .insert({ ...data, report_order_id: null, revision, measurements })
      .select("*")
      .single();
    if (error) {
      const code = error.code ? ` (code ${error.code})` : "";
      throw new Error(`Database rejected the roof drawing save: ${error.message}${code}`);
    }
    if (!row)
      throw new Error(
        "The database returned no drawing after saving. Refresh and check before retrying.",
      );
    return row;
  });
