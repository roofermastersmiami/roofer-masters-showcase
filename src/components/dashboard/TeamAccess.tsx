import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { listTeam, setTeamRole, setJobCrew } from '@/lib/team.functions';
import { ROLE_LABELS, type TeamRole } from '@/lib/team-roles';
import { jobsQuery } from './operations-data';
import { Field, SectionHeading, Choice } from './CrmControls';
const ASSIGNABLE: Exclude<TeamRole, 'admin'>[] = ['office', 'sales', 'production_manager', 'crew', 'accounting'];
export function TeamAccess() {
  const listFn = useServerFn(listTeam), roleFn = useServerFn(setTeamRole), crewFn = useServerFn(setJobCrew), qc = useQueryClient();
  const team = useQuery({ queryKey: ['team'], queryFn: () => listFn() }), jobs = useQuery(jobsQuery);
  const [email, setEmail] = useState(''), [role, setRole] = useState<Exclude<TeamRole, 'admin'>>('office'), [busy, setBusy] = useState(false);
  async function change(target: string, r: Exclude<TeamRole, 'admin'>, grant: boolean) {
    setBusy(true);
    try { const res = await roleFn({ data: { email: target, role: r, grant } }); if ('error' in res) toast.error(res.error); else { toast.success(grant ? 'Access granted' : 'Access removed'); await qc.invalidateQueries({ queryKey: ['team'] }); } }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Could not update access'); } finally { setBusy(false); }
  }
  const crew = (team.data ?? []).filter(u => u.roles.includes('crew'));
  return <div>
    <SectionHeading title="Team & access" />
    <p className="mb-5 max-w-2xl text-sm text-muted-foreground">Team members create their own account at the sign-in page and confirm their email. Then give them a role here. No one is invited or emailed automatically. Only Owner and Accounting can see money.</p>
    <form className="mb-8 flex flex-wrap items-end gap-3" onSubmit={e => { e.preventDefault(); void change(email, role, true); }}>
      <Field label="Team member email"><Input className="w-72" type="email" required value={email} onChange={e => setEmail(e.target.value)} /></Field>
      <div className="w-56"><Choice label="Role" value={role} onChange={v => setRole(v as typeof role)} options={ASSIGNABLE.map(r => ({ value: r, label: ROLE_LABELS[r] }))} /></div>
      <Button disabled={busy}>Give access</Button>
    </form>
    {team.isPending ? <p>Loading team…</p> : team.error ? <p role="alert" className="text-destructive">Team could not load.</p> :
      <div className="divide-y divide-border border-y border-border">{(team.data ?? []).filter(u => u.roles.length).map(u => <div key={u.id} className="flex flex-wrap items-center justify-between gap-3 py-3"><span className="font-medium">{u.email}</span><span className="flex flex-wrap gap-2">{u.roles.map(r => <span key={r} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs">{ROLE_LABELS[r as TeamRole] ?? r}{r !== 'admin' && <button type="button" aria-label={`Remove ${r}`} className="text-destructive" disabled={busy} onClick={() => void change(u.email, r as Exclude<TeamRole, 'admin'>, false)}>×</button>}</span>)}</span></div>)}</div>}
    <h3 className="mb-3 mt-10 text-lg font-bold">Crew job assignments</h3>
    {!crew.length ? <p className="text-sm text-muted-foreground">No crew accounts yet.</p> :
      <div className="grid gap-4">{(jobs.data ?? []).map(j => <div key={j.id} className="border-b border-border pb-3"><p className="mb-2 font-medium">{j.title}</p><div className="flex flex-wrap gap-4">{crew.map(c => { const on = (j.assigned_user_ids ?? []).includes(c.id); return <label key={c.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={on} disabled={busy} onChange={async () => { setBusy(true); try { await crewFn({ data: { job_id: j.id, user_ids: on ? j.assigned_user_ids.filter(x => x !== c.id) : [...(j.assigned_user_ids ?? []), c.id] } }); await qc.invalidateQueries({ queryKey: ['roof-jobs'] }); } catch { toast.error('Could not assign crew'); } finally { setBusy(false); } }} />{c.email}</label>; })}</div></div>)}</div>}
  </div>;
}
