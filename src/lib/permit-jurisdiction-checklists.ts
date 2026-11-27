/**
 * Source-backed roofing permit intake references for South Florida.
 *
 * These are CRM preparation aids, not determinations of permit requirements.
 * Always resolve the actual authority having jurisdiction (AHJ) for the property
 * and confirm the current checklist with that building department before filing.
 */
export type RoofingSystem = "low_slope" | "asphalt_shingle" | "tile" | "metal" | "wood_shake" | "other";
export type PermitProjectKind = "reroof" | "multifamily_reroof" | "new_roof" | "repair" | "commercial_reroof" | "unknown";

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

const coralSpringsChecklist: ChecklistItem[] = [
  { id: "electronic-submittal", label: "Electronic permit submittal", detail: "The City stopped processing paper submittals effective January 1, 2026. Applications are submitted through the online portal; paper submissions may be converted to electronic format for a fee.", appliesWhen: "Applies to all residential re-roof applications under the current city process.", sourceUrl: "https://www.coralsprings.gov/files/assets/public/v/11/documents/building/checklists/013.0-roof-reroof-permit-application-checklist-ada.pdf" },
  { id: "building-application", label: "Broward County Building Permit Application", detail: "Complete the current building permit application.", appliesWhen: "Required for residential re-roof permit intake.", sourceUrl: "https://www.coralsprings.gov/files/assets/public/v/11/documents/building/checklists/013.0-roof-reroof-permit-application-checklist-ada.pdf" },
  { id: "zoning-addendum", label: "Building Permit Application Zoning Addendum", detail: "Complete the City of Coral Springs zoning addendum.", appliesWhen: "Required for residential re-roof permit intake.", sourceUrl: "https://www.coralsprings.gov/files/assets/public/v/11/documents/building/checklists/013.0-roof-reroof-permit-application-checklist-ada.pdf" },
  { id: "roofers-application-packet", label: "Roofers Application Packet", detail: "Complete the current city roofing application packet.", appliesWhen: "Required for residential re-roof permit intake.", sourceUrl: "https://www.coralsprings.gov/files/assets/public/v/11/documents/building/checklists/013.0-roof-reroof-permit-application-checklist-ada.pdf" },
  { id: "job-value", label: "Job value and itemized cost breakdown", detail: "List the job value on the permit application; an itemized cost breakdown may be requested.", appliesWhen: "Required job value; itemized breakdown when requested.", sourceUrl: "https://www.coralsprings.gov/files/assets/public/v/11/documents/building/checklists/013.0-roof-reroof-permit-application-checklist-ada.pdf" },
  { id: "product-approvals", label: "Roofing product approvals", detail: "Provide applicable approvals for roofing materials and accessories, including solar roof fans, roof vents, and skylights when present.", appliesWhen: "For products included in the proposed scope.", sourceUrl: "https://www.coralsprings.gov/files/assets/public/v/11/documents/building/checklists/013.0-roof-reroof-permit-application-checklist-ada.pdf" },
  { id: "asbestos-srra", label: "Statement of Responsibility Regarding Asbestos (SRRA)", detail: "Include the Broward County asbestos statement.", appliesWhen: "Listed in the city checklist.", sourceUrl: "https://www.coralsprings.gov/files/assets/public/v/11/documents/building/checklists/013.0-roof-reroof-permit-application-checklist-ada.pdf" },
  { id: "lightweight-concrete", label: "Lightweight concrete installation documentation", detail: "Provide the applicable lightweight concrete documentation.", appliesWhen: "Only when lightweight concrete installation applies.", sourceUrl: "https://www.coralsprings.gov/files/assets/public/v/11/documents/building/checklists/013.0-roof-reroof-permit-application-checklist-ada.pdf" },
  { id: "contractor-registration", label: "City contractor registration", detail: "Complete contractor registration requirements if the contractor is not already registered with the City.", appliesWhen: "Only if contractor is not registered with Coral Springs.", sourceUrl: "https://www.coralsprings.gov/files/assets/public/v/11/documents/building/checklists/013.0-roof-reroof-permit-application-checklist-ada.pdf" },
  { id: "owner-builder-affidavit", label: "Owner/Builder Affidavit Packet", detail: "Provide the city owner/builder affidavit packet.", appliesWhen: "Only for owner-builder applications.", sourceUrl: "https://www.coralsprings.gov/files/assets/public/v/11/documents/building/checklists/013.0-roof-reroof-permit-application-checklist-ada.pdf" },
  { id: "notice-of-commencement", label: "Notice of Commencement", detail: "Record and provide the Notice of Commencement before the first inspection.", appliesWhen: "When job value exceeds $5,000.", sourceUrl: "https://www.coralsprings.gov/files/assets/public/v/11/documents/building/checklists/013.0-roof-reroof-permit-application-checklist-ada.pdf" },
  { id: "rooftop-equipment-affidavit", label: "Rooftop Mounted Equipment Affidavit", detail: "Provide the rooftop-mounted equipment affidavit.", appliesWhen: "When rooftop-mounted equipment is present.", sourceUrl: "https://www.coralsprings.gov/files/assets/public/v/11/documents/building/checklists/013.0-roof-reroof-permit-application-checklist-ada.pdf" },
  { id: "preapproved-roof-materials", label: "Pre-Approved Roof Colors and Materials", detail: "Check the City's current pre-approved roof colors and materials before selecting tile or other regulated finish materials.", appliesWhen: "As applicable to the selected roof material and city design requirements.", sourceUrl: "https://www.coralsprings.gov/Government/Departments/Community-Development/Property-Guidelines/Property-Guidelines-old/Roofs" },
  { id: "asbestos-compliance", label: "Asbestos Compliance Program", detail: "Confirm and satisfy the Broward County Asbestos Compliance Program requirements.", appliesWhen: "Listed in the city checklist.", sourceUrl: "https://www.coralsprings.gov/files/assets/public/v/11/documents/building/checklists/013.0-roof-reroof-permit-application-checklist-ada.pdf" },
  { id: "roof-to-wall-interpretation", label: "Roof-to-wall retrofit interpretation", detail: "Review Broward County Board of Rules and Appeals Formal Interpretation #28 regarding retrofitting roof-to-wall connections.", appliesWhen: "Review for applicability to the existing roof-to-wall condition and proposed scope.", sourceUrl: "https://www.coralsprings.gov/files/assets/public/v/11/documents/building/checklists/013.0-roof-reroof-permit-application-checklist-ada.pdf" },
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

export const BROWARD_CORAL_SPRINGS_RESIDENTIAL_PROFILE: JurisdictionPermitProfile = {
  id: "broward-coral-springs-residential-reroof",
  label: "City of Coral Springs — residential re-roof",
  county: "Broward",
  authorityScope: "City of Coral Springs Building Department Roof / Re-Roof Permit Application Checklist, Form 013.0, revised October 26, 2026.",
  authorityWarning: "This profile is limited to residential roof / re-roof permit intake in the City of Coral Springs. Verify the parcel is inside city limits and confirm the current Building Department packet before filing. The City states its checklist is not all-inclusive.",
  codeEdition: "Florida Building Code, 8th Edition (2023)",
  codeEditionEffectiveThrough: "2026-12-30",
  sourceUrls: ["https://www.coralsprings.gov/files/assets/public/v/11/documents/building/checklists/013.0-roof-reroof-permit-application-checklist-ada.pdf", "https://www.coralsprings.gov/Government/Departments/Community-Development/Property-Guidelines/Property-Guidelines-old/Roofs", FBC_CODE_URL],
  checklist: coralSpringsChecklist,
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


const pompanoBeachRoofingChecklist: ChecklistItem[] = [
  { id: "building-application", label: "Broward County Uniform Building Permit Application", detail: "Complete the current Broward County uniform building application with Building selected.", appliesWhen: "Required for residential and commercial roofing permit applications.", sourceUrl: "https://cdn.pompanobeachfl.gov/city/pages/building_inspections/submittal_checklists/Roofing.pdf" },
  { id: "fire-review-application", label: "Fire Review Application", detail: "Submit the Fire Review Application for multi-family, condominium, and commercial projects.", appliesWhen: "Multi-family, condominium, and commercial projects; excluded for one- and two-family residences.", sourceUrl: "https://cdn.pompanobeachfl.gov/city/pages/building_inspections/submittal_checklists/Roofing.pdf" },
  { id: "hvzh-roofing-application", label: "HVHZ Uniform Permit Application", detail: "Complete the High Velocity Hurricane Zone Uniform Permit Application and all required attachments.", appliesWhen: "All roofing applications covered by the city checklist.", sourceUrl: "https://cdn.pompanobeachfl.gov/city/pages/building_inspections/submittal_checklists/Roofing.pdf" },
  { id: "roof-product-approvals", label: "Roofing product approvals and Fire Directory listings", detail: "Provide current Miami-Dade NOAs or Florida Product Approvals for roofing materials, underlayments, fasteners, and adhesives, including applicable Fire Directory listing pages.", appliesWhen: "For all products in the proposed roofing assembly.", sourceUrl: "https://cdn.pompanobeachfl.gov/city/pages/building_inspections/submittal_checklists/Roofing.pdf" },
  { id: "asbestos-certificate", label: "Broward County Asbestos Certificate of Submittal", detail: "Include the Broward County Asbestos Certificate of Submittal.", appliesWhen: "Listed in the City roofing checklist.", sourceUrl: "https://cdn.pompanobeachfl.gov/city/pages/building_inspections/submittal_checklists/Roofing.pdf" },
  { id: "commercial-site-plan", label: "Roofing site and fire-access plan", detail: "Show dumpster and equipment staging, fire apparatus access, exits, and fire-lane clearance. If using a tar kettle, show its location, LPG cylinders, and fire extinguishers.", appliesWhen: "Multi-family, condominium, and commercial projects; not one- or two-family residences.", sourceUrl: "https://cdn.pompanobeachfl.gov/city/pages/building_inspections/submittal_checklists/Roofing.pdf" },
  { id: "wind-load-verification", label: "Wind-load verification", detail: "Use the city's Fenestration Wind Load and Roof Uplift Chart for one- and two-family dwellings/townhomes; submit engineer-sealed wind-pressure calculations for multi-family, commercial, or non-prescriptive projects.", appliesWhen: "All projects, with documentation type determined by building/project classification.", sourceUrl: "https://cdn.pompanobeachfl.gov/city/pages/building_inspections/submittal_checklists/Roofing.pdf" },
  { id: "windstorm-mitigation-affidavit", label: "Roofing Affidavit for Windstorm Loss Mitigation", detail: "Document roof-to-wall connection compliance and any required enhancements by a licensed contractor.", appliesWhen: "Single-family residential structures and duplexes.", sourceUrl: "https://cdn.pompanobeachfl.gov/city/pages/building_inspections/submittal_checklists/Roofing.pdf" },
  { id: "rooftop-equipment-affidavit", label: "Rooftop Mounted Equipment Affidavit", detail: "Identify all rooftop-mounted equipment.", appliesWhen: "When rooftop equipment is present.", sourceUrl: "https://cdn.pompanobeachfl.gov/city/pages/building_inspections/submittal_checklists/Roofing.pdf" },
  { id: "polyiso-attachment-calculations", label: "Polyisocyanurate board attachment calculations", detail: "Provide calculations demonstrating compliance with fastening and uplift requirements.", appliesWhen: "When installing polyisocyanurate insulation boards.", sourceUrl: "https://cdn.pompanobeachfl.gov/city/pages/building_inspections/submittal_checklists/Roofing.pdf" },
  { id: "field-withdrawal-test", label: "Field withdrawal resistance test report", detail: "Provide test results for existing deck or fastener pull-out strength.", appliesWhen: "When field withdrawal resistance testing is used to verify deck or fastener capacity.", sourceUrl: "https://cdn.pompanobeachfl.gov/city/pages/building_inspections/submittal_checklists/Roofing.pdf" },
  { id: "moisture-survey", label: "Moisture survey report", detail: "Confirm the existing roof substrate is dry and suitable for reuse.", appliesWhen: "Roof recover or renovation projects.", sourceUrl: "https://cdn.pompanobeachfl.gov/city/pages/building_inspections/submittal_checklists/Roofing.pdf" },
  { id: "hoa-authorization", label: "Association authorization letter", detail: "Obtain a letter signed by an authorized association representative.", appliesWhen: "When work is proposed on property governed by a condominium or homeowners association.", sourceUrl: "https://cdn.pompanobeachfl.gov/city/pages/building_inspections/submittal_checklists/Roofing.pdf" },
];

export const BROWARD_POMPANO_BEACH_ROOFING_PROFILE: JurisdictionPermitProfile = {
  id: "broward-pompano-beach-roofing",
  label: "City of Pompano Beach — residential / commercial roofing",
  county: "Broward",
  authorityScope: "City of Pompano Beach roofing checklist for residential and commercial roof installation, replacement, and major repair.",
  authorityWarning: "Use only after verifying the parcel is inside City of Pompano Beach limits. This checklist is an intake aid; confirm current forms, code edition, and project-specific reviews with the City before filing.",
  codeEdition: "Florida Building Code, 8th Edition (2023)",
  codeEditionEffectiveThrough: "2026-12-30",
  sourceUrls: ["https://cdn.pompanobeachfl.gov/city/pages/building_inspections/submittal_checklists/Roofing.pdf", "https://www.pompanobeachfl.gov/government/building-inspections/applications-and-forms", "https://www.pompanobeachfl.gov/government/building-inspections/apply-for-a-new-permit", FBC_CODE_URL],
  checklist: pompanoBeachRoofingChecklist,
};


const fortLauderdaleRoofingChecklist: ChecklistItem[] = [
  { id: "broward-uniform-application", label: "Broward Uniform Building Permit Application", detail: "Complete the current Broward Uniform Building Permit Application for the City submission.", appliesWhen: "Required application form listed by the City for permitting.", sourceUrl: "https://www.fortlauderdale.gov/Government/Departments/Development-Services/DSD-Documents-Forms" },
  { id: "city-roofing-checklist", label: "City Roofing Permit Checklist", detail: "Download and complete the current City Roofing Permit Checklist; the City states the package must contain all applicable items before processing.", appliesWhen: "Roofing permit applications; verify the latest revision and project-specific applicability.", sourceUrl: "https://www.fortlauderdale.gov/Government/Departments/Development-Services/DSD-Documents-Forms" },
  { id: "hvzh-roofing-application", label: "HVHZ Uniform Permit Application / Roofing Application Packet", detail: "Complete the current High Velocity Hurricane Zone Uniform Permit Application and City Roofing Application Packet.", appliesWhen: "Roofing applications; use current forms from the City documents library.", sourceUrl: "https://www.fortlauderdale.gov/Government/Departments/Development-Services/DSD-Documents-Forms" },
  { id: "rooftop-equipment-affidavit", label: "Rooftop Equipment and Gas Vent Affidavit", detail: "Complete the affidavit. If mechanical equipment is relocated or replaced, obtain the required mechanical permit; new or altered equipment curbs/stands require engineered attachment plans. Existing gas vents must be inspected for leaks before roofing final.", appliesWhen: "Required by the City for all roofing applications.", sourceUrl: "https://www.fortlauderdale.gov/home/showpublisheddocument/1610/637372380321770000" },
  { id: "contractor-registration", label: "City contractor registration", detail: "Register the licensed professional and upload the state license or county certificate of competency, liability insurance, and workers' compensation certificate or exemption as applicable.", appliesWhen: "Before a contractor applies for permits through LauderBuild.", sourceUrl: "https://www.fortlauderdale.gov/Government/Departments/Development-Services/Permitting-Services/Contractors-Licensed-Professionals" },
  { id: "notice-of-commencement", label: "Notice of Commencement", detail: "Check the current statutory and City requirements, and record/display the NOC when applicable before the first inspection.", appliesWhen: "When required by project value and applicable law; confirm current threshold and recording instructions.", sourceUrl: "https://www.fortlauderdale.gov/Government/Departments/Development-Services/DSD-Documents-Forms" },
  { id: "wind-load-calculations", label: "Wind-load calculations", detail: "Use the City's wind-load calculation form when calculations are required for the proposed roof assembly or project review.", appliesWhen: "When required by the applicable code, assembly, or plan reviewer; the form listing alone does not make it universal.", sourceUrl: "https://www.fortlauderdale.gov/Government/Departments/Development-Services/DSD-Documents-Forms" },
];


const miramarRoofingChecklist: ChecklistItem[] = [
  { id: "building-application", label: "Complete City / Broward building permit application", detail: "Complete the current permit application and applicable roofing forms for the proposed scope.", appliesWhen: "Required for City of Miramar roofing permit intake.", sourceUrl: "https://www.miramarfl.gov/files/assets/public/v/3/buildingplanningzoning/documents/application-and-forms/roofing-package-fbc-2023-dec.-2024.pdf" },
  { id: "permit-valuation", label: "Roofing permit valuation", detail: "Provide the total project value, including labor and materials; the Building Official may request supporting valuation detail.", appliesWhen: "Required at application.", sourceUrl: "https://www.miramarfl.gov/files/assets/public/v/3/buildingplanningzoning/documents/application-and-forms/roofing-package-fbc-2023-dec.-2024.pdf" },
  { id: "hoa-awareness", label: "Homeowners Association Affidavit of Awareness", detail: "Complete the affidavit even when the property is not in a homeowners association.", appliesWhen: "Required by the City roofing package.", sourceUrl: "https://www.miramarfl.gov/files/assets/public/v/3/buildingplanningzoning/documents/application-and-forms/roofing-package-fbc-2023-dec.-2024.pdf" },
  { id: "roof-underlayment-affidavit", label: "Roof underlayment affidavit", detail: "Complete the City's roof underlayment affidavit for the applicable roof covering.", appliesWhen: "Shingle and metal roof systems, as identified in the City roofing package.", sourceUrl: "https://www.miramarfl.gov/Departments/Building-Planning-Zoning/Building-Permits-Inspections/Applications-Forms" },
  { id: "roof-to-wall-mitigation", label: "Roof-to-wall connection hurricane mitigation affidavit", detail: "Complete the City's roof-to-wall connection hurricane mitigation affidavit.", appliesWhen: "Listed in the City roofing package; confirm applicability to the existing structure and proposed scope with plan review.", sourceUrl: "https://www.miramarfl.gov/files/assets/public/v/3/buildingplanningzoning/documents/application-and-forms/roofing-package-fbc-2023-dec.-2024.pdf" },
  { id: "rooftop-equipment-affidavit", label: "Mandatory rooftop-mounted equipment affidavit", detail: "Complete the City's rooftop-mounted equipment affidavit.", appliesWhen: "Required by the City roofing package.", sourceUrl: "https://www.miramarfl.gov/files/assets/public/v/3/buildingplanningzoning/documents/application-and-forms/roofing-package-fbc-2023-dec.-2024.pdf" },
  { id: "debris-removal-affidavit", label: "Construction debris removal affidavit", detail: "Complete the affidavit included in the City's roofing package.", appliesWhen: "Required by City ordinance and listed in the roofing package.", sourceUrl: "https://www.miramarfl.gov/files/assets/public/v/3/buildingplanningzoning/documents/application-and-forms/roofing-package-fbc-2023-dec.-2024.pdf" },
  { id: "roof-product-approvals", label: "Roof-system product approval / NOA", detail: "Provide the applicable Florida Product Approval or Miami-Dade Notice of Acceptance for the roof system and components, including underlayment where applicable.", appliesWhen: "For the proposed shingles, tile, flat roof system, metal panels, underlayment, and other applicable products.", sourceUrl: "https://www.miramarfl.gov/files/assets/public/v/3/buildingplanningzoning/documents/application-and-forms/roofing-package-fbc-2023-dec.-2024.pdf" },
  { id: "hvzh-roofing-package", label: "HVHZ Uniform Roofing Application Package", detail: "Include the applicable roofing forms and attachments identified by FBC Section 1525; do not submit unrelated forms.", appliesWhen: "Required as applicable to the selected roof system and scope.", sourceUrl: "https://www.miramarfl.gov/files/assets/public/v/3/buildingplanningzoning/documents/application-and-forms/roofing-package-fbc-2023-dec.-2024.pdf" },
  { id: "asbestos-certificate", label: "Broward County Asbestos Certificate", detail: "Obtain the Broward County asbestos certificate and include it with the permit documents.", appliesWhen: "Listed in the City roofing package.", sourceUrl: "https://www.miramarfl.gov/files/assets/public/v/3/buildingplanningzoning/documents/application-and-forms/roofing-package-fbc-2023-dec.-2024.pdf" },
  { id: "owner-builder-affidavit", label: "Owner-builder disclosure statement", detail: "Provide the owner-builder disclosure and supporting proof of ownership, matching identification, and homestead verification where applicable. If a contractor is hired, that contractor must pull the permit.", appliesWhen: "Only for eligible residential owner-builder applications.", sourceUrl: "https://www.miramarfl.gov/files/assets/public/v/3/buildingplanningzoning/documents/application-and-forms/roofing-package-fbc-2023-dec.-2024.pdf" },
  { id: "digital-identical-documents", label: "Affidavit of Identical Documents", detail: "Include the affidavit with engineered plans and calculations submitted digitally with professional digital seals and signatures.", appliesWhen: "Only when engineered plans or calculations are submitted digitally.", sourceUrl: "https://www.miramarfl.gov/files/assets/public/v/3/buildingplanningzoning/documents/application-and-forms/roofing-package-fbc-2023-dec.-2024.pdf" },
  { id: "notice-of-commencement", label: "Recorded Notice of Commencement", detail: "Record and post the Notice of Commencement before the first inspection when the statutory project-value threshold applies; verify current statutory instructions.", appliesWhen: "The City package cites construction / renovation / alteration values over $5,000; confirm current law and applicability before relying on this threshold.", sourceUrl: "https://www.miramarfl.gov/files/assets/public/v/3/buildingplanningzoning/documents/application-and-forms/roofing-package-fbc-2023-dec.-2024.pdf" },
];


const westonRoofingChecklist: ChecklistItem[] = [
  { id: "weston-uniform-application", label: "Weston Building Code Services Uniform Permit Application Packet", detail: "Complete the City's Uniform Building Permit Application Packet and the Broward County Uniform Building Permit Application (BCUBPA).", appliesWhen: "Required for Weston roofing / reroof applications.", sourceUrl: "https://www.westonfl.org/home/showpublisheddocument/4725/639146974624870000" },
  { id: "weston-contract-valuation", label: "Signed contract and total job cost", detail: "Provide the contract or agreement showing the total project cost; retain the assessed building valuation from the Broward County Property Appraiser for the roofing package.", appliesWhen: "Required for all building permit applications and listed in the Weston roofing package.", sourceUrl: "https://www.westonfl.org/home/showpublisheddocument/4725/639146974624870000" },
  { id: "weston-product-approvals", label: "Roof-system product approvals", detail: "Provide product approvals with the components proposed for installation highlighted.", appliesWhen: "Required for reroof / roofing applications; include approvals for the actual selected roof system and components.", sourceUrl: "https://www.westonfl.org/home/showpublisheddocument/4725/639146974624870000" },
  { id: "weston-hvhz-roof-application", label: "HVHZ Uniform Roof Permit Application — FBC Section 1525", detail: "Complete the applicable HVHZ roofing application sections for the selected roof system.", appliesWhen: "Required roofing application package item; select only sections applicable to the roof assembly.", sourceUrl: "https://www.westonfl.org/government/forms-for-download" },
  { id: "weston-owner-notification", label: "Owner's Notification Form — FBC Section 1524", detail: "Include the required owner notification form for roofing considerations.", appliesWhen: "Listed in the City's roofing application package; confirm the current form and scope applicability with Building Code Services.", sourceUrl: "https://www.westonfl.org/government/forms-for-download" },
  { id: "weston-notice-of-commencement", label: "Notice of Commencement", detail: "Record and post the Notice of Commencement before the first inspection when the applicable statutory and City threshold is met. The City's general checklist states over $5,000; verify current Florida law and the project facts before relying on that threshold.", appliesWhen: "Weston's general building-permit checklist states project value over $5,000; statutory applicability must be confirmed for the specific project.", sourceUrl: "https://www.westonfl.org/home/showpublisheddocument/4725/639146974624870000" },
  { id: "weston-asbestos-responsibility", label: "Statement of Responsibilities Regarding Asbestos", detail: "Obtain and complete the asbestos responsibility form through Broward County Development and Regulation Division.", appliesWhen: "Weston lists this for reroofs other than single-family residences.", sourceUrl: "https://www.westonfl.org/home/showpublisheddocument/4725/639146974624870000" },
  { id: "weston-lightweight-concrete", label: "Lightweight Concrete Installation Packet", detail: "Provide the City's referenced lightweight concrete installation packet and supporting documents.", appliesWhen: "Only when lightweight concrete installation is part of the roof scope.", sourceUrl: "https://www.westonfl.org/home/showpublisheddocument/4725/639146974624870000" },
  { id: "weston-rooftop-gas-vent", label: "Weston Rooftop Equipment and Gas Vent Affidavit", detail: "Complete the Weston affidavit for rooftop equipment and gas vents.", appliesWhen: "Weston lists this for reroofs other than single-family residences; verify current applicability with the City.", sourceUrl: "https://www.westonfl.org/government/forms-for-download" },
  { id: "weston-broward-rooftop-equipment", label: "Broward County Rooftop Mounted Equipment Affidavit", detail: "Complete the Broward County rooftop mounted equipment affidavit.", appliesWhen: "Weston lists this for reroofs other than single-family residences; verify current applicability with the City.", sourceUrl: "https://www.westonfl.org/government/forms-for-download" },
];

const davieRoofingChecklist: ChecklistItem[] = [
  { id: "davie-online-submittal", label: "Town of Davie Online Application Submittal (OAS)", detail: "Start the permit request through the Town's OAS process; the Town states this is the required method for new permit and Building Division service requests from January 12, 2026, with plans and documents uploaded through ProjectDox after invitation.", appliesWhen: "Required by the current Town of Davie Building Division submission instructions; paper and direct-email submissions are not accepted.", sourceUrl: "https://www.davie-fl.gov/Pages/DavieFL_BuildngDpt/index" },
  { id: "davie-building-application", label: "Broward County Uniform Building Permit Application", detail: "Complete the current Broward County uniform building permit application.", appliesWhen: "Required by the Town of Davie roofing checklist; use the current revision from the Town's forms page.", sourceUrl: "https://www.davie-fl.gov/DocumentCenter/View/1836/Building-Permit-Application-" },
  { id: "davie-notarized-addendum", label: "Signed and notarized Town Addendum Form", detail: "Have the contractor or owner complete, sign, and notarize the Town addendum.", appliesWhen: "Required by the Town of Davie roofing checklist.", sourceUrl: "https://www.davie-fl.gov/DocumentCenter/View/11543/Roofing-Checklist" },
  { id: "davie-owner-builder-disclosure", label: "Owner-Builder Disclosure Statement", detail: "Submit the Town's owner-builder disclosure when the permit is filed as owner-builder.", appliesWhen: "Only when the owner is acting as contractor.", sourceUrl: "https://www.davie-fl.gov/1301/Building-Forms" },
  { id: "davie-property-ownership", label: "Broward County Property Appraiser ownership / property search", detail: "Include a copy of the property search or ownership record.", appliesWhen: "Listed in the Town of Davie roofing checklist.", sourceUrl: "https://www.davie-fl.gov/DocumentCenter/View/11543/Roofing-Checklist" },
  { id: "davie-roofing-package", label: "HVHZ Uniform Roofing Package", detail: "Complete the applicable roofing package sections for the selected system and work type. The current package includes low-slope, metal, tile, shingle, and wood systems, plus new roof, repair, maintenance, reroof, and recovery scope selections.", appliesWhen: "Required for roofing permit intake; complete only sections applicable to the proposed roof system and scope.", sourceUrl: "https://www.davie-fl.gov/DocumentCenter/View/15265/Roofing-Package" },
  { id: "davie-rooftop-equipment", label: "Mandatory Rooftop Mounted Equipment Affidavit", detail: "Identify all existing rooftop-mounted equipment, including applicable A/C equipment, photovoltaic panels, solar thermal, gas vents, waterlines, and electrical conduits. Separate permits may be required for removal and reinstallation of specified equipment.", appliesWhen: "Required with the HVHZ Uniform Roofing Permit Application for all rooftop equipment; submit the affidavit even when no equipment is present.", sourceUrl: "https://www.davie-fl.gov/DocumentCenter/View/18920/Rooftop-Mounted-Equipment-Affidavit---Roofing" },
  { id: "davie-product-approvals", label: "Roof-system product approvals / NOAs", detail: "Provide applicable product approvals for the installed roof assembly and components.", appliesWhen: "Required by the Town of Davie roofing checklist.", sourceUrl: "https://www.davie-fl.gov/DocumentCenter/View/11543/Roofing-Checklist" },
  { id: "davie-tile-uplift-test", label: "Adhesive-set tile uplift test", detail: "Arrange the required job-site uplift test for tile installed with adhesive.", appliesWhen: "Only when the proposed roof is tile set with adhesive.", sourceUrl: "https://www.davie-fl.gov/DocumentCenter/View/11543/Roofing-Checklist" },
  { id: "davie-workers-compensation", label: "Workers' compensation coverage and subcontractor documentation", detail: "Provide workers' compensation coverage showing the Town as certificate holder. If a subcontractor performs roofing work, include that subcontractor's workers' compensation policy and the contractor/subcontractor agreement.", appliesWhen: "Required by the Town roofing checklist; subcontractor documents apply when a subcontractor performs the work.", sourceUrl: "https://www.davie-fl.gov/DocumentCenter/View/11543/Roofing-Checklist" },
  { id: "davie-contractor-registration", label: "Town contractor registration and current credentials", detail: "Confirm Town registration and current state license or county certificate of competency, liability insurance, workers' compensation certificate or exemption, and business tax receipt.", appliesWhen: "For contractors not already registered with the Town; keep all applicable credentials current.", sourceUrl: "https://www.davie-fl.gov/1813/Contractor-Information" },
  { id: "davie-notice-of-commencement", label: "Notice of Commencement", detail: "Record and post the Notice of Commencement before the first inspection when the applicable value threshold and statutory conditions are met. The Town's general guidance cites an estimated value exceeding $5,000; verify current law and project applicability.", appliesWhen: "Conditional on project valuation and current statutory requirements; Town guidance states over $5,000.", sourceUrl: "https://www.davie-fl.gov/1224/General-Information" },
  { id: "davie-hurricane-mitigation-retrofit", label: "Single-family hurricane mitigation retrofit affidavit", detail: "Complete the Town's single-family residential hurricane mitigation retrofit form when applicable to the reroof scope.", appliesWhen: "Single-family residential reroofs only; confirm applicability under the current Florida Existing Building Code.", sourceUrl: "https://www.davie-fl.gov/DocumentCenter/View/20330/Roofing-Hurricane-Mitigation-Form" },
  { id: "davie-roof-to-wall-connection", label: "Roof-to-wall connection affidavit / retrofit documentation", detail: "Review the Town's current roof-to-wall form and provide the required affidavit, retrofit permit application, plans, photos, or value / permit-age documentation when the existing-building criteria apply.", appliesWhen: "Conditional under FBC Existing Building Section 706.8, including the applicable deck type, insured or just value, and prior permit history; do not treat as universally required.", sourceUrl: "https://www.davie-fl.gov/DocumentCenter/View/20331/Roof-to-Wall-Connection-Affidavit" },
  { id: "davie-asbestos-responsibilities", label: "Broward Statement of Responsibilities Regarding Asbestos", detail: "Obtain the asbestos responsibilities form from Broward County Development and Regulation Division.", appliesWhen: "Town roofing checklist lists this for reroofs other than single-family residences.", sourceUrl: "https://www.davie-fl.gov/DocumentCenter/View/11543/Roofing-Checklist" },
  { id: "davie-anchor-spacing-calculations", label: "Engineering calculations for anchor spacing", detail: "Provide engineering calculations for anchor spacing when required for the proposed roof assembly.", appliesWhen: "Town roofing checklist lists this for reroofs other than single-family residences, where required.", sourceUrl: "https://www.davie-fl.gov/DocumentCenter/View/11543/Roofing-Checklist" },
  { id: "davie-commercial-reroof-statement", label: "Commercial reroofing statement and structural / drainage review", detail: "Complete the commercial-only reroofing statement. Where a non-Group R-3 building changes roofing system or uses recovery, include signed and sealed supporting-structure and drainage calculations and the required professional statement.", appliesWhen: "Commercial reroof applications only; additional calculations depend on occupancy, roof-system change, and recovery scope.", sourceUrl: "https://www.davie-fl.gov/DocumentCenter/View/15265/Roofing-Package" },
  { id: "davie-tin-cap-inspection", label: "Tin-cap inspection before peel-and-stick", detail: "Obtain approval of the tin-cap inspection before installing any peel-and-stick underlayment.", appliesWhen: "Inspection sequencing item where tin cap / peel-and-stick work is part of the roofing assembly.", sourceUrl: "https://www.davie-fl.gov/DocumentCenter/View/11543/Roofing-Checklist" },
  { id: "davie-peel-stick-inspection", label: "Peel-and-stick inspection", detail: "Schedule the inspection one day ahead, during installation, or after installation but before loading tiles; if inspected during installation, the Town checklist describes minimum visible installation coverage and detailing.", appliesWhen: "Inspection sequencing item when peel-and-stick underlayment is installed.", sourceUrl: "https://www.davie-fl.gov/DocumentCenter/View/11543/Roofing-Checklist" },
];

const margateRoofingChecklist: ChecklistItem[] = [
  { id: "margate-uniform-application", label: "Broward County Uniform Building Permit Application", detail: "Complete and notarize the current Broward County Uniform Building Permit Application.", appliesWhen: "Listed as a minimum roofing permit application requirement; use the current revision.", sourceUrl: "https://www.margatefl.com/DocumentCenter/View/213/Roof-Permit-PDF" },
  { id: "margate-proof-of-cost", label: "Signed contract / documented labor and material cost", detail: "Provide a signed contract or other documented proof of project cost, including labor and materials. Owner-builders use the City's cost verification form with separate labor and materials amounts.", appliesWhen: "Required for contractor applications; owner-builder cost verification applies when the owner-builder exception is used.", sourceUrl: "https://www.margatefl.com/DocumentCenter/View/213/Roof-Permit-PDF" },
  { id: "margate-owner-builder-affidavit", label: "Owner-Builder Affidavit and proof of eligibility", detail: "Submit the City's notarized Owner-Builder Affidavit and supporting proof of ownership / residency when the property owner is acting as contractor.", appliesWhen: "Only for owner-builder applications.", sourceUrl: "https://www.margatefl.com/DocumentCenter/View/213/Roof-Permit-PDF" },
  { id: "margate-asbestos-certificate", label: "Broward County Certificate of Asbestos", detail: "Submit the Broward County asbestos certificate with the permit application.", appliesWhen: "Listed as a minimum permit application requirement in the City's roofing packet.", sourceUrl: "https://www.margatefl.com/DocumentCenter/View/213/Roof-Permit-PDF" },
  { id: "margate-notice-of-commencement", label: "Recorded Notice of Commencement", detail: "Record and post the Notice of Commencement before the first inspection when the applicable project value threshold is met.", appliesWhen: "The City's checklist states when job value is over $5,000; confirm current statutory applicability and record requirements.", sourceUrl: "https://www.margatefl.com/DocumentCenter/View/213/Roof-Permit-PDF" },
  { id: "margate-uniform-roof-package", label: "HVHZ Uniform Roofing Permit Package", detail: "Complete the applicable sections of the Broward County 8th Edition Uniform Roofing Application for the selected system and scope. The packet distinguishes low-slope, asphalt shingle, tile, metal, wood, and other systems.", appliesWhen: "Required minimum roofing submission; complete only sections and attachments applicable to the roof system.", sourceUrl: "https://www.margatefl.com/DocumentCenter/View/213/Roof-Permit-PDF" },
  { id: "margate-roof-to-wall-affidavit", label: "Owner's Roof-to-Wall Mitigation Affidavit", detail: "Complete and notarize the owner's roof-to-wall mitigation affidavit included in the City's roofing packet.", appliesWhen: "Listed as a minimum roofing permit application requirement; confirm project-specific applicability with the City.", sourceUrl: "https://www.margatefl.com/DocumentCenter/View/213/Roof-Permit-PDF" },
  { id: "margate-owner-notification", label: "HVHZ Owner's Notification for Roofing Considerations", detail: "Obtain signatures from both the owner and contractor on the required roofing considerations notification.", appliesWhen: "Reroofing only, as stated in the City's packet.", sourceUrl: "https://www.margatefl.com/DocumentCenter/View/213/Roof-Permit-PDF" },
  { id: "margate-hurricane-preparedness", label: "Hurricane Preparedness and Precautions Form", detail: "Complete the City's Hurricane Preparedness and Precautions form.", appliesWhen: "Listed as a minimum roofing permit application requirement.", sourceUrl: "https://www.margatefl.com/DocumentCenter/View/213/Roof-Permit-PDF" },
  { id: "margate-wind-load-calculations", label: "Engineer-signed wind-load calculations", detail: "Provide wind-load calculations signed by an engineer when required for the proposed roof assembly and project conditions.", appliesWhen: "Conditional; the City's packet says if applicable.", sourceUrl: "https://www.margatefl.com/DocumentCenter/View/213/Roof-Permit-PDF" },
  { id: "margate-fire-classification", label: "Roof assembly fire-classification / UL listing page", detail: "Include the fire-classification page or UL listing for the proposed roof assembly.", appliesWhen: "Listed in the City's minimum roofing documentation.", sourceUrl: "https://www.margatefl.com/DocumentCenter/View/213/Roof-Permit-PDF" },
  { id: "margate-product-approvals", label: "Highlighted Notice(s) of Acceptance and product approvals", detail: "Provide highlighted NOA / product approval documents and the applicable system description, limitations, and installation details.", appliesWhen: "Listed in the City's minimum roofing documentation; match approvals to the installed roof assembly and components.", sourceUrl: "https://www.margatefl.com/DocumentCenter/View/213/Roof-Permit-PDF" },
];
export const BROWARD_MARGATE_ROOFING_PROFILE: JurisdictionPermitProfile = {
  id: "broward-margate-roofing",
  label: "City of Margate — roofing",
  county: "Broward",
  authorityScope: "City of Margate Roofing Permit Application Checklist and roofing packet, revised March 2024. The embedded Broward County Uniform Building Permit Application was revised January 8, 2026 and effective March 9, 2026; confirm the City's live packet before filing.",
  authorityWarning: "Use only after verifying the parcel is inside City of Margate limits. This profile is a CRM intake aid, not a municipal determination or approval. Confirm current City forms, fees, and project-specific requirements before filing.",
  codeEdition: "Florida Building Code, 8th Edition (2023)",
  codeEditionEffectiveThrough: "2026-12-30",
  sourceUrls: ["https://www.margatefl.com/DocumentCenter/View/213/Roof-Permit-PDF"],
  checklist: margateRoofingChecklist,
};

export const BROWARD_DAVIE_ROOFING_PROFILE: JurisdictionPermitProfile = {
  id: "broward-davie-roofing",
  label: "Town of Davie — roofing",
  county: "Broward",
  authorityScope: "Town of Davie Building Division Roofing Checklist and Roofing Package. The Roofing Package was revised May 12, 2026; the checklist PDF is undated, so verify current forms and intake instructions before filing.",
  authorityWarning: "Use only after verifying the parcel is inside Town of Davie limits. The checklist and package are Town-specific CRM preparation aids, not municipal approval; confirm current requirements with the Town Building Division.",
  codeEdition: "Florida Building Code, 8th Edition (2023)",
  codeEditionEffectiveThrough: "2026-12-30",
  sourceUrls: ["https://www.davie-fl.gov/DocumentCenter/View/11543/Roofing-Checklist", "https://www.davie-fl.gov/DocumentCenter/View/15265/Roofing-Package", "https://www.davie-fl.gov/Pages/DavieFL_BuildngDpt/index", "https://www.davie-fl.gov/1225/Structural", "https://www.davie-fl.gov/1813/Contractor-Information", "https://www.davie-fl.gov/1224/General-Information"],
  checklist: davieRoofingChecklist,
};

export const BROWARD_WESTON_ROOFING_PROFILE: JurisdictionPermitProfile = {
  id: "broward-weston-roofing",
  label: "City of Weston — roofing",
  county: "Broward",
  authorityScope: "City of Weston Quick Permit Application Checklist / Requirements, revision May 2026. Covers roofing and reroof permit intake. The City identifies additional asbestos, lightweight concrete, and rooftop-equipment documents for reroofs other than single-family residences.",
  authorityWarning: "Use only after verifying the parcel is inside City of Weston limits. This is a CRM intake aid, not a municipal determination or approval. Confirm current forms and project-specific requirements with Weston Building Code Services before filing.",
  codeEdition: "Florida Building Code, 8th Edition (2023)",
  codeEditionEffectiveThrough: "2026-12-30",
  sourceUrls: ["https://www.westonfl.org/home/showpublisheddocument/4725/639146974624870000", "https://www.westonfl.org/government/forms-for-download"],
  checklist: westonRoofingChecklist,
};

export const BROWARD_MIRAMAR_RESIDENTIAL_ROOFING_PROFILE: JurisdictionPermitProfile = {
  id: "broward-miramar-residential-roofing",
  label: "City of Miramar — residential roofing",
  county: "Broward",
  authorityScope: "City of Miramar residential roofing application package, revision 01/2025. The package is specifically described for residential permits; confirm separate commercial and multifamily requirements with the City.",
  authorityWarning: "Use only after verifying the parcel is inside City of Miramar limits. This profile is a CRM intake aid, not a municipal determination or approval; check the live City roofing package and portal before filing.",
  codeEdition: "Florida Building Code, 8th Edition (2023)",
  codeEditionEffectiveThrough: "2026-12-30",
  sourceUrls: ["https://www.miramarfl.gov/files/assets/public/v/3/buildingplanningzoning/documents/application-and-forms/roofing-package-fbc-2023-dec.-2024.pdf", "https://www.miramarfl.gov/Departments/Building-Planning-Zoning/Building-Permits-Inspections/Applications-Forms", "https://www.miramarfl.gov/Departments/Building-Planning-Zoning/Building-Permits-Inspections"],
  checklist: miramarRoofingChecklist,
};

export const BROWARD_FORT_LAUDERDALE_ROOFING_PROFILE: JurisdictionPermitProfile = {
  id: "broward-fort-lauderdale-roofing",
  label: "City of Fort Lauderdale — roofing",
  county: "Broward",
  authorityScope: "City of Fort Lauderdale roofing permit intake. City permitting guidance lists Re-Roof — SFR, Duplex, Townhouse as a residential structural permit type; confirm separate commercial and multifamily requirements directly with the City.",
  authorityWarning: "Use only after verifying the parcel is inside City of Fort Lauderdale limits. The official documents library may update form revisions; check the live Roofing Permit Checklist and application packet before filing. This CRM profile does not replace City review.",
  codeEdition: "Florida Building Code, 8th Edition (2023)",
  codeEditionEffectiveThrough: "2026-12-30",
  sourceUrls: ["https://www.fortlauderdale.gov/Government/Departments/Development-Services/DSD-Documents-Forms", "https://www.fortlauderdale.gov/Government/Departments/Development-Services/Permitting-Services", "https://www.fortlauderdale.gov/Government/Departments/Development-Services/LauderBuild", "https://www.fortlauderdale.gov/home/showpublisheddocument/1610/637372380321770000"],
  checklist: fortLauderdaleRoofingChecklist,
};

const hallandaleRoofingChecklist: ChecklistItem[] = [
  { id: "hallandale-building-permit", label: "City building permit application", detail: "Submit the City building permit application and applicable roofing application packet.", appliesWhen: "Required permit application for the City's roof permit checklist.", sourceUrl: "https://hallandalebeachfl.gov/DocumentCenter/View/32554/Reroof-Permit-Checklist?bidId=" },
  { id: "hallandale-notice-of-commencement", label: "Notice of Commencement", detail: "Record and provide the Notice of Commencement when the job cost is $5,000 or more, as stated by the current roof checklist.", appliesWhen: "City roof checklist threshold; confirm current statutory applicability and timing.", sourceUrl: "https://hallandalebeachfl.gov/DocumentCenter/View/32554/Reroof-Permit-Checklist?bidId=" },
  { id: "hallandale-hvhz-roofing-application", label: "HVHZ Uniform Roofing Application Form", detail: "Complete the roofing packet and applicable HVHZ Uniform Roofing Application Form sections.", appliesWhen: "Minimum plan submittal for roofing permits.", sourceUrl: "https://hallandalebeachfl.gov/DocumentCenter/View/32554/Reroof-Permit-Checklist?bidId=" },
  { id: "hallandale-product-approval", label: "Miami-Dade NOA or Florida Product Approval", detail: "Provide the applicable product approval for the proposed roof system.", appliesWhen: "Minimum plan submittal; approval must match the proposed roof assembly.", sourceUrl: "https://hallandalebeachfl.gov/DocumentCenter/View/32554/Reroof-Permit-Checklist?bidId=" },
  { id: "hallandale-design-pressures", label: "Enhanced fastener calculations / design pressures", detail: "Provide digitally signed and sealed enhanced fastener calculations or design pressures.", appliesWhen: "When applicable to the proposed roof assembly or required by plan review.", sourceUrl: "https://hallandalebeachfl.gov/DocumentCenter/View/32554/Reroof-Permit-Checklist?bidId=" },
  { id: "hallandale-fire-directory", label: "Fire Directory listing", detail: "Provide the Fire Directory listing identifying a Class A roofing system and ensure listed components match the HVHZ roofing application.", appliesWhen: "Minimum plan submittal for the proposed roofing system.", sourceUrl: "https://hallandalebeachfl.gov/DocumentCenter/View/32554/Reroof-Permit-Checklist?bidId=" },
  { id: "hallandale-asbestos-certificate", label: "Broward asbestos responsibility certificate", detail: "Obtain the Statement of Responsibilities Regarding Asbestos Certificate through Broward County NRD e-Permits Online.", appliesWhen: "Reroof applications.", sourceUrl: "https://hallandalebeachfl.gov/DocumentCenter/View/32554/Reroof-Permit-Checklist?bidId=" },
  { id: "hallandale-insulation-replacement", label: "Roof insulation replacement documentation", detail: "Where the existing roof membrane includes insulation, replace it and ensure new thickness and R-value are at least equal to the existing insulation.", appliesWhen: "Reroof with an insulated roof membrane.", sourceUrl: "https://hallandalebeachfl.gov/DocumentCenter/View/32554/Reroof-Permit-Checklist?bidId=" },
  { id: "hallandale-rooftop-equipment", label: "Rooftop Equipment Affidavit", detail: "Complete the City's Rooftop Equipment Affidavit.", appliesWhen: "Reroof applications.", sourceUrl: "https://hallandalebeachfl.gov/DocumentCenter/View/32554/Reroof-Permit-Checklist?bidId=" },
  { id: "hallandale-renailing-affidavit", label: "Renailing Affidavit", detail: "Complete the City's renailing affidavit.", appliesWhen: "Reroof applications.", sourceUrl: "https://hallandalebeachfl.gov/DocumentCenter/View/32554/Reroof-Permit-Checklist?bidId=" },
  { id: "hallandale-assessed-value", label: "Broward assessed building valuation", detail: "Attach the Broward County Property Appraiser assessed building valuation.", appliesWhen: "Reroofs where assessed building value is $300,000 or more.", sourceUrl: "https://hallandalebeachfl.gov/DocumentCenter/View/32554/Reroof-Permit-Checklist?bidId=" },
  { id: "hallandale-hurricane-mitigation", label: "Hurricane Mitigation Form and Roof-to-Wall Affidavit", detail: "Complete the Hurricane Mitigation Form and attach a Roof-to-Wall Affidavit when necessary.", appliesWhen: "Reroofs where assessed building value is $300,000 or more; roof-to-wall affidavit as applicable.", sourceUrl: "https://hallandalebeachfl.gov/DocumentCenter/View/32554/Reroof-Permit-Checklist?bidId=" },
];
export const BROWARD_HALLANDALE_ROOFING_PROFILE: JurisdictionPermitProfile = {
  id: "broward-hallandale-roofing",
  label: "City of Hallandale Beach — roofing",
  county: "Broward",
  authorityScope: "City of Hallandale Beach Roof Permit Checklist approved August 1, 2024. The checklist covers roof permit submittals and additional reroof documents; confirm the live City forms and any updated code or intake requirements before filing.",
  authorityWarning: "Use only after verifying the parcel is inside City of Hallandale Beach limits. The checklist is a CRM intake aid, not a municipal determination or approval. The City states permit-related documents must be submitted through its online portal.",
  codeEdition: "Florida Building Code, 8th Edition (2023)",
  codeEditionEffectiveThrough: "2026-12-30",
  sourceUrls: ["https://hallandalebeachfl.gov/DocumentCenter/View/32554/Reroof-Permit-Checklist?bidId=", "https://hallandalebeachfl.gov/1271/Applications-Forms", "https://www.cohb.org/1316/Online-Services", "https://www.hallandalebeachfl.gov/1036/Building-Division/"],
  checklist: hallandaleRoofingChecklist,
};

const cityOfMiamiResidentialRoofingChecklist: ChecklistItem[] = [
  { id: "miami-city-roofing-permit", label: "City of Miami Building Roofing Permit", detail: "Apply for the City roofing permit and use the residential reroof applicant checklist for the selected roof system. The City's permit catalog says a building permit is required for all roofing work.", appliesWhen: "All roofing work; this profile's detailed checklist is intentionally limited to residential reroofs.", sourceUrl: "https://www.miami.gov/Permits-Construction/Permit-Catalog/Get-a-Roofing-Permit?lang_update=637748169458966676" },
  { id: "miami-city-uniform-roofing-application", label: "Uniform Roofing Application (PAP) and HVHZ form (RPF)", detail: "Complete the Uniform Roofing Application and HVHZ form. Include a dimensioned roof plan and slope; complete sections A, B and the applicable roof-system section.", appliesWhen: "Residential reroof; flat/low-slope uses sections A, B and C; shingle, tile and metal use sections A, B and D per the City's published checklists.", sourceUrl: "https://www.miami.gov/Permits-Construction/Digital-Permitting/Permitting-Forms-Documents" },
  { id: "miami-city-disclosure-statement", label: "Reroof disclosure statement", detail: "Include the City's disclosure statement on the HVHZ roof sketch page. The permit authorizes only the proposed reroof scope and does not legalize the attached structure.", appliesWhen: "Residential reroof; include the statement on the HVHZ roof sketch page.", sourceUrl: "https://www.miami.gov/files/assets/public/v/2/document-resources/pdf-docs/building/checklists/residential-permit-re-roofing-metal-roof-applicant-checklist_remediated.pdf" },
  { id: "miami-city-product-approval", label: "Miami-Dade NOA or Florida Product Approval", detail: "Provide the NOA or Florida Product Approval identifying the exact roof system to be installed.", appliesWhen: "Residential reroof; approval must match the selected system.", sourceUrl: "https://www.miami.gov/Permits-Construction/Permit-Catalog/Get-a-Roofing-Permit?lang_update=637748169458966676" },
  { id: "miami-city-ul-listing", label: "UL roof-system listing (BLD)", detail: "Provide the UL listing identifying the roof system proposed for installation.", appliesWhen: "Listed in the City's residential reroof applicant checklists.", sourceUrl: "https://www.miami.gov/files/assets/public/v/2/document-resources/pdf-docs/building/checklists/residential-permit-re-roofing-metal-roof-applicant-checklist_remediated.pdf" },
  { id: "miami-city-owner-notification", label: "Owner's Notification for Roofing Considerations — Form 1524", detail: "Complete the City owner-notification form for roofing considerations.", appliesWhen: "Listed in the City's residential reroof applicant checklists.", sourceUrl: "https://www.miami.gov/Permits-Construction/Digital-Permitting/Permitting-Forms-Documents" },
  { id: "miami-city-owner-affidavit-exemption", label: "Owner's Affidavit of Exemption (BLD)", detail: "Include the Owner's Affidavit of Exemption in the application package.", appliesWhen: "Listed in the City's residential reroof applicant checklists; confirm applicability for the specific owner and project.", sourceUrl: "https://www.miami.gov/Permits-Construction/Digital-Permitting/Permitting-Forms-Documents" },
  { id: "miami-city-eplan-upload", label: "ePlan document upload and file naming", detail: "Upload the signed application, NOAs, drawings and supporting documents to the correct ePlan folders. Follow the City's current file-naming and upload-complete instructions.", appliesWhen: "City of Miami online roofing permit application process.", sourceUrl: "https://www.miami.gov/Permits-Construction/Permit-Catalog/Get-a-Roofing-Permit?lang_update=637748169458966676" },
];
export const CITY_OF_MIAMI_RESIDENTIAL_ROOFING_PROFILE: JurisdictionPermitProfile = {
  id: "miami-city-residential-roofing",
  label: "City of Miami — residential reroof",
  county: "Miami-Dade",
  authorityScope: "City of Miami roofing permit guidance and residential applicant checklists for flat, shingle, tile, metal, and waterproofing reroofs. Detailed checklist scope is limited to residential reroofing; commercial roofing requires the City's applicable commercial submittal requirements.",
  authorityWarning: "Use only after confirming the property is inside City of Miami limits. The City says folios beginning with -01 are a City-limit clue, but the address/GIS or property record and City boundary must still be verified. This CRM profile is not a municipal determination or approval.",
  codeEdition: "Florida Building Code, 8th Edition (2023)",
  codeEditionEffectiveThrough: "2026-12-30",
  sourceUrls: ["https://www.miami.gov/Permits-Construction/Permit-Catalog/Get-a-Roofing-Permit?lang_update=637748169458966676", "https://www.miami.gov/My-Government/Departments/Building/Residential-Permit-Guide", "https://www.miami.gov/Permits-Construction/Digital-Permitting/Permitting-Forms-Documents", "https://www.miami.gov/files/assets/public/v/2/document-resources/pdf-docs/building/checklists/residential-permit-re-roofing-flat-roof-applicant-checklist_remediated.pdf", "https://www.miami.gov/files/assets/public/v/2/document-resources/pdf-docs/building/checklists/residential-permit-re-roofing-metal-roof-applicant-checklist_remediated.pdf"],
  checklist: cityOfMiamiResidentialRoofingChecklist,
};

const miamiGardensResidentialRoofingChecklist: ChecklistItem[] = [
  { id: "miami-gardens-residential-permit", label: "City permit application and fee sheet", detail: "Complete the City building permit application and include the current roofing permit fee sheet.", appliesWhen: "Residential roofing permit application.", sourceUrl: "https://www.miamigardens-fl.gov/DocumentCenter/View/7764/Roofing-Permit-Checklist" },
  { id: "miami-gardens-hoa-affidavit", label: "Homeowners Association Affidavit", detail: "Include the City's HOA affidavit in the residential roofing package.", appliesWhen: "Listed on the City's residential roofing checklist.", sourceUrl: "https://www.miamigardens-fl.gov/DocumentCenter/View/7764/Roofing-Permit-Checklist" },
  { id: "miami-gardens-workers-comp", label: "Workers' Compensation Exemption / coverage", detail: "Provide the applicable workers' compensation exemption or coverage documentation.", appliesWhen: "Listed on the City's residential roofing checklist.", sourceUrl: "https://www.miamigardens-fl.gov/DocumentCenter/View/7764/Roofing-Permit-Checklist" },
  { id: "miami-gardens-roof-wall", label: "Roof-to-Wall Connection Affidavit", detail: "Complete the City's roof-to-wall connection affidavit or applicable exemption.", appliesWhen: "Listed on the City's residential roofing checklist; confirm project-specific applicability.", sourceUrl: "https://www.miamigardens-fl.gov/DocumentCenter/View/7764/Roofing-Permit-Checklist" },
  { id: "miami-gardens-owner-notification", label: "Owner's Notification for Roofing Considerations", detail: "Include the owner notification document required in the HVHZ roofing package.", appliesWhen: "Reroofing only.", sourceUrl: "https://www.miamigardens-fl.gov/DocumentCenter/View/7598/Residential-Roofing-Complete-Packet-PDF" },
  { id: "miami-gardens-hvhz-package", label: "HVHZ Uniform Roofing Application package", detail: "Complete the applicable Uniform Roofing Application sections and attachments for the selected roof system.", appliesWhen: "Residential reroof; low-slope A/B/C, asphalt shingle A/B/D, tile A/B/D/E, metal A/B/D.", sourceUrl: "https://www.miamigardens-fl.gov/DocumentCenter/View/7598/Residential-Roofing-Complete-Packet-PDF" },
  { id: "miami-gardens-anchor-table", label: "Prescriptive anchor/base-sheet table or site-specific engineering", detail: "Provide the Miami-Dade prescriptive anchor/base-sheet attachment table or site-specific engineering calculations.", appliesWhen: "Listed on the City's residential roofing checklist; select the route applicable to the assembly.", sourceUrl: "https://www.miamigardens-fl.gov/DocumentCenter/View/7764/Roofing-Permit-Checklist" },
  { id: "miami-gardens-product-approvals", label: "Florida Product Approval / Miami-Dade NOA", detail: "Provide current product approval documentation for the exact roof system and components.", appliesWhen: "Listed on the City's residential roofing checklist.", sourceUrl: "https://www.miamigardens-fl.gov/DocumentCenter/View/7764/Roofing-Permit-Checklist" },
  { id: "miami-gardens-ul-listing", label: "UL Listings", detail: "Include the applicable UL listing information for the proposed roof system.", appliesWhen: "Listed on the City's residential roofing checklist.", sourceUrl: "https://www.miamigardens-fl.gov/DocumentCenter/View/7764/Roofing-Permit-Checklist" },
  { id: "miami-gardens-osha-ladder", label: "OSHA Ladder Information Sheet", detail: "Include the City's OSHA ladder information sheet.", appliesWhen: "Listed on the City's residential roofing checklist.", sourceUrl: "https://www.miamigardens-fl.gov/DocumentCenter/View/7764/Roofing-Permit-Checklist" },
  { id: "miami-gardens-noc", label: "Notice of Commencement", detail: "Record, submit, and display the NOC before scheduling the first inspection for non-mechanical projects valued over $5,000; verify current statutory applicability.", appliesWhen: "Non-mechanical project with job value over $5,000, before first inspection.", sourceUrl: "https://www.miamigardens-fl.gov/DocumentCenter/View/7764/Roofing-Permit-Checklist" },
];
export const CITY_OF_MIAMI_GARDENS_RESIDENTIAL_ROOFING_PROFILE: JurisdictionPermitProfile = {
  id: "miami-gardens-residential-roofing",
  label: "City of Miami Gardens — residential reroof",
  county: "Miami-Dade",
  authorityScope: "City of Miami Gardens residential roofing checklist and 8th Edition HVHZ residential roofing packet. Limited to residential reroofs.",
  authorityWarning: "Use only after verifying the property is inside City of Miami Gardens limits against official parcel / boundary records. This CRM profile is an intake aid, not a municipal determination or approval.",
  codeEdition: "Florida Building Code, 8th Edition (2023)",
  codeEditionEffectiveThrough: "2026-12-30",
  sourceUrls: ["https://www.miamigardens-fl.gov/DocumentCenter/View/7764/Roofing-Permit-Checklist", "https://www.miamigardens-fl.gov/DocumentCenter/View/7598/Residential-Roofing-Complete-Packet-PDF", "https://www.miamigardens-fl.gov/193/Documents-Forms"],
  checklist: miamiGardensResidentialRoofingChecklist,
};

const miamiGardensCommercialRoofingChecklist: ChecklistItem[] = [
  { id: "miami-gardens-commercial-permit", label: "City permit application and fee sheet", detail: "Complete the City building permit application and include the current roofing permit fee sheet.", appliesWhen: "Commercial roofing permit application.", sourceUrl: "https://www.miamigardens-fl.gov/DocumentCenter/View/7775/Commercial-Roofing-Permit-Checklist" },
  { id: "miami-gardens-commercial-reroof-affidavit", label: "Commercial Re-Roofing Affidavit", detail: "Complete the City's commercial reroofing affidavit.", appliesWhen: "Commercial reroofing.", sourceUrl: "https://www.miamigardens-fl.gov/DocumentCenter/View/7775/Commercial-Roofing-Permit-Checklist" },
  { id: "miami-gardens-commercial-asbestos", label: "Asbestos Release Form — Commercial Roofs", detail: "Include the asbestos release form identified by the City for commercial roofs.", appliesWhen: "Commercial roofing checklist.", sourceUrl: "https://www.miamigardens-fl.gov/DocumentCenter/View/7775/Commercial-Roofing-Permit-Checklist" },
  { id: "miami-gardens-commercial-hvhz", label: "HVHZ Uniform Roofing Application package", detail: "Complete the applicable HVHZ roofing package for the proposed commercial roof system.", appliesWhen: "Commercial reroofing.", sourceUrl: "https://www.miamigardens-fl.gov/DocumentCenter/View/7598/Residential-Roofing-Complete-Packet-PDF" },
  { id: "miami-gardens-commercial-engineering", label: "Site-specific engineering calculations", detail: "Provide site-specific engineering calculations for the commercial roof project.", appliesWhen: "Listed on the City's commercial roofing checklist.", sourceUrl: "https://www.miamigardens-fl.gov/DocumentCenter/View/7775/Commercial-Roofing-Permit-Checklist" },
  { id: "miami-gardens-commercial-product-approvals", label: "Product approvals", detail: "Provide product approvals for the proposed roof system and components.", appliesWhen: "Listed on the City's commercial roofing checklist.", sourceUrl: "https://www.miamigardens-fl.gov/DocumentCenter/View/7775/Commercial-Roofing-Permit-Checklist" },
  { id: "miami-gardens-commercial-ul", label: "UL Listings", detail: "Provide UL listings for the proposed roof system.", appliesWhen: "Listed on the City's commercial roofing checklist.", sourceUrl: "https://www.miamigardens-fl.gov/DocumentCenter/View/7775/Commercial-Roofing-Permit-Checklist" },
  { id: "miami-gardens-commercial-noc", label: "Notice of Commencement", detail: "Record, submit, and display the NOC before scheduling the first inspection for non-mechanical projects valued over $5,000; verify current statutory applicability.", appliesWhen: "Non-mechanical project with job value over $5,000, before first inspection.", sourceUrl: "https://www.miamigardens-fl.gov/DocumentCenter/View/7775/Commercial-Roofing-Permit-Checklist" },
];
export const CITY_OF_MIAMI_GARDENS_COMMERCIAL_ROOFING_PROFILE: JurisdictionPermitProfile = {
  id: "miami-gardens-commercial-roofing",
  label: "City of Miami Gardens — commercial reroof",
  county: "Miami-Dade",
  authorityScope: "City of Miami Gardens commercial roofing permit checklist. Limited to commercial reroofing.",
  authorityWarning: "Use only after verifying the property is inside City of Miami Gardens limits against official parcel / boundary records. This CRM profile is an intake aid, not a municipal determination or approval.",
  codeEdition: "Florida Building Code, 8th Edition (2023)",
  codeEditionEffectiveThrough: "2026-12-30",
  sourceUrls: ["https://www.miamigardens-fl.gov/DocumentCenter/View/7775/Commercial-Roofing-Permit-Checklist", "https://www.miamigardens-fl.gov/DocumentCenter/View/7598/Residential-Roofing-Complete-Packet-PDF", "https://www.miamigardens-fl.gov/193/Documents-Forms"],
  checklist: miamiGardensCommercialRoofingChecklist,
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
    [CITY_OF_MIAMI_RESIDENTIAL_ROOFING_PROFILE.id]: CITY_OF_MIAMI_RESIDENTIAL_ROOFING_PROFILE,
    [CITY_OF_MIAMI_GARDENS_RESIDENTIAL_ROOFING_PROFILE.id]: CITY_OF_MIAMI_GARDENS_RESIDENTIAL_ROOFING_PROFILE,
    [CITY_OF_MIAMI_GARDENS_COMMERCIAL_ROOFING_PROFILE.id]: CITY_OF_MIAMI_GARDENS_COMMERCIAL_ROOFING_PROFILE,
    [BROWARD_COUNTY_PROFILE.id]: BROWARD_COUNTY_PROFILE,
    [BROWARD_SUNRISE_RESIDENTIAL_PROFILE.id]: BROWARD_SUNRISE_RESIDENTIAL_PROFILE,
    [BROWARD_PEMBROKE_PINES_RESIDENTIAL_PROFILE.id]: BROWARD_PEMBROKE_PINES_RESIDENTIAL_PROFILE,
    [BROWARD_HOLLYWOOD_ROOFING_PROFILE.id]: BROWARD_HOLLYWOOD_ROOFING_PROFILE,
    [BROWARD_CORAL_SPRINGS_RESIDENTIAL_PROFILE.id]: BROWARD_CORAL_SPRINGS_RESIDENTIAL_PROFILE,
    [BROWARD_POMPANO_BEACH_ROOFING_PROFILE.id]: BROWARD_POMPANO_BEACH_ROOFING_PROFILE,
    [BROWARD_FORT_LAUDERDALE_ROOFING_PROFILE.id]: BROWARD_FORT_LAUDERDALE_ROOFING_PROFILE,
    [BROWARD_MIRAMAR_RESIDENTIAL_ROOFING_PROFILE.id]: BROWARD_MIRAMAR_RESIDENTIAL_ROOFING_PROFILE,
    [BROWARD_WESTON_ROOFING_PROFILE.id]: BROWARD_WESTON_ROOFING_PROFILE,
    [BROWARD_DAVIE_ROOFING_PROFILE.id]: BROWARD_DAVIE_ROOFING_PROFILE,
    [BROWARD_MARGATE_ROOFING_PROFILE.id]: BROWARD_MARGATE_ROOFING_PROFILE,
    [BROWARD_HALLANDALE_ROOFING_PROFILE.id]: BROWARD_HALLANDALE_ROOFING_PROFILE,
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
  if (profile.id === CITY_OF_MIAMI_RESIDENTIAL_ROOFING_PROFILE.id) {
    if (!request.folio?.trim()) {
      authorityConfirmed = false;
      warnings.push("Enter the property folio and verify the address is inside City of Miami limits. Folios beginning with 01 are a routing clue only.");
    } else {
      const normalizedFolio = request.folio.replace(/\D/g, "");
      if (!normalizedFolio.startsWith("01")) {
        authorityConfirmed = false;
        warnings.push("The supplied folio does not begin with 01. Confirm the actual municipality / authority having jurisdiction; do not use the City of Miami checklist.");
      } else if (!request.parcelAuthorityVerified) {
        authorityConfirmed = false;
        warnings.push("Confirm the folio against the property record and verify the address is inside City of Miami limits before treating the City as the permit authority.");
      }
    }
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
  const residentialOnlyProfile = profile.id === CITY_OF_MIAMI_GARDENS_RESIDENTIAL_ROOFING_PROFILE.id || profile.id === CITY_OF_MIAMI_RESIDENTIAL_ROOFING_PROFILE.id || profile.id === BROWARD_SUNRISE_RESIDENTIAL_PROFILE.id || profile.id === BROWARD_PEMBROKE_PINES_RESIDENTIAL_PROFILE.id || profile.id === BROWARD_CORAL_SPRINGS_RESIDENTIAL_PROFILE.id || profile.id === BROWARD_MIRAMAR_RESIDENTIAL_ROOFING_PROFILE.id;
  if ((profile.id === BROWARD_SUNRISE_RESIDENTIAL_PROFILE.id || profile.id === BROWARD_PEMBROKE_PINES_RESIDENTIAL_PROFILE.id || profile.id === BROWARD_HOLLYWOOD_ROOFING_PROFILE.id || profile.id === BROWARD_CORAL_SPRINGS_RESIDENTIAL_PROFILE.id || profile.id === BROWARD_POMPANO_BEACH_ROOFING_PROFILE.id || profile.id === BROWARD_FORT_LAUDERDALE_ROOFING_PROFILE.id || profile.id === BROWARD_MIRAMAR_RESIDENTIAL_ROOFING_PROFILE.id || profile.id === BROWARD_WESTON_ROOFING_PROFILE.id || profile.id === BROWARD_DAVIE_ROOFING_PROFILE.id || profile.id === BROWARD_MARGATE_ROOFING_PROFILE.id || profile.id === BROWARD_HALLANDALE_ROOFING_PROFILE.id || profile.id === CITY_OF_MIAMI_RESIDENTIAL_ROOFING_PROFILE.id || profile.id === CITY_OF_MIAMI_GARDENS_RESIDENTIAL_ROOFING_PROFILE.id || profile.id === CITY_OF_MIAMI_GARDENS_COMMERCIAL_ROOFING_PROFILE.id) && !request.parcelAuthorityVerified) {
    authorityConfirmed = false;
    warnings.push(`Verify the property is inside ${profile.label.split(" — ")[0]} limits and confirm its current checklist with the Building Division before filing.`);
  }
  if (residentialOnlyProfile && request.projectKind !== "reroof") {
    authorityConfirmed = false;
    warnings.push(`The ${profile.label} source covers residential reroof work only; confirm requirements for this different project type.`);
  }

  const roofSystem = request.roofingSystem ?? "other";
  const commercialOnlyProfile = profile.id === CITY_OF_MIAMI_GARDENS_COMMERCIAL_ROOFING_PROFILE.id;
  if (commercialOnlyProfile && request.projectKind !== "commercial_reroof") {
    authorityConfirmed = false;
    warnings.push("The City of Miami Gardens commercial checklist is limited to commercial reroofing; confirm requirements for this different project type.");
  }
  const profileScopeSupported = (!residentialOnlyProfile || request.projectKind === "reroof") && (!commercialOnlyProfile || request.projectKind === "commercial_reroof");
  const checklistEnabled = codeReferenceCurrent && profileScopeSupported;
  const requiredRoofingSections = !checklistEnabled ? [] : profile.id === CITY_OF_MIAMI_GARDENS_RESIDENTIAL_ROOFING_PROFILE.id
    ? (roofSystem === "low_slope" ? ["A", "B", "C"] : roofSystem === "tile" ? ["A", "B", "D", "E"] : ["asphalt_shingle", "metal", "wood_shake"].includes(roofSystem) ? ["A", "B", "D"] : [])
    : profile.id === CITY_OF_MIAMI_RESIDENTIAL_ROOFING_PROFILE.id
    ? (roofSystem === "low_slope" ? ["A", "B", "C"] : ["asphalt_shingle", "tile", "metal"].includes(roofSystem) ? ["A", "B", "D"] : [])
    : profile.id === MIAMI_DADE_UNINCORPORATED_PROFILE.id
    ? miamiDadeSections[roofSystem]
    : [];

  const allowedIds = profile.id === MIAMI_DADE_UNINCORPORATED_PROFILE.id
    ? new Set(miamiDadeAttachmentIds[roofSystem])
    : new Set(profile.checklist.map((item) => item.id));
  const items = (checklistEnabled ? profile.checklist : []).filter((item) => allowedIds.has(item.id)).filter((item) => {
    if (item.id === "owner-roofing-notification") return ["reroof", "multifamily_reroof", "commercial_reroof"].includes(request.projectKind ?? "unknown");
    if (item.id === "commercial-reroof-statement") return request.projectKind === "commercial_reroof";
    if (["weston-asbestos-responsibility", "weston-rooftop-gas-vent", "weston-broward-rooftop-equipment", "davie-asbestos-responsibilities", "davie-anchor-spacing-calculations"].includes(item.id)) return request.projectKind === "multifamily_reroof" || request.projectKind === "commercial_reroof";
    if (item.id === "davie-hurricane-mitigation-retrofit") return request.projectKind === "reroof";
    if (item.id === "davie-commercial-reroof-statement") return request.projectKind === "commercial_reroof";
    if (item.id === "margate-owner-notification") return ["reroof", "multifamily_reroof", "commercial_reroof"].includes(request.projectKind ?? "unknown");
    if (["hallandale-asbestos-certificate", "hallandale-insulation-replacement", "hallandale-rooftop-equipment", "hallandale-renailing-affidavit", "hallandale-assessed-value", "hallandale-hurricane-mitigation"].includes(item.id)) return ["reroof", "multifamily_reroof", "commercial_reroof"].includes(request.projectKind ?? "unknown");
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
  coralSpringsResidentialReroofChecklist: "https://www.coralsprings.gov/files/assets/public/v/11/documents/building/checklists/013.0-roof-reroof-permit-application-checklist-ada.pdf",
  pompanoBeachRoofingChecklist: "https://cdn.pompanobeachfl.gov/city/pages/building_inspections/submittal_checklists/Roofing.pdf",
  fortLauderdaleRoofingChecklist: "https://www.fortlauderdale.gov/Government/Departments/Development-Services/DSD-Documents-Forms",
  davieRoofingChecklist: "https://www.davie-fl.gov/DocumentCenter/View/11543/Roofing-Checklist",
  davieRoofingPackage: "https://www.davie-fl.gov/DocumentCenter/View/15265/Roofing-Package",
  hallandaleBeachReroofChecklist: "https://hallandalebeachfl.gov/DocumentCenter/View/32554/Reroof-Permit-Checklist?bidId=",
  cityOfMiamiRoofingPermit: "https://www.miami.gov/Permits-Construction/Permit-Catalog/Get-a-Roofing-Permit?lang_update=637748169458966676",
  miamiGardensResidentialRoofing: "https://www.miamigardens-fl.gov/DocumentCenter/View/7764/Roofing-Permit-Checklist",
  miamiGardensCommercialRoofing: "https://www.miamigardens-fl.gov/DocumentCenter/View/7775/Commercial-Roofing-Permit-Checklist",
} as const;
