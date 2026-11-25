import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { materialTakeoffPdf } from "@/lib/material-order-pdf";
import type { RoofReport } from "@/lib/material-order";

const report: RoofReport = {
  roof_type: "Shingle Roof",
  area_sqft: 2400,
  waste_pct: 10,
  ridge_lf: 30,
  hips_lf: 0,
  valleys_lf: 12,
  eaves_lf: 160,
  rakes_lf: 80,
  panel_width_in: 16,
  pipes: 2,
  dominant_pitch: 6,
};

describe("materialTakeoffPdf", () => {
  it("creates a separate readable PDF with project and material rows", async () => {
    const bytes = await materialTakeoffPdf({
      title: "123 Main Street",
      source: "Reviewed roof drawing",
      report,
      lines: [
        { item: "Architectural shingles", qty: 80, unit: "bundles" },
        { item: "Synthetic underlayment", qty: 4, unit: "rolls" },
      ],
    });
    expect(new TextDecoder().decode(bytes.slice(0, 8))).toContain("%PDF");
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(1);
  });

  it("adds pages for long material lists", async () => {
    const lines = Array.from({ length: 75 }, (_, index) => ({
      item: `Material line ${index + 1} with a longer description for wrapping`,
      qty: index + 1,
      unit: "pcs",
    }));
    const bytes = await materialTakeoffPdf({
      title: "Large project",
      source: "Reviewed drawing",
      report,
      lines,
    });
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBeGreaterThan(1);
  });

  it("blocks empty or incomplete takeoffs", async () => {
    await expect(
      materialTakeoffPdf({ title: "Unready", source: "Drawing", report, lines: [] }),
    ).rejects.toThrow(/cannot be generated/i);
  });
});
