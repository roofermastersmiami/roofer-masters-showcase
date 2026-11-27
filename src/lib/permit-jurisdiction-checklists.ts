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
    appliesWhen: "Required by the official attachment matrix for low-slope and tile systems; for other systems, add when required by plan review or the approved assembly.",
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

export type PermitChecklistRequest = {
  profileId: string;
  roofingSystem?: RoofingSystem;
  projectKind?: PermitProjectKind;
  folio?: string | null;
};

export type PermitChecklistResult = {
  profile: JurisdictionPermitProfile;
  items: ChecklistItem[];
  requiredRoofingSections: string[];
  authorityConfirmed: boolean;
  warnings: string[];
};

/**
 * Return only the checklist items explicitly supported by the selected
 * authority's published source. An empty checklist is intentional when the
 * exact Broward AHJ / permit type has not been resolved.
 */
export function getPermitChecklist(request: PermitChecklistRequest): PermitChecklistResult {
  const profiles: Record<string, JurisdictionPermitProfile> = {
    [MIAMI_DADE_UNINCORPORATED_PROFILE.id]: MIAMI_DADE_UNINCORPORATED_PROFILE,
    [BROWARD_COUNTY_PROFILE.id]: BROWARD_COUNTY_PROFILE,
    [BROWARD_SUNRISE_RESIDENTIAL_PROFILE.id]: BROWARD_SUNRISE_RESIDENTIAL_PROFILE,
  };
  const profile = profiles[request.profileId];
  if (!profile) throw new Error("Select a supported permit jurisdiction profile.");

  const warnings: string[] = [profile.authorityWarning];\n  if (!request.projectKind || request.projectKind === "unknown") {\n    warnings.push("Set the project type so reroof-only documents are not treated as universally required.");\n  }
  let authorityConfirmed = true;
  if (profile.id === MIAMI_DADE_UNINCORPORATED_PROFILE.id && request.folio) {
    const normalizedFolio = request.folio.replace(/\\D/g, "");
    if (!normalizedFolio.startsWith("30")) {
      authorityConfirmed = false;
      warnings.push("The supplied folio does not begin with 30. Confirm the municipality / authority having jurisdiction; do not use the unincorporated County checklist.");
    }
  }
  if (profile.id === BROWARD_COUNTY_PROFILE.id) {
    authorityConfirmed = false;
    warnings.push("County-level routing is not a roofing document checklist. Confirm the exact municipality, project type, and permit intake checklist before filing.");
  }
  if (profile.id === BROWARD_SUNRISE_RESIDENTIAL_PROFILE.id && request.projectKind && request.projectKind !== "reroof") {
    authorityConfirmed = false;
    warnings.push("The Sunrise source covers residential structural roof / reroof work only; confirm requirements for this different project type.");
  }

  const roofSystem = request.roofingSystem ?? "other";
  const requiredRoofingSections = profile.id === MIAMI_DADE_UNINCORPORATED_PROFILE.id
    ? miamiDadeSections[roofSystem]
    : profile.id === BROWARD_SUNRISE_RESIDENTIAL_PROFILE.id
      ? ["A", "B", "D"]
      : [];

  const allowedIds = profile.id === MIAMI_DADE_UNINCORPORATED_PROFILE.id
    ? new Set(miamiDadeAttachmentIds[roofSystem])
    : new Set(profile.checklist.map((item) => item.id));
  const items = profile.checklist.filter((item) => allowedIds.has(item.id)).filter((item) => {
    if (item.id === "owner-roofing-notification") return request.projectKind === "reroof" || request.projectKind === "commercial_reroof";
    if (item.id === "notice-of-commencement" || item.id === "hurricane-mitigation-affidavit") return true;
    return true;
  });

  return { profile, items, requiredRoofingSections, authorityConfirmed, warnings };
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
