import { describe, expect, it } from "vitest";
import { resolveCompanyContext, type CompanyMembershipRow } from "@/lib/company-context";

const own: CompanyMembershipRow = {
  company_id: "company-roofer-masters",
  user_id: "user-1",
  role: "owner",
};

describe("resolveCompanyContext", () => {
  it("fails closed without an authenticated user", () => {
    expect(resolveCompanyContext(null, [own])).toEqual({
      ok: false,
      reason: "unauthenticated",
    });
  });

  it("fails closed when the authenticated user has no membership", () => {
    expect(resolveCompanyContext("user-2", [own])).toEqual({
      ok: false,
      reason: "no_membership",
    });
  });

  it("resolves the sole membership belonging to the authenticated user", () => {
    expect(resolveCompanyContext("user-1", [own])).toEqual({
      ok: true,
      companyId: "company-roofer-masters",
      role: "owner",
    });
  });

  it("ignores memberships belonging to other users", () => {
    const other = { ...own, company_id: "company-other", user_id: "user-2" };
    expect(resolveCompanyContext("user-1", [other, own])).toEqual({
      ok: true,
      companyId: "company-roofer-masters",
      role: "owner",
    });
  });

  it("fails closed when the user belongs to multiple companies", () => {
    const second = { ...own, company_id: "company-other" };
    expect(resolveCompanyContext("user-1", [own, second])).toEqual({
      ok: false,
      reason: "multiple_memberships",
    });
  });

  it("fails closed for incomplete membership rows", () => {
    expect(resolveCompanyContext("user-1", [{ ...own, company_id: "" }])).toEqual({
      ok: false,
      reason: "invalid_membership",
    });
  });
});
