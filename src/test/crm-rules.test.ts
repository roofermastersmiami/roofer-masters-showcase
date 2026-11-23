import { describe, expect, it } from "vitest";
import { calculateEstimate, dollarsToCents, invoiceTotals, invoiceSchema, invoiceState, paymentAmount, money } from "@/lib/crm-schema";
import { proposalMetrics } from "@/lib/crm-reporting";
describe("CRM invoices and roofing operations",()=>{
  it("calculates line items and tax in integer cents",()=>{expect(invoiceTotals([{description:"Roof",quantity:1.5,unit_cents:10001}],7)).toEqual({subtotal:15002,tax:1050,total:16052});});
  it("rejects malformed invoice line item collections before totaling",()=>{
    expect(()=>invoiceTotals(null as never,0)).toThrow("between 1 and 50");
    expect(()=>invoiceTotals([] as never,0)).toThrow("between 1 and 50");
    expect(()=>invoiceTotals([{description:"",quantity:1,unit_cents:100}] as never,0)).toThrow();
    expect(()=>invoiceTotals([{description:"Roof",quantity:Number.NaN,unit_cents:100}] as never,0)).toThrow();
  });
  it("rejects unsafe invoice currency calculations",()=>{expect(()=>invoiceTotals([{description:"Roof",quantity:Number.MAX_VALUE,unit_cents:100}],0)).toThrow();expect(()=>invoiceTotals([{description:"Roof",quantity:1,unit_cents:100}],101)).toThrow();expect(()=>dollarsToCents(Number.MAX_VALUE)).toThrow();});
  it("requests only the remaining deposit after partial payments",()=>{expect(paymentAmount({total_cents:1000000,deposit_cents:300000,paid_cents:100000},"deposit")).toBe(200000);});
  it("requests only the unpaid invoice balance",()=>{expect(paymentAmount({total_cents:1000000,deposit_cents:300000,paid_cents:300000},"balance")).toBe(700000);});
  it("does not request a deposit that is already covered",()=>{expect(paymentAmount({total_cents:1000000,deposit_cents:300000,paid_cents:500000},"deposit")).toBe(0);});
  it("rejects invoices without customers or with zero total",()=>{const invoice={lead_id:crypto.randomUUID(),proposal_id:null,title:"Roof",items:[{description:"Roof",quantity:1,unit_cents:100}],tax_percent:0,deposit_percent:30,due_date:"2026-12-01",notes:"",environment:"sandbox"};expect(invoiceSchema.safeParse(invoice).success).toBe(true);expect(invoiceSchema.safeParse({...invoice,lead_id:""}).success).toBe(false);expect(invoiceSchema.safeParse({...invoice,items:[{description:"Roof",quantity:1,unit_cents:0}]}).success).toBe(false);expect(invoiceSchema.safeParse({...invoice,due_date:"2026-02-31"}).success).toBe(false);expect(invoiceSchema.safeParse({...invoice,due_date:"2028-02-29"}).success).toBe(true);});
  it("marks issued invoices overdue without marking paid invoices overdue",()=>{const invoice={status:"issued",total_cents:10000,paid_cents:1000,due_date:"2026-11-01"};const now=Date.parse("2026-11-20T18:00:00Z");expect(invoiceState(invoice,now)).toBe("overdue");expect(invoiceState({...invoice,paid_cents:10000},now)).toBe("paid");expect(invoiceState({...invoice,status:"draft"},now)).toBe("draft");});
  it("uses Miami daylight-saving time when deciding whether an invoice is overdue",()=>{const invoice={status:"issued",total_cents:10000,paid_cents:0,due_date:"2026-07-01"};expect(invoiceState(invoice,Date.parse("2026-07-02T03:30:00Z"))).toBe("unpaid");expect(invoiceState(invoice,Date.parse("2026-07-02T04:30:00Z"))).toBe("overdue");});
  it("rejects missing or non-object estimate inputs",()=>{
    expect(()=>calculateEstimate(null as never)).toThrow();
    expect(()=>calculateEstimate([] as never)).toThrow();
  });
  it("uses roof squares, material waste, labor and profit margin in estimates",()=>{const result=calculateEstimate({sqft:2000,waste:10,material:300,labor:200,permits:500,other:100,margin:20});expect(result.squares).toBe(20);expect(result.materialSquares).toBe(22);expect(result.cost).toBe(1120000);expect(result.total).toBe(1400000);expect(result.profit).toBe(280000);});
  it("applies waste to material quantities without inflating measured roof area or labor",()=>{const result=calculateEstimate({sqft:1000,waste:10,material:200,labor:150,permits:0,other:0,margin:0});expect(result.squares).toBe(10);expect(result.materialSquares).toBe(11);expect(result.materialCents).toBe(220000);expect(result.laborCents).toBe(150000);expect(result.cost).toBe(370000);});
  it("keeps material allowance equal to measured area when waste is zero",()=>{const result=calculateEstimate({sqft:1250,waste:0,material:180,labor:120,permits:0,other:0,margin:0});expect(result.squares).toBe(12.5);expect(result.materialSquares).toBe(12.5);expect(result.materialCents).toBe(225000);expect(result.laborCents).toBe(150000);});
  it("rejects malformed proposal reporting data and unsafe expected revenue",()=>{
    expect(()=>proposalMetrics(null as never,[])).toThrow("valid collections");
    expect(()=>proposalMetrics([{id:"p",is_template:false,amount:100,lead_id:"l",created_at:"not-a-date"}],[])).toThrow("invalid proposal");
    expect(()=>proposalMetrics([{id:"p",is_template:false,amount:100,lead_id:"l",created_at:"2026-11-01"}],[{proposal_id:"p",signed_at:null,revoked_at:null,expires_at:"bad-date"}])).toThrow("invalid share");
    expect(()=>proposalMetrics([{id:"p",is_template:false,amount:Number.MAX_VALUE,lead_id:"l",created_at:"2026-11-01"}],[{proposal_id:"p",signed_at:null,revoked_at:null,expires_at:"2026-12-01"}])).toThrow("supported amount");
  });
  it("counts a signed proposal once even when multiple links are signed",()=>{const proposals=[{id:"p",is_template:false,amount:100,lead_id:"l",created_at:"2026-11-01"}];const share={proposal_id:"p",signed_at:"2026-11-02",revoked_at:null,expires_at:"2026-12-01"};expect(proposalMetrics(proposals,[share,share]).accepted).toBe(1);expect(proposalMetrics(proposals,[share,share]).acceptance).toBe(100);});
  it("avoids double-counting proposal revisions in expected revenue",()=>{const proposals=[{id:"old",is_template:false,amount:100,lead_id:"l",created_at:"2026-11-01"},{id:"new",is_template:false,amount:150,lead_id:"l",created_at:"2026-11-02"}];const shares=proposals.map((p)=>({proposal_id:p.id,signed_at:null,revoked_at:null,expires_at:"2026-12-01"}));expect(proposalMetrics(proposals,shares,Date.parse("2026-11-20")).expectedCents).toBe(15000);});
  it("rejects invalid invoice balances before computing status or payment amounts",()=>{
    expect(()=>invoiceState({status:"issued",total_cents:100,paid_cents:101,due_date:"2026-12-01"})).toThrow("supported range");
    expect(()=>paymentAmount({total_cents:100,paid_cents:-1,deposit_cents:30},"deposit")).toThrow("supported range");
    expect(()=>paymentAmount({total_cents:100,paid_cents:0,deposit_cents:101},"balance")).toThrow("supported range");
    expect(()=>money(Number.MAX_VALUE)).toThrow("supported range");
  });
  it("rejects invalid timestamps when calculating invoice status",()=>{expect(()=>invoiceState({status:"issued",total_cents:100,paid_cents:0,due_date:"2026-12-01"},Number.NaN)).toThrow("valid current date");});
  it("rejects invalid due dates and unknown invoice statuses",()=>{
    expect(()=>invoiceState({status:"issued",total_cents:100,paid_cents:0,due_date:"2026-02-30"})).toThrow("due date");
    expect(()=>invoiceState({status:"pending",total_cents:100,paid_cents:0,due_date:"2026-12-01"})).toThrow("status is invalid");
  });
});