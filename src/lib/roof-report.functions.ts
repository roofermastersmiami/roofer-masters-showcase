import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { ROOF_TYPES } from "./instant-estimate-schema";

const inputSchema = z.object({
  filename: z.string().min(1).max(200),
  mime: z.enum(["application/pdf", "image/jpeg", "image/png", "image/webp"]),
  base64: z.string().min(10).max(14_000_000),
});
const num = { type: ["number", "null"] } as const;
const extractedSchema = z.object({
  roof_type: z.enum(ROOF_TYPES).nullable(),
  area_sqft: z.number().nonnegative().nullable(),
  waste_pct: z.number().min(0).max(50).nullable(),
  ridge_lf: z.number().nonnegative().nullable(),
  hips_lf: z.number().nonnegative().nullable(),
  valleys_lf: z.number().nonnegative().nullable(),
  eaves_lf: z.number().nonnegative().nullable(),
  rakes_lf: z.number().nonnegative().nullable(),
  pipes: z.number().int().nonnegative().nullable(),
  pitch: z.string().nullable(),
  notes: z.string().max(600),
});
export type ExtractedReport = z.infer<typeof extractedSchema>;

export const extractRoofReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => inputSchema.parse(d))
  .handler(async ({ data, context }): Promise<{ ok: true; report: ExtractedReport } | { ok: false; error: string }> => {
    const { data: isAdmin } = await context.supabase.rpc('has_any_role',{_user_id:context.userId,_roles:['office','sales','production_manager']});
    if (!isAdmin) throw new Error("You do not have access to this action");
    const { generateResponse, GatewayError } = await import("@lovable.dev/ai-gateway");
    const dataUrl = `data:${data.mime};base64,${data.base64}`;
    const file = data.mime === "application/pdf"
      ? { type: "input_file" as const, filename: data.filename, file_data: dataUrl }
      : { type: "input_image" as const, image_url: dataUrl, detail: "high" as const };
    try {
      const res = await generateResponse({
        model: "openai/gpt-6-astra",
        instructions: "You read roof measurement reports (EagleView, Hover, RoofSnap, GAF QuickMeasure, hand sketches). Extract totals for the whole roof in feet / square feet. area_sqft = total roof area (convert squares x100). pipes = count of pipe/vent penetrations. waste_pct = the report's suggested waste if given. roof_type only if the report states the material, else null. Use null for anything not in the report; never guess. notes: short summary of pitch, facets and anything ambiguous.",
        input: [{ role: "user", content: [{ type: "input_text", text: "Extract the roof measurements from this report." }, file] }],
        text: { format: { type: "json_schema", name: "roof_report", strict: true, schema: {
          type: "object", additionalProperties: false,
          required: ["roof_type","area_sqft","waste_pct","ridge_lf","hips_lf","valleys_lf","eaves_lf","rakes_lf","pipes","pitch","notes"],
          properties: { roof_type: { type: ["string","null"], enum: [...ROOF_TYPES, null] }, area_sqft: num, waste_pct: num, ridge_lf: num, hips_lf: num, valleys_lf: num, eaves_lf: num, rakes_lf: num, pipes: { type: ["integer","null"] }, pitch: { type: ["string","null"] }, notes: { type: "string" } },
        } } },
      });
      const text = (res.output ?? []).flatMap((o) => (o.type === "message" ? o.content : [])).map((c) => (c.type === "output_text" ? c.text : "")).join("");
      const parsed = extractedSchema.safeParse(JSON.parse(text || "{}"));
      if (!parsed.success) return { ok: false, error: "Could not read measurements from this report." };
      return { ok: true, report: parsed.data };
    } catch (e) {
      if (e instanceof GatewayError) {
        console.error("roof report AI error", e.code, e.ids);
        if (e.code === "payment_required") return { ok: false, error: "AI credits are used up. Add credits and try again." };
        if (e.code === "rate_limited") return { ok: false, error: "The AI is busy right now. Please try again in a minute." };
        return { ok: false, error: "The AI could not read this report. Try a clearer PDF or photo." };
      }
      if (e instanceof SyntaxError) return { ok: false, error: "Could not read measurements from this report." };
      throw e;
    }
  });
