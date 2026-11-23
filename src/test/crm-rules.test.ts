import { describe, expect, it } from "vitest";
import {
  calculateEstimate,
  invoiceTotals,
  invoiceSchema,
  invoiceState,
  paymentAmount,
} from "@/lib/crm-schema";
import { proposalMetrics } from "@/lib/crm-reporting";
describe("CRM invoices and roofing operations", () => {
  it("calculates line items and tax in integer cents", () => {
    expect(invoiceTotals([{ description: "Roof", quantity: 1.5, unit_cents: 10001 }], 7)).toEqual({
      subtotal: 15002,
      tax: 1050,
      total: 16052,
    });
  });
  it("requests only the remaining deposit after partial payments", () => {
    expect(
      paymentAmount({ total_cents: 1000000, deposit_cents: 300000, paid_cents: 100000 }, "deposit"),
    ).toBe(200000);
  });
  it("requests only the unpaid invoice balance", () => {
    expect(
      paymentAmount({ total_cents: 1000000, deposit_cents: 300000, paid_cents: 300000 }, "balance"),
    ).toBe(700000);
  });
  it("does not request a deposit that is already covered", () => {
    expect(
      paymentAmount({ total_cents: 1000000, deposit_cents: 300000, paid_cents: 500000 }, "deposit"),
    ).toBe(0);
  });
  it("rejects invoices without customers or with zero total", () => {
    const invoice = {
      lead_id: crypto.randomUUID(),
      proposal_id: null,
      title: "Roof",
      items: [{ description: "Roof", quantity: 1, unit_cents: 100 }],
      tax_percent: 0,
      deposit_percent: 30,
      due_date: "2026-12-01",
      notes: "",
      environment: "sandbox",
    };
    expect(invoiceSchema.safeParse(invoice).success).toBe(true);
    expect(invoiceSchema.safeParse({ ...invoice, lead_id: "" }).success).toBe(false);
    expect(
      invoiceSchema.safeParse({
        ...invoice,
        items: [{ description: "Roof", quantity: 1, unit_cents: 0 }],
      }).success,
    ).toBe(false);
  });
  it("marks issued invoices overdue without marking paid invoices overdue", () => {
    const invoice = {
      status: "issued",
      total_cents: 10000,
      paid_cents: 1000,
      due_date: "2026-11-01",
    };
    const now = Date.parse("2026-11-20T18:00:00Z");
    expect(invoiceState(invoice, now)).toBe("overdue");
    expect(invoiceState({ ...invoice, paid_cents: 10000 }, now)).toBe("paid");
    expect(invoiceState({ ...invoice, status: "draft" }, now)).toBe("draft");
  });
  it("uses roof squares, material waste, labor and profit margin in estimates", () => {
    const result = calculateEstimate({
      sqft: 2000,
      waste: 10,
      material: 300,
      labor: 200,
      permits: 500,
      other: 100,
      margin: 20,
    });
    expect(result.squares).toBe(20);
    expect(result.materialSquares).toBe(22);
    expect(result.cost).toBe(1120000);
    expect(result.total).toBe(1400000);
    expect(result.profit).toBe(280000);
  });
  it("counts a signed proposal once even when multiple links are signed", () => {
    const proposals = [
      { id: "p", is_template: false, amount: 100, lead_id: "l", created_at: "2026-11-01" },
    ];
    const share = {
      proposal_id: "p",
      signed_at: "2026-11-02",
      revoked_at: null,
      expires_at: "2026-12-01",
    };
    expect(proposalMetrics(proposals, [share, share]).accepted).toBe(1);
    expect(proposalMetrics(proposals, [share, share]).acceptance).toBe(100);
  });
  it("avoids double-counting proposal revisions in expected revenue", () => {
    const proposals = [
      { id: "old", is_template: false, amount: 100, lead_id: "l", created_at: "2026-11-01" },
      { id: "new", is_template: false, amount: 150, lead_id: "l", created_at: "2026-11-02" },
    ];
    const shares = proposals.map((p) => ({
      proposal_id: p.id,
      signed_at: null,
      revoked_at: null,
      expires_at: "2026-12-01",
    }));
    expect(proposalMetrics(proposals, shares, Date.parse("2026-11-20")).expectedCents).toBe(15000);
  });
});
