import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { shareIsActive } from "./proposal-schema";

export const createProposalShare = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ proposalId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: owner, error: roleError } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" });
    if (roleError || !owner) throw new Error("Owner access required");
    const { data: proposal } = await context.supabase.from("proposals").select("id, file_path, is_template").eq("id", data.proposalId).single();
    if (!proposal?.file_path || proposal.is_template) throw new Error("Save a proposal PDF before sharing");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: share, error } = await supabaseAdmin.from("proposal_shares").insert({ proposal_id: proposal.id }).select("id, token, expires_at, revoked_at").single();
    if (error || !share) throw new Error("Could not create sharing link");
    return share;
  });

export const revokeProposalShare = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: owner, error } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" });
    if (error || !owner) throw new Error("Owner access required");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error: updateError } = await supabaseAdmin.from("proposal_shares").update({ revoked_at: new Date().toISOString() }).eq("id", data.id);
    if (updateError) throw new Error("Could not revoke link");
    return { ok: true };
  });

// Public capability endpoint: a high-entropy, unexpired, nonrevoked token is the authorization.
// Returns only the document title and a short-lived PDF URL, never the lead or library.
export const getSharedProposal = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) => z.object({ token: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: share } = await supabaseAdmin.from("proposal_shares").select("proposal_id, expires_at, revoked_at").eq("token", data.token).maybeSingle();
    if (!share || !shareIsActive(share)) return null;
    const { data: proposal } = await supabaseAdmin.from("proposals").select("title, file_path, is_template").eq("id", share.proposal_id).maybeSingle();
    if (!proposal?.file_path || proposal.is_template) return null;
    const { data: signed } = await supabaseAdmin.storage.from("roofing-proposals").createSignedUrl(proposal.file_path, 60);
    if (!signed) return null;
    return { title: proposal.title, url: signed.signedUrl };
  });