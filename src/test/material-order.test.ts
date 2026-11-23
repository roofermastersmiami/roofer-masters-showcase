import { describe, it, expect } from "vitest";
import { materialOrder } from "@/lib/material-order";
const base = { area_sqft: 2000, waste_pct: 10, ridge_lf: 40, hips_lf: 26, valleys_lf: 30, eaves_lf: 120, rakes_lf: 80 };
const q = (lines: ReturnType<typeof materialOrder>, s: string) => lines.find((l) => l.item.includes(s))?.qty;
describe("material orders from roof report", () => {
  it("shingle: 3 bundles per square incl. waste", () => { expect(q(materialOrder({ ...base, roof_type: "Shingle Roof" }), "Architectural")).toBe(66); });
  it("drip edge from eaves + rakes", () => { expect(q(materialOrder({ ...base, roof_type: "Metal Roof" }), "Drip edge")).toBe(20); });
  it("metal: reports aggregate panel run length without inventing a panel count", () => { expect(q(materialOrder({ ...base, roof_type: "Metal Roof" }), "Equivalent panel run length")).toBe(1650); expect(q(materialOrder({ ...base, roof_type: "Metal Roof" }), "Metal panels")).toBeUndefined(); });
  it("valleys: metal valley flashing in 10 ft pieces", () => { expect(q(materialOrder({ ...base, roof_type: "Metal Roof" }), "Valley flashing")).toBe(3); });
  it("TPO includes insulation boards", () => { expect(q(materialOrder({ ...base, roof_type: "TPO" }), "Insulation")).toBe(69); });
});
