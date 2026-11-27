/**
 * Source-backed roofing permit intake references for South Florida.
 *
 * These are CRM preparation aids, not determinations of permit requirements.
 * Always resolve the actual authority having jurisdiction (AHJ) for the property
 * and confirm the current checklist with that building department before filing.
 */
export type RoofingSystem = "low_slope" | "asphalt_shingle" | "tile" | "metal" | "wood_shake" | "other";
export type PermitProjectKind = "reroof" | "new_roof" | "repair" | "commercial_reroof" | "unknown";

export type ChecklistItem = {
  id: string;
  label: string;
  detail: string;
  appliesWhen: string;
  sourceUrl: string;
};

export type JurisdictionPermitProfile = {
  id: string;
  label: string;
  county: "Miami-Dade" | "Broward";
  authorityScope: string;
  authorityWarning: string;
  codeEdition: string;
  codeEditionEffectiveThrough: string;
  sourceUrls: string[];
  checklist: ChecklistItem[];
};

const MIAMI_DADE_ROOFING_URL = "https://www.miamidade.gov/global/economy/building/roofing-permits.page";
const MIAMI_DADE_APPLY_URL = "https://www.miamidade.gov/global/economy/building/how-to-apply-for-permit.page";
const MIAMI_DADE_FORM_URL = "https://www.miamidade.gov/resources/economy/permits/documents/roofing-permit.pdf";
const BROWARD_BUILDING_URL = "https://www.broward.org/Building";
const BROWARD_EPERMITS_URL = "https://www.broward.org/epermits/ParticipatingCities";
const SUNRISE_CHECKLIST_URL = "https://www.sunrisefl.gov/home/showpublisheddocument/10756/638914730831870000";
const FBC_CODE_URL = "https://www.floridabuilding.org/fbc/commission/FBC_1226/Commission/Commission_Milestones_10132026.pdf";

const miamiDadeAttachments: ChecklistItem[] = [
  {
    id: "fire-directory-listing",
    label: "Fire Directory listing page",
    detail: "Attach the applicable Fire Directory listing page.",
    appliesWhen: "Listed in the Miami-Dade Uniform Roofing Permit attachment checklist for the selected roof system.",
    sourceUrl: MIAMI_DADE_FORM_URL,
  },
  {
    id: "product-approval-package",
    label: "Roof-system product approval package",
    detail: "Include the approval front page, specific system description and limitations, general limitations, and applicable detail drawings.",
    appliesWhen: "Listed for the selected Miami-Dade roof system; verify the exact approval and assembly against the proposed installation.",
    sourceUrl: MIAMI_DADE_FORM_URL,
  },
  {
    id: "design-calculations",
    label: "Design calculations",
    detail: "Chapter 16 calculations or, where applicable, RAS 127 / RAS 128 calculations.",
    appliesWhen: "Required by the official attachment matrix for low-slope, tile, and metal systems; for other systems, add when required by plan review or the approved assembly.",
    sourceUrl: MIAMI_DADE_FORM_URL,
  },
  {
    id: "component-approvals",
    label: "Other component product approvals",
    detail: "Provide approvals for applicable additional roof components.",
    appliesWhen: "Listed in the official attachment matrix for the selected roof system.",
    sourceUrl: MIAMI_DADE_FORM_URL,
  },
  {
    id: "municipal-application",
    label: "Municipal permit application",
    detail: "Complete the application required by the authority having jurisdiction.",
    appliesWhen: "Listed in the Miami-Dade Uniform Roofing Permit attachment checklist.",
    sourceUrl: MIAMI_DADE_FORM_URL,
  },
  {
    id: "owner-roofing-notification",
    label: "Owner notification for roofing considerations",
    detail: "Obtain the owner notification form required for reroofing.",
    appliesWhen: "Reroofing only.",
    sourceUrl: MIAMI_DADE_FORM_URL,
  },
  {
    id: "roof-testing-calculations",
    label: "Roof testing / additional calculations",
    detail: "Attach any roof testing or calculation documentation required for the proposed assembly.",
    appliesWhen: "When required for the specific roof system or by plan review.",
    sourceUrl: MIAMI_DADE_FORM_URL,
  },
];

