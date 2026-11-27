import { describe, expect, it } from "vitest";
import {
  canAssignCompanyCrew,
  canManageCompanyMember,
  isCompanyAdmin,
  type CompanyTeamMembership,
} from "@/lib/company-team-policy";

const members: CompanyTeamMembership[] = [
  { user_id: "crew-a", company_id: "company-a", role: "crew" },
  { user_id: "crew-b", company_id: "company-b", role: "crew" },
  { user_id: "sales-a", company_id: "company-a", role: "sales" },
];

describe("company-scoped team policy", () => {
  it("recognizes only owner and admin as company administrators", () => {
    expect(isCompanyAdmin("owner")).toBe(true);
    expect(isCompanyAdmin("admin")).toBe(true);
    expect(isCompanyAdmin("production_manager")).toBe(false);
    expect(isCompanyAdmin("admin-global")).toBe(false);
    expect(isCompanyAdmin(null)).toBe(false);
  });

  it("allows owners to manage non-owner company memberships", () => {
    expect(canManageCompanyMember("owner", "admin", "office")).toBe(true);
    expect(canManageCompanyMember("owner", "sales", "admin")).toBe(true);
  });

  it("prevents admins from managing owners, admins, or granting admin access", () => {
    expect(canManageCompanyMember("admin", "owner", "sales")).toBe(false);
    expect(canManageCompanyMember("admin", "admin", "sales")).toBe(false);
    expect(canManageCompanyMember("admin", "crew", "admin")).toBe(false);
    expect(canManageCompanyMember("admin", "crew", "owner")).toBe(false);
  });

  it("does not let operational roles manage team memberships", () => {
    expect(canManageCompanyMember("production_manager", "crew", "office")).toBe(false);
    expect(canManageCompanyMember("crew", "sales", "crew")).toBe(false);
  });

  it("allows a production manager to assign crew from the same company", () => {
    expect(
      canAssignCompanyCrew({
        actorRole: "production_manager",
        companyId: "company-a",
        requestedUserIds: ["crew-a"],
        memberships: members,
      }),
    ).toBe(true);
  });

  it("rejects crew belonging to a different company", () => {
    expect(
      canAssignCompanyCrew({
        actorRole: "production_manager",
        companyId: "company-a",
        requestedUserIds: ["crew-b"],
        memberships: members,
      }),
    ).toBe(false);
  });

  it("rejects non-crew memberships even when they belong to the company", () => {
    expect(
      canAssignCompanyCrew({
        actorRole: "production_manager",
        companyId: "company-a",
        requestedUserIds: ["sales-a"],
        memberships: members,
      }),
    ).toBe(false);
  });

  it("fails closed for missing company context, unknown users, and duplicate IDs", () => {
    const base = {
      actorRole: "production_manager",
      companyId: "company-a",
      memberships: members,
    };
    expect(canAssignCompanyCrew({ ...base, companyId: null, requestedUserIds: ["crew-a"] })).toBe(
      false,
    );
    expect(canAssignCompanyCrew({ ...base, requestedUserIds: ["unknown"] })).toBe(false);
    expect(canAssignCompanyCrew({ ...base, requestedUserIds: ["crew-a", "crew-a"] })).toBe(false);
  });

  it("does not treat an empty crew assignment as an authorization bypass", () => {
    expect(
      canAssignCompanyCrew({
        actorRole: "crew",
        companyId: "company-a",
        requestedUserIds: [],
        memberships: members,
      }),
    ).toBe(false);
  });
});
