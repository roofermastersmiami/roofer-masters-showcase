import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "drizzle/migrations/0068_permit_notifications.sql"),
  "utf8",
);
const journal = JSON.parse(
  readFileSync(resolve(process.cwd(), "drizzle/migrations/meta/_journal.json"), "utf8"),
);

describe("company-scoped permit notifications", () => {
  it("registers migration 0068 after the core role matrix", () => {
    const entry = journal.entries.find((item: { idx: number }) => item.idx === 68);
    const previous = journal.entries.find((item: { idx: number }) => item.idx === 67);
    expect(entry).toMatchObject({ idx: 68, tag: "0068_permit_notifications" });
    expect(entry.when).toBeGreaterThan(previous.when);
  });
  it("creates the notifications table with the automation kinds", () => {
    expect(migration).toMatch(/CREATE TABLE public\.crm_notifications/);
    expect(migration).toMatch(/'permit_status_changed'/);
    expect(migration).toMatch(/'inspection_scheduled'/);
    expect(migration).toMatch(/'inspection_result'/);
    expect(migration).toMatch(/'permit_expiring_soon'/);
    expect(migration).toMatch(/'permit_expired'/);
  });
  it("isolates rows by company and admin role", () => {
    expect(migration).toMatch(/FORCE ROW LEVEL SECURITY/);
    expect(migration).toMatch(/public\.is_crm_company_admin\(company_id\)/);
    expect(migration).toMatch(/FOREIGN KEY \(permit_application_id, company_id\)/);
    expect(migration).toMatch(/tenant-audit: reviewed/);
  });
  it("deduplicates expiration notifications per company and key", () => {
    expect(migration).toMatch(/CREATE UNIQUE INDEX crm_notifications_dedupe_key/);
    expect(migration).toMatch(/WHERE dedupe_key IS NOT NULL/);
  });
});