const miamiDadeSections: Record<RoofingSystem, string[]> = {
  low_slope: ["A", "B", "C"],
  asphalt_shingle: ["A", "B", "D"],
  tile: ["A", "B", "D", "E"],
  metal: ["A", "B", "D"],
  wood_shake: ["A", "B", "D"],
  other: [],
};

const miamiDadeAttachmentIds: Record<RoofingSystem, string[]> = {
  low_slope: ["fire-directory-listing", "product-approval-package", "design-calculations", "component-approvals", "municipal-application", "owner-roofing-notification", "roof-testing-calculations"],
  asphalt_shingle: ["fire-directory-listing", "product-approval-package", "component-approvals", "municipal-application", "owner-roofing-notification", "roof-testing-calculations"],
  tile: ["fire-directory-listing", "product-approval-package", "design-calculations", "component-approvals", "municipal-application", "owner-roofing-notification", "roof-testing-calculations"],
  metal: ["fire-directory-listing", "product-approval-package", "design-calculations", "component-approvals", "municipal-application", "owner-roofing-notification", "roof-testing-calculations"],
  wood_shake: ["fire-directory-listing", "product-approval-package", "component-approvals", "municipal-application", "owner-roofing-notification", "roof-testing-calculations"],
  other: miamiDadeAttachments.map((item) => item.id),
};

export const MIAMI_DADE_UNINCORPORATED_PROFILE: JurisdictionPermitProfile = {
  id: "miami-dade-unincorporated",
  label: "Miami-Dade County — unincorporated area",
  county: "Miami-Dade",
  authorityScope: "Unincorporated Miami-Dade County properties. The County's permit application guidance identifies folios beginning with 30 for this process.",
  authorityWarning: "Do not use this county profile for a property inside a municipality. Miami-Dade municipalities have their own building officials and permit processes. Confirm the parcel jurisdiction before preparing the packet.",
  codeEdition: "Florida Building Code, 8th Edition (2023)",
  codeEditionEffectiveThrough: "2026-12-30",
  sourceUrls: [MIAMI_DADE_ROOFING_URL, MIAMI_DADE_APPLY_URL, MIAMI_DADE_FORM_URL, FBC_CODE_URL],
  checklist: miamiDadeAttachments,
};

const sunriseChecklist: ChecklistItem[] = [
  { id: "building-application", label: "Broward County Uniform Building Permit Application", detail: "Complete, sign, and notarize the structural building application.", appliesWhen: "Residential structural roof / reroof applications in the City of Sunrise checklist.", sourceUrl: SUNRISE_CHECKLIST_URL },
  { id: "owner-builder-affidavit", label: "Owner-builder affidavit", detail: "Submit the owner-builder affidavit when the owner is acting as contractor; Sunrise notes in-person signing at its Building Division.", appliesWhen: "Only when the owner is acting as contractor.", sourceUrl: SUNRISE_CHECKLIST_URL },
  { id: "hvzh-roof-application", label: "HVHZ Uniform Roofing Application and attachments", detail: "Complete the applicable sections and provide the attachments identified by FBC 2023 Section 1525.", appliesWhen: "Residential structural roof / reroof applications in the City of Sunrise checklist.", sourceUrl: SUNRISE_CHECKLIST_URL },
  { id: "rooftop-equipment-affidavit", label: "Mandatory rooftop-mounted equipment affidavit", detail: "Complete applicable sections and have the contractor or owner-builder sign and date.", appliesWhen: "Listed in the City of Sunrise residential roof checklist.", sourceUrl: SUNRISE_CHECKLIST_URL },
  { id: "roof-product-approvals", label: "Roof material product approvals", detail: "Provide Florida Product Approvals or Miami-Dade Notices of Acceptance for roof covering materials and applicable rooftop products such as vents and skylights.", appliesWhen: "For roof covering materials and products being installed on the roof.", sourceUrl: SUNRISE_CHECKLIST_URL },
  { id: "asbestos-responsibilities", label: "Asbestos Statement of Responsibilities", detail: "Obtain the Broward County Statement of Responsibilities Regarding Asbestos before commencing the reroof renovation work.", appliesWhen: "Listed for residential reroofs in the City of Sunrise checklist.", sourceUrl: SUNRISE_CHECKLIST_URL },
  { id: "notice-of-commencement", label: "Recorded Notice of Commencement", detail: "The City of Sunrise checklist cites a recorded Notice of Commencement when construction / renovation / alteration value exceeds $5,000.", appliesWhen: "Only when the stated value threshold is met; verify current law and local intake instructions before relying on this threshold.", sourceUrl: SUNRISE_CHECKLIST_URL },
  { id: "hurricane-mitigation-affidavit", label: "Hurricane mitigation affidavit", detail: "Select and complete the applicable option.", appliesWhen: "The City of Sunrise checklist states this is required when insured structure value is $300,000 or more; verify current local criteria.", sourceUrl: SUNRISE_CHECKLIST_URL },
  { id: "owner-roofing-notification", label: "Owner notification for roofing considerations", detail: "Obtain owner initials in all sections and signatures from owner and contractor.", appliesWhen: "Listed in the City of Sunrise residential roof checklist.", sourceUrl: SUNRISE_CHECKLIST_URL },
];

