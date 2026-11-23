import { describe, expect, it } from "vitest";
import {
  portalInput,
  portalLinkIsActive,
  portalInvoiceVisible,
  portalSignatureVisible,
} from "@/lib/client-portal-schema";

const now = Date.parse("2026-11-20T20:35:00Z");
const active = { expires_at: "2026-12-20T20:35:00Z", revoked_at: null };
describe("client portal access", () => {
  it("rejects expired and revoked customer links", () => {
    expect(portalLinkIsActive(active, now)).toBe(true);
    expect(portalLinkIsActive({ ...active, revoked_at: "2026-11-20T19:00:00Z" }, now)).toBe(false);
    expect(portalLinkIsActive({ ...active, expires_at: "2026-11-20T20:35:00Z" }, now)).toBe(false);
  });
  it("only exposes issued invoices from the matching payment environment", () => {
    const invoice = { status: "issued", environment: "sandbox", expires_at: active.expires_at };
    expect(portalInvoiceVisible(invoice, "sandbox", now)).toBe(true);
    expect(portalInvoiceVisible({ ...invoice, status: "draft" }, "sandbox", now)).toBe(false);
    expect(portalInvoiceVisible({ ...invoice, status: "void" }, "sandbox", now)).toBe(false);
    expect(portalInvoiceVisible(invoice, "live", now)).toBe(false);
    expect(portalInvoiceVisible(invoice, null, now)).toBe(false);
    expect(
      portalInvoiceVisible({ ...invoice, expires_at: "2026-11-19T00:00:00Z" }, "sandbox", now),
    ).toBe(false);
  });
  it("only shows signed proposals from active shares", () => {
    const signed = { ...active, signed_at: "2026-11-20T19:00:00Z" };
    expect(portalSignatureVisible(signed, now)).toBe(true);
    expect(portalSignatureVisible({ ...signed, signed_at: null }, now)).toBe(false);
    expect(portalSignatureVisible({ ...signed, revoked_at: "2026-11-20T20:00:00Z" }, now)).toBe(
      false,
    );
  });
  it("fails closed for malformed invoice and signature records", () => {
    expect(portalInvoiceVisible(null as never, "sandbox", now)).toBe(false);
    expect(
      portalInvoiceVisible(
        { status: "issued", environment: "sandbox", expires_at: "not-a-date" },
        "sandbox",
        now,
      ),
    ).toBe(false);
    expect(
      portalInvoiceVisible(
        { status: "issued", environment: "sandbox", expires_at: active.expires_at },
        "production",
        now,
      ),
    ).toBe(false);
    expect(
      portalInvoiceVisible(
        { status: "issued", environment: "sandbox", expires_at: active.expires_at },
        "sandbox",
        Number.NaN,
      ),
    ).toBe(false);
    expect(portalSignatureVisible(null as never, now)).toBe(false);
    expect(
      portalSignatureVisible(
        { signed_at: "2026-11-20T19:00:00Z", revoked_at: null, expires_at: "not-a-date" },
        now,
      ),
    ).toBe(false);
    expect(
      portalSignatureVisible(
        { signed_at: "2026-11-20T19:00:00Z", revoked_at: null, expires_at: active.expires_at },
        Number.NaN,
      ),
    ).toBe(false);
  });
  it("requires a private UUID token rather than an email or customer name", () => {
    expect(
      portalInput.safeParse({ token: "customer@example.com", environment: "sandbox" }).success,
    ).toBe(false);
  });
});
