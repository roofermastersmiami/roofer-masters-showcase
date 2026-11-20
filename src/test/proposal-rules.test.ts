import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { ROOF_CATEGORIES, proposalSchema, validPdfHeader, shareIsActive } from "@/lib/proposal-schema";
import { generateProposalPdf, applyPdfEdits, changePdfPages, getPdfFields } from "@/lib/proposal-pdf";

const details = { title: "Roofing proposal", category: "Metal Roof" as const, is_template: false, lead_id: null, scope: "Standing seam metal roof", terms: "", amount: 12345.67 };
describe("Roofing proposal rules", () => {
  for (const category of ["Metal Roof", "Tile Roof", "Shingle Roof", "TPO", "Flat Roof"] as const) {
    it(`supports ${category} templates`, () => { expect(ROOF_CATEGORIES).toContain(category); expect(proposalSchema.parse({ ...details, category, is_template: true }).category).toBe(category); });
  }
  it("accepts PDF uploads and rejects non-PDF bytes", async () => {
    expect(validPdfHeader(await generateProposalPdf(details))).toBe(true);
    expect(validPdfHeader(new TextEncoder().encode("not a PDF"))).toBe(false);
  });
  it("saves added PDF text into the document", async () => {
    const bytes = await generateProposalPdf(details);
    const result = await applyPdfEdits(bytes, [{ id: "note", page: 0, x: 0.1, y: 0.5, kind: "text", text: "Roof upgrade", size: 14 }], []);
    const pdf = await PDFDocument.load(result);
    expect(pdf.getPageCount()).toBe(1);
    expect(result.length).toBeGreaterThan(bytes.length);
  });
  it("fills existing PDF form fields", async () => {
    const pdf = await PDFDocument.create(); const page = pdf.addPage(); const field = pdf.getForm().createTextField("Roof type"); field.addToPage(page); const bytes = await pdf.save();
    const fields = await getPdfFields(bytes);
    const result = await applyPdfEdits(bytes, [], fields.map((f) => ({ ...f, value: "TPO" })));
    expect((await PDFDocument.load(result)).getForm().getTextField("Roof type").getText()).toBe("TPO");
  });
  it("merges and rotates proposal pages", async () => {
    const bytes = await generateProposalPdf(details);
    const merged = await changePdfPages(bytes, "merge", 0, bytes);
    expect((await PDFDocument.load(merged)).getPageCount()).toBe(2);
    const rotated = await changePdfPages(merged, "rotate", 0);
    expect((await PDFDocument.load(rotated)).getPage(0).getRotation().angle).toBe(90);
  });
  it("revoked and expired links cannot authorize customer access", () => {
    expect(shareIsActive({ revoked_at: "2026-11-20T00:00:00Z", expires_at: "2026-12-20T00:00:00Z" }, Date.parse("2026-11-21T00:00:00Z"))).toBe(false);
    expect(shareIsActive({ revoked_at: null, expires_at: "2026-11-20T00:00:00Z" }, Date.parse("2026-11-21T00:00:00Z"))).toBe(false);
    expect(shareIsActive({ revoked_at: null, expires_at: "2026-12-20T00:00:00Z" }, Date.parse("2026-11-21T00:00:00Z"))).toBe(true);
  });
});