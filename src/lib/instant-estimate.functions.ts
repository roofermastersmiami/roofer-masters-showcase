import { createServerFn } from "@tanstack/react-start";
import { queryOptions } from "@tanstack/react-query";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
export const getInstantRates = createServerFn({ method: "GET" }).handler(async () => {
  const url = process.env["SUPABASE_URL"];
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"];
  if (!url || !key)
    throw new Error("Estimates are temporarily unavailable. Please call 305-942-3093.");
  const db = createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) => {
        const headers = new Headers(init?.headers);
        if (key.startsWith("sb_")) headers.delete("Authorization");
        headers.set("apikey", key);
        return fetch(input, { ...init, headers });
      },
    },
  });
  const { data, error } = await db
    .from("instant_roof_rates")
    .select("category,low_cents,high_cents,enabled")
    .eq("enabled", true);
  if (error) throw new Error("Estimates are temporarily unavailable. Please call 305-942-3093.");
  return data ?? [];
});
export const instantRatesQuery = queryOptions({
  queryKey: ["instant-rates"],
  queryFn: () => getInstantRates(),
  staleTime: 60000,
});
