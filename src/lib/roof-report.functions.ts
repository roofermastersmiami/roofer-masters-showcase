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

/**
 * Deliberately disabled: automatic extraction previously used a metered AI gateway.
 * Keep the typed server-function contract so the UI can explain the no-credit workflow
 * without ever transmitting customer reports to a paid AI service.
 */
export const extractRoofReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => inputSchema.parse(raw))
  .handler(async () => ({
    ok: false as const,
    error:
      "Automatic AI reading is turned off to avoid paid credits. Open the report and enter its measurements below; the material quantities will calculate automatically.",
  }));
