import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(process.cwd(), "scripts/production-permit-readonly-preflight.sql"),
  "utf8",
);

describe("production permitting preflight is read-only and schema-drift tolerant", () => {
  it("checks the production ledger and guards optional tables before querying them", () => {
    expect(sql).toContain("to_regclass('drizzle.__drizzle_migrations')");
    expect(sql).toContain("\\if :has_migration_ledger");
    expect(sql).toContain("to_regclass('public.crm_companies')");
    expect(sql).toContain("to_regclass('storage.buckets')");
  });

  it("collects operational counts and company ownership coverage", () => {
    const ownershipChecks: Record<string, string> = {
      leads: "leads_has_company_id",
      crm_customers: "customers_has_company_id",
      crm_properties: "properties_has_company_id",
      roof_report_orders: "orders_has_company_id",
      roof_jobs: "roof_jobs_has_company_id",
    };
    for (const [table, variable] of Object.entries(ownershipChecks)) {
      expect(sql).toContain(`public.${table}`);
      expect(sql).toContain(variable);
    }
  });

  it("captures constraints, indexes, RLS, policies, triggers, functions, and storage", () => {
    for (const evidence of [
      "pg_constraint",
      "pg_indexes",
      "relforcerowsecurity",
      "pg_policies",
      "information_schema.triggers",
      "pg_get_functiondef",
      "storage.buckets",
    ])
      expect(sql).toContain(evidence);
  });

  it("contains no schema or data mutation statements", () => {
    const executable = sql.replace(/^\\echo.*$/gm, "").replace(/^--.*$/gm, "");
    expect(executable).not.toMatch(
      /^\s*(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE|CALL|COPY)\b/im,
    );
    expect(executable).toContain("BEGIN READ ONLY;");
    expect(executable).toContain("COMMIT;");
    expect(executable).toContain("SELECT current_database()");
    expect(executable).toContain("\\set ON_ERROR_STOP on");
  });

  it("captures the live tenant-security drift needed before a forward-only cutover", () => {
    for (const evidence of [
      "crm_company_memberships",
      "crm_company_branding",
      "is_crm_company_member",
      "is_crm_company_admin",
      "save_crm_customer",
      "create_roof_report_request",
      "p.proacl AS raw_acl",
      "pg_get_function_identity_arguments",
    ])
      expect(sql).toContain(evidence);

    expect(sql).toContain("FROM pg_policies");
    expect(sql).toContain("FROM pg_proc p");
    expect(sql).toContain("FROM pg_constraint c");
  });
});
