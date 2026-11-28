import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { validPdfHeader } from "@/lib/proposal-schema";

export type Proposal = Database["public"]["Tables"]["proposals"]["Row"];
export type ProposalShare = Database["public"]["Tables"]["proposal_shares"]["Row"];
export const proposalsQuery = queryOptions({
  queryKey: ["proposals"],
  queryFn: async () => {
    const { data, error } = await supabase
      .from("proposals")
      .select("*")
      .order("updated_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  },
});
export const proposalSharesQuery = (id: string) =>
  queryOptions({
    queryKey: ["proposal-shares", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("proposal_shares")
        .select("*")
        .eq("proposal_id", id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

export async function readProposalPdf(path: string) {
  const { data, error } = await supabase.storage.from("roofing-proposals").download(path);
  if (error || !data) throw new Error("Could not open PDF");
  return new Uint8Array(await data.arrayBuffer());
}

export async function uploadProposalPdf(id: string, bytes: Uint8Array) {
  if (!validPdfHeader(bytes)) throw new Error("Choose a valid PDF file");
  if (bytes.length > 20 * 1024 * 1024) throw new Error("PDF must be under 20 MB");
  const path = `${id}/${crypto.randomUUID()}.pdf`;
  const { error } = await supabase.storage
    .from("roofing-proposals")
    .upload(path, new Blob([Uint8Array.from(bytes)], { type: "application/pdf" }), {
      contentType: "application/pdf",
    });
  if (error) throw error;
  return path;
}

export async function saveProposalPdf(proposal: Proposal, bytes: Uint8Array) {
  if (!proposal.company_id) throw new Error("Proposal is missing company ownership");
  const path = await uploadProposalPdf(proposal.id, bytes);
  const { error } = await supabase
    .from("proposals")
    .update({ file_path: path })
    .eq("id", proposal.id)
    .eq("company_id", proposal.company_id);
  if (error) {
    await supabase.storage.from("roofing-proposals").remove([path]);
    throw error;
  }
  // Existing issued URLs expire shortly; never reuse object paths across PDF revisions.
  if (proposal.file_path)
    await supabase.storage.from("roofing-proposals").remove([proposal.file_path]);
  return path;
}

export function downloadPdf(bytes: Uint8Array, title: string) {
  const url = URL.createObjectURL(new Blob([Uint8Array.from(bytes)], { type: "application/pdf" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${title.replace(/[^a-z0-9-_ ]/gi, "").slice(0, 100) || "proposal"}.pdf`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
