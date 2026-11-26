import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "drizzle/migrations/0042_crm_company_ownership_foundation.sql"),
  "utf8",
);
const journal = JSON.parse(
  readFileSync(resolve(process.cwd(), "drizzle/migrations/meta/_journal.json"), "utf8"),
);

describe("CRM company ownership migration 0042", () => {
  it("is registered as the next sequential migration", () => {
    expect(journal.entries.at(-1)).toMatchObject({
      idx: 42,
      tag: "0042_crm_company_ownership_foundation",
      when: expect.any(Number),
    });
    expect(journal.entries.at(-1).when).toBeGreaterThan(journal.entries.at(-2).when);
  });

  it("fails closed unless exactly one legacy company and its owner membership exist", () => {
    expect(migration).toMatch(/company_count\s*<>\s*1/i);
    expect(migration).toMatch(/company_id\s*=\s*company_uuid/i);
    expect(migration).toMatch(/user_id\s*=\s*owner_uuid/i);
    expect(migration).toMatch(/role\s*=\s*'owner'/i);
  });

  it("backfills and requires company ownership on every core CRM record", () => {
    for (const table of ["leads", "crm_customers", "crm_properties", "roof_report_orders"]) {
      expect(migration).toMatch(new RegExp(`ALTER TABLE public\\.${table}[\\s\\S]*?ADD COLUMN IF NOT EXISTS company_id uuid`, "i"));
      expect(migration).toMatch(new RegExp(`UPDATE public\\.${table}[\\s\\S]*?SET company_id =`, "i"));
      expect(migration).toMatch(new RegExp(`ALTER TABLE public\\.${table} ALTER COLUMN company_id SET NOT NULL`, "i"));
    }
  });

  it("enforces same-company customer, lead, property, and report relationships", () => {
    expect(migration).toMatch(/crm_customers_source_lead_company_fkey/i);
    expect(migration).toContain("ON DELETE SET NULL (source_lead_id)");
    expect(migration).toContain("CONSTRAINT crm_properties_customer_company_fkey");
    expect(migration).toMatch(/leads_customer_company_fkey/i);
    expect(migration).toMatch(/crm_properties_customer_company_fkey/i);
    expect(migration).toMatch(/roof_report_orders_customer_company_fkey/i);
    expect(migration).toMatch(/roof_report_orders_property_company_fkey/i);
  });

  it("indexes company ownership and protects company parent rows", () => {
    for (const table of ["leads", "crm_customers", "crm_properties", "roof_report_orders"]) {
      expect(migration).toMatch(
        new RegExp(`CONSTRAINT ${table}_company_id_fkey[\\\\s\\\\S]*?ON DELETE RESTRICT`, "i"),
      );
      expect(migration).toContain(`CREATE INDEX IF NOT EXISTS ${table}_company_id_idx`);
    }
    for (const table of ["leads", "crm_customers", "crm_properties"]) {
      expect(migration).toContain(`CONSTRAINT ${table}_id_company_id_key UNIQUE (id, company_id)`);
    }
  });

  it("does not claim to enable tenant isolation before RLS and RPC migration", () => {
    expect(migration).toMatch(/NOT the tenant-isolation release gate/i);
    expect(migration).toMatch(/RLS policies remain unchanged/i);
    expect(migration).not.toMatch(/DROP POLICY|CREATE POLICY|FORCE ROW LEVEL SECURITY/i);
  });
});
