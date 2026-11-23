import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { queryOptions } from "@tanstack/react-query";
import type { Database } from "@/integrations/supabase/types";
import { optionalContent } from "@/lib/optional-content";

export const CONTENT_DEFAULTS = {
  hero_headline: "Storm-Ready Roofs Built for Miami-Dade & Broward",
  hero_subheadline:
    "Metal, tile, shingle and flat roofing installed by a local Homestead crew that treats every roof like a masterpiece.",
  announcement: "Free roof inspections across Miami-Dade & Broward · Hablamos español",
};
export type SiteContent = typeof CONTENT_DEFAULTS;
export const CONTENT_KEYS = Object.keys(CONTENT_DEFAULTS) as (keyof SiteContent)[];

export const getSiteContent = createServerFn({ method: "GET" }).handler(
  async (): Promise<SiteContent> => {
    try {
      const url = process.env["SUPABASE_URL"];
      const key = process.env["SUPABASE_PUBLISHABLE_KEY"];
      if (!url || !key) return CONTENT_DEFAULTS;
      const client = createClient<Database>(url, key, {
        auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
        global: {
          fetch: (input, init) => {
            const h = new Headers(init?.headers);
            if (key.startsWith("sb_") && h.get("Authorization") === `Bearer ${key}`)
              h.delete("Authorization");
            h.set("apikey", key);
            return fetch(input, { ...init, headers: h });
          },
        },
      });
      const { data } = await client.from("site_content").select("key, value");
      const out: SiteContent = { ...CONTENT_DEFAULTS };
      for (const row of data ?? []) {
        if (!(row.key in out)) continue;
        // The announcement may be blanked to hide the bar; headlines fall back to defaults.
        if (row.key === "announcement" || row.value.trim())
          out[row.key as keyof SiteContent] = row.value;
      }
      return out;
    } catch (e) {
      console.error("getSiteContent failed", e);
      return CONTENT_DEFAULTS;
    }
  },
);

export const siteContentQuery = queryOptions({
  queryKey: ["site-content"],
  // The RPC transport can fail before the server's fallback handler runs.
  // Optional public copy must never prevent sign-in or the CRM from rendering.
  queryFn: () => optionalContent(() => getSiteContent(), { ...CONTENT_DEFAULTS }),
  staleTime: 60_000,
});
