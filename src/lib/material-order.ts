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
  panel_width_in: z.number().min(6).max(60).default(16),
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
          item: `Equivalent panel run length (${r.panel_width_in}" net coverage; aggregate only)`,
          qty: Math.round((area / (r.panel_width_in / 12)) * 10) / 10,
          unit: "linear ft",
        },
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

export type ParsedRoofReportText = {
  values: Partial<RoofReport>;
  found: string[];
};

/**
 * Extract only explicitly labelled measurements from copied report text.
 * This is deterministic and runs locally; it does not send report contents anywhere.
 */
export function parseRoofReportText(text: string): ParsedRoofReportText {
  const source = text.slice(0, 100_000);
  const values: Partial<RoofReport> = {};
  const found: string[] = [];
  const read = (
    label: string,
    patterns: RegExp[],
    key: keyof RoofReport,
    convert?: (n: number, unit: string) => number,
  ) => {
    for (const pattern of patterns) {
      const match = source.match(pattern);
      if (!match) continue;
      const n = Number(match[1].replace(/,/g, ""));
      if (!Number.isFinite(n) || n < 0) continue;
      const unit = (match[2] ?? "").toLowerCase();
      (values as Record<string, number>)[key] = convert ? convert(n, unit) : n;
      found.push(label);
      return;
    }
  };
  const number = "([\\d,]+(?:\\.\\d+)?)";
  const unit = "\\s*(sq\\.?\\s*ft|square feet|sq(?:uares?)?|squares?|sf|lf|linear feet|feet|ft|%)?";
  read(
    "Roof area",
    [
      new RegExp("(?:total\\s+)?(?:roof\\s+)?area\\s*[:=]?\\s*" + number + unit, "i"),
      new RegExp("total\\s+(\\d[\\d,]*(?:\\.\\d+)?)\\s*(squares?)", "i"),
    ],
    "area_sqft",
    (n, u) => (/square|squares|^sq$/.test(u) ? n * 100 : n),
  );
  read(
    "Waste",
    [new RegExp("waste(?:\\s+factor)?\\s*[:=]?\\s*" + number + "\\s*%?", "i")],
    "waste_pct",
  );
  const linear = (label: string, aliases: string[], key: keyof RoofReport) => {
    const names = aliases.join("|");
    read(
      label,
      [
        new RegExp(
          "(?:" +
            names +
            ")(?:\\s+(?:length|total))?\\s*[:=]?\\s*" +
            number +
            "\\s*(lf|linear feet|feet|ft)?",
          "i",
        ),
      ],
      key,
    );
  };
  linear("Ridge", ["ridge", "ridges"], "ridge_lf");
  linear("Hips", ["hip", "hips"], "hips_lf");
  linear("Valleys", ["valley", "valleys"], "valleys_lf");
  linear("Eaves", ["eave", "eaves"], "eaves_lf");
  linear("Rakes", ["rake", "rakes"], "rakes_lf");
  read(
    "Pipes / vents",
    [
      new RegExp(
        "(?:pipe\\s+(?:boots?|flashings?)|vents?|penetrations)\\s*(?:count)?\\s*[:=]?\\s*" + number,
        "i",
      ),
    ],
    "pipes",
  );
  const roof = source
    .match(/\\b(shingle|tile|metal|tpo|flat)\\s*(?:roof)?\\b/i)?.[1]
    ?.toLowerCase();
  if (roof) {
    values.roof_type =
      roof === "shingle"
        ? "Shingle Roof"
        : roof === "tile"
          ? "Tile Roof"
          : roof === "metal"
            ? "Metal Roof"
            : roof === "tpo"
              ? "TPO"
              : "Flat Roof";
    found.push("Roof type");
  }
  const pitch = source.match(/(?:roof\\s+)?pitch\\s*[:=]?\\s*(\\d{1,2}\\s*[:/]\\s*12)/i)?.[1];
  if (pitch) found.push("Pitch (review manually)");
  return { values, found: [...new Set(found)] };
}
