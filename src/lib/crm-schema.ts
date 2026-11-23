import { z } from "zod";

export const money = (cents: number) => {
  if (!Number.isSafeInteger(cents)) throw new Error("Amount exceeds the supported currency range");
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
};
export const dollarsToCents = (dollars: number) => {
  const cents = Math.round(dollars * 100);
  if (!Number.isFinite(dollars) || !Number.isSafeInteger(cents)) throw new Error("Amount exceeds the supported currency range");
  return cents;
};
export const itemSchema = z.object({ description: z.string().trim().min(1).max(250), quantity: z.number().positive().max(100000), unit_cents: z.number().int().nonnegative().max(100000000) });
export type InvoiceItem = z.infer<typeof itemSchema>;
export function invoiceTotals(items: InvoiceItem[], taxPercent: number) {
  if (!Number.isFinite(taxPercent) || taxPercent < 0 || taxPercent > 100) throw new Error("Tax percentage must be between 0 and 100");
  const subtotal = items.reduce((sum, item) => {
    const lineTotal = Math.round(item.quantity * item.unit_cents);
    if (!Number.isSafeInteger(lineTotal) || lineTotal < 0 || !Number.isSafeInteger(sum + lineTotal)) throw new Error("Invoice subtotal exceeds the supported amount");
    return sum + lineTotal;
  }, 0);
  const tax = Math.round(subtotal * (taxPercent / 100));
  const total = subtotal + tax;
  if (!Number.isSafeInteger(tax) || !Number.isSafeInteger(total)) throw new Error("Invoice total exceeds the supported amount");
  return { subtotal, tax, total };
}
export const invoiceSchema = z.object({
  lead_id: z.string().uuid(), proposal_id: z.string().uuid().nullable(), title: z.string().trim().min(1).max(180),
  items: z.array(itemSchema).min(1).max(50), tax_percent: z.number().min(0).max(100), deposit_percent: z.number().min(0).max(100),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((v) => { const date = new Date(`${v}T00:00:00.000Z`); return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === v; }, "Choose a valid due date"), notes: z.string().max(4000), environment: z.enum(["sandbox", "live"]),
}).refine((data) => invoiceTotals(data.items, data.tax_percent).total > 0, "Invoice total must be greater than zero");
export function invoiceState(invoice: { status: string; total_cents: number; paid_cents: number; due_date: string }, now = Date.now()) {
  if (![invoice.total_cents, invoice.paid_cents].every(Number.isSafeInteger) || invoice.total_cents < 0 || invoice.paid_cents < 0 || invoice.paid_cents > invoice.total_cents) throw new Error("Invoice balances are outside the supported range");
  if (!Number.isFinite(now)) throw new Error("Invoice status requires a valid current date");
  if (invoice.status === "draft" || invoice.status === "void") return invoice.status;
  if (invoice.paid_cents >= invoice.total_cents) return "paid";
  const todayInMiami = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  if (invoice.due_date < todayInMiami) return "overdue";
  return invoice.paid_cents > 0 ? "partial" : "unpaid";
}
export function paymentAmount(invoice: { total_cents: number; paid_cents: number; deposit_cents: number }, kind: "deposit" | "balance") {
  if (![invoice.total_cents, invoice.paid_cents, invoice.deposit_cents].every(Number.isSafeInteger) ||
      invoice.total_cents < 0 || invoice.paid_cents < 0 || invoice.paid_cents > invoice.total_cents ||
      invoice.deposit_cents < 0 || invoice.deposit_cents > invoice.total_cents) {
    throw new Error("Invoice payment amounts are outside the supported range");
  }
  if (kind !== "deposit" && kind !== "balance") throw new Error("Unsupported invoice payment type");
  return kind === "deposit" ? Math.max(0, Math.min(invoice.deposit_cents - invoice.paid_cents, invoice.total_cents - invoice.paid_cents)) : invoice.total_cents - invoice.paid_cents;
}
export const estimateInputSchema = z.object({ sqft: z.number().positive().max(1000000), waste: z.number().min(0).max(100), material: z.number().nonnegative().max(100000), labor: z.number().nonnegative().max(100000), permits: z.number().nonnegative().max(1000000), other: z.number().nonnegative().max(1000000), margin: z.number().min(0).max(95) });
export type EstimateInputs = z.infer<typeof estimateInputSchema>;
export function calculateEstimate(raw: EstimateInputs) {
  const input = estimateInputSchema.parse(raw);
  const squares = input.sqft / 100;
  const materialSquares = squares * (1 + input.waste / 100);
  const materialCents = dollarsToCents(materialSquares * input.material);
  const laborCents = dollarsToCents(squares * input.labor);
  const cost = materialCents + laborCents + dollarsToCents(input.permits + input.other);
  const total = Math.round(cost / (1 - input.margin / 100));
  if (![materialCents, laborCents, cost, total].every(Number.isSafeInteger)) throw new Error("Estimate exceeds the supported amount");
  return { squares, materialSquares, materialCents, laborCents, cost, total, profit: total - cost };
}
export const CHECKLIST = ["Pre-job inspection", "Permit verified", "Materials delivered", "Tear-off complete", "Dry-in inspection", "Roof installation", "Final inspection", "Site cleanup"];