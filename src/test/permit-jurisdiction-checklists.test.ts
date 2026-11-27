import { describe, expect, it } from "vitest";
import {
  BROWARD_COUNTY_PROFILE,
  BROWARD_CORAL_SPRINGS_RESIDENTIAL_PROFILE,
  BROWARD_FORT_LAUDERDALE_ROOFING_PROFILE,
  BROWARD_HOLLYWOOD_ROOFING_PROFILE,
  BROWARD_PEMBROKE_PINES_RESIDENTIAL_PROFILE,
  BROWARD_POMPANO_BEACH_ROOFING_PROFILE,
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
        parcelAuthorityVerified: true,
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

  it("requires manual parcel-record verification even when the folio begins with 30", () => {
    const result = getPermitChecklist({
      profileId: MIAMI_DADE_UNINCORPORATED_PROFILE.id,
      roofingSystem: "metal",
      projectKind: "reroof",
      folio: "30-1234567",
    });
    expect(result.authorityConfirmed).toBe(false);
    expect(result.warnings.join(" ")).toContain("Confirm the folio against the property record");
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

  it("stops serving the 2023-code checklist after the 9th Edition effective date", () => {
    const result = getPermitChecklist({
      profileId: MIAMI_DADE_UNINCORPORATED_PROFILE.id,
      roofingSystem: "metal",
      projectKind: "reroof",
      folio: "30-1234567",
      parcelAuthorityVerified: true,
      asOfDate: "2026-12-31",
    });
    expect(result.codeReferenceCurrent).toBe(false);
    expect(result.authorityConfirmed).toBe(false);
    expect(result.items).toHaveLength(0);
    expect(result.requiredRoofingSections).toHaveLength(0);
    expect(result.warnings.join(" ")).toContain("verify the current code edition");
  });

  it("uses the attachment matrix to include structural calculations where listed", () => {
    const metal = getPermitChecklist({
      profileId: MIAMI_DADE_UNINCORPORATED_PROFILE.id,
      roofingSystem: "metal",
      folio: "30-1234567",
      parcelAuthorityVerified: true,
    });
    const shingle = getPermitChecklist({
      profileId: MIAMI_DADE_UNINCORPORATED_PROFILE.id,
      roofingSystem: "asphalt_shingle",
      folio: "30-1234567",
      parcelAuthorityVerified: true,
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
    expect(residential.authorityConfirmed).toBe(false);
    expect(residential.warnings.join(" ")).toContain("inside City of Sunrise limits");
    expect(residential.items.map((item) => item.id)).toContain("asbestos-responsibilities");
    expect(residential.items.map((item) => item.id)).toContain("roof-product-approvals");
    expect(residential.requiredRoofingSections).toHaveLength(0);

    const commercial = getPermitChecklist({
      profileId: BROWARD_SUNRISE_RESIDENTIAL_PROFILE.id,
      roofingSystem: "metal",
      projectKind: "commercial_reroof",
    });
    expect(commercial.authorityConfirmed).toBe(false);
    expect(commercial.items).toHaveLength(0);
    expect(commercial.warnings.join(" ")).toContain("residential structural roof / reroof");
  });

  it("confirms Sunrise parcel authority only after an explicit property-boundary check", () => {
    const result = getPermitChecklist({
      profileId: BROWARD_SUNRISE_RESIDENTIAL_PROFILE.id,
      roofingSystem: "metal",
      projectKind: "reroof",
      parcelAuthorityVerified: true,
    });
    expect(result.authorityConfirmed).toBe(true);
    expect(result.requiredRoofingSections).toHaveLength(0);
  });

  it("does not confirm the Sunrise checklist until the reroof scope is selected", () => {
    const result = getPermitChecklist({
      profileId: BROWARD_SUNRISE_RESIDENTIAL_PROFILE.id,
      roofingSystem: "metal",
    });
    expect(result.authorityConfirmed).toBe(false);
    expect(result.warnings.join(" ")).toContain("residential structural roof / reroof");
  });

  it("does not apply the Sunrise reroof-only owner notice to new roof construction", () => {
    const result = getPermitChecklist({
      profileId: BROWARD_SUNRISE_RESIDENTIAL_PROFILE.id,
      projectKind: "new_roof",
    });
    expect(result.items).toHaveLength(0);
  });
});


describe("additional Broward city roofing profiles", () => {
  it("keeps Pembroke Pines checklist limited to residential reroof and requires parcel verification", () => {
    const unverified = getPermitChecklist({
      profileId: BROWARD_PEMBROKE_PINES_RESIDENTIAL_PROFILE.id,
      projectKind: "reroof",
      roofingSystem: "metal",
    });
    expect(unverified.authorityConfirmed).toBe(false);
    expect(unverified.items.map((item) => item.id)).toContain("hoa-awareness");
    expect(unverified.items.map((item) => item.id)).toContain("hvzh-roofing-package");

    const verified = getPermitChecklist({
      profileId: BROWARD_PEMBROKE_PINES_RESIDENTIAL_PROFILE.id,
      projectKind: "reroof",
      roofingSystem: "metal",
      parcelAuthorityVerified: true,
    });
    expect(verified.authorityConfirmed).toBe(true);

    const commercial = getPermitChecklist({
      profileId: BROWARD_PEMBROKE_PINES_RESIDENTIAL_PROFILE.id,
      projectKind: "commercial_reroof",
      parcelAuthorityVerified: true,
    });
    expect(commercial.authorityConfirmed).toBe(false);
    expect(commercial.items).toHaveLength(0);
  });

  it("supports Hollywood residential and commercial roofing with an explicit city-boundary check", () => {
    const residential = getPermitChecklist({
      profileId: BROWARD_HOLLYWOOD_ROOFING_PROFILE.id,
      projectKind: "reroof",
      roofingSystem: "metal",
    });
    expect(residential.authorityConfirmed).toBe(false);
    expect(residential.requiredRoofingSections).toHaveLength(0);
    expect(residential.items.map((item) => item.id)).toContain("asbestos-certificate");
    expect(residential.items.map((item) => item.id)).toContain("historic-district-photos");

    const verified = getPermitChecklist({
      profileId: BROWARD_HOLLYWOOD_ROOFING_PROFILE.id,
      projectKind: "commercial_reroof",
      roofingSystem: "metal",
      parcelAuthorityVerified: true,
    });
    expect(verified.authorityConfirmed).toBe(true);
    expect(verified.items.map((item) => item.id)).toContain("roof-testing-calculations");
  });

  it("suppresses the older-code city checklists after December 30, 2026", () => {
    for (const profileId of [BROWARD_PEMBROKE_PINES_RESIDENTIAL_PROFILE.id, BROWARD_HOLLYWOOD_ROOFING_PROFILE.id]) {
      const result = getPermitChecklist({
        profileId,
        projectKind: "reroof",
        roofingSystem: "metal",
        parcelAuthorityVerified: true,
        asOfDate: "2026-12-31",
      });
      expect(result.codeReferenceCurrent).toBe(false);
      expect(result.authorityConfirmed).toBe(false);
      expect(result.items).toHaveLength(0);
    }
  });
});


describe("Coral Springs residential reroof checklist", () => {
  it("requires city parcel confirmation and exposes only source-backed city checklist items", () => {
    const unverified = getPermitChecklist({
      profileId: BROWARD_CORAL_SPRINGS_RESIDENTIAL_PROFILE.id,
      projectKind: "reroof",
      roofingSystem: "tile",
      asOfDate: "2026-11-26",
    });
    expect(unverified.authorityConfirmed).toBe(false);
    expect(unverified.items.map((item) => item.id)).toContain("electronic-submittal");
    expect(unverified.items.map((item) => item.id)).toContain("zoning-addendum");
    expect(unverified.items.map((item) => item.id)).toContain("asbestos-srra");
    expect(unverified.items.map((item) => item.id)).toContain("preapproved-roof-materials");
    expect(unverified.items.map((item) => item.id)).toContain("roof-to-wall-interpretation");

    const verified = getPermitChecklist({
      profileId: BROWARD_CORAL_SPRINGS_RESIDENTIAL_PROFILE.id,
      projectKind: "reroof",
      roofingSystem: "metal",
      parcelAuthorityVerified: true,
      asOfDate: "2026-11-26",
    });
    expect(verified.authorityConfirmed).toBe(true);
    expect(verified.items.map((item) => item.id)).toContain("notice-of-commencement");
  });

  it("does not apply the residential reroof profile to repairs, new roofs, or commercial reroofs", () => {
    for (const projectKind of ["repair", "new_roof", "commercial_reroof"] as const) {
      const result = getPermitChecklist({
        profileId: BROWARD_CORAL_SPRINGS_RESIDENTIAL_PROFILE.id,
        projectKind,
        parcelAuthorityVerified: true,
        asOfDate: "2026-11-26",
      });
      expect(result.authorityConfirmed).toBe(false);
      expect(result.items).toHaveLength(0);
    }
  });

  it("suppresses the 8th Edition checklist after December 30, 2026", () => {
    const result = getPermitChecklist({
      profileId: BROWARD_CORAL_SPRINGS_RESIDENTIAL_PROFILE.id,
      projectKind: "reroof",
      parcelAuthorityVerified: true,
      asOfDate: "2026-12-31",
    });
    expect(result.codeReferenceCurrent).toBe(false);
    expect(result.authorityConfirmed).toBe(false);
    expect(result.items).toHaveLength(0);
  });
});

describe("Pompano Beach roofing checklist", () => {
  it("provides city-source requirements for residential and commercial roofing while requiring parcel verification", () => {
    const unverified = getPermitChecklist({
      profileId: BROWARD_POMPANO_BEACH_ROOFING_PROFILE.id,
      projectKind: "commercial_reroof",
      roofingSystem: "low_slope",
      asOfDate: "2026-11-26",
    });
    expect(unverified.authorityConfirmed).toBe(false);
    expect(unverified.items.map((item) => item.id)).toContain("hvzh-roofing-application");
    expect(unverified.items.map((item) => item.id)).toContain("wind-load-verification");
    expect(unverified.items.map((item) => item.id)).toContain("commercial-site-plan");
    expect(unverified.items.map((item) => item.id)).toContain("moisture-survey");

    const verified = getPermitChecklist({
      profileId: BROWARD_POMPANO_BEACH_ROOFING_PROFILE.id,
      projectKind: "reroof",
      roofingSystem: "metal",
      parcelAuthorityVerified: true,
      asOfDate: "2026-11-26",
    });
    expect(verified.authorityConfirmed).toBe(true);
    expect(verified.items.map((item) => item.id)).toContain("windstorm-mitigation-affidavit");
  });

  it("suppresses the 2023-code Pompano checklist after December 30, 2026", () => {
    const result = getPermitChecklist({
      profileId: BROWARD_POMPANO_BEACH_ROOFING_PROFILE.id,
      projectKind: "reroof",
      parcelAuthorityVerified: true,
      asOfDate: "2026-12-31",
    });
    expect(result.codeReferenceCurrent).toBe(false);
    expect(result.authorityConfirmed).toBe(false);
    expect(result.items).toHaveLength(0);
  });
});


describe("Fort Lauderdale roofing permit profile", () => {
  it("includes City-listed roofing forms and mandatory rooftop equipment affidavit", () => {
    const result = getPermitChecklist({
      profileId: BROWARD_FORT_LAUDERDALE_ROOFING_PROFILE.id,
      projectKind: "reroof",
      roofingSystem: "metal",
      parcelAuthorityVerified: true,
      asOfDate: "2026-11-26",
    });
    expect(result.authorityConfirmed).toBe(true);
    expect(result.items.map((item) => item.id)).toContain("city-roofing-checklist");
    expect(result.items.map((item) => item.id)).toContain("hvzh-roofing-application");
    expect(result.items.map((item) => item.id)).toContain("rooftop-equipment-affidavit");
    expect(result.items.find((item) => item.id === "rooftop-equipment-affidavit")?.appliesWhen).toContain("all roofing applications");
  });

  it("does not confirm Fort Lauderdale city authority without parcel-boundary verification", () => {
    const result = getPermitChecklist({
      profileId: BROWARD_FORT_LAUDERDALE_ROOFING_PROFILE.id,
      projectKind: "reroof",
      roofingSystem: "metal",
      asOfDate: "2026-11-26",
    });
    expect(result.authorityConfirmed).toBe(false);
    expect(result.warnings.join(" ")).toContain("inside City of Fort Lauderdale limits");
  });

  it("suppresses Fort Lauderdale's 8th Edition checklist after December 30, 2026", () => {
    const result = getPermitChecklist({
      profileId: BROWARD_FORT_LAUDERDALE_ROOFING_PROFILE.id,
      projectKind: "reroof",
      parcelAuthorityVerified: true,
      asOfDate: "2026-12-31",
    });
    expect(result.codeReferenceCurrent).toBe(false);
    expect(result.authorityConfirmed).toBe(false);
    expect(result.items).toHaveLength(0);
  });
});
