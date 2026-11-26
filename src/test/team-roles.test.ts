import { describe, it, expect } from "vitest";
import { canOpen, seesMoney, SECTION_ROLES, CRM_SECTION_IDS } from "@/lib/team-roles";
const money = ["invoices", "expenses", "financials", "sales", "prices", "detailed-estimator"];
describe("team roles", () => {
  it("defines an authorization policy for every CRM route and sidebar section", () => {
    for (const section of CRM_SECTION_IDS) {
      expect(Object.hasOwn(SECTION_ROLES, section), `missing policy for ${section}`).toBe(true);
    }
  });
  it("owner opens every section except the crew view", () => {
    expect(canOpen(["admin"], "financials")).toBe(true);
    expect(canOpen(["admin"], "team")).toBe(true);
    expect(canOpen(["admin"], "my-jobs")).toBe(false);
  });
  it("only owner and accounting see money", () => {
    for (const r of ["office", "sales", "production_manager", "crew"]) {
      expect(seesMoney([r])).toBe(false);
      for (const s of money) expect(canOpen([r], s)).toBe(false);
    }
    expect(seesMoney(["accounting"])).toBe(true);
    for (const s of money) expect(canOpen(["accounting"], s)).toBe(true);
  });
  it("sales works leads, estimates and proposals", () => {
    for (const s of ["pipeline", "estimates", "proposals", "measurements"])
      expect(canOpen(["sales"], s)).toBe(true);
    expect(canOpen(["sales"], "jobs")).toBe(false);
  });
  it("keeps permitting owner-only until a role-checked service is available", () => {
    for (const r of ["office", "sales", "production_manager", "crew", "accounting"])
      expect(canOpen([r], "permitting")).toBe(false);
    expect(canOpen(["admin"], "permitting")).toBe(true);
  });
  it("production manager works jobs and roof reports, not leads", () => {
    expect(canOpen(["production_manager"], "jobs")).toBe(true);
    expect(canOpen(["production_manager"], "measurements")).toBe(true);
    expect(canOpen(["production_manager"], "pipeline")).toBe(false);
  });
  it("crew only sees assigned jobs", () => {
    expect(canOpen(["crew"], "my-jobs")).toBe(true);
    for (const s of ["", "jobs", "customers", "pipeline", "team"])
      expect(canOpen(["crew"], s)).toBe(false);
  });
  it("team management and website settings are owner only", () => {
    for (const r of ["office", "sales", "production_manager", "crew", "accounting"])
      for (const s of ["team", "content", "instant"]) expect(canOpen([r], s)).toBe(false);
  });
  it("fails closed for unknown navigation sections for every role, including owners", () => {
    for (const roles of [["admin"], ["office"], ["crew"], ["admin", "accounting"]]) {
      expect(canOpen(roles, "company-settings")).toBe(false);
      expect(canOpen(roles, "billing")).toBe(false);
    }
  });
  it("does not combine unrelated roles into owner privileges", () => {
    expect(canOpen(["office", "crew"], "financials")).toBe(false);
    expect(seesMoney(["office", "crew"])).toBe(false);
    expect(canOpen(["sales", "accounting"], "invoices")).toBe(true);
  });
});
