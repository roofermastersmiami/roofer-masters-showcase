import { describe, expect, it } from "vitest";
import { CRM_THEME_IDS, isCrmThemeId } from "@/lib/crm-theme";

describe("CRM theme preference validation", () => {
  it("accepts the original Roofer Masters default", () => {
    expect(isCrmThemeId("default")).toBe(true);
  });

  it("accepts all 15 named CRM palettes", () => {
    expect(CRM_THEME_IDS).toHaveLength(15);
    for (const theme of CRM_THEME_IDS) expect(isCrmThemeId(theme)).toBe(true);
  });

  it("rejects unknown, malformed, and non-string preferences", () => {
    for (const value of ["", "executive-berry-dark", "navy", null, undefined, 42, {}])
      expect(isCrmThemeId(value)).toBe(false);
  });
});
