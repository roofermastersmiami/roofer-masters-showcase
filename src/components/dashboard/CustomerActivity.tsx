import {useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {Phone,Plus} from 'lucide-react';
import {toast} from 'sonner';
import {supabase} from '@/integrations/supabase/client';
import {Button} from '@/components/ui/button';
import {Textarea} from '@/components/ui/textarea';
import {activityQuery} from './foundation-data';
import {formatWhen} from './data';
export function CustomerActivity({leadId}:{leadId:string}){
 const activity=useQuery(activityQuery),qc=useQueryClient();const [note,setNote]=useState(''),[busy,setBusy]=useState(false);
 async function record(){if(!note.trim())return;setBusy(true);const {error}=await supabase.from('crm_activity').insert({lead_id:leadId,kind:'call_note',body:note.trim().slice(0,4000)});setBusy(false);if(error){toast.error('Could not record call note');return;}setNote('');await qc.invalidateQueries({queryKey:['crm-activity']});toast.success('Call note recorded');}
 return <section className="mt-6 border-t border-border pt-5"><h3 className="mb-3 flex items-center gap-2 font-bold"><Phone className="size-4"/> Communication & activity</h3><Textarea aria-label="Call note" placeholder="Record a call or follow-up note" maxLength={4000} value={note} onChange={e=>setNote(e.target.value)}/><Button className="mt-2" size="sm" variant="outline" disabled={busy||!note.trim()} onClick={()=>void record()}><Plus/> Record call note</Button><div className="mt-5 grid gap-4">{activity.error&&<p className="text-destructive">Activity unavailable.</p>}{activity.data?.filter(a=>a.lead_id===leadId).map(a=><div key={a.id} className="border-l-2 border-border pl-3"><p className="text-xs text-muted-foreground">{formatWhen(a.created_at)} · {a.kind.replaceAll('_',' ')}</p><p className="mt-1 whitespace-pre-wrap break-words text-sm">{a.body}</p></div>)}</div></section>;
}