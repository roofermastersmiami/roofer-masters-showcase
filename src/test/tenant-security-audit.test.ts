import { describe, expect, it } from "vitest";
import { hasPrivilegedPattern, isReviewed } from "../../scripts/tenant-security-audit-patterns.mjs";

describe("tenant security diff audit", () => {
  it("detects new SECURITY DEFINER SQL functions", () => {
    expect(hasPrivilegedPattern("CREATE FUNCTION public.example() SECURITY DEFINER")).toBe(true);
  });

  it("detects role checks and service-role server clients", () => {
    expect(hasPrivilegedPattern('supabase.rpc("has_any_role", args)')).toBe(true);
    expect(hasPrivilegedPattern("const { supabaseAdmin } = await import('./client.server')")).toBe(true);
  });

  it("ignores ordinary application code", () => {
    expect(hasPrivilegedPattern('const title = "Roof report";')).toBe(false);
  });

  it("requires explicit review annotation", () => {
    expect(isReviewed("// tenant-audit: reviewed — owner scoped and RLS enforced")).toBe(true);
    expect(isReviewed("SECURITY DEFINER")).toBe(false);
  });
});
