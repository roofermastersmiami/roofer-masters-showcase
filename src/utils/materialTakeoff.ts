/**
 * South Florida roofing material takeoff planning formulas.
 *
 * Quantities are planning estimates only. Confirm manufacturer coverage,
 * current Florida Building Code / HVHZ approvals, fastening schedules, and
 * field conditions before ordering. This module intentionally contains no
 * supplier prices or quote totals.
 */
export type RoofSystem = "architectural_metal" | "shingle" | "tile" | "flat_modbit";
export type FlatInstallationMethod = "torch" | "peel_and_stick";

export interface MetalPlaneRun {
  /** Eave length for this individual roof plane. */
  eaveLengthFt: number;
  /** Measured panel run from eave to ridge/high-side, including approved overhang. */
  panelRunFt: number;
}

export interface MetalTakeoffConfig {
  /** Net installed panel coverage width, supplied from the selected product data. */
  panelCoverageIn: number;
  /** Manufacturer-confirmed net underlayment coverage per roll. */
  underlaymentCoverageSqFtPerRoll: number;
  /** Owner/manufacturer-approved fasteners required per panel. */
  fastenersPerPanel: number;
  /** Fasteners supplied per box. */
  fastenersPerBox: number;
  /** Actual stock trim length in feet. */
  trimStickLengthFt: number;
}

export interface RoofMeasurements {
  /** Pitch-adjusted 3D roof surface area, not plan-view footprint. */
  totalAreaSqFt: number;
  /** Rise per 12 inches of horizontal run (e.g. 5 for 5/12); 0 for flat. */
  dominantPitch: number;
  ridgesFt: number;
  hipsFt: number;
  valleysFt: number;
  eavesFt: number;
  rakesFt: number;
  penetrationsCount?: number;
  /** Required for architectural metal: measured runs for each individual plane. */
  metalPlaneRuns?: MetalPlaneRun[];
  /** Required for architectural metal; values must come from selected product data. */
  metalConfig?: MetalTakeoffConfig;
  /** Required to distinguish torch-applied and self-adhered modified bitumen systems. */
  flatInstallationMethod?: FlatInstallationMethod;
}

export interface TakeoffLineItem {
  code: string;
  name: string;
  category: "Primary" | "Underlayment" | "Metal & Flashing" | "Fasteners & Sealants";
  quantity: number;
  unit: string;
  notes?: string;
}

export interface RoofTakeoff {
  squaresNet: number;
  squaresWithWaste: number;
  wastePct: number;
  steepSlopeMultiplier: number;
  lineItems: TakeoffLineItem[];
  system: RoofSystem;
  flatInstallationMethod?: FlatInstallationMethod;
  planningNote: string;
}

const MAX_DIMENSION = 1_000_000;
const MAX_QUANTITY = 10_000_000;
const ceilQty = (value: number, label: string): number => {
  if (!Number.isFinite(value) || value < 0 || value > MAX_QUANTITY)
    throw new Error(`${label} is outside the supported quantity range`);
  return Math.max(0, Math.ceil(value - 1e-9));
};
const round2 = (value: number): number => Number(value.toFixed(2));

function validateMeasurements(m: RoofMeasurements, customWastePct?: number): void {
  if (!m || typeof m !== "object") throw new Error("Roof measurements are required");
  if (!Number.isFinite(m.totalAreaSqFt) || m.totalAreaSqFt <= 0 || m.totalAreaSqFt > MAX_DIMENSION)
    throw new Error("Roof area must be greater than 0 and no more than 1,000,000 sq ft");
  if (!Number.isFinite(m.dominantPitch) || m.dominantPitch < 0 || m.dominantPitch > 24)
    throw new Error("Dominant pitch must be between 0:12 and 24:12");
  for (const [label, value] of [
    ["Ridges", m.ridgesFt],
    ["Hips", m.hipsFt],
    ["Valleys", m.valleysFt],
    ["Eaves", m.eavesFt],
    ["Rakes", m.rakesFt],
  ] as const) {
    if (!Number.isFinite(value) || value < 0 || value > MAX_DIMENSION)
      throw new Error(`${label} length must be a finite non-negative number`);
  }
  if (
    m.penetrationsCount !== undefined &&
    (!Number.isSafeInteger(m.penetrationsCount) ||
      m.penetrationsCount < 0 ||
      m.penetrationsCount > 5000)
  )
    throw new Error("Penetration count must be a whole number between 0 and 5,000");
  if (
    customWastePct !== undefined &&
    (!Number.isFinite(customWastePct) || customWastePct < 0 || customWastePct > 50)
  )
    throw new Error("Custom waste must be between 0% and 50%");
}

