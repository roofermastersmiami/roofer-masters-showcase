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
    for (const table of ["leads", "crm_customers", "crm_properties", "roof_report_orders", "roof_jobs"]) {
      expect(sql).toContain(`public.${table}`);
      expect(sql).toContain(`${table}_has_company_id`);
    }
  });

  it("captures constraints, indexes, RLS, policies, triggers, functions, and storage", () => {
    for (const evidence of [
      "pg_constraint", "pg_indexes", "relforcerowsecurity", "pg_policies",
      "information_schema.triggers", "pg_get_functiondef", "storage.buckets",
    ]) expect(sql).toContain(evidence);
  });

  it("contains no schema or data mutation statements", () => {
    const executable = sql.replace(/^\\echo.*$/gm, "").replace(/^--.*$/gm, "");
    expect(executable).not.toMatch(/^\s*(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE|CALL|COPY)\b/im);
    expect(executable).toContain("SELECT current_database()");
    expect(executable).toContain("\\set ON_ERROR_STOP on");
  });
});
