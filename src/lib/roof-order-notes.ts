/**
 * Structured header lines for a roof report order's free-text
 * `notes` field. The measurement-order form collects a building
 * type, an include-outbuilding flag and one map pin per building;
 * the orders table has no columns for any of them, so they are
 * recorded as labelled lines at the top of the notes the order
 * already carries — readable by a person opening the report, and
 * parseable by the workspace (the measurement pin steers the
 * detection service's footprint selection). The user's own notes
 * follow verbatim after a blank line.
 */

export const BUILDING_TYPES = [
  { value: "single_family", label: "Single Family" },
  { value: "multi_family", label: "Multi-Family" },
  { value: "commercial", label: "Commercial" },
] as const;

export type BuildingType = (typeof BUILDING_TYPES)[number]["value"];

export function buildingTypeLabel(value: BuildingType): string {
  return BUILDING_TYPES.find((type) => type.value === value)?.label ?? "Single Family";
}

const PIN_LINE = /^Measurement pin:\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/m;

export function composeRoofOrderNotes(input: {
  buildingType: BuildingType;
  includeOutbuilding: boolean;
  pin: { lat: number; lon: number } | null;
  notes: string;
}): string {
  const lines = [
    `Building type: ${buildingTypeLabel(input.buildingType)}`,
    `Include outbuilding: ${input.includeOutbuilding ? "Yes" : "No"}`,
  ];
  if (input.pin) {
    lines.push(`Measurement pin: ${input.pin.lat.toFixed(6)}, ${input.pin.lon.toFixed(6)}`);
  }
  const userNotes = input.notes.trim();
  return userNotes ? `${lines.join("\n")}\n\n${userNotes}` : lines.join("\n");
}

/** Recover the measurement pin recorded by composeRoofOrderNotes.
 * Returns null when the notes carry no valid pin line, so reports
 * created before the order form existed behave exactly as before. */
export function parseMeasurementPin(notes: string | null | undefined): {
  lat: number;
  lon: number;
} | null {
  if (!notes) return null;
  const match = PIN_LINE.exec(notes);
  if (!match) return null;
  const lat = Number(match[1]);
  const lon = Number(match[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { lat, lon };
}