function metalItems(
  m: RoofMeasurements,
  squaresWithWaste: number,
  wastePct: number,
): TakeoffLineItem[] {
  const config = m.metalConfig;
  const planes = m.metalPlaneRuns;
  if (!config || !planes?.length)
    throw new Error(
      "Architectural metal takeoff requires measured plane runs and product coverage settings",
    );
  for (const [label, value] of [
    ["Panel coverage", config.panelCoverageIn],
    ["Underlayment roll coverage", config.underlaymentCoverageSqFtPerRoll],
    ["Fasteners per panel", config.fastenersPerPanel],
    ["Fasteners per box", config.fastenersPerBox],
    ["Trim stick length", config.trimStickLengthFt],
  ] as const) {
    if (!Number.isFinite(value) || value <= 0 || value > MAX_DIMENSION)
      throw new Error(`${label} must be supplied as a positive product-specific value`);
  }
  let panels = 0;
  const panelCutList: TakeoffLineItem[] = [];
  for (const [index, plane] of planes.entries()) {
    if (
      !Number.isFinite(plane.eaveLengthFt) ||
      plane.eaveLengthFt <= 0 ||
      !Number.isFinite(plane.panelRunFt) ||
      plane.panelRunFt <= 0 ||
      plane.eaveLengthFt > MAX_DIMENSION ||
      plane.panelRunFt > MAX_DIMENSION
    )
      throw new Error(`Metal plane ${index + 1} needs positive measured eave length and panel run`);
    const planePanels = ceilQty(
      ((plane.eaveLengthFt * 12) / config.panelCoverageIn) * (1 + wastePct / 100),
      "Metal panel count",
    );
    panels += planePanels;
    panelCutList.push({
      code: `MTL-PANEL-PLANE-${index + 1}`,
      name: `Architectural metal panels — Plane ${index + 1} measured cut list`,
      category: "Primary",
      quantity: planePanels,
      unit: "panels",
      notes: `${round2(plane.panelRunFt)}-ft measured cut length per panel; ${round2(plane.eaveLengthFt)}-ft eave; ${config.panelCoverageIn}-in net coverage; ${wastePct}% panel allowance`,
    });
  }
  const trimFt = m.eavesFt + m.rakesFt + m.ridgesFt + m.hipsFt + m.valleysFt;
  const trimSticks = ceilQty(trimFt / config.trimStickLengthFt, "Metal trim sticks");
  const fastenerBoxes = ceilQty(
    (panels * config.fastenersPerPanel) / config.fastenersPerBox,
    "Metal fastener boxes",
  );
  return [
    ...panelCutList,
    {
      code: "MTL-UNDERLAYMENT",
      name: "Metal-roof approved underlayment",
      category: "Underlayment",
      quantity: ceilQty(
        (squaresWithWaste * 100) / config.underlaymentCoverageSqFtPerRoll,
        "Metal underlayment rolls",
      ),
      unit: "rolls",
      notes: "Roll coverage supplied from the selected product data",
    },
    {
      code: "MTL-TRIM-CUSTOM",
      name: "Metal roof perimeter and transition trim",
      category: "Metal & Flashing",
      quantity: trimSticks,
      unit: "sticks",
      notes: `${round2(trimFt)} measured linear ft; ${config.trimStickLengthFt}-ft stock length`,
    },
    {
      code: "MTL-FASTENER-CUSTOM",
      name: "Manufacturer-approved panel fasteners",
      category: "Fasteners & Sealants",
      quantity: fastenerBoxes,
      unit: "boxes",
      notes: `${config.fastenersPerPanel} fasteners per panel; ${config.fastenersPerBox} per box`,
    },
  ];
}

