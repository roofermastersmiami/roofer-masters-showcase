import { describe, expect, it } from "vitest";
import { resolvePublicLeadCompanyId } from "@/lib/public-lead-company";

const COMPANY_ID = "10000000-0000-4000-8000-000000000001";

describe("trusted public lead company routing", () => {
  it("accepts a configured UUID", () => {
    expect(resolvePublicLeadCompanyId(COMPANY_ID)).toBe(COMPANY_ID);
  });

  it("accepts uppercase UUID characters", () => {
    const uppercase = COMPANY_ID.toUpperCase();
    expect(resolvePublicLeadCompanyId(uppercase)).toBe(uppercase);
  });

  it("trims deployment configuration whitespace", () => {
    expect(resolvePublicLeadCompanyId(` ${COMPANY_ID} `)).toBe(COMPANY_ID);
  });

  it("fails closed when the server setting is absent", () => {
    expect(() => resolvePublicLeadCompanyId(undefined)).toThrow(/not configured/i);
    expect(() => resolvePublicLeadCompanyId("")).toThrow(/not configured/i);
  });

  it.each(["company-1", "not-a-uuid", "10000000-0000-4000-8000-00000000000z"])(
    "rejects malformed company IDs: %s",
    (value) => {
      expect(() => resolvePublicLeadCompanyId(value)).toThrow(/not configured/i);
    },
  );
});
