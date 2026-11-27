import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "drizzle/migrations/0052_product_approval_code_edition.sql"),
  "utf8",
);
const journal = JSON.parse(
  readFileSync(resolve(process.cwd(), "drizzle/migrations/meta/_journal.json"), "utf8"),
);

describe("product approval code edition tracking", () => {
  it("registers migration 0052 after NOC tracking", () => {
    const entry = journal.entries.find((item: { idx: number }) => item.idx === 52);
    const previous = journal.entries.find((item: { idx: number }) => item.idx === 51);
    expect(entry).toMatchObject({ idx: 52, tag: "0052_product_approval_code_edition" });
    expect(entry.when).toBeGreaterThan(previous.when);
  });
  it("keeps code edition unknown unless the approval source is cited", () => {
    expect(migration).toMatch(/DEFAULT 'unknown'/);
    expect(migration).toMatch(/'2023_8th','2026_9th','legacy','unknown'/);
    expect(migration).toMatch(/code_edition = 'unknown' OR code_edition_source_url IS NOT NULL/);
    expect(migration).toMatch(/not a compatibility determination/i);
  });
});
