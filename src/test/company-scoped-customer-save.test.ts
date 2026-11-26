import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "drizzle/migrations/0044_company_scoped_customer_save.sql"),
  "utf8",
);
const journal = JSON.parse(
  readFileSync(resolve(process.cwd(), "drizzle/migrations/meta/_journal.json"), "utf8"),
);

describe("company-scoped customer save RPC", () => {
  it("registers migration 0044 after the trigger compatibility migration", () => {
    expect(journal.entries.at(-1)).toMatchObject({
      idx: 44,
      tag: "0044_company_scoped_customer_save",
    });
    expect(journal.entries.at(-1).when).toBeGreaterThan(journal.entries.at(-2).when);
  });

  it("fails closed unless the actor has exactly one company membership", () => {
    expect(migration).toMatch(/auth\.uid\(\) IS NULL/i);
    expect(migration).toMatch(/SELECT count\(\*\) INTO company_count/i);
    expect(migration).toMatch(/company_count <> 1/i);
  });

  it("authorizes by company membership role and scopes customer and source-lead access", () => {
    expect(migration).toMatch(/actor_role NOT IN \('owner','admin','office','sales'\)/i);
    expect(migration).toMatch(/WHERE id=cid AND company_id=actor_company_id/i);
    expect(migration).toMatch(/WHERE id=lid AND company_id=actor_company_id/i);
    expect(migration).toMatch(/INSERT INTO public\.leads\(company_id/i);
  });

  it("revokes public execution and grants only authenticated/service roles", () => {
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION public\.save_crm_customer\(jsonb\) FROM PUBLIC, anon, service_role/i);
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION public\.save_crm_customer\(jsonb\) TO authenticated/i);
    expect(migration).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.save_crm_customer\(jsonb\) TO [^;]*service_role/i);
  });
});
