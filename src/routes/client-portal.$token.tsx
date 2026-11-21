import { createFileRoute, Link } from '@tanstack/react-router';
import { queryOptions, useSuspenseQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { z } from 'zod';
import { BadgeCheck, CalendarDays, Check, CreditCard, FileCheck2, FileText, HardHat, Phone, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Logo } from '@/components/site/Logo';
import { PaymentTestModeBanner } from '@/components/PaymentTestModeBanner';
import { getClientPortal } from '@/lib/client-portal.functions';
import { money, invoiceState } from '@/lib/crm-schema';
import { getStripeEnvironment } from '@/lib/stripe';
import { pageMeta } from '@/lib/seo';

function environment() { try { return getStripeEnvironment(); } catch { return null; } }
const portalQuery = (token: string) => queryOptions({ queryKey: ['client-portal', token, environment()], queryFn: () => getClientPortal({ data: { token, environment: environment() } }), staleTime: 0, refetchInterval: 45000 });
const checklistSchema = z.array(z.object({ title: z.string(), done: z.boolean() }));
const statusLabels: Record<string, string> = { scheduled: 'Scheduled', in_progress: 'In progress', on_hold: 'On hold', completed: 'Completed', not_started: 'Not started', submitted: 'Submitted', approved: 'Approved', not_required: 'Not required' };
const date = (value: string) => new Date(value.length === 10 ? `${value}T12:00:00` : value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

export const Route = createFileRoute('/client-portal/$token')({
  head: () => ({ meta: [...pageMeta('Your Client Portal | Roofer Masters', 'Your private roofing estimates, signed proposals, project updates and invoice payments.'), { name: 'robots', content: 'noindex,nofollow,noarchive' }, { name: 'referrer', content: 'no-referrer' }] }),
  loader: ({ params, context }) => context.queryClient.ensureQueryData(portalQuery(params.token)),
  component: ClientPortal,
});

function ClientPortal() {
  const { token } = Route.useParams();
  const { data: portal, error } = useSuspenseQuery(portalQuery(token));
  const qc = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState('overview');
  if (!portal) return <main className="mx-auto max-w-xl px-5 py-20 text-center"><Logo className="mx-auto h-24" /><h1 className="mt-8 text-3xl font-bold">Portal unavailable</h1><p className="mt-4 text-muted-foreground">This private link has expired or was revoked. Contact Roofer Masters for a new link.</p><Button asChild className="mt-6"><a href="tel:3059423093"><Phone /> Call Roofer Masters</a></Button></main>;
  const balance = portal.invoices.reduce((sum, i) => sum + Math.max(0, i.total_cents - i.paid_cents), 0);
  const tabs = [{ id: 'overview', label: 'Overview' }, { id: 'estimates', label: 'Estimates' }, { id: 'proposals', label: 'Signed proposals' }, { id: 'jobs', label: 'Job status' }, { id: 'invoices', label: 'Invoices' }];
  return <div className="min-h-screen bg-background text-foreground">
    <header className="border-b border-border"><div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-5 sm:px-8"><Logo className="h-20" /><Button asChild variant="outline"><a href="tel:3059423093"><Phone /> 305-942-3093</a></Button></div></header>
    <main className="mx-auto max-w-6xl px-5 py-8 sm:px-8 sm:py-12">
      <div className="flex flex-wrap items-end justify-between gap-5"><div className="min-w-0"><p className="text-xs font-bold uppercase tracking-wider text-primary">Your roofing project</p><h1 className="mt-2 break-words font-display text-3xl font-bold sm:text-4xl">Welcome, {portal.name}</h1><p className="mt-3 text-sm text-muted-foreground">Roofer Masters · Your roof, our masterpiece.</p></div><Button variant="outline" size="sm" disabled={refreshing} onClick={async () => { setRefreshing(true); try { await qc.invalidateQueries({ queryKey: ['client-portal', token] }); } finally { setRefreshing(false); } }}><RefreshCw className={refreshing ? 'animate-spin' : ''} /> Refresh</Button></div>
      <nav aria-label="Portal views" className="mt-8 flex flex-wrap gap-2 border-b border-border pb-4">{tabs.map(t => <Button key={t.id} variant={tab === t.id ? 'default' : 'ghost'} size="sm" aria-pressed={tab === t.id} onClick={() => setTab(t.id)}>{t.label}</Button>)}</nav>
      {error && <p role="alert" className="mt-4 text-destructive">Updates could not load. Try refreshing.</p>}
      {tab === 'overview' && <section className="grid gap-6 border-b border-border py-8 sm:grid-cols-3"><div><p className="text-sm text-muted-foreground">Active projects</p><p className="mt-2 text-3xl font-bold">{portal.jobs.filter(j => j.status !== 'completed').length}</p></div><div><p className="text-sm text-muted-foreground">Signed proposals</p><p className="mt-2 text-3xl font-bold">{portal.proposals.length}</p></div><div><p className="text-sm text-muted-foreground">Invoice balance</p><p className="mt-2 text-3xl font-bold text-primary">{money(balance)}</p></div></section>}
      {(tab === 'overview' || tab === 'jobs') && <section className="py-8"><h2 className="flex items-center gap-2 text-xl font-bold"><HardHat className="size-5 text-primary" /> Job status</h2>{!portal.jobs.length && <Empty>No job has been scheduled yet.</Empty>}<div className="mt-5 grid gap-4 md:grid-cols-2">{portal.jobs.map(job => {
        const parsed = checklistSchema.safeParse(job.checklist); const checklist = parsed.success ? parsed.data : [];
        return <article key={job.id} className="min-w-0 rounded-lg border border-border bg-card p-5"><div className="flex flex-wrap justify-between gap-3"><h3 className="break-words font-bold">{job.title}</h3><span className="text-sm font-semibold text-primary">{statusLabels[job.status] ?? 'Pending update'}</span></div><dl className="mt-5 grid grid-cols-2 gap-3 text-sm"><dt className="text-muted-foreground">Start date</dt><dd>{job.start_date ? date(job.start_date) : 'Not scheduled'}</dd><dt className="text-muted-foreground">Inspection</dt><dd>{job.inspection_at ? date(job.inspection_at) : 'Not scheduled'}</dd><dt className="text-muted-foreground">Permit</dt><dd>{statusLabels[job.permit_status] ?? 'Pending update'}</dd></dl>{checklist.length > 0 && <div className="mt-5 border-t border-border pt-4"><p className="text-xs font-semibold text-muted-foreground">{checklist.filter(c => c.done).length} of {checklist.length} milestones complete</p><ul className="mt-3 grid gap-2">{checklist.map((c, i) => <li key={i} className="flex items-start gap-2 text-sm"><Check className={`mt-0.5 size-4 shrink-0 ${c.done ? 'text-primary' : 'text-muted-foreground/30'}`} /><span className={c.done ? 'text-foreground' : 'text-muted-foreground'}>{c.title}</span></li>)}</ul></div>}</article>;
      })}</div></section>}
      {tab === 'estimates' && <section className="py-8"><h2 className="flex items-center gap-2 text-xl font-bold"><FileText className="size-5 text-primary" /> Your estimates</h2><p className="mt-2 text-sm text-muted-foreground">Preliminary pricing is subject to roof inspection and the final signed scope.</p>{!portal.estimates.length && <Empty>Your estimate will appear here when prepared.</Empty>}<div className="mt-5 grid gap-4 md:grid-cols-2">{portal.estimates.map(e => <article key={e.id} className="min-w-0 rounded-lg border border-border bg-card p-5"><p className="text-xs font-semibold text-primary">{e.category}</p><h3 className="mt-2 break-words text-lg font-bold">{e.title}</h3><p className="mt-5 text-3xl font-bold">{money(e.total_cents)}</p><p className="mt-3 text-xs text-muted-foreground">Prepared {date(e.created_at)}</p></article>)}</div></section>}
      {tab === 'proposals' && <section className="py-8"><h2 className="flex items-center gap-2 text-xl font-bold"><FileCheck2 className="size-5 text-primary" /> Signed proposals</h2>{!portal.proposals.length && <Empty>No signed proposal is available yet.</Empty>}<div className="mt-5 grid gap-4 md:grid-cols-2">{portal.proposals.map(p => <article key={p.id} className="min-w-0 rounded-lg border border-border bg-card p-5"><h3 className="break-words text-lg font-bold">{p.title}</h3><p className="mt-2 text-sm text-muted-foreground">{p.category}{p.amount !== null ? ` · ${money(p.amount * 100)}` : ''}</p><p className="mt-5 flex items-center gap-2 font-semibold text-primary"><BadgeCheck className="size-5" /> Signed by {p.signedName}</p><p className="mt-2 text-sm text-muted-foreground">{p.signedAt ? date(p.signedAt) : ''}</p>{p.signature && <img src={p.signature} alt={`Signature of ${p.signedName}`} className="mt-4 h-24 max-w-full rounded-md border border-border bg-card object-contain" />}{p.url ? <Button asChild className="mt-5" variant="outline"><a href={p.url} target="_blank" rel="noreferrer"><FileText /> View proposal PDF</a></Button> : <p className="mt-5 text-sm text-muted-foreground">The PDF is temporarily unavailable.</p>}</article>)}</div></section>}
      {(tab === 'overview' || tab === 'invoices') && <section className="border-t border-border py-8"><h2 className="mb-4 flex items-center gap-2 text-xl font-bold"><CreditCard className="size-5 text-primary" /> Invoices & payments</h2><PaymentTestModeBanner />{!portal.invoices.length && <Empty>No issued invoices are available.</Empty>}<div className="mt-5 grid gap-4 md:grid-cols-2">{portal.invoices.map(i => {
        const remaining = Math.max(0, i.total_cents - i.paid_cents); const state = invoiceState({ ...i, status: 'issued' });
        return <article key={i.id} className="min-w-0 rounded-lg border border-border bg-card p-5"><div className="flex items-center justify-between gap-3"><p className="text-xs font-bold text-primary">RM-{i.number}</p><span className="text-xs font-semibold capitalize text-muted-foreground">{state}</span></div><h3 className="mt-2 break-words text-lg font-bold">{i.title}</h3><p className="mt-4 text-sm text-muted-foreground">Total {money(i.total_cents)} · Paid {money(i.paid_cents)}</p><p className="mt-3 text-2xl font-bold">{money(remaining)} <span className="text-sm font-normal text-muted-foreground">remaining</span></p><p className="mt-2 flex items-center gap-2 text-xs text-muted-foreground"><CalendarDays className="size-4" /> Due {date(i.due_date)}</p><Button asChild className="mt-5"><Link to="/invoice/$token" params={{ token: i.token }} search={{ session_id: '' }}><CreditCard /> {remaining > 0 ? 'View & pay invoice' : 'View paid invoice'}</Link></Button></article>;
      })}</div></section>}
      <footer className="mt-6 border-t border-border py-6 text-sm text-muted-foreground"><a href="mailto:roofermasters@gmail.com" className="break-all text-primary">roofermasters@gmail.com</a><p className="mt-2">Miami-Dade & Broward · Hablamos español</p></footer>
    </main>
  </div>;
}
function Empty({ children }: { children: React.ReactNode }) { return <p className="py-8 text-sm text-muted-foreground">{children}</p>; }