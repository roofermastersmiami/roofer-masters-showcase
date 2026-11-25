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

export const CRM_THEME_COLORS = [
  { id: "executive-berry", label: "Executive Berry", value: "#b21e63" },
  { id: "modern-enterprise", label: "Modern Enterprise", value: "#8e3a70" },
  { id: "canyon-corporate", label: "Canyon Corporate", value: "#a61e5c" },
  { id: "midnight-teal", label: "Midnight Teal", value: "#087f8c" },
  { id: "ocean-slate", label: "Ocean Slate", value: "#2878a5" },
  { id: "royal-indigo", label: "Royal Indigo", value: "#5146a5" },
  { id: "emerald-ledger", label: "Emerald Ledger", value: "#16815b" },
  { id: "copperstone", label: "Copperstone", value: "#a65b35" },
  { id: "arctic-blue", label: "Arctic Blue", value: "#2876bd" },
  { id: "graphite-gold", label: "Graphite Gold", value: "#98752c" },
  { id: "crimson-executive", label: "Crimson Executive", value: "#a52a42" },
  { id: "sage-stone", label: "Sage & Stone", value: "#637d62" },
  { id: "cobalt-professional", label: "Cobalt Professional", value: "#2458b8" },
  { id: "plum-luxe", label: "Plum Luxe", value: "#87528e" },
  { id: "monochrome-pro", label: "Monochrome Pro", value: "#44484e" },
] as const;

export const CRM_ALL_THEME_COLORS = [...CRM_THEME_COLORS, ...CRM_ACCENT_COLORS] as const;

export type CrmAccentId = (typeof CRM_ACCENT_COLORS)[number]["id"];

const CRM_ACCENT_IDS: ReadonlySet<string> = new Set(CRM_ACCENT_COLORS.map(({ id }) => id));

export function isCrmAccentId(value: unknown): value is CrmAccentId {
  return typeof value === "string" && CRM_ACCENT_IDS.has(value);
}

export function getCrmAccent(value: unknown) {
  return CRM_ACCENT_COLORS.find(({ id }) => id === value) ?? null;
}