export const BROWARD_COUNTY_PROFILE: JurisdictionPermitProfile = {
  id: "broward-county-routing",
  label: "Broward County — authority routing",
  county: "Broward",
  authorityScope: "Broward County Building Code Division regulates unincorporated Broward County / Broward Municipal Services District and cities with which the County contracts.",
  authorityWarning: "Broward County is not the permit authority for every Broward address. Resolve the municipality and its building department first; use the county profile only for the County's service area or a confirmed participating arrangement.",
  codeEdition: "Florida Building Code, 8th Edition (2023)",
  codeEditionEffectiveThrough: "2026-12-30",
  sourceUrls: [BROWARD_BUILDING_URL, BROWARD_EPERMITS_URL, FBC_CODE_URL],
  checklist: [],
};

export const BROWARD_SUNRISE_RESIDENTIAL_PROFILE: JurisdictionPermitProfile = {
  id: "broward-sunrise-residential-reroof",
  label: "City of Sunrise — residential structural roof / reroof",
  county: "Broward",
  authorityScope: "City of Sunrise residential structural roof / reroof checklist, revision 5/2025.",
  authorityWarning: "This is a City of Sunrise checklist only. Do not apply it to other Broward municipalities or commercial projects without confirming their own current requirements.",
  codeEdition: "Florida Building Code, 8th Edition (2023)",
  codeEditionEffectiveThrough: "2026-12-30",
  sourceUrls: [SUNRISE_CHECKLIST_URL, BROWARD_EPERMITS_URL, FBC_CODE_URL],
  checklist: sunriseChecklist,
};


const pembrokePinesChecklist: ChecklistItem[] = [
  { id: "building-application", label: "Broward County Uniform Building Permit Application", detail: "Complete the current Broward County uniform building application.", appliesWhen: "Required by the City of Pembroke Pines residential re-roof checklist.", sourceUrl: "https://www.ppines.com/DocumentCenter/View/26288/Re-Roof-Permit-Checklist" },
  { id: "hoa-awareness", label: "Homeowners Association Affidavit of Awareness", detail: "Submit the affidavit even when the property is not part of an association.", appliesWhen: "Required by the City of Pembroke Pines residential re-roof checklist.", sourceUrl: "https://www.ppines.com/DocumentCenter/View/26288/Re-Roof-Permit-Checklist" },
  { id: "roof-to-wall-connection", label: "Roof-to-wall connection affidavit", detail: "Provide the affidavit when the home is insured or valued over $300,000; it must be completed by an eligible licensed or design professional.", appliesWhen: "When the insured or property value threshold in the current city checklist is met.", sourceUrl: "https://www.ppines.com/DocumentCenter/View/26288/Re-Roof-Permit-Checklist" },
  { id: "asbestos-release", label: "Asbestos release form", detail: "Include the applicable asbestos release documentation.", appliesWhen: "Listed in the City of Pembroke Pines residential re-roof checklist.", sourceUrl: "https://www.ppines.com/DocumentCenter/View/26288/Re-Roof-Permit-Checklist" },
  { id: "hvzh-roofing-package", label: "HVHZ roofing package", detail: "Complete the applicable High Velocity Hurricane Zone roofing forms and supporting attachments.", appliesWhen: "Listed in the City of Pembroke Pines residential re-roof checklist.", sourceUrl: "https://www.ppines.com/DocumentCenter/View/26288/Re-Roof-Permit-Checklist" },
  { id: "rooftop-equipment-affidavit", label: "Rooftop-mounted equipment affidavit", detail: "Submit the current rooftop-mounted equipment affidavit.", appliesWhen: "Listed in the City of Pembroke Pines residential re-roof checklist.", sourceUrl: "https://www.ppines.com/DocumentCenter/View/26288/Re-Roof-Permit-Checklist" },
  { id: "commercial-reroof-statement", label: "Commercial re-roofing statement", detail: "Use the city's commercial re-roofing statement for commercial projects; this profile itself is limited to residential reroofs.", appliesWhen: "Commercial projects only; confirm the commercial permit checklist separately.", sourceUrl: "https://www.ppines.com/1665/Information-Forms" },
  { id: "notice-of-commencement", label: "Recorded Notice of Commencement", detail: "Record, submit, and display before the first inspection when a non-mechanical project exceeds $5,000.", appliesWhen: "When the project value exceeds $5,000.", sourceUrl: "https://www.ppines.com/DocumentCenter/View/26288/Re-Roof-Permit-Checklist" },
];

