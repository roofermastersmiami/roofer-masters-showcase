import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "drizzle/migrations/0051_company_permit_noc_tracking.sql"),
  "utf8",
);
const journal = JSON.parse(
  readFileSync(resolve(process.cwd(), "drizzle/migrations/meta/_journal.json"), "utf8"),
);

describe("company-scoped NOC tracking", () => {
  it("registers migration 0051 after product approvals", () => {
    const entry = journal.entries.find((item: { idx: number }) => item.idx === 51);
    const previous = journal.entries.find((item: { idx: number }) => item.idx === 50);
    expect(entry).toMatchObject({ idx: 51, tag: "0051_company_permit_noc_tracking" });
    expect(entry.when).toBeGreaterThan(previous.when);
  });
  it("does not infer a legal NOC threshold and requires recorded evidence", () => {
    expect(migration).toMatch(/does not calculate a statutory threshold/i);
    expect(migration).toMatch(/assessment_status IN \('not_assessed','required','not_required'\)/);
    expect(migration).toMatch(/recording_status <> 'recorded' OR/);
    expect(migration).toMatch(/instrument_number/);
    expect(migration).toMatch(/recorded_on IS NOT NULL/);
  });
  it("isolates records by company and admin role", () => {
    expect(migration).toMatch(/FOREIGN KEY \(permit_application_id, company_id\)/);
    expect(migration).toMatch(/FORCE ROW LEVEL SECURITY/);
    expect(migration).toMatch(/public\.is_crm_company_member\(company_id\)/);
    expect(migration).toMatch(/public\.is_crm_company_admin\(company_id\)/);
  });
});
