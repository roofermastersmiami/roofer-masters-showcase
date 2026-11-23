import { z } from 'zod';

export const PIPELINE_STAGES = ['new','contacted','appointment_scheduled','inspection_completed','estimate_sent','follow_up','approved','contract_signed','project_scheduled','in_progress','completed','paid','lost'] as const;
export type PipelineStage = typeof PIPELINE_STAGES[number];
export const PIPELINE_LABELS: Record<PipelineStage,string> = {new:'New lead',contacted:'Contacted',appointment_scheduled:'Appointment scheduled',inspection_completed:'Inspection completed',estimate_sent:'Estimate sent',follow_up:'Follow-up',approved:'Approved',contract_signed:'Contract signed',project_scheduled:'Project scheduled',in_progress:'In progress',completed:'Completed',paid:'Paid',lost:'Lost'};
export const customerSchema = z.object({id:z.string().uuid().optional(),name:z.string().trim().min(2).max(100),phone:z.string().trim().max(30),email:z.string().trim().email().or(z.literal('')),billing_address:z.string().trim().max(250),customer_type:z.enum(['residential','commercial','property_manager']),notes:z.string().max(4000)});
export const propertySchema = z.object({customer_id:z.string().uuid(),label:z.string().trim().min(1).max(100),address:z.string().trim().min(5).max(250),notes:z.string().max(4000)});
export function stageOf(lead:{pipeline_stage?:string;status:string}):PipelineStage {
  const parsed=z.enum(PIPELINE_STAGES).safeParse(lead.pipeline_stage);
  if(parsed.success)return parsed.data;
  if(lead.status==='won')return 'approved';
  const old=z.enum(PIPELINE_STAGES).safeParse(lead.status);return old.success?old.data:'new';
}
type LedgerInvoice={id:string;total_cents:number;paid_cents:number;status:string;environment:string;created_at:string};
type LedgerPayment={invoice_id:string;amount_cents:number;environment:string;received_at:string};
export function dashboardLedger(invoices:LedgerInvoice[],payments:LedgerPayment[],environment:string,from:number,to:number){
  if(!Array.isArray(invoices)||!Array.isArray(payments)||typeof environment!=='string'||!environment.trim()||!Number.isFinite(from)||!(Number.isFinite(to)||to===Infinity)||from>to) throw new Error('Dashboard ledger requires valid collections, environment, and date range');
  const invoiceIds=new Set<string>();
  for(const invoice of invoices){
    if(!invoice||typeof invoice.id!=='string'||!invoice.id||invoiceIds.has(invoice.id)||!Number.isSafeInteger(invoice.total_cents)||!Number.isSafeInteger(invoice.paid_cents)||invoice.total_cents<0||invoice.paid_cents<0||invoice.paid_cents>invoice.total_cents||typeof invoice.status!=='string'||typeof invoice.environment!=='string'||!Number.isFinite(Date.parse(invoice.created_at))) throw new Error('Dashboard ledger contains an invalid or duplicate invoice');
    invoiceIds.add(invoice.id);
  }
  for(const payment of payments){
    if(!payment||typeof payment.invoice_id!=='string'||!Number.isSafeInteger(payment.amount_cents)||payment.amount_cents<=0||typeof payment.environment!=='string'||!Number.isFinite(Date.parse(payment.received_at))) throw new Error('Dashboard ledger contains an invalid payment');
  }
  const issued=invoices.filter(i=>i.environment===environment&&i.status==='issued');
  const ids=new Set(issued.map(i=>i.id));
  const received=payments.filter(p=>p.environment===environment&&ids.has(p.invoice_id)&&Date.parse(p.received_at)>=from&&Date.parse(p.received_at)<=to);
  const collected=received.reduce((n,p)=>n+p.amount_cents,0);
  const sales=issued.filter(i=>Date.parse(i.created_at)>=from&&Date.parse(i.created_at)<=to).reduce((n,i)=>n+i.total_cents,0);
  const outstanding=issued.reduce((n,i)=>n+Math.max(0,i.total_cents-i.paid_cents),0);
  if(![collected,sales,outstanding].every(Number.isSafeInteger)) throw new Error('Dashboard ledger totals exceed the supported amount');
  return {collected,sales,outstanding,received};
}
