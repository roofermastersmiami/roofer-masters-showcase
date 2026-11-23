
/**
 * Roofer Masters - Roof Calculation Helpers
 *
 * Supply either:
 * 1. Already-sloped surface area, OR
 * 2. Projected horizontal area and roof pitch.
 *
 * Projected area is corrected for pitch once.
 * Already-sloped surface area is never corrected again.
 */

export type RoofEdgeType =
  | "eave"
  | "rake"
  | "ridge"
  | "hip"
  | "valley"
  | "other";

export type RoofFacetInput = {
  id: string;
  name?: string;
  surfaceAreaSqFt?: number;
  projectedAreaSqFt?: number;
  pitchRisePer12?: number;
};

export type RoofEdgeInput = {
  id: string;
  type: RoofEdgeType;
  lengthFt: number;
};

export type RoofCalculationInput = {
  facets: RoofFacetInput[];
  edges?: RoofEdgeInput[];
  wastePercent?: number;
};

export type RoofCalculationResult = {
  facetSurfaceAreaSqFt: number;
  baseAreaSqFt: number;
  wastePercent: number;
  wasteAreaSqFt: number;
  totalAreaWithWasteSqFt: number;
  exactSquares: number;
  orderSquares: number;
  linearFeet: Record<RoofEdgeType, number>;
  totalUniqueEdgeFeet: number;
  predominantPitchRisePer12: number | null;
};

const SQFT_PER_SQUARE = 100;

function nonNegative(n: number, label: string) {
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(
      `${label} must be finite and non-negative.`
    );
  }
}

/** Convert pitch angle in degrees to rise per 12 inches. */
export function degreesToPitchRise(
  degrees: number
): number {
  if (
    !Number.isFinite(degrees) ||
    degrees < 0 ||
    degrees >= 90
  ) {
    throw new Error(
      "Pitch angle must be from 0 to less than 90 degrees."
    );
  }

  return 12 * Math.tan((degrees * Math.PI) / 180);
}

/** Convert rise per 12 inches to pitch angle in degrees. */
export function pitchRiseToDegrees(
  risePer12: number
): number {
  nonNegative(risePer12, "Pitch rise");

  return (
    (Math.atan(risePer12 / 12) * 180) /
    Math.PI
  );
}

/** Convert square meters to square feet. */
export function squareMetersToSquareFeet(
  m2: number
): number {
  nonNegative(m2, "Square meters");

  const result = m2 * 10.763910416709722;
  if (!Number.isFinite(result)) throw new Error("Square feet exceed the supported range.");
  return result;
}

/** Convert square feet to roofing squares. */
export function squareFeetToSquares(
  ft2: number
): number {
  nonNegative(ft2, "Square feet");

  return ft2 / SQFT_PER_SQUARE;
}

/**
 * Convert horizontal projected area to actual
 * sloped roof surface area.
 */
export function projectedAreaToSurfaceArea(
  projectedAreaSqFt: number,
  pitchRisePer12: number
): number {
  nonNegative(projectedAreaSqFt, "Projected area");
  nonNegative(pitchRisePer12, "Pitch rise");

  const result = projectedAreaSqFt * Math.sqrt(1 + (pitchRisePer12 / 12) ** 2);
  if (!Number.isFinite(result)) throw new Error("Roof surface area exceeds the supported range.");
  return result;
}

/**
 * Calculate polygon area using the shoelace formula.
 * Coordinates must be measured in feet.
 */
export function polygonAreaSqFt(
  points: Array<{ x: number; y: number }>
): number {
  if (points.length < 3) {
    throw new Error(
      "A polygon needs at least three points."
    );
  }

  let twice = 0;

  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;

    if (
      !Number.isFinite(a.x) ||
      !Number.isFinite(a.y)
    ) {
      throw new Error(
        "Polygon coordinates must be finite."
      );
    }

    const term = a.x * b.y - b.x * a.y;
    if (!Number.isFinite(term) || !Number.isFinite(twice + term)) {
      throw new Error("Polygon area exceeds the supported range.");
    }
    twice += term;
  }

  const area = Math.abs(twice) / 2;
  if (!Number.isFinite(area)) throw new Error("Polygon area exceeds the supported range.");
  return area;
}

/** Calculate the actual surface area of one roof plane. */
function facetArea(f: RoofFacetInput): number {
  const hasSurface =
    f.surfaceAreaSqFt !== undefined;

  const hasProjected =
    f.projectedAreaSqFt !== undefined;

  if (hasSurface === hasProjected) {
    throw new Error(
      `Facet ${f.id}: provide exactly one area source.`
    );
  }

  if (hasSurface) {
    nonNegative(
      f.surfaceAreaSqFt!,
      `Facet ${f.id} surface area`
    );

    return f.surfaceAreaSqFt!;
  }

  if (f.pitchRisePer12 === undefined) {
    throw new Error(
      `Facet ${f.id}: pitchRisePer12 is required for projected area.`
    );
  }

  return projectedAreaToSurfaceArea(
    f.projectedAreaSqFt!,
    f.pitchRisePer12
  );
}