/**
 * Calculate a South Florida roofing material takeoff. Coverage constants are
 * explicit planning assumptions from the supplied worksheet; metal coverage
 * and fastening values must always be entered from the selected product data.
 */
export function calculateRoofTakeoff(
  m: RoofMeasurements,
  system: RoofSystem,
  customWastePct?: number,
): RoofTakeoff {
  validateMeasurements(m, customWastePct);
  if (!["architectural_metal", "shingle", "tile", "flat_modbit"].includes(system))
    throw new Error("Unsupported roof system");
  if (
    system === "flat_modbit" &&
    m.flatInstallationMethod !== "torch" &&
    m.flatInstallationMethod !== "peel_and_stick"
  )
    throw new Error("Select Torch or Peel-and-Stick for modified bitumen");
  const complexityRatio = (m.hipsFt + m.valleysFt) / Math.max(m.totalAreaSqFt / 100, 1);
  const defaultWaste = system === "flat_modbit" ? 10 : complexityRatio > 12 ? 15 : 12;
  const wastePct = customWastePct ?? defaultWaste;
  const squaresNet = round2(m.totalAreaSqFt / 100);
  const squaresWithWaste = round2(squaresNet * (1 + wastePct / 100));
  const steepSlopeMultiplier = m.dominantPitch >= 7 ? 1.15 : 1;
  const perimeterFt = m.eavesFt + m.rakesFt;
  const ridgeAndHipFt = m.ridgesFt + m.hipsFt;
  const items: TakeoffLineItem[] = [
    {
      code: "MTL-DRIP-3X3",
      name:
        system === "tile"
          ? "26ga Galvalume Tile Drip Edge (10ft)"
          : '26ga 3"x3" HVHZ Drip Edge (10ft)',
      category: "Metal & Flashing",
      quantity: ceilQty((perimeterFt * 1.08) / 10, "Drip edge sticks"),
      unit: "sticks",
    },
  ];
  if (m.valleysFt > 0)
    items.push({
      code: "MTL-VALLEY-16",
      name: '16" W-Valley Metal Flashing (10ft)',
      category: "Metal & Flashing",
      quantity: ceilQty((m.valleysFt * 1.1) / 10, "Valley sticks"),
      unit: "sticks",
    });
  if (system === "architectural_metal") {
    items.push(...metalItems(m, squaresWithWaste, wastePct));
  } else if (system === "shingle") {
    items.push(
      {
        code: "SHG-ARCH",
        name: "Architectural Shingles (HVHZ Rated)",
        category: "Primary",
        quantity: ceilQty(squaresWithWaste * 3, "Shingle bundles"),
        unit: "bundles",
      },
      {
        code: "SHG-START",
        name: "Starter Strip Shingles",
        category: "Primary",
        quantity: ceilQty((perimeterFt * 1.05) / 100, "Starter bundles"),
        unit: "bundles",
      },
      {
        code: "SHG-RIDGE",
        name: "Hip & Ridge Cap Shingles",
        category: "Primary",
        quantity: ceilQty((ridgeAndHipFt * 1.05) / 25, "Ridge bundles"),
        unit: "bundles",
      },
      {
        code: "UND-PSA",
        name: "Self-Adhered Peel & Stick Underlayment (2 Sq)",
        category: "Underlayment",
        quantity: ceilQty((squaresNet * 1.1) / 2, "Peel-and-stick rolls"),
        unit: "rolls",
        notes: "HVHZ Secondary Water Barrier",
      },
      {
        code: "FST-COIL-125",
        name: '1-1/4" Galvanized Ring-Shank Coil Nails (7.2k)',
        category: "Fasteners & Sealants",
        quantity: ceilQty(squaresWithWaste / 15, "Coil nail boxes"),
        unit: "boxes",
      },
      {
        code: "FST-TINCAP",
        name: '1-5/8" Tin Caps + Ring Shank Nails',
        category: "Fasteners & Sealants",
        quantity: ceilQty(squaresNet / 15, "Tin-cap boxes"),
        unit: "boxes",
      },
    );
  } else if (system === "tile") {
    items.push(
      {
        code: "TIL-FIELD",
        name: "Concrete Roof Field Tiles",
        category: "Primary",
        quantity: ceilQty(squaresWithWaste * 92, "Field tiles"),
        unit: "pieces",
      },
      {
        code: "TIL-RIDGE",
        name: "Barrel / Rake Ridge Tiles",
        category: "Primary",
        quantity: ceilQty((ridgeAndHipFt * 1.05) / 1.15, "Ridge tiles"),
        unit: "pieces",
      },
      {
        code: "UND-BASE30",
        name: "ASTM #30 / Anchor Base Sheet (2 Sq)",
        category: "Underlayment",
        quantity: ceilQty((squaresNet * 1.1) / 2, "Base-sheet rolls"),
        unit: "rolls",
      },
      {
        code: "UND-TILECAP",
        name: "HVHZ Tile Cap Sheet Underlayment (1 Sq)",
        category: "Underlayment",
        quantity: ceilQty(squaresNet * 1.12, "Tile cap-sheet rolls"),
        unit: "rolls",
      },
      {
        code: "ADH-FOAM",
        name: "2-Component Polyurethane Tile Adhesive Kit",
        category: "Fasteners & Sealants",
        quantity: ceilQty(squaresWithWaste / 3.5, "Foam kits"),
        unit: "kits",
      },
      {
        code: "MRT-OXIDE",
        name: "Color-Matched Roof Tile Mortar (50lb)",
        category: "Fasteners & Sealants",
        quantity: ceilQty(ridgeAndHipFt / 25, "Mortar bags"),
        unit: "bags",
      },
    );
  } else {
    const torch = m.flatInstallationMethod === "torch";
    items.push(
      {
        code: "MOD-BASE",
        name: "SBS Smooth / Fiberglass Base Sheet (1.5 Sq)",
        category: "Underlayment",
        quantity: ceilQty((squaresNet * 1.12) / 1.5, "Modified base rolls"),
        unit: "rolls",
      },
      {
        code: "MOD-CAP",
        name: torch
          ? "SBS Granulated Torch Cap Sheet (1 Sq)"
          : "SBS Granulated Self-Adhered Cap Sheet (1 Sq)",
        category: "Primary",
        quantity: ceilQty(squaresNet * 1.15, "Modified cap rolls"),
        unit: "rolls",
      },
      {
        code: "SEAL-CEM",
        name: "Modified Bitumen Flashing Cement (5 Gal)",
        category: "Fasteners & Sealants",
        quantity: ceilQty(squaresNet / 10, "Flashing cement pails"),
        unit: "pails",
      },
      {
        code: "FST-TINCAP",
        name: '1-5/8" Tin Caps & 1-1/4" Ring Shank Nails',
        category: "Fasteners & Sealants",
        quantity: ceilQty(squaresNet / 12, "Tin-cap boxes"),
        unit: "boxes",
      },
    );
  }
  const penetrations = m.penetrationsCount ?? Math.max(3, Math.round(squaresNet / 8));
  items.push(
    {
      code: "FLS-BOOT",
      name: "Lead / Bullet Pipe Flashing Boots",
      category: "Metal & Flashing",
      quantity: penetrations,
      unit: "each",
    },
    {
      code: "SEAL-NP1",
      name: "Polyurethane Roof Sealant Tubes",
      category: "Fasteners & Sealants",
      quantity: ceilQty(perimeterFt / 50, "Sealant tubes"),
      unit: "tubes",
    },
  );
  return {
    squaresNet,
    squaresWithWaste,
    wastePct,
    steepSlopeMultiplier,
    lineItems: items,
    system,
    ...(system === "flat_modbit" ? { flatInstallationMethod: m.flatInstallationMethod } : {}),
    planningNote:
      "Planning estimate only. Confirm actual product coverage, Florida Building Code/HVHZ approvals, fastening schedules, roof-plane details, and field conditions with the installer and manufacturer before ordering.",
  };
}
