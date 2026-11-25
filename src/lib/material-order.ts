import { z } from "zod";
import { ROOF_TYPES } from "./instant-estimate-schema";
import {
  calculateRoofTakeoff,
  type MetalPlaneRun,
  type MetalTakeoffConfig,
} from "@/utils/materialTakeoff";

export const reportSchema = z.object({
  roof_type: z.enum(ROOF_TYPES),
  area_sqft: z.number().positive().max(1000000),
  waste_pct: z.number().min(0).max(50).optional(),
  ridge_lf: z.number().min(0).max(100000),
  hips_lf: z.number().min(0).max(100000),
  valleys_lf: z.number().min(0).max(100000),
  eaves_lf: z.number().min(0).max(100000),
  rakes_lf: z.number().min(0).max(100000),
  panel_width_in: z.number().min(6).max(48).default(16),
  pipes: z.number().int().min(0).max(500).default(0),
  dominant_pitch: z.number().finite().min(0).max(24).default(0),
  flat_installation_method: z.enum(["torch", "peel_and_stick"]).default("torch"),
  metal_plane_runs: z
    .array(
      z.object({
        eaveLengthFt: z.number().positive().max(100000),
        panelRunFt: z.number().positive().max(100000),
      }),
    )
    .min(1)
    .max(100)
    .optional(),
  metal_config: z
    .object({
      panelCoverageIn: z.number().positive().max(48),
      underlaymentCoverageSqFtPerRoll: z.number().positive().max(100000),
      fastenersPerPanel: z.number().positive().max(1000),
      fastenersPerBox: z.number().positive().max(100000),
      trimStickLengthFt: z.number().positive().max(100),
    })
    .optional(),
});
export type RoofReport = z.input<typeof reportSchema>;
export type MaterialLine = {
  item: string;
  qty: number;
  unit: string;
  code?: string;
  category?: string;
};
const up = (n: number) => Math.max(0, Math.ceil(n - 1e-9));
/** Material takeoff from a roof measurement report. 1 square = 100 sq ft. */
export function materialOrder(input: RoofReport): MaterialLine[] {
  const r = reportSchema.parse(input);
  const boots = { item: "Pipe boots / flashings", qty: r.pipes, unit: "pcs" };
  const wastePct = r.waste_pct ?? (r.roof_type === "Flat Roof" ? 10 : 12);
  const area = r.area_sqft * (1 + wastePct / 100);
  const sq = area / 100;
  const edges = r.eaves_lf + r.rakes_lf;
  const caps = r.ridge_lf + r.hips_lf;
  const drip = { item: "Drip edge / edge metal (10 ft)", qty: up(edges / 10), unit: "pcs" };
  if (["Shingle Roof", "Tile Roof", "Flat Roof"].includes(r.roof_type)) {
    const system =
      r.roof_type === "Shingle Roof"
        ? "shingle"
        : r.roof_type === "Tile Roof"
          ? "tile"
          : "flat_modbit";
    const takeoff = calculateRoofTakeoff(
      {
        totalAreaSqFt: r.area_sqft,
        dominantPitch: r.dominant_pitch ?? 0,
        ridgesFt: r.ridge_lf,
        hipsFt: r.hips_lf,
        valleysFt: r.valleys_lf,
        eavesFt: r.eaves_lf,
        rakesFt: r.rakes_lf,
        penetrationsCount: r.pipes,
        ...(system === "flat_modbit" ? { flatInstallationMethod: r.flat_installation_method } : {}),
      },
      system,
      r.waste_pct,
    );
    return takeoff.lineItems.map((line) => ({
      item: line.name,
      qty: line.quantity,
      unit: line.unit,
      code: line.code,
      category: line.category,
    }));
  }
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
    case "Metal Roof": {
      if (!r.metal_plane_runs?.length || !r.metal_config) {
        throw new Error(
          "Architectural metal takeoff needs measured eave-to-ridge runs for every roof plane and product-specific panel coverage, underlayment roll coverage, fasteners, and trim length. Add those values before generating the cut list.",
        );
      }
      const takeoff = calculateRoofTakeoff(
        {
          totalAreaSqFt: r.area_sqft,
          dominantPitch: r.dominant_pitch,
          ridgesFt: r.ridge_lf,
          hipsFt: r.hips_lf,
          valleysFt: r.valleys_lf,
          eavesFt: r.eaves_lf,
          rakesFt: r.rakes_lf,
          penetrationsCount: r.pipes,
          metalPlaneRuns: r.metal_plane_runs as MetalPlaneRun[],
          metalConfig: r.metal_config as MetalTakeoffConfig,
        },
        "architectural_metal",
        r.waste_pct,
      );
      return takeoff.lineItems.map((line) => ({
        item: line.name,
        qty: line.quantity,
        unit: line.unit,
        code: line.code,
        category: line.category,
      }));
    }
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
/**
 * Transfers reviewed geometry into the job's material-order workspace.
 * Metal reports can be saved before product-specific specifications are known;
 * their cut list remains empty until those specifications are supplied.
 */
export function materialOrderForTransfer(input: RoofReport): MaterialLine[] {
  const report = reportSchema.parse(input);
  if (
    report.roof_type === "Metal Roof" &&
    (!report.metal_plane_runs?.length || !report.metal_config)
  ) {
    return [];
  }
  return materialOrder(report);
}

export function materialOrderWarnings(input: RoofReport): string[] {
  const parsed = reportSchema.parse(input);
  if (parsed.roof_type !== "Metal Roof") return [];
  if (!parsed.metal_plane_runs?.length || !parsed.metal_config) {
    return [
      "Architectural metal quantities are not order-ready until every roof plane has a measured eave-to-ridge run and the selected panel, underlayment, fastener, and trim specifications are entered.",
    ];
  }
  return [
    "Verify every measured panel run, overhang, panel coverage, fastening schedule, and trim detail against the selected manufacturer's approved system before ordering.",
  ];
}

export type MaterialOrderSource = "drawing" | "uploaded_report" | "manual" | "legacy";

/** Resolve trustworthy provenance from the JSON saved with a roof job. */
export function resolveMaterialOrderSource(saved: unknown): {
  source: MaterialOrderSource;
  label: string;
  drawingId?: string;
} {
  if (!saved || typeof saved !== "object" || Array.isArray(saved))
    return { source: "manual", label: "Manual estimate — not drawing-verified" };
  const data = saved as Record<string, unknown>;
  const drawingId =
    typeof data.drawing_id === "string" && data.drawing_id.trim() ? data.drawing_id : undefined;
  if (drawingId && (data.source === "drawing" || !data.source))
    return {
      source: "drawing",
      label: "Transferred from saved roof drawing",
      ...(drawingId ? { drawingId } : {}),
    };
  if (data.source === "uploaded_report")
    return { source: "uploaded_report", label: "Uploaded roof report — verify measurements" };
  if (data.source === "manual")
    return { source: "manual", label: "Manual estimate — not drawing-verified" };
  return { source: "legacy", label: "Previously saved estimate — source not recorded" };
}
