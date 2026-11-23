import { describe,it,expect } from 'vitest';
import { instantRange, qualifyRoofLead, changeOrderSchema, rateSchema } from '@/lib/instant-estimate-schema';
const input={category:'Metal Roof' as const,sqft:2000,county:'Miami-Dade' as const,timeline:'Urgent' as const,owner:true,language:'en' as const};\nconst rate=(category:'Metal Roof'|'Tile Roof'|'Shingle Roof'|'TPO'|'Flat Roof',low_cents:number,high_cents=low_cents,enabled=true)=>({category,low_cents,high_cents,enabled});
describe('Instant estimator and changes',()=>{
  it('Metal is $1400 per square',()=>expect(instantRange({...input,sqft:100},rate('Metal Roof',140000))?.low).toBe(140000));
  it('Shingle is $700 per square',()=>expect(instantRange({...input,category:'Shingle Roof',sqft:100},rate('Shingle Roof',70000))?.low).toBe(70000));
  it('Tile is $1200 per square',()=>expect(instantRange({...input,category:'Tile Roof',sqft:100},rate('Tile Roof',120000))?.low).toBe(120000));
  it('TPO including insulation totals $1700 per square',()=>expect(instantRange({...input,category:'TPO',sqft:100},rate('TPO',170000))?.low).toBe(170000));
  it('Flat Roof is $8 per sq ft',()=>expect(instantRange({...input,category:'Flat Roof',sqft:2000},rate('Flat Roof',80000))?.low).toBe(1600000));
  it('uses 100 square feet per roofing square',()=>expect(instantRange(input,rate('Metal Roof',10000,20000))).toEqual({low:200000,high:400000}));
  it('never quotes inactive or missing pricing',()=>{expect(instantRange(input,null)).toBeNull();expect(instantRange(input,rate('Metal Roof',10000,20000,false))).toBeNull();});
  it('rejects malformed and mismatched rates without quoting',()=>{expect(instantRange(input,{category:'Metal Roof',low_cents:NaN,high_cents:20000,enabled:true})).toBeNull();expect(instantRange(input,rate('Shingle Roof',10000,20000))).toBeNull();expect(instantRange(input,{low_cents:10000,high_cents:20000,enabled:true})).toBeNull();});\n  it('qualifies urgent local requests',()=>expect(qualifyRoofLead(input)).toBe('urgent'));
  it('holds outside-area estimates',()=>expect(instantRange({...input,county:'Other'},rate('Metal Roof',10000,20000))).toBeNull());
  it('flags nonowner requests',()=>expect(qualifyRoofLead({...input,owner:false})).toBe('owner_authorization_needed'));
  it('requires recorded customer name on approval',()=>expect(changeOrderSchema.safeParse({job_id:'00000000-0000-4000-8000-000000000001',title:'Decking',scope:'Replace decking',amount_cents:50000,days_added:1,status:'approved',approved_by:''}).success).toBe(false));
  it('accepts credits and schedule reductions',()=>expect(changeOrderSchema.safeParse({job_id:'00000000-0000-4000-8000-000000000001',title:'Credit',scope:'Remove optional work',amount_cents:-50000,days_added:-1,status:'draft',approved_by:''}).success).toBe(true));
  it('rejects reversed pricing ranges',()=>expect(rateSchema.safeParse({category:'Metal Roof',low_cents:20000,high_cents:10000,enabled:true}).success).toBe(false));
});