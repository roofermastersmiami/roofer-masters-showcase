import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

// tenant-audit: reviewed — authenticated staff-only proxy for the free
// public aerial imagery sources (county GIS ImageServer/tile services
// and USDA NAIP; see report-aerial.server.ts for the source chain).
// It reads no tenant data and writes nothing; it returns public
// imagery bytes for a report cover so the browser never has to fetch
// cross-origin tiles itself.
export const loadReportAerial = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) =>
    z
      .object({
        latitude: z.number().finite().min(-85).max(85),
        longitude: z.number().finite().min(-180).max(180),
        // Optional cover framing (roof-centred window sized to the
        // roof, aerial-photo.ts roofCoverFraming); absent = the
        // server's ±42 m default.
        halfExtentMeters: z.number().finite().min(15).max(60).optional(),
      })
      .parse(raw),
  )
  .handler(async ({ data, context }) => {
    const { data: allowed, error } = await context.supabase.rpc("has_any_role", {
      _user_id: context.userId,
      _roles: ["admin", "office", "sales", "production_manager"],
    });
    if (error || !allowed)
      return {
        error:
          "Your session or team role cannot fetch aerial imagery for reports. The report will use its sketch cover instead.",
        stage: "authorization",
      } as const;
    const { fetchReportAerialImage } = await import("./report-aerial.server");
    return fetchReportAerialImage(data.latitude, data.longitude, fetch, data.halfExtentMeters);
  });
