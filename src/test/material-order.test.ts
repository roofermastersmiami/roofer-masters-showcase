import { describe, it, expect } from "vitest";
import { materialOrder, escapeMaterialOrderHtml } from "@/lib/material-order";
const base = {
  area_sqft: 2000,
  waste_pct: 10,
  ridge_lf: 40,
  hips_lf: 26,
  valleys_lf: 30,
  eaves_lf: 120,
  rakes_lf: 80,
};
const q = (lines: ReturnType<typeof materialOrder>, s: string) =>
  lines.find((l) => l.item.includes(s))?.qty;
describe("material orders from roof report", () => {
  it("shingle: 3 bundles per square incl. waste", () => {
    expect(q(materialOrder({ ...base, roof_type: "Shingle Roof" }), "Architectural")).toBe(66);
  });
  it("drip edge from eaves + rakes", () => {
    expect(q(materialOrder({ ...base, roof_type: "Metal Roof" }), "Drip edge")).toBe(20);
  });
  it("metal: panels = eave length / 16in coverage plus waste", () => {
    expect(q(materialOrder({ ...base, roof_type: "Metal Roof" }), "Metal panels")).toBe(99);
  });
  it("valleys: metal valley flashing in 10 ft pieces", () => {
    expect(q(materialOrder({ ...base, roof_type: "Metal Roof" }), "Valley flashing")).toBe(3);
  });
  it("TPO includes insulation boards", () => {
    expect(q(materialOrder({ ...base, roof_type: "TPO" }), "Insulation")).toBe(69);
  });
});

describe("metal panel length and validation", () => {
  it("does not add area waste to the average panel cut length", () => {
    const noWaste = q(
      materialOrder({ ...base, roof_type: "Metal Roof", waste_pct: 0 }),
      "Average panel length",
    );
    const withWaste = q(
      materialOrder({ ...base, roof_type: "Metal Roof", waste_pct: 15 }),
      "Average panel length",
    );
    expect(noWaste).toBe(17);
    expect(withWaste).toBe(noWaste);
  });

  it("rejects negative dimensions and waste above the supported limit", () => {
    expect(() => materialOrder({ ...base, roof_type: "Metal Roof", eaves_lf: -1 })).toThrow();
    expect(() => materialOrder({ ...base, roof_type: "Metal Roof", waste_pct: 51 })).toThrow();
  });
});


describe("material order print escaping", () => {
  it("escapes HTML metacharacters in customer-controlled print text", () => {
    expect(escapeMaterialOrderHtml(`Roof <script>alert("x")</script> & 'metal'`)).toBe(
      "Roof &lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;metal&#39;",
    );
  });
});