const hollywoodChecklist: ChecklistItem[] = [
  { id: "building-application", label: "Broward County Uniform Building Permit Application", detail: "Complete the application with Building checked; the city's checklist identifies a licensed roofing contractor or owner-builder.", appliesWhen: "Residential and commercial roofing permit applications.", sourceUrl: "https://hollywoodfl.org/DocumentCenter/View/4770/COH-Roofing-Permit-Checklist--Application-Packet-91525" },
  { id: "hvzh-roofing-package", label: "HVHZ Uniform Roofing Permit Application", detail: "Complete the applicable sections and attachments for the proposed roof system.", appliesWhen: "Residential and commercial roofing permit applications.", sourceUrl: "https://hollywoodfl.org/DocumentCenter/View/4770/COH-Roofing-Permit-Checklist--Application-Packet-91525" },
  { id: "product-approval-package", label: "Product approval and Fire Directory listing", detail: "Provide current Miami-Dade NOA or Florida Product Approval with all elements identified, plus Fire Directory listing pages.", appliesWhen: "For the proposed roofing product and assembly.", sourceUrl: "https://hollywoodfl.org/DocumentCenter/View/4770/COH-Roofing-Permit-Checklist--Application-Packet-91525" },
  { id: "asbestos-certificate", label: "Broward County Asbestos Program Certificate of Submittal", detail: "Include the Broward County asbestos submittal certificate.", appliesWhen: "Listed in the City of Hollywood roofing checklist.", sourceUrl: "https://hollywoodfl.org/DocumentCenter/View/4770/COH-Roofing-Permit-Checklist--Application-Packet-91525" },
  { id: "site-plan", label: "Roofing site plan", detail: "Show proposed dumpster, tar kettle, and related staging locations; maintain fire-lane access.", appliesWhen: "When applicable; the checklist excludes single-family residences from this site-plan item.", sourceUrl: "https://hollywoodfl.org/DocumentCenter/View/4770/COH-Roofing-Permit-Checklist--Application-Packet-91525" },
  { id: "reroof-mitigation-affidavit", label: "Re-roof mitigation affidavit", detail: "Submit the completed re-roof mitigation affidavit and mandatory countywide rooftop-mounted affidavit.", appliesWhen: "Listed in the City of Hollywood roofing checklist.", sourceUrl: "https://hollywoodfl.org/DocumentCenter/View/4770/COH-Roofing-Permit-Checklist--Application-Packet-91525" },
  { id: "roof-testing-calculations", label: "Roof testing and engineering calculations", detail: "Provide field withdrawal resistance tests, moisture survey reports, wind-pressure calculations, or polyiso attachment calculations when applicable.", appliesWhen: "As required by the roof assembly, project conditions, or plan review.", sourceUrl: "https://hollywoodfl.org/DocumentCenter/View/4770/COH-Roofing-Permit-Checklist--Application-Packet-91525" },
  { id: "letter-of-authorization", label: "Letter of authorization", detail: "Provide authorization documentation when applicable, such as HOA approval.", appliesWhen: "When required for the property or project.", sourceUrl: "https://hollywoodfl.org/DocumentCenter/View/4770/COH-Roofing-Permit-Checklist--Application-Packet-91525" },
  { id: "notice-of-commencement", label: "Notice of Commencement", detail: "Submit the Notice of Commencement when the job value exceeds $5,000.", appliesWhen: "When the project value exceeds $5,000.", sourceUrl: "https://hollywoodfl.org/DocumentCenter/View/4770/COH-Roofing-Permit-Checklist--Application-Packet-91525" },
  { id: "historic-district-photos", label: "Existing roof photographs", detail: "Include photographs of the existing roof; the checklist notes roofing material in historic districts may remain the same or be upgraded, not downgraded.", appliesWhen: "Only for properties in a historic district.", sourceUrl: "https://hollywoodfl.org/DocumentCenter/View/4770/COH-Roofing-Permit-Checklist--Application-Packet-91525" },
];


