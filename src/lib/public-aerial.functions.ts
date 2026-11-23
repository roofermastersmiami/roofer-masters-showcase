import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

function hasNoControlCharacters(value: string) {
  return !Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });
}

// Free, keyless public sources only: US Census geocoder + USGS National Map imagery (public domain).
export const loadPublicAerial = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) =>
    z
      .object({
        address: z.string().trim().min(8).max(250).refine(hasNoControlCharacters, {
          message: "Address contains unsupported control characters.",
        }),
        spanMeters: z.number().min(30).max(200).default(70),
      })
      .parse(raw),
  )
  .handler(async ({ data, context }) => {
    const { data: allowed, error } = await context.supabase.rpc("has_any_role", {
      _user_id: context.userId,
      _roles: ["office", "sales", "production_manager"],
    });
    if (error || !allowed)
      return {
        error:
          "Your session or team role cannot import aerial imagery. Sign in again or contact the owner. Use Add image to upload and calibrate your own roof photo.",
        stage: "authorization",
      } as const;
    const { fetchPublicAerial } = await import("./public-aerial.server");
    return fetchPublicAerial(data.address, data.spanMeters);
  });
