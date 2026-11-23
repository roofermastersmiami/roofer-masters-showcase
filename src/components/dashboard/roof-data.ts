import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
export const drawingsQuery = queryOptions({
  queryKey: ["roof-drawings"],
  queryFn: async () => {
    const { data, error } = await supabase
      .from("roof_drawings")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  },
});
