import { createServerFn } from '@tanstack/react-start';
import { setResponseHeader } from '@tanstack/react-start/server';
import { z } from 'zod';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';
import { portalInput, portalLinkIsActive, portalInvoiceVisible, portalSignatureVisible } from './client-portal-schema';

export const createClientPortal = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ leadId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: owner, error: roleError } = await context.supabase.rpc('has_any_role',{_user_id:context.userId,_roles:['office','sales']});
    if (roleError || !owner) throw new Error('You do not have access to this action');
    const { data: lead, error: leadError } = await context.supabase.from('leads').select('id').eq('id', data.leadId).maybeSingle();
    if (leadError) throw new Error('Could not verify customer record');
    if (!lead) throw new Error('Customer not found');
    const { data: link, error } = await context.supabase.from('client_portal_links').insert({ lead_id: lead.id }).select('id,token,expires_at,revoked_at').single();
    if (error || !link) throw new Error('Could not create customer portal');
    return link;
  });

export const revokeClientPortal = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: owner, error: roleError } = await context.supabase.rpc('has_any_role',{_user_id:context.userId,_roles:['office','sales']});
    if (roleError || !owner) throw new Error('You do not have access to this action');
    const { data: revoked, error } = await context.supabase.from('client_portal_links').update({ revoked_at: new Date().toISOString() }).eq('id', data.id).select('id').maybeSingle();
    if (error || !revoked) throw new Error('Could not revoke customer portal');
    return { ok: true };
  });

// The expiring, owner-issued capability is the authorization, never an email or lead ID.
export const getClientPortal = createServerFn({ method: 'GET' })
  .inputValidator((input: unknown) => portalInput.parse(input))
  .handler(async ({ data }) => {
    setResponseHeader('Cache-Control', 'private, no-store');
    setResponseHeader('Referrer-Policy', 'no-referrer');
    const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
    const { data: link, error: linkError } = await supabaseAdmin.from('client_portal_links').select('lead_id,expires_at,revoked_at').eq('token', data.token).maybeSingle();
    if (linkError) throw new Error('Could not load your portal');
    if (!link || !portalLinkIsActive(link)) return null;
    const [customer, estimates, jobs, proposals, invoices] = await Promise.all([
      supabaseAdmin.from('leads').select('name').eq('id', link.lead_id).maybeSingle(),
      supabaseAdmin.from('roof_estimates').select('id,title,category,total_cents,created_at').eq('lead_id', link.lead_id).order('created_at', { ascending: false }),
      supabaseAdmin.from('roof_jobs').select('id,title,status,start_date,inspection_at,permit_status,checklist').eq('lead_id', link.lead_id).order('created_at', { ascending: false }),
      supabaseAdmin.from('proposals').select('id,title,category,file_path,amount').eq('lead_id', link.lead_id).eq('is_template', false).order('created_at', { ascending: false }),
      supabaseAdmin.from('crm_invoices').select('id,number,title,total_cents,paid_cents,due_date,token,status,environment,expires_at').eq('lead_id', link.lead_id).eq('status', 'issued').order('created_at', { ascending: false }),
    ]);
    if ([customer.error, estimates.error, jobs.error, proposals.error, invoices.error].some(Boolean)) throw new Error('Could not load your project records');
    if (!customer.data) return null;
    const proposalIds = (proposals.data ?? []).map(p => p.id);
    const shares = proposalIds.length ? await supabaseAdmin.from('proposal_shares').select('proposal_id,signed_name,signed_at,signature_data,expires_at,revoked_at').in('proposal_id', proposalIds).not('signed_at', 'is', null).order('signed_at', { ascending: false }) : { data: [], error: null };
    if (shares.error) throw new Error('Could not load signed proposals');
    const signedProposals = await Promise.all((proposals.data ?? []).flatMap(p => {
      const share = shares.data?.find(s => s.proposal_id === p.id && portalSignatureVisible(s));
      if (!share || !p.file_path) return [];
      const filePath = p.file_path;
      return [(async () => {
        const { data: pdf, error: pdfError } = await supabaseAdmin.storage.from('roofing-proposals').createSignedUrl(filePath, 60);
        if (pdfError || !pdf?.signedUrl) {
          console.error('Client portal signed proposal URL failed', { proposalId: p.id, error: pdfError });
          throw new Error('Could not load a signed proposal document');
        }
        return { id: p.id, title: p.title, category: p.category, amount: p.amount, signedName: share.signed_name, signedAt: share.signed_at, signature: share.signature_data, url: pdf.signedUrl };
      })()];
    }));
    return {
      name: customer.data.name,
      estimates: estimates.data ?? [],
      jobs: jobs.data ?? [],
      proposals: signedProposals,
      invoices: (invoices.data ?? []).filter(i => portalInvoiceVisible(i, data.environment)).map(i => ({ id: i.id, number: i.number, title: i.title, total_cents: i.total_cents, paid_cents: i.paid_cents, due_date: i.due_date, token: i.token })),
    };
  });