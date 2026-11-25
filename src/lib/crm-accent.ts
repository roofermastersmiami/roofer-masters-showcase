export const CRM_ACCENT_COLORS = [
  { id: "magenta", label: "Magenta", value: "#a81762" },
  { id: "fuchsia", label: "Fuchsia", value: "#a21caf" },
  { id: "berry", label: "Berry", value: "#9d174d" },
  { id: "navy", label: "Navy", value: "#1e3a8a" },
  { id: "royal-blue", label: "Royal Blue", value: "#1d4ed8" },
  { id: "cobalt", label: "Cobalt", value: "#1e40af" },
  { id: "teal", label: "Teal", value: "#0f766e" },
  { id: "emerald", label: "Emerald", value: "#047857" },
  { id: "forest-green", label: "Forest Green", value: "#166534" },
  { id: "purple", label: "Purple", value: "#6b21a8" },
  { id: "violet", label: "Violet", value: "#6d28d9" },
  { id: "plum", label: "Plum", value: "#7e225d" },
  { id: "crimson", label: "Crimson", value: "#b91c1c" },
  { id: "coral", label: "Coral", value: "#c2413b" },
  { id: "orange", label: "Orange", value: "#c2410c" },
  { id: "amber", label: "Amber", value: "#a16207" },
  { id: "gold", label: "Gold", value: "#946200" },
  { id: "bronze", label: "Bronze", value: "#92400e" },
  { id: "slate", label: "Slate", value: "#475569" },
  { id: "graphite", label: "Graphite", value: "#374151" },
] as const;

export type CrmAccentId = (typeof CRM_ACCENT_COLORS)[number]["id"];

const CRM_ACCENT_IDS: ReadonlySet<string> = new Set(CRM_ACCENT_COLORS.map(({ id }) => id));

export function isCrmAccentId(value: unknown): value is CrmAccentId {
  return typeof value === "string" && CRM_ACCENT_IDS.has(value);
}

export function getCrmAccent(value: unknown) {
  return CRM_ACCENT_COLORS.find(({ id }) => id === value) ?? null;
}
