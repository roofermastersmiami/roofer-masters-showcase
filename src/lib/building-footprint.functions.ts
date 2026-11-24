import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { parseBuildingFootprints } from "./building-footprint";

const addressSchema = z.object({ address: z.string().trim().min(8).max(250) });
/** Free OpenStreetMap building-footprint lookup. These are ground footprints, not roof plans. */
export const findBuildingFootprints = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => addressSchema.parse(raw))
  .handler(async ({ data, context }) => {
    const { data: allowed, error } = await context.supabase.rpc("has_any_role", {
      _user_id: context.userId,
      _roles: ["office", "sales", "production_manager"],
    });
    if (error || !allowed) return { error: "Your session or team role cannot search building footprints." } as const;

    const geocoderUrl = new URL("https://geocoding.geo.census.gov/geocoder/locations/onelineaddress");
    geocoderUrl.search = new URLSearchParams({
      address: data.address,
      benchmark: "Public_AR_Current",
      format: "json",
    }).toString();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const geoResponse = await fetch(geocoderUrl, { signal: controller.signal, headers: { Accept: "application/json" } });
      if (!geoResponse.ok) return { error: "The free address lookup is temporarily unavailable." } as const;
      const geo = await geoResponse.json() as {
        result?: { addressMatches?: Array<{ coordinates?: { x?: number; y?: number } }> };
      };
      const coordinates = geo.result?.addressMatches?.[0]?.coordinates;
      if (typeof coordinates?.x !== "number" || typeof coordinates.y !== "number" ||
          !Number.isFinite(coordinates.x) || !Number.isFinite(coordinates.y)) {
        return { error: "The address could not be located. Check the street, city and ZIP code." } as const;
      }
      const query = `[out:json][timeout:15];way(around:100,${coordinates.y},${coordinates.x})["building"];out tags geom;`;
      const overpass = await fetch("https://overpass-api.de/api/interpreter", {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8", Accept: "application/json" },
        body: new URLSearchParams({ data: query }),
      });
      if (!overpass.ok) return { error: "OpenStreetMap building data is temporarily unavailable. Try again later." } as const;
      const payload: unknown = await overpass.json();
      const footprints = parseBuildingFootprints(payload, { lat: coordinates.y, lon: coordinates.x });
      return { matchedAddress: data.address, footprints, attribution: "© OpenStreetMap contributors" } as const;
    } catch {
      return { error: "The free building-footprint lookup timed out or could not connect. Try again later." } as const;
    } finally {
      clearTimeout(timeout);
    }
  });
