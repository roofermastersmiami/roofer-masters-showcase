import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { PipelineStage } from "@/lib/crm-foundation";
export const customersQuery = queryOptions({
  queryKey: ["crm-customers"],
  queryFn: async () => {
    const { data, error } = await supabase.from("crm_customers").select("*").order("name");
    if (error) throw error;
    return data ?? [];
  },
});
export const propertiesQuery = queryOptions({
  queryKey: ["crm-properties"],
  queryFn: async () => {
    const { data, error } = await supabase
      .from("crm_properties")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  },
});
export const activityQuery = queryOptions({
  queryKey: ["crm-activity"],
  queryFn: async () => {
    const { data, error } = await supabase
      .from("crm_activity")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw error;
    return data ?? [];
  },
  refetchInterval: 30000,
});
export function useMoveStage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, stage }: { id: string; stage: PipelineStage }) => {
      const { data: auth } = await supabase.auth.getUser();
      const { data: lead, error: leadError } = await supabase
        .from("leads")
        .select("company_id")
        .eq("id", id)
        .maybeSingle();
      if (!auth.user || leadError || !lead?.company_id)
        throw new Error("Could not verify lead company");
      const { data: membership, error: membershipError } = await supabase
        .from("crm_company_memberships")
        .select("role")
        .eq("user_id", auth.user.id)
        .eq("company_id", lead.company_id)
        .in("role", ["owner", "admin", "office", "sales"])
        .maybeSingle();
      if (membershipError || !membership) throw new Error("You cannot update this lead");
      const { error } = await supabase
        .from("leads")
        .update({ pipeline_stage: stage })
        .eq("id", id)
        .eq("company_id", lead.company_id);
      if (error) throw error;
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["leads"] }),
        qc.invalidateQueries({ queryKey: ["crm-activity"] }),
      ]);
    },
    onError: () => toast.error("Could not move this lead"),
  });
}
