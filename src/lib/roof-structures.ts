import type { RoofDrawing } from "@/lib/roof-geometry";

/**
 * Multi-structure support for the measurement workspace.
 *
 * In multi-structure mode the detection service identifies the main
 * house plus any detached structures (garage, shed, guest house) on
 * the same property and measures each one separately. The main
 * structure IS the report's drawing; detached structures ride inside
 * it (`drawing.detached_structures`) as complete drawings in the
 * same coordinate frame, so picking a structure in the report swaps
 * the displayed drawing and every derived measurement instantly —
 * no re-measure, no manual editing.
 */

export interface StructureDrawingEntry {
  /** Picker key: "main", the detached candidate id, or "all". */
  key: string;
  role: "main" | "detached" | "all";
  label: string;
  candidateId: string | null;
  drawing: RoofDrawing;
}

export const MAIN_STRUCTURE_LABEL = "Main house";
export const ALL_STRUCTURES_LABEL = "All structures";
export const ALL_STRUCTURES_KEY = "all";

/** Picker entries for a drawing: the main house first (the drawing
 * itself), then one entry per stored detached structure. */
export function structureEntries(drawing: RoofDrawing): StructureDrawingEntry[] {
  const entries: StructureDrawingEntry[] = [
    { key: "main", role: "main", label: MAIN_STRUCTURE_LABEL, candidateId: null, drawing },
  ];
  (drawing.detached_structures ?? []).forEach((structure, index) => {
    entries.push({
      key: structure.candidate_id ?? `detached-${index}`,
      role: "detached",
      label: structure.label,
      candidateId: structure.candidate_id,
      drawing: structure.drawing,
    });
  });
  return entries;
}

type ServiceEdges = NonNullable<RoofDrawing["service_edge_lengths_lf"]>;

export function sumServiceEdges(list: ServiceEdges[]): ServiceEdges {
  const total: ServiceEdges = {
    ridge: 0,
    hip: 0,
    valley: 0,
    eave: 0,
    rake: 0,
    pitch_change: 0,
  };
  for (const edges of list) {
    total.ridge += edges.ridge;
    total.hip += edges.hip;
    total.valley += edges.valley;
    total.eave += edges.eave;
    total.rake += edges.rake;
    total.pitch_change += edges.pitch_change;
  }
  return total;
}

/** One drawing containing every structure's planes, in their true
 * relative positions (all structure drawings share one coordinate
 * frame), for the "All structures" view. Plane and penetration ids
 * are prefixed per structure so they stay unique; plane names carry
 * the structure label so the measurements table reads clearly. The
 * authoritative service edge totals are summed when every structure
 * has them. Display-only — never saved. */
export function combinedStructureDrawing(entries: StructureDrawingEntry[]): RoofDrawing {
  const parts = entries.filter((entry) => entry.role !== "all");
  const base = parts[0]?.drawing;
  if (!base) throw new Error("At least one structure is required.");
  if (parts.length === 1) return base;
  const planes = parts.flatMap((entry, entryIndex) =>
    entry.drawing.planes.map((plane) => ({
      ...plane,
      id: `structure-${entryIndex}-${plane.id}`,
      name: `${entry.label} — ${plane.name}`,
    })),
  );
  const penetrations = parts.flatMap((entry, entryIndex) =>
    entry.drawing.penetrations.map((penetration) => ({
      ...penetration,
      id: `structure-${entryIndex}-${penetration.id}`,
    })),
  );
  const edgeSets = parts
    .map((entry) => entry.drawing.service_edge_lengths_lf)
    .filter((edges): edges is ServiceEdges => Boolean(edges));
  return {
    ...base,
    planes,
    penetrations,
    ...(edgeSets.length === parts.length
      ? { service_edge_lengths_lf: sumServiceEdges(edgeSets) }
      : {}),
  };
}

/** The drawing to display for a picker key, or null when the key is
 * the main structure (the workspace's own drawing state). */
export function pickedStructureDrawing(
  entries: StructureDrawingEntry[],
  pickedKey: string,
): { label: string; drawing: RoofDrawing } | null {
  if (pickedKey === "main") return null;
  if (pickedKey === ALL_STRUCTURES_KEY) {
    return { label: ALL_STRUCTURES_LABEL, drawing: combinedStructureDrawing(entries) };
  }
  const entry = entries.find((candidate) => candidate.key === pickedKey);
  if (!entry || entry.role === "main") return null;
  return { label: entry.label, drawing: entry.drawing };
}

/** Report title for a structure-specific PDF: the base title plus
 * the structure label, so the downloaded file and the document
 * itself say which structure the numbers belong to. */
export function structurePdfTitle(baseTitle: string, structureLabel: string): string {
  return `${baseTitle} — ${structureLabel}`;
}