export const BROWARD_PEMBROKE_PINES_RESIDENTIAL_PROFILE: JurisdictionPermitProfile = {
  id: "broward-pembroke-pines-residential-reroof",
  label: "City of Pembroke Pines — residential re-roof",
  county: "Broward",
  authorityScope: "City of Pembroke Pines residential re-roof checklist, revised February 19, 2026.",
  authorityWarning: "This profile is limited to residential re-roof intake in the City of Pembroke Pines. Confirm the parcel is inside city limits and check the live Building Department checklist before filing.",
  codeEdition: "Florida Building Code, 8th Edition (2023)",
  codeEditionEffectiveThrough: "2026-12-30",
  sourceUrls: ["https://www.ppines.com/DocumentCenter/View/26288/Re-Roof-Permit-Checklist", "https://www.ppines.com/1665/Information-Forms", FBC_CODE_URL],
  checklist: pembrokePinesChecklist,
};

export const BROWARD_HOLLYWOOD_ROOFING_PROFILE: JurisdictionPermitProfile = {
  id: "broward-hollywood-roofing",
  label: "City of Hollywood — residential / commercial roofing",
  county: "Broward",
  authorityScope: "City of Hollywood roofing checklist covering residential and commercial roofing permit applications.",
  authorityWarning: "Use only after verifying the parcel is inside City of Hollywood limits. The city notes project-specific additional items may apply; confirm the current Building Division packet before filing.",
  codeEdition: "Florida Building Code, 8th Edition (2023)",
  codeEditionEffectiveThrough: "2026-12-30",
  sourceUrls: ["https://hollywoodfl.org/DocumentCenter/View/4770/COH-Roofing-Permit-Checklist--Application-Packet-91525", "https://www.hollywoodfl.org/499/Applications-Forms", FBC_CODE_URL],
  checklist: hollywoodChecklist,
};

export type PermitChecklistRequest = {
  profileId: string;
  roofingSystem?: RoofingSystem;
  projectKind?: PermitProjectKind;
  folio?: string | null;
  asOfDate?: string;
  parcelAuthorityVerified?: boolean;
};

export type PermitChecklistResult = {
  profile: JurisdictionPermitProfile;
  items: ChecklistItem[];
  requiredRoofingSections: string[];
  authorityConfirmed: boolean;
  codeReferenceCurrent: boolean;
  warnings: string[];
};

/**
 * Return only the checklist items explicitly supported by the selected
 * authority's published source. An empty checklist is intentional when the
 * exact Broward AHJ / permit type has not been resolved.
 */
