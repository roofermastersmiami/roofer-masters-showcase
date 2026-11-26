import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "drizzle/migrations/0043_company_aware_lead_customer_sync.sql"),
  "utf8",
);
const journal = JSON.parse(
  readFileSync(resolve(process.cwd(), "drizzle/migrations/meta/_journal.json"), "utf8"),
);
const fixture = readFileSync(
  resolve(process.cwd(), "scripts/test-crm-company-ownership-migration.sql"),
  "utf8",
);

describe("company-aware lead/customer synchronization", () => {
  it("registers migration 0043 after ownership foundation 0042", () => {
    const entry = journal.entries.find((item: { idx: number }) => item.idx === 43);
    expect(entry).toMatchObject({
      idx: 43,
      tag: "0043_company_aware_lead_customer_sync",
      when: expect.any(Number),
    });
    expect(entry!.when).toBeGreaterThan(journal.entries[42].when);
  });

  it("requires a source company and propagates it to customers and properties", () => {
    expect(migration).toMatch(/IF NEW\.company_id IS NULL THEN[\s\S]*?RAISE EXCEPTION/i);
    expect(migration).toMatch(/INSERT INTO public\.crm_customers\s*\([\s\S]*?company_id/i);
    expect(migration).toMatch(/VALUES\s*\([\s\S]*?NEW\.company_id/i);
    expect(migration).toMatch(/INSERT INTO public\.crm_properties\s*\([\s\S]*?company_id/i);
    expect(migration).toMatch(/ON CONFLICT \(id\) DO UPDATE[\s\S]*?company_id = EXCLUDED\.company_id/i);
  });

  it("keeps the integration fixture exercising the real trigger migration", () => {
    expect(fixture).toContain("\\ir ../drizzle/migrations/0043_company_aware_lead_customer_sync.sql");
    expect(fixture).toMatch(/CREATE TRIGGER crm_sync_lead_customer[\s\S]*?sync_lead_customer\(\)/i);
    expect(fixture).toMatch(/Lead trigger failed to propagate company ownership/i);
  });

  it("does not change RLS or claim to complete tenant isolation", () => {
    expect(migration).not.toMatch(/DROP POLICY|CREATE POLICY|ENABLE ROW LEVEL SECURITY|FORCE ROW LEVEL SECURITY/i);
  });
});
