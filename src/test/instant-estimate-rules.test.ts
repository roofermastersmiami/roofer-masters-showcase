import { describe,it,expect } from 'vitest';
import { instantRange, qualifyRoofLead, changeOrderSchema, rateSchema } from '@/lib/instant-estimate-schema';
const input={category:'Metal Roof' as const,sqft:2000,county:'Miami-Dade' as const,timeline:'Urgent' as const,owner:true,language:'en' as const};
describe('Instant estimator and changes',()=>{
  it('Metal is $1400 per square',()=>expect(instantRange({...input,sqft:100},{low_cents:140000,high_cents:140000,enabled:true})?.low).toBe(140000));
  it('Shingle is $700 per square',()=>expect(instantRange({...input,category:'Shingle Roof',sqft:100},{low_cents:70000,high_cents:70000,enabled:true})?.low).toBe(70000));
  it('Tile is $1200 per square',()=>expect(instantRange({...input,category:'Tile Roof',sqft:100},{low_cents:120000,high_cents:120000,enabled:true})?.low).toBe(120000));
  it('TPO including insulation totals $1700 per square',()=>expect(instantRange({...input,category:'TPO',sqft:100},{low_cents:170000,high_cents:170000,enabled:true})?.low).toBe(170000));
  it('Flat Roof is $8 per sq ft',()=>expect(instantRange({...input,category:'Flat Roof',sqft:2000},{low_cents:80000,high_cents:80000,enabled:true})?.low).toBe(1600000));
  it('uses 100 square feet per roofing square',()=>expect(instantRange(input,{low_cents:10000,high_cents:20000,enabled:true})).toEqual({low:200000,high:400000}));
  it('never quotes inactive or missing pricing',()=>{expect(instantRange(input,null)).toBeNull();expect(instantRange(input,{low_cents:10000,high_cents:20000,enabled:false})).toBeNull();});
  it('qualifies urgent local requests',()=>expect(qualifyRoofLead(input)).toBe('urgent'));
  it('holds outside-area estimates',()=>expect(instantRange({...input,county:'Other'},{low_cents:10000,high_cents:20000,enabled:true})).toBeNull());
  it('flags nonowner requests',()=>expect(qualifyRoofLead({...input,owner:false})).toBe('owner_authorization_needed'));
  it('requires recorded customer name on approval',()=>expect(changeOrderSchema.safeParse({job_id:'00000000-0000-4000-8000-000000000001',title:'Decking',scope:'Replace decking',amount_cents:50000,days_added:1,status:'approved',approved_by:''}).success).toBe(false));
  it('accepts credits and schedule reductions',()=>expect(changeOrderSchema.safeParse({job_id:'00000000-0000-4000-8000-000000000001',title:'Credit',scope:'Remove optional work',amount_cents:-50000,days_added:-1,status:'draft',approved_by:''}).success).toBe(true));
  it('rejects reversed pricing ranges',()=>expect(rateSchema.safeParse({category:'Metal Roof',low_cents:20000,high_cents:10000,enabled:true}).success).toBe(false));
});