import { describe, expect, it } from "vitest";
import { requireReadAccess } from "@/lib/mcp/access";
import { requireVisibleSection } from "@/lib/webmcp-navigation";
describe("agent read permissions", () => {
  it("only Owner and Accounting can read invoice money", () => {
    for (const role of ["admin", "accounting"])
      expect(() => requireReadAccess([role], "invoices")).not.toThrow();
    for (const role of ["office", "sales", "production_manager", "crew"])
      expect(() => requireReadAccess([role], "invoices")).toThrow();
  });
  it("crew cannot read global customer, lead or report records", () => {
    for (const capability of ["leads", "customers", "reports"] as const)
      expect(() => requireReadAccess(["crew"], capability)).toThrow();
  });
  it("Office and Sales read leads while production does not", () => {
    for (const role of ["office", "sales"])
      expect(() => requireReadAccess([role], "leads")).not.toThrow();
    expect(() => requireReadAccess(["production_manager"], "leads")).toThrow();
  });
  it("missing and unknown memberships grant nothing", () => {
    expect(() => requireReadAccess([], "customers")).toThrow();
    expect(() => requireReadAccess(["superuser"], "invoices")).toThrow();
  });
  it("browser tools reject unavailable sections before navigation", () => {
    expect(requireVisibleSection("measurements", ["", "measurements"])).toBe("measurements");
    expect(() => requireVisibleSection("invoices", ["my-jobs"])).toThrow();
    expect(() => requireVisibleSection(null, [""])).toThrow();
  });
});
