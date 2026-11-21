import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import type { LeadStatus } from "@/lib/lead-schema";

export type Lead = Omit<Database["public"]["Tables"]["leads"]["Row"], "chat_token">;
export type LeadMessage = Database["public"]["Tables"]["lead_messages"]["Row"];

const LEAD_COLS =
  "id, created_at, updated_at, name, phone, email, address, service, message, source, status, notes, page, last_message_at, qualification, customer_id, pipeline_stage";

export const leadsQuery = queryOptions({
  queryKey: ["leads"],
  queryFn: async (): Promise<Lead[]> => {
    const { data, error } = await supabase
      .from("leads")
      .select(LEAD_COLS)
      .order("created_at", { ascending: false })
      .limit(1000);
    if (error) throw error;
    return data ?? [];
  },
  refetchInterval: 30_000,
});

export const messagesQuery = (leadId: string) =>
  queryOptions({
    queryKey: ["lead-messages", leadId],
    queryFn: async (): Promise<LeadMessage[]> => {
      const { data, error } = await supabase
        .from("lead_messages")
        .select("*")
        .eq("lead_id", leadId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
    refetchInterval: 10_000,
  });

export function useUpdateLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { id: string; status?: LeadStatus; notes?: string }) => {
      const patch: { status?: LeadStatus; notes?: string } = {};
      if (vars.status) patch.status = vars.status;
      if (vars.notes !== undefined) patch.notes = vars.notes;
      const { error } = await supabase.from("leads").update(patch).eq("id", vars.id);
      if (error) throw error;
    },
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: ["leads"] });
      const prev = qc.getQueryData<Lead[]>(["leads"]);
      qc.setQueryData<Lead[]>(["leads"], (old) =>
        old?.map((l) => (l.id === vars.id ? { ...l, ...vars, status: vars.status ?? l.status } : l)),
      );
      return { prev };
    },
    onError: (_e, _v, ctx) => ctx?.prev && qc.setQueryData(["leads"], ctx.prev),
    onSettled: () => qc.invalidateQueries({ queryKey: ["leads"] }),
  });
}

export function useDeleteLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("leads").delete().eq("id", id);
      if (error) throw error;
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["leads"] }),
  });
}

export function formatWhen(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