function southFloridaCalendarDate(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function getPermitChecklist(request: PermitChecklistRequest): PermitChecklistResult {
  const profiles: Record<string, JurisdictionPermitProfile> = {
    [MIAMI_DADE_UNINCORPORATED_PROFILE.id]: MIAMI_DADE_UNINCORPORATED_PROFILE,
    [BROWARD_COUNTY_PROFILE.id]: BROWARD_COUNTY_PROFILE,
    [BROWARD_SUNRISE_RESIDENTIAL_PROFILE.id]: BROWARD_SUNRISE_RESIDENTIAL_PROFILE,
    [BROWARD_PEMBROKE_PINES_RESIDENTIAL_PROFILE.id]: BROWARD_PEMBROKE_PINES_RESIDENTIAL_PROFILE,
    [BROWARD_HOLLYWOOD_ROOFING_PROFILE.id]: BROWARD_HOLLYWOOD_ROOFING_PROFILE,
  };
  const profile = profiles[request.profileId];
  if (!profile) throw new Error("Select a supported permit jurisdiction profile.");

  const warnings: string[] = [profile.authorityWarning];
  const asOfDate = request.asOfDate ?? southFloridaCalendarDate();
  const codeReferenceCurrent = asOfDate <= profile.codeEditionEffectiveThrough;
  if (!codeReferenceCurrent) {
    warnings.push(`This checklist references ${profile.codeEdition}. That reference expired after ${profile.codeEditionEffectiveThrough}; verify the current code edition and updated local forms before using any checklist item.`);
  }
  let authorityConfirmed = codeReferenceCurrent;
  if (!request.projectKind || request.projectKind === "unknown") {
    authorityConfirmed = false;
    warnings.push("Set the project type so reroof-only documents are not treated as universally required.");
  }
  if (profile.id === MIAMI_DADE_UNINCORPORATED_PROFILE.id) {
    if (!request.folio?.trim()) {
      authorityConfirmed = false;
      warnings.push("Enter and verify the property folio. The County identifies folios beginning with 30 for its unincorporated permit process.");
    } else {
      const normalizedFolio = request.folio.replace(/\D/g, "");
      if (!normalizedFolio.startsWith("30")) {
        authorityConfirmed = false;
        warnings.push("The supplied folio does not begin with 30. Confirm the municipality / authority having jurisdiction; do not use the unincorporated County checklist.");
      } else if (!request.parcelAuthorityVerified) {
        authorityConfirmed = false;
        warnings.push("Confirm the folio against the property record and verify the address is in unincorporated Miami-Dade before treating the County as the permit authority.");
      }
    }
  }
  if (profile.id === BROWARD_COUNTY_PROFILE.id) {
    authorityConfirmed = false;
    warnings.push("County-level routing is not a roofing document checklist. Confirm the exact municipality, project type, and permit intake checklist before filing.");
  }
  if (profile.id === BROWARD_SUNRISE_RESIDENTIAL_PROFILE.id) {
    if (!request.parcelAuthorityVerified) {
      authorityConfirmed = false;
      warnings.push("Verify the property is inside City of Sunrise limits and confirm its current checklist with the Sunrise Building Division before filing.");
    }
  }
  if (profile.id === BROWARD_SUNRISE_RESIDENTIAL_PROFILE.id && request.projectKind !== "reroof") {
    authorityConfirmed = false;
    warnings.push("The Sunrise source covers residential structural roof / reroof work only; confirm requirements for this different project type.");
  }

  const roofSystem = request.roofingSystem ?? "other";
  const residentialOnlyProfile = profile.id === BROWARD_SUNRISE_RESIDENTIAL_PROFILE.id || profile.id === BROWARD_PEMBROKE_PINES_RESIDENTIAL_PROFILE.id;
  const profileScopeSupported = !residentialOnlyProfile || request.projectKind === "reroof";
  const checklistEnabled = codeReferenceCurrent && profileScopeSupported;
  const requiredRoofingSections = !checklistEnabled ? [] : profile.id === MIAMI_DADE_UNINCORPORATED_PROFILE.id
    ? miamiDadeSections[roofSystem]
    : [];

  const allowedIds = profile.id === MIAMI_DADE_UNINCORPORATED_PROFILE.id
    ? new Set(miamiDadeAttachmentIds[roofSystem])
    : new Set(profile.checklist.map((item) => item.id));
  const items = (checklistEnabled ? profile.checklist : []).filter((item) => allowedIds.has(item.id)).filter((item) => {
    if (item.id === "owner-roofing-notification") return request.projectKind === "reroof" || request.projectKind === "commercial_reroof";
    if (item.id === "commercial-reroof-statement") return request.projectKind === "commercial_reroof";
    if (item.id === "notice-of-commencement" || item.id === "hurricane-mitigation-affidavit") return true;
    return true;
  });

  return { profile, items, requiredRoofingSections, authorityConfirmed, codeReferenceCurrent, warnings };
}

export const PERMIT_JURISDICTION_REFERENCE_SOURCES = {
  miamiDadeRoofingPermits: MIAMI_DADE_ROOFING_URL,
  miamiDadeHowToApply: MIAMI_DADE_APPLY_URL,
  miamiDadeUniformRoofingForm: MIAMI_DADE_FORM_URL,
  browardBuildingCode: BROWARD_BUILDING_URL,
  browardParticipatingCities: BROWARD_EPERMITS_URL,
  sunriseResidentialRoofChecklist: SUNRISE_CHECKLIST_URL,
  floridaBuildingCodeMilestones: FBC_CODE_URL,
} as const;
