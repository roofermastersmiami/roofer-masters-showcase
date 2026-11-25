import { describe, it, expect } from "vitest";
import {
  materialOrder,
  escapeMaterialOrderHtml,
  materialOrderWarnings,
  materialOrderForTransfer,
  effectiveMaterialWastePct,
} from "@/lib/material-order";
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
  lines.find((l) => l.item.toLocaleLowerCase().includes(s.toLocaleLowerCase()))?.qty;
const metal = {
  roof_type: "Metal Roof" as const,
  metal_plane_runs: [
    { eaveLengthFt: 60, panelRunFt: 20 },
    { eaveLengthFt: 60, panelRunFt: 20 },
  ],
  metal_config: {
    panelCoverageIn: 16,
    underlaymentCoverageSqFtPerRoll: 200,
    fastenersPerPanel: 4,
    fastenersPerBox: 250,
    trimStickLengthFt: 10,
  },
};
describe("material orders from roof report", () => {
  it("shingle: 3 bundles per square incl. waste", () => {
    expect(q(materialOrder({ ...base, roof_type: "Shingle Roof" }), "Architectural")).toBe(66);
  });
  it("drip edge from eaves + rakes", () => {
    expect(q(materialOrder({ ...base, ...metal }), "Drip Edge")).toBe(22);
  });
  it("metal: panel count is calculated from each measured plane and product coverage", () => {
    expect(q(materialOrder({ ...base, ...metal }), "measured plane cut list")).toBe(100);
  });
  it("metal: measured valley flashing uses the shared takeoff calculator", () => {
    expect(q(materialOrder({ ...base, ...metal }), "Valley")).toBe(4);
  });
  it("metal: refuses to create a cut list without plane runs and product data", () => {
    expect(() => materialOrder({ ...base, roof_type: "Metal Roof" })).toThrow(
      /measured eave-to-ridge/,
    );
  });
  it("TPO includes insulation boards", () => {
    expect(q(materialOrder({ ...base, roof_type: "TPO" }), "Insulation")).toBe(69);
  });
});

describe("automatic material waste", () => {
  it("reports the same complexity-based waste allowance used by default quantities", () => {
    expect(
      effectiveMaterialWastePct({
        ...base,
        hips_lf: 200,
        valleys_lf: 80,
        waste_pct: undefined,
        roof_type: "Shingle Roof",
      }),
    ).toBe(15);
    expect(effectiveMaterialWastePct({ ...base, waste_pct: undefined, roof_type: "Flat Roof" })).toBe(10);
    expect(effectiveMaterialWastePct({ ...base, waste_pct: 7, roof_type: "Shingle Roof" })).toBe(7);
  });

  it("uses the complexity-based default for shingle when no override is supplied", () => {
    const lines = materialOrder({ ...base, waste_pct: undefined, roof_type: "Shingle Roof" });
    expect(q(lines, "Architectural")).toBe(68);
  });

  it("uses the flat-system default waste when no override is supplied", () => {
    const lines = materialOrder({ ...base, waste_pct: undefined, roof_type: "Flat Roof" });
    expect(q(lines, "SBS Granulated")).toBe(23);
  });
});

describe("metal panel length and validation", () => {
  it("rejects negative dimensions and waste above the supported limit", () => {
    expect(() => materialOrder({ ...base, ...metal, eaves_lf: -1 })).toThrow();
    expect(() => materialOrder({ ...base, ...metal, waste_pct: 51 })).toThrow();
  });
});

describe("material order print escaping", () => {
  it("escapes HTML metacharacters in customer-controlled print text", () => {
    expect(escapeMaterialOrderHtml(`Roof <script>alert("x")</script> & 'metal'`)).toBe(
      "Roof &lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;metal&#39;",
    );
  });
});

describe("material takeoff review warnings", () => {
  it("requires measured roof planes and product specifications before metal ordering", () => {
    const warnings = materialOrderWarnings({ ...base, roof_type: "Metal Roof" });
    expect(warnings).toHaveLength(1);
    expect(warnings.join(" ")).toContain("measured eave-to-ridge run");
  });
  it("keeps a final verification warning after product-specific inputs are supplied", () => {
    expect(materialOrderWarnings({ ...base, ...metal }).join(" ")).toContain(
      "manufacturer's approved system",
    );
  });
  it("does not show metal panel warnings for other roof systems", () => {
    expect(materialOrderWarnings({ ...base, roof_type: "Shingle Roof" })).toEqual([]);
  });
});

describe("material order source tracking", () => {
  it("recognizes a saved drawing-linked takeoff", async () => {
    const { resolveMaterialOrderSource } = await import("@/lib/material-order");
    expect(resolveMaterialOrderSource({ drawing_id: "drawing-123" })).toEqual({
      source: "drawing",
      label: "Transferred from saved roof drawing",
      drawingId: "drawing-123",
    });
  });
  it("labels uploaded reports as requiring verification", async () => {
    const { resolveMaterialOrderSource } = await import("@/lib/material-order");
    expect(resolveMaterialOrderSource({ source: "uploaded_report" }).label).toContain("verify");
  });
  it("does not treat legacy records without provenance as drawing-verified", async () => {
    const { resolveMaterialOrderSource } = await import("@/lib/material-order");
    expect(resolveMaterialOrderSource({ report: base }).source).toBe("legacy");
    expect(resolveMaterialOrderSource({ source: "drawing" }).source).toBe("legacy");
    expect(resolveMaterialOrderSource(null).source).toBe("manual");
  });
});

describe("reviewed drawing transfer to material order", () => {
  it("transfers metal measurements before manufacturer specs are entered", () => {
    const report = {
      ...base,
      roof_type: "Metal Roof" as const,
      metal_plane_runs: [{ eaveLengthFt: 40, panelRunFt: 18 }],
    };
    expect(materialOrderForTransfer(report)).toEqual([]);
  });

  it("still builds non-metal material lines during transfer", () => {
    expect(materialOrderForTransfer({ ...base, roof_type: "Shingle Roof" }).length).toBeGreaterThan(
      0,
    );
  });

  it("builds the metal cut list when plane runs and product specifications are complete", () => {
    const report = {
      ...base,
      roof_type: "Metal Roof" as const,
      metal_plane_runs: [{ eaveLengthFt: 40, panelRunFt: 18 }],
      metal_config: {
        panelCoverageIn: 16,
        underlaymentCoverageSqFtPerRoll: 200,
        fastenersPerPanel: 4,
        fastenersPerBox: 250,
        trimStickLengthFt: 10,
      },
    };
    expect(materialOrderForTransfer(report).length).toBeGreaterThan(0);
  });
});
