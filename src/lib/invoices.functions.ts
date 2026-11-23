import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { invoiceSchema, invoiceTotals } from "./crm-schema";

export const createInvoice = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).inputValidator((input: unknown) => invoiceSchema.parse(input)).handler(async ({ data, context }) => {
  const { data: owner, error: roleError } = await context.supabase.rpc('has_any_role',{_user_id:context.userId,_roles:['admin','accounting']});
  if (roleError) throw new Error("Could not verify accounting permissions");
  if (!owner) throw new Error("You do not have access to this action");
  const { data: lead, error: leadError } = await context.supabase.from("leads").select("name,email,address").eq("id", data.lead_id).maybeSingle();
  if (leadError) throw new Error("Could not verify customer details");
  if (!lead) throw new Error("Choose an existing customer");

  let propertyId: string | null = null;
  if (data.proposal_id) {
    const { data: proposal, error: proposalError } = await context.supabase.from("proposals").select("lead_id,is_template,property_id").eq("id", data.proposal_id).maybeSingle();
    if (proposalError) throw new Error("Could not verify proposal details");
    if (!proposal || proposal.is_template || proposal.lead_id !== data.lead_id) throw new Error("Proposal must belong to this customer");
    propertyId = proposal.property_id;
  }

  const totals = invoiceTotals(data.items, data.tax_percent);
  const depositCents = Math.round(totals.total * (data.deposit_percent / 100));
  if (!Number.isSafeInteger(depositCents) || depositCents < 0 || depositCents > totals.total) {
    throw new Error("Invoice deposit exceeds the supported amount");
  }
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: invoice, error } = await supabaseAdmin.from("crm_invoices").insert({
    lead_id: data.lead_id,
    proposal_id: data.proposal_id,
    property_id: propertyId,
    title: data.title,
    customer_name: lead.name,
    customer_email: lead.email ?? "",
    customer_address: lead.address ?? "",
    items: data.items,
    subtotal_cents: totals.subtotal,
    tax_cents: totals.tax,
    total_cents: totals.total,
    deposit_cents: depositCents,
    due_date: data.due_date,
    notes: data.notes,
    environment: data.environment,
  }).select("id").single();
  if (error || !invoice) throw new Error("Could not save invoice");
  return invoice;
});
export const changeInvoiceStatus = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).inputValidator((input: unknown) => z.object({ id: z.string().uuid(), status: z.enum(["issued", "void"]) }).parse(input)).handler(async ({ data, context }) => {
  const { data: owner, error: roleError } = await context.supabase.rpc('has_any_role',{_user_id:context.userId,_roles:['admin','accounting']});
  if (roleError) throw new Error("Could not verify accounting permissions");
  if (!owner) throw new Error("You do not have access to this action");
  const { data: changed, error } = await context.supabase.rpc("set_invoice_status", { p_invoice_id: data.id, p_status: data.status });
  if (error || !changed) throw new Error(error?.message ?? "Invoice cannot be changed");
  return { ok: true };
});
export const getSharedInvoice = createServerFn({ method: "GET" }).inputValidator((input: unknown) => z.object({ token: z.string().uuid() }).parse(input)).handler(async ({ data }) => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: invoice, error } = await supabaseAdmin.from("crm_invoices").select("number,title,customer_name,items,subtotal_cents,tax_cents,total_cents,deposit_cents,paid_cents,due_date,notes,environment").eq("token", data.token).eq("status", "issued").gt("expires_at", new Date().toISOString()).maybeSingle();
  if (error) throw new Error("Could not load shared invoice");
  return invoice;
});