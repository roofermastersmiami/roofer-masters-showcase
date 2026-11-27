import { describe, expect, it } from "vitest";
import {
  BROWARD_COUNTY_PROFILE,
  BROWARD_CORAL_SPRINGS_RESIDENTIAL_PROFILE,
  BROWARD_FORT_LAUDERDALE_ROOFING_PROFILE,
  BROWARD_MIRAMAR_RESIDENTIAL_ROOFING_PROFILE,
  BROWARD_WESTON_ROOFING_PROFILE,
  BROWARD_DAVIE_ROOFING_PROFILE,
  BROWARD_MARGATE_ROOFING_PROFILE,
  BROWARD_HALLANDALE_ROOFING_PROFILE,
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


describe("Miramar residential roofing permit profile", () => {
  it("includes the official City roofing package documents and requires parcel verification", () => {
    const unverified = getPermitChecklist({
      profileId: BROWARD_MIRAMAR_RESIDENTIAL_ROOFING_PROFILE.id,
      projectKind: "reroof",
      roofingSystem: "metal",
      asOfDate: "2026-11-26",
    });
    expect(unverified.authorityConfirmed).toBe(false);
    expect(unverified.items.map((item) => item.id)).toContain("hoa-awareness");
    expect(unverified.items.map((item) => item.id)).toContain("roof-underlayment-affidavit");
    expect(unverified.items.map((item) => item.id)).toContain("roof-to-wall-mitigation");
    expect(unverified.items.map((item) => item.id)).toContain("asbestos-certificate");

    const verified = getPermitChecklist({
      profileId: BROWARD_MIRAMAR_RESIDENTIAL_ROOFING_PROFILE.id,
      projectKind: "reroof",
      roofingSystem: "metal",
      parcelAuthorityVerified: true,
      asOfDate: "2026-11-26",
    });
    expect(verified.authorityConfirmed).toBe(true);
    expect(verified.items.map((item) => item.id)).toContain("notice-of-commencement");
  });

  it("does not apply the residential City package to commercial reroofs, repairs, or new roofs", () => {
    for (const projectKind of ["commercial_reroof", "repair", "new_roof"] as const) {
      const result = getPermitChecklist({
        profileId: BROWARD_MIRAMAR_RESIDENTIAL_ROOFING_PROFILE.id,
        projectKind,
        parcelAuthorityVerified: true,
        asOfDate: "2026-11-26",
      });
      expect(result.authorityConfirmed).toBe(false);
      expect(result.items).toHaveLength(0);
    }
  });

  it("suppresses the 8th Edition Miramar package after December 30, 2026", () => {
    const result = getPermitChecklist({
      profileId: BROWARD_MIRAMAR_RESIDENTIAL_ROOFING_PROFILE.id,
      projectKind: "reroof",
      parcelAuthorityVerified: true,
      asOfDate: "2026-12-31",
    });
    expect(result.codeReferenceCurrent).toBe(false);
    expect(result.authorityConfirmed).toBe(false);
    expect(result.items).toHaveLength(0);
  });
});


describe("City of Margate roofing permit profile", () => {
  it("includes the City's roofing application, cost, asbestos, HVHZ, and product documents", () => {
    const result = getPermitChecklist({
      profileId: BROWARD_MARGATE_ROOFING_PROFILE.id,
      projectKind: "reroof",
      roofingSystem: "metal",
      parcelAuthorityVerified: true,
      asOfDate: "2026-11-26",
    });
    const ids = result.items.map((item) => item.id);
    expect(result.authorityConfirmed).toBe(true);
    expect(ids).toContain("margate-uniform-application");
    expect(ids).toContain("margate-proof-of-cost");
    expect(ids).toContain("margate-asbestos-certificate");
    expect(ids).toContain("margate-notice-of-commencement");
    expect(ids).toContain("margate-uniform-roof-package");
    expect(ids).toContain("margate-roof-to-wall-affidavit");
    expect(ids).toContain("margate-owner-notification");
    expect(ids).toContain("margate-hurricane-preparedness");
    expect(ids).toContain("margate-fire-classification");
    expect(ids).toContain("margate-product-approvals");
    expect(ids).toContain("margate-owner-builder-affidavit");
  });

  it("requires City parcel verification and suppresses expired code references", () => {
    const unverified = getPermitChecklist({
      profileId: BROWARD_MARGATE_ROOFING_PROFILE.id,
      projectKind: "reroof",
      asOfDate: "2026-11-26",
    });
    expect(unverified.authorityConfirmed).toBe(false);
    expect(unverified.warnings.join(" ")).toContain("inside City of Margate limits");

    const expired = getPermitChecklist({
      profileId: BROWARD_MARGATE_ROOFING_PROFILE.id,
      projectKind: "reroof",
      parcelAuthorityVerified: true,
      asOfDate: "2026-12-31",
    });
    expect(expired.codeReferenceCurrent).toBe(false);
    expect(expired.authorityConfirmed).toBe(false);
    expect(expired.items).toHaveLength(0);
  });
});

describe("Town of Davie roofing permit profile", () => {
  it("includes the Town's current roofing package and permit intake requirements", () => {
    const result = getPermitChecklist({
      profileId: BROWARD_DAVIE_ROOFING_PROFILE.id,
      projectKind: "reroof",
      roofingSystem: "metal",
      parcelAuthorityVerified: true,
      asOfDate: "2026-11-26",
    });
    const ids = result.items.map((item) => item.id);
    expect(result.authorityConfirmed).toBe(true);
    expect(ids).toContain("davie-online-submittal");
    expect(ids).toContain("davie-roofing-package");
    expect(ids).toContain("davie-rooftop-equipment");
    expect(ids).toContain("davie-product-approvals");
    expect(ids).toContain("davie-tin-cap-inspection");
    expect(ids).toContain("davie-peel-stick-inspection");
    expect(ids).toContain("davie-hurricane-mitigation-retrofit");
    expect(ids).not.toContain("davie-asbestos-responsibilities");
  });

  it("includes the Town's non-single-family reroof and commercial-only documents conditionally", () => {
    const multifamily = getPermitChecklist({
      profileId: BROWARD_DAVIE_ROOFING_PROFILE.id,
      projectKind: "multifamily_reroof",
      parcelAuthorityVerified: true,
      asOfDate: "2026-11-26",
    });
    const multiIds = multifamily.items.map((item) => item.id);
    expect(multiIds).toContain("davie-asbestos-responsibilities");
    expect(multiIds).toContain("davie-anchor-spacing-calculations");
    expect(multiIds).not.toContain("davie-hurricane-mitigation-retrofit");
    expect(multiIds).not.toContain("davie-commercial-reroof-statement");

    const commercial = getPermitChecklist({
      profileId: BROWARD_DAVIE_ROOFING_PROFILE.id,
      projectKind: "commercial_reroof",
      parcelAuthorityVerified: true,
      asOfDate: "2026-11-26",
    });
    const commercialIds = commercial.items.map((item) => item.id);
    expect(commercialIds).toContain("davie-asbestos-responsibilities");
    expect(commercialIds).toContain("davie-commercial-reroof-statement");
  });

  it("requires explicit Town parcel verification and suppresses expired code references", () => {
    const unverified = getPermitChecklist({
      profileId: BROWARD_DAVIE_ROOFING_PROFILE.id,
      projectKind: "reroof",
      asOfDate: "2026-11-26",
    });
    expect(unverified.authorityConfirmed).toBe(false);
    expect(unverified.warnings.join(" ")).toContain("inside Town of Davie limits");

    const expired = getPermitChecklist({
      profileId: BROWARD_DAVIE_ROOFING_PROFILE.id,
      projectKind: "reroof",
      parcelAuthorityVerified: true,
      asOfDate: "2026-12-31",
    });
    expect(expired.codeReferenceCurrent).toBe(false);
    expect(expired.authorityConfirmed).toBe(false);
    expect(expired.items).toHaveLength(0);
  });
});

describe("Weston roofing permit profile", () => {
  it("includes the City-listed roofing application and product approval requirements", () => {
    const result = getPermitChecklist({
      profileId: BROWARD_WESTON_ROOFING_PROFILE.id,
      projectKind: "reroof",
      roofingSystem: "metal",
      parcelAuthorityVerified: true,
      asOfDate: "2026-11-26",
    });
    expect(result.authorityConfirmed).toBe(true);
    expect(result.items.map((item) => item.id)).toContain("weston-uniform-application");
    expect(result.items.map((item) => item.id)).toContain("weston-product-approvals");
    expect(result.items.map((item) => item.id)).toContain("weston-hvhz-roof-application");
    expect(result.items.map((item) => item.id)).toContain("weston-owner-notification");
  });

  it("keeps non-single-family Weston reroof documents conditional", () => {
    const result = getPermitChecklist({
      profileId: BROWARD_WESTON_ROOFING_PROFILE.id,
      projectKind: "commercial_reroof",
      parcelAuthorityVerified: true,
      asOfDate: "2026-11-26",
    });
    const ids = result.items.map((item) => item.id);
    expect(ids).toContain("weston-asbestos-responsibility");
    expect(ids).toContain("weston-rooftop-gas-vent");
    expect(ids).toContain("weston-broward-rooftop-equipment");
  });

  it("includes Weston non-single-family documents on a multifamily / condominium reroof", () => {
    const result = getPermitChecklist({
      profileId: BROWARD_WESTON_ROOFING_PROFILE.id,
      projectKind: "multifamily_reroof",
      parcelAuthorityVerified: true,
      asOfDate: "2026-11-26",
    });
    const ids = result.items.map((item) => item.id);
    expect(ids).toContain("weston-asbestos-responsibility");
    expect(ids).toContain("weston-rooftop-gas-vent");
    expect(ids).toContain("weston-broward-rooftop-equipment");
  });

  it("does not require Weston non-single-family documents on a single-family reroof", () => {
    const result = getPermitChecklist({
      profileId: BROWARD_WESTON_ROOFING_PROFILE.id,
      projectKind: "reroof",
      parcelAuthorityVerified: true,
      asOfDate: "2026-11-26",
    });
    const ids = result.items.map((item) => item.id);
    expect(ids).not.toContain("weston-asbestos-responsibility");
    expect(ids).not.toContain("weston-rooftop-gas-vent");
    expect(ids).not.toContain("weston-broward-rooftop-equipment");
  });

  it("does not confirm Weston jurisdiction without parcel-boundary verification", () => {
    const result = getPermitChecklist({
      profileId: BROWARD_WESTON_ROOFING_PROFILE.id,
      projectKind: "reroof",
      asOfDate: "2026-11-26",
    });
    expect(result.authorityConfirmed).toBe(false);
    expect(result.warnings.join(" ")).toContain("inside City of Weston limits");
  });

  it("suppresses Weston's 8th Edition checklist after December 30, 2026", () => {
    const result = getPermitChecklist({
      profileId: BROWARD_WESTON_ROOFING_PROFILE.id,
      projectKind: "reroof",
      parcelAuthorityVerified: true,
      asOfDate: "2026-12-31",
    });
    expect(result.codeReferenceCurrent).toBe(false);
    expect(result.authorityConfirmed).toBe(false);
    expect(result.items).toHaveLength(0);
  });
});

describe("City of Hallandale Beach roofing permit profile", () => {
  it("includes the City's roof permit and reroof documents with conditional requirements", () => {
    const result = getPermitChecklist({
      profileId: BROWARD_HALLANDALE_ROOFING_PROFILE.id,
      projectKind: "reroof",
      roofingSystem: "metal",
      parcelAuthorityVerified: true,
      asOfDate: "2026-11-26",
    });
    const ids = result.items.map((item) => item.id);
    expect(result.authorityConfirmed).toBe(true);
    expect(ids).toContain("hallandale-building-permit");
    expect(ids).toContain("hallandale-hvhz-roofing-application");
    expect(ids).toContain("hallandale-product-approval");
    expect(ids).toContain("hallandale-fire-directory");
    expect(ids).toContain("hallandale-asbestos-certificate");
    expect(ids).toContain("hallandale-rooftop-equipment");
    expect(ids).toContain("hallandale-renailing-affidavit");
    expect(ids).toContain("hallandale-assessed-value");
    expect(ids).toContain("hallandale-hurricane-mitigation");
  });

  it("does not apply Hallandale reroof-only affidavits to a new roof or repair", () => {
    for (const projectKind of ["new_roof", "repair"] as const) {
      const result = getPermitChecklist({
        profileId: BROWARD_HALLANDALE_ROOFING_PROFILE.id,
        projectKind,
        parcelAuthorityVerified: true,
        asOfDate: "2026-11-26",
      });
      const ids = result.items.map((item) => item.id);
      expect(ids).not.toContain("hallandale-asbestos-certificate");
      expect(ids).not.toContain("hallandale-rooftop-equipment");
      expect(ids).not.toContain("hallandale-renailing-affidavit");
    }
  });

  it("requires City parcel verification and suppresses expired code references", () => {
    const unverified = getPermitChecklist({
      profileId: BROWARD_HALLANDALE_ROOFING_PROFILE.id,
      projectKind: "reroof",
      asOfDate: "2026-11-26",
    });
    expect(unverified.authorityConfirmed).toBe(false);
    expect(unverified.warnings.join(" ")).toContain("inside City of Hallandale Beach limits");

    const expired = getPermitChecklist({
      profileId: BROWARD_HALLANDALE_ROOFING_PROFILE.id,
      projectKind: "reroof",
      parcelAuthorityVerified: true,
      asOfDate: "2026-12-31",
    });
    expect(expired.codeReferenceCurrent).toBe(false);
    expect(expired.authorityConfirmed).toBe(false);
    expect(expired.items).toHaveLength(0);
  });
});
