import { describe, expect, it } from "vitest";
import {
  BROWARD_COUNTY_PROFILE,
  BROWARD_SUNRISE_RESIDENTIAL_PROFILE,
  getPermitChecklist,
  MIAMI_DADE_UNINCORPORATED_PROFILE,
} from "@/lib/permit-jurisdiction-checklists";

describe("Miami-Dade unincorporated roofing checklist", () => {
  it("maps each roof system to the published uniform application sections", () => {
    const cases = [
      ["low_slope", ["A", "B", "C"]],
      ["asphalt_shingle", ["A", "B", "D"]],
      ["tile", ["A", "B", "D", "E"]],
      ["metal", ["A", "B", "D"]],
      ["wood_shake", ["A", "B", "D"]],
    ] as const;

    for (const [roofingSystem, sections] of cases) {
      const result = getPermitChecklist({
        profileId: MIAMI_DADE_UNINCORPORATED_PROFILE.id,
        roofingSystem,
        projectKind: "reroof",
        folio: "30-1234567",
      });
      expect(result.requiredRoofingSections).toEqual(sections);
      expect(result.authorityConfirmed).toBe(true);
      expect(result.items.some((item) => item.id === "owner-roofing-notification")).toBe(true);
    }
  });

  it("does not list reroof-only owner notification for new roof construction", () => {
    const result = getPermitChecklist({
      profileId: MIAMI_DADE_UNINCORPORATED_PROFILE.id,
      roofingSystem: "metal",
      projectKind: "new_roof",
    });
    expect(result.items.some((item) => item.id === "owner-roofing-notification")).toBe(false);
  });

  it("requires a verified folio before confirming the unincorporated County authority", () => {
    const result = getPermitChecklist({
      profileId: MIAMI_DADE_UNINCORPORATED_PROFILE.id,
      roofingSystem: "metal",
    });
    expect(result.authorityConfirmed).toBe(false);
    expect(result.warnings.some((warning) => warning.includes("Enter and verify the property folio"))).toBe(true);
  });

  it("flags a folio that does not match the County's unincorporated-property guidance", () => {
    const result = getPermitChecklist({
      profileId: MIAMI_DADE_UNINCORPORATED_PROFILE.id,
      roofingSystem: "metal",
      folio: "4942-01-001",
    });
    expect(result.authorityConfirmed).toBe(false);
    expect(result.warnings.some((warning) => warning.includes("does not begin with 30"))).toBe(true);
  });

  it("uses the attachment matrix to include structural calculations where listed", () => {
    const metal = getPermitChecklist({
      profileId: MIAMI_DADE_UNINCORPORATED_PROFILE.id,
      roofingSystem: "metal",
      folio: "30-1234567",
    });
    const shingle = getPermitChecklist({
      profileId: MIAMI_DADE_UNINCORPORATED_PROFILE.id,
      roofingSystem: "asphalt_shingle",
      folio: "30-1234567",
    });
    expect(metal.items.some((item) => item.id === "design-calculations")).toBe(true);
    expect(shingle.items.some((item) => item.id === "design-calculations")).toBe(false);
  });
});

describe("Broward authority routing", () => {
  it("does not pretend the County administers every Broward municipal permit", () => {
    const result = getPermitChecklist({ profileId: BROWARD_COUNTY_PROFILE.id });
    expect(result.authorityConfirmed).toBe(false);
    expect(result.items).toHaveLength(0);
    expect(result.warnings.join(" ")).toContain("exact municipality");
  });

  it("keeps the Sunrise checklist limited to residential reroof projects", () => {
    const residential = getPermitChecklist({
      profileId: BROWARD_SUNRISE_RESIDENTIAL_PROFILE.id,
      roofingSystem: "tile",
      projectKind: "reroof",
    });
    expect(residential.authorityConfirmed).toBe(true);
    expect(residential.items.map((item) => item.id)).toContain("asbestos-responsibilities");
    expect(residential.items.map((item) => item.id)).toContain("roof-product-approvals");

    const commercial = getPermitChecklist({
      profileId: BROWARD_SUNRISE_RESIDENTIAL_PROFILE.id,
      roofingSystem: "metal",
      projectKind: "commercial_reroof",
    });
    expect(commercial.authorityConfirmed).toBe(false);
    expect(commercial.warnings.join(" ")).toContain("residential structural roof / reroof");
  });

  it("does not apply the Sunrise reroof-only owner notice to new roof construction", () => {
    const result = getPermitChecklist({
      profileId: BROWARD_SUNRISE_RESIDENTIAL_PROFILE.id,
      projectKind: "new_roof",
    });
    expect(result.items.some((item) => item.id === "owner-roofing-notification")).toBe(false);
  });
});
