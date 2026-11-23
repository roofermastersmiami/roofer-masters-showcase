import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { shareIsActive, signatureSchema } from "./proposal-schema";

export const createProposalShare = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ proposalId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: owner, error: roleError } = await context.supabase.rpc('has_any_role',{_user_id:context.userId,_roles:['office','sales']});
    if (roleError || !owner) throw new Error("You do not have access to this action");
    const { data: proposal, error: proposalError } = await context.supabase.from("proposals").select("id, file_path, is_template").eq("id", data.proposalId).maybeSingle();
    if (proposalError) throw new Error("Could not verify proposal");
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
    const { data: owner, error } = await context.supabase.rpc('has_any_role',{_user_id:context.userId,_roles:['office','sales']});
    if (error || !owner) throw new Error("You do not have access to this action");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: revoked, error: updateError } = await supabaseAdmin.from("proposal_shares").update({ revoked_at: new Date().toISOString() }).eq("id", data.id).is("revoked_at", null).select("id").maybeSingle();
    if (updateError || !revoked) throw new Error("Could not revoke link");
    return { ok: true };
  });

// Public capability endpoint: a high-entropy, unexpired, nonrevoked token is the authorization.
// Returns only the document title and a short-lived PDF URL, never the lead or library.
export const getSharedProposal = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) => z.object({ token: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: share, error: shareError } = await supabaseAdmin.from("proposal_shares").select("proposal_id, expires_at, revoked_at, signed_name, signed_at").eq("token", data.token).maybeSingle();
    if (shareError) throw new Error("Could not verify proposal link");
    if (!share || !shareIsActive(share)) return null;
    const { data: proposal, error: proposalError } = await supabaseAdmin.from("proposals").select("title, file_path, is_template").eq("id", share.proposal_id).maybeSingle();
    if (proposalError) throw new Error("Could not load shared proposal");
    if (!proposal?.file_path || proposal.is_template) return null;
    const { data: signed, error: signedError } = await supabaseAdmin.storage.from("roofing-proposals").createSignedUrl(proposal.file_path, 60);
    if (signedError || !signed?.signedUrl) throw new Error("Could not prepare proposal document");
    return { title: proposal.title, url: signed.signedUrl, signedName: share.signed_name, signedAt: share.signed_at };
  });

// Public capability endpoint: the same unexpired, nonrevoked token authorizes one customer sign-off.
// Records only the signer's name, drawn signature and timestamp on that share; a signed link cannot be re-signed.
export const signSharedProposal = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => signatureSchema.parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: share, error: shareError } = await supabaseAdmin.from("proposal_shares").select("id, expires_at, revoked_at, signed_at").eq("token", data.token).maybeSingle();
    if (shareError) throw new Error("Could not verify proposal link");
    if (!share || !shareIsActive(share)) throw new Error("This proposal link is no longer available");
    if (share.signed_at) throw new Error("This proposal was already signed");
    const signedAt = new Date().toISOString();
    const { data: updated, error } = await supabaseAdmin.from("proposal_shares").update({ signed_name: data.name, signed_at: signedAt, signature_data: data.signature }).eq("id", share.id).is("signed_at", null).is("revoked_at", null).gt("expires_at", signedAt).select("id").maybeSingle();
    if (error) throw new Error("Could not record your signature");
    if (!updated) throw new Error("This proposal was already signed");
    return { signedAt };
  });