import {describe,it,expect} from 'vitest';
import {dashboardLedger,stageOf,propertySchema,customerSchema,PIPELINE_STAGES} from '@/lib/crm-foundation';
describe('CRM foundation',()=>{
 it('supports all twelve requested sales stages and retains Lost',()=>{expect(PIPELINE_STAGES).toEqual(['new','contacted','appointment_scheduled','inspection_completed','estimate_sent','follow_up','approved','contract_signed','project_scheduled','in_progress','completed','paid','lost']);});
 it('preserves Won as Approved in the expanded pipeline',()=>{expect(stageOf({status:'won'})).toBe('approved');});
 it('counts recorded live payments, not invoice value as receipts',()=>{const i=[{id:'a',total_cents:2800000,paid_cents:50000,status:'issued',environment:'live',created_at:'2026-01-01'}];expect(dashboardLedger(i,[{invoice_id:'a',amount_cents:50000,environment:'live',received_at:'2026-11-21'}],'live',Date.parse('2026-11-01'),Date.parse('2026-12-01')).collected).toBe(50000);});
 it('includes older unpaid invoices in outstanding balances',()=>{expect(dashboardLedger([{id:'a',total_cents:2800000,paid_cents:50000,status:'issued',environment:'live',created_at:'2026-01-01'}],[],'live',Date.parse('2026-11-01'),Date.parse('2026-12-01')).outstanding).toBe(2750000);});
 it('excludes sandbox and draft receipts from live metrics',()=>{expect(dashboardLedger([{id:'a',total_cents:1000,paid_cents:0,status:'draft',environment:'live',created_at:'2026-11-21'},{id:'b',total_cents:1000,paid_cents:1000,status:'issued',environment:'sandbox',created_at:'2026-11-21'}],[{invoice_id:'a',amount_cents:1000,environment:'live',received_at:'2026-11-21'},{invoice_id:'b',amount_cents:1000,environment:'sandbox',received_at:'2026-11-21'}],'live',0,Infinity).collected).toBe(0);});
 it('requires a real property address of at least five characters',()=>{expect(propertySchema.safeParse({customer_id:'11111111-1111-4111-8111-111111111111',label:'Home',address:'',notes:''}).success).toBe(false);});
 it('rejects unsupported customer types',()=>{expect(customerSchema.safeParse({name:'Ana Perez',phone:'',email:'',billing_address:'',customer_type:'administrator',notes:''}).success).toBe(false);});
 it('trims customer names and rejects whitespace-only names',()=>{
  const valid={name:'  Ana Perez  ',phone:'',email:'',billing_address:'',customer_type:'residential',notes:''};
  expect(customerSchema.parse(valid).name).toBe('Ana Perez');
  expect(customerSchema.safeParse({...valid,name:'   '}).success).toBe(false);
 });
 it('rejects malformed customer email and oversized notes',()=>{
  const valid={name:'Ana Perez',phone:'',email:'',billing_address:'',customer_type:'residential',notes:''};
  expect(customerSchema.safeParse({...valid,email:'not-an-email'}).success).toBe(false);
  expect(customerSchema.safeParse({...valid,notes:'x'.repeat(4001)}).success).toBe(false);
 });
 it('requires a valid customer UUID when linking a property',()=>{
  expect(propertySchema.safeParse({customer_id:'not-a-uuid',label:'Home',address:'123 Main Street',notes:''}).success).toBe(false);
 });
 it('rejects blank property labels and overlong property notes',()=>{
  const valid={customer_id:'11111111-1111-4111-8111-111111111111',label:'Home',address:'123 Main Street',notes:''};
  expect(propertySchema.safeParse({...valid,label:'  '}).success).toBe(false);
  expect(propertySchema.safeParse({...valid,notes:'x'.repeat(4001)}).success).toBe(false);
 });

});