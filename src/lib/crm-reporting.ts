export function proposalMetrics(proposals:{id:string;is_template:boolean;amount:number|null;lead_id:string|null;created_at:string}[],shares:{proposal_id:string;signed_at:string|null;revoked_at:string|null;expires_at:string}[],now=Date.now()){
  const actual=proposals.filter((p)=>!p.is_template);
  const sent=actual.filter((p)=>shares.some((s)=>s.proposal_id===p.id));
  const accepted=sent.filter((p)=>shares.some((s)=>s.proposal_id===p.id && s.signed_at));
  const newestByLead=new Map<string,typeof actual[number]>();
  for(const p of [...actual].sort((a,b)=>Date.parse(b.created_at)-Date.parse(a.created_at))){if(p.lead_id && !newestByLead.has(p.lead_id))newestByLead.set(p.lead_id,p);}
  const expected=[...newestByLead.values()].filter((p)=>shares.some((s)=>s.proposal_id===p.id && !s.signed_at && !s.revoked_at && Date.parse(s.expires_at)>now) && !accepted.some((a)=>a.id===p.id)).reduce((n,p)=>n+(p.amount ?? 0),0);
  return {sent:sent.length,accepted:accepted.length,acceptance:sent.length ? Math.round(accepted.length/sent.length*100):0,expectedCents:Math.round(expected*100)};
}