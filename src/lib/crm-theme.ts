export const CRM_THEME_IDS = [
  "executive-berry",
  "modern-enterprise",
  "canyon-corporate",
  "midnight-teal",
  "ocean-slate",
  "royal-indigo",
  "emerald-ledger",
  "copperstone",
  "arctic-blue",
  "graphite-gold",
  "crimson-executive",
  "sage-stone",
  "cobalt-professional",
  "plum-luxe",
  "monochrome-pro",
] as const;

export type CrmThemeId = "default" | (typeof CRM_THEME_IDS)[number];

const CRM_THEME_ID_SET: ReadonlySet<string> = new Set(["default", ...CRM_THEME_IDS]);

export function isCrmThemeId(value: unknown): value is CrmThemeId {
  return typeof value === "string" && CRM_THEME_ID_SET.has(value);
}