/**
 * Calculate total roof area, waste, roofing squares,
 * edge lengths, and predominant pitch.
 */
export function calculateRoofSummary(
  input: RoofCalculationInput
): RoofCalculationResult {
  if (!Array.isArray(input.facets) || !input.facets.length) {
    throw new Error(
      "At least one roof facet is required."
    );
  }

  const facetIds = new Set<string>();
  for (const facet of input.facets) {
    if (typeof facet.id !== "string" || !facet.id.trim()) {
      throw new Error("Every roof facet must have a non-empty id.");
    }
    if (facetIds.has(facet.id)) {
      throw new Error(`Duplicate roof facet id: ${facet.id}.`);
    }
    facetIds.add(facet.id);
  }

  const wastePercent = input.wastePercent ?? 10;

  if (
    !Number.isFinite(wastePercent) ||
    wastePercent < 0 ||
    wastePercent > 50
  ) {
    throw new Error(
      "Waste percentage must be between 0 and 50."
    );
  }

  const facetSurfaceAreaSqFt =
    input.facets.reduce(
      (sum, facet) => sum + facetArea(facet),
      0
    );

  if (!Number.isFinite(facetSurfaceAreaSqFt)) {
    throw new Error("Total roof surface area exceeds the supported range.");
  }

  const wasteAreaSqFt =
    facetSurfaceAreaSqFt * wastePercent / 100;

  const totalAreaWithWasteSqFt =
    facetSurfaceAreaSqFt + wasteAreaSqFt;

  if (!Number.isFinite(totalAreaWithWasteSqFt)) {
    throw new Error("Total roof area with waste exceeds the supported range.");
  }

  const linearFeet: Record<RoofEdgeType, number> = {
    eave: 0,
    rake: 0,
    ridge: 0,
    hip: 0,
    valley: 0,
    other: 0,
  };

  // Shared edges are counted only once.
  const unique = new Map<string, RoofEdgeInput>();

  for (const edge of input.edges ?? []) {
    if (typeof edge.id !== "string" || !edge.id.trim()) {
      throw new Error("Every roof edge must have a non-empty id.");
    }
    nonNegative(
      edge.lengthFt,
      `Edge ${edge.id} length`
    );

    const prior = unique.get(edge.id);

    if (prior) {
      if (
        prior.type !== edge.type ||
        Math.abs(prior.lengthFt - edge.lengthFt) > 0.01
      ) {
        throw new Error(
          `Shared edge ${edge.id} has conflicting measurements.`
        );
      }

      continue;
    }

    if (!Object.hasOwn(linearFeet, edge.type)) throw new Error(`Edge ${edge.id} has an unsupported type.`);
    unique.set(edge.id, edge);
    const nextLength = linearFeet[edge.type] + edge.lengthFt;
    if (!Number.isFinite(nextLength)) throw new Error("Total edge length exceeds the supported range.");
    linearFeet[edge.type] = nextLength;
  }

  // Find the most common roof pitch.
  const pitches = input.facets
    .map(facet => facet.pitchRisePer12)
    .filter(
      (pitch): pitch is number =>
        pitch !== undefined
    );

  for (const pitch of pitches) {
    nonNegative(pitch, "Pitch rise");
  }

  const counts = new Map<number, number>();

  for (const pitch of pitches) {
    counts.set(
      pitch,
      (counts.get(pitch) ?? 0) + 1
    );
  }

  const totalUniqueEdgeFeet = [...unique.values()].reduce((sum, edge) => sum + edge.lengthFt, 0);
  if (!Number.isFinite(totalUniqueEdgeFeet)) throw new Error("Total edge length exceeds the supported range.");

  const predominantPitchRisePer12 =
    pitches.length
      ? [...counts.entries()].sort(
          (a, b) =>
            b[1] - a[1] || a[0] - b[0]
        )[0]![0]
      : null;

  return {
    facetSurfaceAreaSqFt,
    baseAreaSqFt: facetSurfaceAreaSqFt,
    wastePercent,
    wasteAreaSqFt,
    totalAreaWithWasteSqFt,

    exactSquares: squareFeetToSquares(
      facetSurfaceAreaSqFt
    ),

    // Round material orders up to the next 1/3 square.
    orderSquares:
      Math.ceil(
        (totalAreaWithWasteSqFt / SQFT_PER_SQUARE) * 3
      ) / 3,

    linearFeet,

    totalUniqueEdgeFeet,

    predominantPitchRisePer12,
  };
}
