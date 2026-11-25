import { describe, expect, it } from "vitest";
import { CRM_ACCENT_COLORS, getCrmAccent, isCrmAccentId } from "@/lib/crm-accent";

describe("CRM accent color preferences", () => {
  it("provides 20 distinct named accents with usable color values", () => {
    expect(CRM_ACCENT_COLORS).toHaveLength(20);
    expect(new Set(CRM_ACCENT_COLORS.map(({ id }) => id)).size).toBe(20);
    for (const color of CRM_ACCENT_COLORS) {
      expect(isCrmAccentId(color.id)).toBe(true);
      expect(color.value).toMatch(/^#[0-9a-f]{6}$/i);
      expect(color.label.length).toBeGreaterThan(1);
    }
  });

  it("rejects unknown and malformed preferences", () => {
    for (const value of ["", "pink", null, undefined, 20, {}])
      expect(isCrmAccentId(value)).toBe(false);
  });

  it("returns null rather than applying an unknown accent", () => {
    expect(getCrmAccent("not-a-color")).toBeNull();
  });
});
