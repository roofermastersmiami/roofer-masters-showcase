import { z } from "zod";
import { ROOF_TYPES } from "./instant-estimate-schema";
export const reportSchema = z.object({
  roof_type: z.enum(ROOF_TYPES),
  area_sqft: z.number().positive().max(1000000),
  waste_pct: z.number().min(0).max(50),
  ridge_lf: z.number().min(0).max(100000),
  hips_lf: z.number().min(0).max(100000),
  valleys_lf: z.number().min(0).max(100000),
  eaves_lf: z.number().min(0).max(100000),
  rakes_lf: z.number().min(0).max(100000),
  panel_width_in: z.number().min(6).max(48).default(16),
  pipes: z.number().int().min(0).max(500).default(0),
});
export type RoofReport = z.input<typeof reportSchema>;
export type MaterialLine = { item: string; qty: number; unit: string };
const up = (n: number) => Math.max(0, Math.ceil(n - 1e-9));
/** Material takeoff from a roof measurement report. 1 square = 100 sq ft. */
export function materialOrder(input: RoofReport): MaterialLine[] {
  const r = reportSchema.parse(input);
  const boots = { item: "Pipe boots / flashings", qty: r.pipes, unit: "pcs" };
  const area = r.area_sqft * (1 + r.waste_pct / 100);
  const sq = area / 100;
  const edges = r.eaves_lf + r.rakes_lf;
  const caps = r.ridge_lf + r.hips_lf;
  const drip = { item: "Drip edge / edge metal (10 ft)", qty: up(edges / 10), unit: "pcs" };
  switch (r.roof_type) {
    case "Shingle Roof":
      return [
        { item: "Architectural shingles", qty: up(sq * 3), unit: "bundles" },
        { item: "Starter strip", qty: up(edges / 100), unit: "bundles" },
        { item: "Hip & ridge cap", qty: up(caps / 33), unit: "bundles" },
        { item: "Synthetic underlayment (10 sq roll)", qty: up(sq / 10), unit: "rolls" },
        {
          item: "Ice & water shield for valleys (66 ft)",
          qty: up(r.valleys_lf / 66),
          unit: "rolls",
        },
        drip,
        { item: "Coil roofing nails", qty: up(sq / 16), unit: "boxes" },
        { item: "Roof cement / sealant", qty: up(sq / 10), unit: "tubes" },
        boots,
      ];
    case "Metal Roof":
      return [
        {
          item: `Metal panels (${r.panel_width_in}" coverage)`,
          qty: up(((r.eaves_lf * 12) / r.panel_width_in) * (1 + r.waste_pct / 100)),
          unit: "panels",
        },
        {
          item: "Average panel length",
          qty: Math.round(r.eaves_lf ? r.area_sqft / r.eaves_lf : 0),
          unit: "ft",
        },
        { item: "Total panel linear footage", qty: up(area / (r.panel_width_in / 12)), unit: "ft" },
        { item: "Eave trim (10 ft)", qty: up(r.eaves_lf / 10), unit: "pcs" },
        { item: "Gable / rake trim (10 ft)", qty: up(r.rakes_lf / 10), unit: "pcs" },
        {
          item: "Foam closures (3 ft)",
          qty: up((r.eaves_lf + caps * 2 + r.valleys_lf * 2) / 3),
          unit: "pcs",
        },
        { item: "Butyl tape (50 ft)", qty: up((caps + r.valleys_lf + edges) / 50), unit: "rolls" },
        { item: "Sealant tubes", qty: up(sq / 3), unit: "tubes" },
        boots,
        { item: "Ridge / hip cap (10 ft)", qty: up(caps / 10), unit: "pcs" },
        { item: "Valley flashing (10 ft)", qty: up(r.valleys_lf / 10), unit: "pcs" },
        { item: "High-temp underlayment (2 sq roll)", qty: up(sq / 2), unit: "rolls" },
        drip,
        { item: "Panel clips & screws", qty: up(sq / 2), unit: "boxes" },
      ];
    case "Tile Roof":
      return [
        { item: "Roof tiles", qty: up(sq * 90), unit: "tiles" },
        { item: "Hip & ridge tiles", qty: up(caps), unit: "tiles" },
        { item: "Peel & stick underlayment (2 sq roll)", qty: up(sq / 2), unit: "rolls" },
        { item: "Tile foam adhesive", qty: up(sq / 2), unit: "cans" },
        { item: "Mortar for hips/ridges", qty: up(caps / 20), unit: "bags" },
        { item: "Valley metal (10 ft)", qty: up(r.valleys_lf / 10), unit: "pcs" },
        { item: "Bird stop / eave closure (10 ft)", qty: up(r.eaves_lf / 10), unit: "pcs" },
        drip,
        boots,
      ];
    case "TPO":
      return [
        { item: "TPO membrane (10x100 ft roll)", qty: up(area / 1000), unit: "rolls" },
        { item: "Insulation board (4x8 ft)", qty: up(area / 32), unit: "boards" },
        { item: "Plates & fasteners", qty: up(sq / 10), unit: "buckets" },
        { item: "Bonding adhesive", qty: up(sq / 5), unit: "pails" },
        { item: "Seam tape / cover strip (100 ft)", qty: up(edges / 100), unit: "rolls" },
        { item: "TPO pipe boots", qty: r.pipes, unit: "pcs" },
        drip,
      ];
    case "Flat Roof":
      return [
        { item: "Base sheet (3 sq roll)", qty: up(sq / 3), unit: "rolls" },
        { item: "Modified cap sheet (1 sq roll)", qty: up(sq), unit: "rolls" },
        { item: "Hot mop asphalt (100 lb keg)", qty: up(sq * 2), unit: "kegs" },
        { item: "Tin caps & nails", qty: up(sq / 10), unit: "boxes" },
        { item: "Lead pipe flashings", qty: r.pipes, unit: "pcs" },
        drip,
      ];
  }
}

/** Escape untrusted text before inserting it into an HTML document. */
export function escapeMaterialOrderHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}


/** Explain why aggregate metal takeoffs require roof-plane review. */
export function materialOrderWarnings(input: RoofReport): string[] {
  const parsed = reportSchema.parse(input);
  if (parsed.roof_type !== "Metal Roof") return [];
  return [
    "Metal panel count is a preliminary estimate based on combined eave length and panel coverage.",
    "Average panel length is only an area-to-eave estimate; it is not a panel cut list. Verify each roof plane's eave-to-ridge run, overhang, and trim details before ordering.",
  ];
}


export type MaterialOrderSource = "drawing" | "uploaded_report" | "manual" | "legacy";

/** Resolve trustworthy provenance from the JSON saved with a roof job. */
export function resolveMaterialOrderSource(saved: unknown): { source: MaterialOrderSource; label: string; drawingId?: string } {
  if (!saved || typeof saved !== "object" || Array.isArray(saved)) return { source: "manual", label: "Manual estimate — not drawing-verified" };
  const data = saved as Record<string, unknown>;
  const drawingId = typeof data.drawing_id === "string" && data.drawing_id.trim() ? data.drawing_id : undefined;
  if (data.source === "drawing" || (!data.source && drawingId)) return { source: "drawing", label: "Transferred from saved roof drawing", ...(drawingId ? { drawingId } : {}) };
  if (data.source === "uploaded_report") return { source: "uploaded_report", label: "Uploaded roof report — verify measurements" };
  if (data.source === "manual") return { source: "manual", label: "Manual estimate — not drawing-verified" };
  return { source: "legacy", label: "Previously saved estimate — source not recorded" };
}
