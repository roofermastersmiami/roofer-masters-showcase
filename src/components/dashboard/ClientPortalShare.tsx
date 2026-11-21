import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { Link } from '@tanstack/react-router';
import { Copy, ExternalLink, Link2, Mail, ShieldOff } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { createClientPortal, revokeClientPortal } from '@/lib/client-portal.functions';
import { portalLinkIsActive } from '@/lib/client-portal-schema';

export function ClientPortalShare({ leadId, email }: { leadId: string; email: string | null }) {
  const qc = useQueryClient();
  const create = useServerFn(createClientPortal);
  const revoke = useServerFn(revokeClientPortal);
  const [busy, setBusy] = useState(false);
  const key = ['client-portal-links', leadId];
  const links = useQuery({ queryKey: key, queryFn: async () => {
    const { data, error } = await supabase.from('client_portal_links').select('id,token,expires_at,revoked_at').eq('lead_id', leadId).order('created_at', { ascending: false });
    if (error) throw error;
    return data ?? [];
  } });
  const active = links.data?.filter(link => portalLinkIsActive(link)) ?? [];
  return <section className="mt-6 border-y border-border py-5">
    <h3 className="font-bold text-foreground">Client portal</h3>
    <p className="mt-2 text-sm text-muted-foreground">Share this customer's saved estimates, signed proposals, job progress and issued invoices. Anyone with the private link can view them for 90 days.</p>
    {links.error && <p role="alert" className="mt-3 text-sm text-destructive">Could not load customer links.</p>}
    {!active.length && <Button className="mt-4 w-full" variant="outline" disabled={busy || links.isPending || !!links.error} onClick={async () => {
      setBusy(true); try { await create({ data: { leadId } }); await qc.invalidateQueries({ queryKey: key }); toast.success('Client portal link created'); } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not create portal'); } finally { setBusy(false); }
    }}><Link2 /> Create client portal link</Button>}
    {active.map(link => {
      const url = `${window.location.origin}/client-portal/${link.token}`;
      return <div key={link.id} className="mt-4 border-t border-border pt-4">
        <p className="mb-3 text-xs text-muted-foreground">Expires {new Date(link.expires_at).toLocaleDateString()}</p>
        <div className="flex flex-wrap gap-2">
          <Button asChild size="sm" variant="outline"><Link to="/client-portal/$token" params={{ token: link.token }} target="_blank" rel="noreferrer"><ExternalLink /> Open portal</Link></Button>
          <Button size="sm" variant="outline" onClick={async () => { try { await navigator.clipboard.writeText(url); toast.success('Private link copied'); } catch { toast.error('Could not copy link'); } }}><Copy /> Copy link</Button>
          {email && <Button asChild size="sm" variant="outline"><a href={`mailto:${email}?subject=${encodeURIComponent('Your Roofer Masters client portal')}&body=${encodeURIComponent(`Your roofing estimates, signed proposal, job updates and invoices are available here:\n${url}\n\nPlease keep this private link secure.`)}`}><Mail /> Email draft</a></Button>}
          <Button size="sm" variant="ghost" disabled={busy} onClick={async () => {
            if (!confirm('Revoke this portal link? Separately shared proposal and invoice links remain active.')) return;
            setBusy(true); try { await revoke({ data: { id: link.id } }); await qc.invalidateQueries({ queryKey: key }); toast.success('Portal link revoked'); } catch { toast.error('Could not revoke portal'); } finally { setBusy(false); }
          }}><ShieldOff /> Revoke</Button>
        </div>
      </div>;
    })}
  </section>;
}