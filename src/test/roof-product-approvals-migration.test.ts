import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "drizzle/migrations/0050_company_roof_product_approvals.sql"),
  "utf8",
);
const journal = JSON.parse(
  readFileSync(resolve(process.cwd(), "drizzle/migrations/meta/_journal.json"), "utf8"),
);

describe("company-scoped roof product approval register", () => {
  it("registers migration 0050 after permit document storage", () => {
    const entry = journal.entries.find((item: { idx: number }) => item.idx === 50);
    const previous = journal.entries.find((item: { idx: number }) => item.idx === 49);
    expect(entry).toMatchObject({ idx: 50, tag: "0050_company_roof_product_approvals" });
    expect(entry.when).toBeGreaterThan(previous.when);
  });

  it("supports NOA, Florida Product Approval, UL and Fire Directory references", () => {
    expect(migration).toMatch(/'miami_dade_noa','florida_product_approval','ul_listing','fire_directory'/);
    expect(migration).toMatch(/hvhz_status IN \('yes','no','unknown'\)/);
    expect(migration).toMatch(/installation_limitations/);
    expect(migration).toMatch(/source_url/);
  });

  it("requires same-company application linkage and verification evidence", () => {
    expect(migration).toMatch(/FOREIGN KEY \(permit_application_id, company_id\)/);
    expect(migration).toMatch(/approval_status <> 'verified' OR \(verified_at IS NOT NULL AND verified_by IS NOT NULL\)/);
    expect(migration).toMatch(/approval_status <> 'expired' OR expires_on IS NOT NULL/);
  });

  it("forces company RLS and grants writes only to company admins", () => {
    expect(migration).toMatch(/ENABLE ROW LEVEL SECURITY/);
    expect(migration).toMatch(/FORCE ROW LEVEL SECURITY/);
    expect(migration).toMatch(/public\.is_crm_company_member\(company_id\)/);
    expect(migration).toMatch(/public\.is_crm_company_admin\(company_id\)/);
    expect(migration).toMatch(/REVOKE ALL ON public\.roof_product_approvals FROM PUBLIC, anon/);
  });
});
