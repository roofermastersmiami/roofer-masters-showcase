import {z} from 'zod';
export const COST_CATEGORIES=['materials','labor','accessories','underlayment','fasteners','flashing','ridge_caps','drip_edge','disposal','permits','equipment','other'] as const;
export const estimateLineSchema=z.object({id:z.string(),description:z.string().trim().min(1).max(250),category:z.enum(COST_CATEGORIES),unit:z.string().max(30),quantity:z.number().positive().max(1000000),unit_cents:z.number().int().nonnegative().max(100000000)});
export const advancedOptionSchema=z.object({id:z.string(),name:z.string().trim().min(1).max(100),system:z.string().min(1).max(100),lines:z.array(estimateLineSchema).min(1).max(150),overhead_pct:z.number().min(0).max(100),margin_pct:z.number().min(0).max(95),discount_cents:z.number().int().min(0),tax_pct:z.number().min(0).max(100),deposit_pct:z.number().min(0).max(100)});
export type EstimateOption=z.infer<typeof advancedOptionSchema>;
export function materialSystem(system:string):'Metal Roof'|'Tile Roof'|'Shingle Roof'|'TPO'|'Flat Roof'|null {
 if(system==='Standing seam'||system==='Metal Roof')return 'Metal Roof';
 if(system==='Tile Roof'||system==='Shingle Roof'||system==='TPO'||system==='Flat Roof')return system;
 return null;
}
export function projectInvoices<T extends {id:string}>(invoices:T[],links:{invoice_id:string;job_id:string}[],project:string):T[]{
 if(project==='all')return invoices;
 const ids=new Set(links.filter(l=>l.job_id===project).map(l=>l.invoice_id));
 return invoices.filter(i=>ids.has(i.id));
}
function safeCents(value:number,label:string):number {
 if(!Number.isSafeInteger(value)||value<0)throw new Error(`${label} exceeds the supported currency range`);
 return value;
}
export function priceOption(raw:EstimateOption){
 const o=advancedOptionSchema.parse(raw);
 const direct=o.lines.reduce((sum,l)=>{
  const line=safeCents(Math.round(l.quantity*l.unit_cents),'Estimate line');
  return safeCents(sum+line,'Direct cost');
 },0);
 const overhead=safeCents(Math.round(direct*o.overhead_pct/100),'Overhead');
 const cost=safeCents(direct+overhead,'Estimate cost');
 const selling=safeCents(Math.round(cost/(1-o.margin_pct/100)),'Selling price');
 const discount=safeCents(o.discount_cents,'Discount');
 if(discount>selling)throw new Error('Discount exceeds selling price');
 const subtotal=safeCents(selling-discount,'Subtotal');
 const tax=safeCents(Math.round(subtotal*o.tax_pct/100),'Tax');
 const total=safeCents(subtotal+tax,'Total');
 const deposit=safeCents(Math.round(total*o.deposit_pct/100),'Deposit');
 const profit=subtotal-cost;
 if(!Number.isSafeInteger(profit))throw new Error('Estimate profit exceeds the supported currency range');
 return {direct,overhead,cost,subtotal,tax,total,deposit,balance:total-deposit,profit,margin:subtotal?100*profit/subtotal:0};
}
export function actualProfit(collected:number,expenses:{category:string;amount_cents:number}[]){const overheadCategories=new Set(['insurance','advertising','office','overhead']);const direct=expenses.filter(e=>!overheadCategories.has(e.category)).reduce((s,e)=>s+e.amount_cents,0);const overhead=expenses.filter(e=>overheadCategories.has(e.category)).reduce((s,e)=>s+e.amount_cents,0);return {direct,overhead,expenses:direct+overhead,gross:collected-direct,net:collected-direct-overhead,margin:collected>0?(collected-direct-overhead)/collected*100:null};}