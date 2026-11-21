import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { ArrowLeft, ArrowRight, MapPin, Plus, Search } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { createRoofOrder } from '@/lib/roof-orders.functions';
import { roofOrderSchema } from '@/lib/roof-order-schema';
import { customersQuery, propertiesQuery } from './foundation-data';
import { drawingsQuery } from './roof-data';
import { roofOrdersQuery } from './roof-orders-data';
import { RoofMeasurements } from './RoofMeasurements';
import { Choice, Field, SectionHeading, Empty } from './CrmControls';

export function RoofReports({ initialCustomer = '', initialAddress = '' }: { initialCustomer?: string; initialAddress?: string }) {
  const customers = useQuery(customersQuery), properties = useQuery(propertiesQuery), orders = useQuery(roofOrdersQuery), drawings = useQuery(drawingsQuery), qc = useQueryClient();
  const create = useServerFn(createRoofOrder);
  const [adding, setAdding] = useState(!!initialAddress), [selected, setSelected] = useState<string | null>(null), [busy, setBusy] = useState(false), [search, setSearch] = useState(''),[legacy,setLegacy]=useState(false);
  const [form, setForm] = useState({ customer_id: initialCustomer, address: initialAddress, title: 'Roof measurement report', provider: 'manual' as const, notes: '' });
  const report = orders.data?.find(r => r.id === selected);
  async function submit() {
    const parsed = roofOrderSchema.safeParse(form);
    if (!parsed.success) { toast.error('Select a customer and enter their complete property address'); return; }
    setBusy(true);
    try {
      const result = await create({ data: parsed.data });
      await Promise.all([qc.invalidateQueries({ queryKey: ['roof-report-orders'] }), qc.invalidateQueries({ queryKey: ['crm-properties'] })]);
      setAdding(false); setSelected(result.id); toast.success('Your address-linked roof report is ready for measurement');
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not create roof report'); }
    finally { setBusy(false); }
  }
  if(legacy)return <div><Button className="mb-5" variant="outline" onClick={()=>setLegacy(false)}><ArrowLeft/> All roof reports</Button><RoofMeasurements/></div>;
  if (report) return <div><div className="mb-5 flex flex-wrap items-center gap-3"><Button variant="outline" onClick={() => setSelected(null)}><ArrowLeft /> All roof reports</Button><div className="min-w-0"><p className="break-words font-semibold">{report.address}</p><p className="text-xs text-muted-foreground">{customers.data?.find(c => c.id === report.customer_id)?.name} · Roofer Masters measurement report</p></div></div>{drawings.isPending?<p>Loading saved measurements…</p>:drawings.error?<p role="alert">Saved measurements could not load. Refresh before editing.</p>:<RoofMeasurements key={report.id} report={report} initialDrawing={drawings.data?.find(d => d.id === report.drawing_id) ?? null} />}</div>;
  const rows = (orders.data ?? []).filter(r => `${r.address} ${r.title} ${customers.data?.find(c => c.id === r.customer_id)?.name ?? ''}`.toLowerCase().includes(search.toLowerCase()));
  return <div><SectionHeading title="Roof reports" action={<Button onClick={() => setAdding(true)}><Plus /> Create report by address</Button>} /><div className="mb-6 flex flex-wrap items-center gap-4"><div className="relative w-full max-w-md"><Search className="absolute left-3 top-3 size-4 text-muted-foreground" /><Input aria-label="Search roof reports" placeholder="Search customer or property address…" className="pl-9" value={search} onChange={e => setSearch(e.target.value)} /></div><Button variant="outline" onClick={()=>setLegacy(true)}>Existing drawings workspace</Button><p className="text-sm text-muted-foreground">Roofer Masters · Company-owned reports</p></div>{orders.error && <p role="alert" className="text-destructive">Roof reports could not load.</p>}{orders.isPending ? <p>Loading roof reports…</p> : <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{rows.map(r => <article key={r.id} className="flex min-w-0 flex-col rounded-lg border border-border bg-card p-5"><MapPin className="size-5 text-primary" /><h3 className="mt-3 break-words text-lg font-bold">{r.address}</h3><p className="mt-2 text-sm">{customers.data?.find(c => c.id === r.customer_id)?.name}</p><p className="mt-1 text-sm text-muted-foreground">{r.title}</p><p className="my-4 text-xs font-semibold text-muted-foreground">{r.status === 'reviewed' ? 'Owner-reviewed measurements' : r.drawing_id ? 'Drawing saved · awaiting review' : 'Awaiting measurements'} · {new Date(r.created_at).toLocaleDateString()}</p><Button variant="outline" className="mt-auto" onClick={() => setSelected(r.id)}>Open measurement report <ArrowRight /></Button></article>)}</div>}{!orders.isPending && !orders.error && !rows.length && <Empty>No roof reports yet.</Empty>}<Dialog open={adding} onOpenChange={setAdding}><DialogContent className="max-h-[90dvh] overflow-y-auto"><DialogHeader><DialogTitle>Create roof report by address</DialogTitle><DialogDescription>Roofer Masters' own report. Address entry identifies the property; measurements come from your roof dimensions or calibrated aerial photo, not the address alone.</DialogDescription></DialogHeader><form className="grid gap-4" onSubmit={e => { e.preventDefault(); void submit(); }}><Choice label="Customer" value={form.customer_id || 'none'} onChange={v => { const id = v === 'none' ? '' : v; setForm({ ...form, customer_id: id, address: properties.data?.find(p => p.customer_id === id)?.address ?? '' }); }} options={[{ value: 'none', label: 'Choose customer' }, ...(customers.data ?? []).map(c => ({ value: c.id, label: c.name }))]} /><Field label="Customer property address"><Input required minLength={8} maxLength={250} autoComplete="street-address" value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} /></Field><Field label="Report title"><Input required maxLength={180} value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></Field><Field label="Inspection notes"><Textarea value={form.notes} maxLength={4000} onChange={e => setForm({ ...form, notes: e.target.value })} /></Field><Button disabled={busy || !form.customer_id} type="submit"><Plus /> {busy ? 'Creating…' : 'Create my roof report'}</Button></form></DialogContent></Dialog></div>;
}