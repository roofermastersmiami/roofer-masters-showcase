import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
export type RoofOrder = Database["public"]["Tables"]["roof_report_orders"]["Row"];
export const roofOrdersQuery = queryOptions({
  queryKey: ["roof-report-orders"],
  queryFn: async () => {
    const { data, error } = await supabase
      .from("roof_report_orders")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  },
});
