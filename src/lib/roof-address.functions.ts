import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { parseRoofAddressMatch } from "./roof-address";

export const lookupRoofAddress = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) =>
    z.object({ address: z.string().trim().min(8).max(250) }).parse(raw),
  )
  .handler(async ({ data, context }) => {
    const { data: allowed, error: roleError } = await context.supabase.rpc("has_any_role", {
      _user_id: context.userId,
      _roles: ["office", "sales", "production_manager"],
    });
    if (roleError || !allowed)
      return { error: "Your session or team role cannot look up property addresses." } as const;

    const url = new URL("https://geocoding.geo.census.gov/geocoder/locations/onelineaddress");
    url.search = new URLSearchParams({
      address: data.address,
      benchmark: "Public_AR_Current",
      format: "json",
    }).toString();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });
      if (!response.ok)
        return {
          error: "The free address lookup is temporarily unavailable. Please retry.",
        } as const;
      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.toLowerCase().includes("json"))
        return {
          error: "The address service returned an invalid response. Please retry shortly.",
        } as const;
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        return { error: "The address service returned unreadable data. Please retry." } as const;
      }
      const match = parseRoofAddressMatch(payload, data.address);
      if (!match)
        return {
          error: "We could not pinpoint that address. Check the street, city, state and ZIP code.",
        } as const;
      return match;
    } catch {
      return {
        error: controller.signal.aborted
          ? "Address lookup timed out. Check the address and retry."
          : "Address lookup could not connect. Check your connection and retry.",
      } as const;
    } finally {
      clearTimeout(timeout);
    }
  });
