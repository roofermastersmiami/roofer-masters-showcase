import { PDFDocument } from "pdf-lib";
import { PDFDocument as CantooDocument } from "@cantoo/pdf-lib";
import { describe, expect, it } from "vitest";
import {
  addComments,
  combinePdfs,
  compressPdfLossless,
  createPdfFromImages,
  createPdfFromText,
  editPdfText,
  fillForm,
  isPdfEncrypted,
  listFormFields,
  organizePages,
  pdfPageCount,
  prepareForm,
  protectPdf,
  signPdf,
} from "@/lib/pdf-tools";

const PNG_1PX = new Uint8Array(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8Xw8AAwMCAO+ip1sAAAAASUVORK5CYII=",
    "base64",
  ),
);

async function textPdf(pages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([612, 792]);
  return doc.save();
}

describe("PDF tools core operations", () => {
  it("combines PDFs in order", async () => {
    const combined = await combinePdfs([await textPdf(2), await textPdf(3)]);
    expect(await pdfPageCount(combined)).toBe(5);
  });

  it("organizes pages: reorder, delete, rotate", async () => {
    const source = await textPdf(3);
    const organized = await organizePages(source, [2, 0], { 2: 90 });
    expect(await pdfPageCount(organized)).toBe(2);
    const doc = await PDFDocument.load(organized);
    expect(doc.getPage(0).getRotation().angle).toBe(90);
    expect(doc.getPage(1).getRotation().angle).toBe(0);
  });

  it("creates a text PDF and an image PDF", async () => {
    const text = await createPdfFromText("Hello", "Roofer Masters ".repeat(600));
    expect(await pdfPageCount(text)).toBeGreaterThan(1);
    expect(new TextDecoder().decode(text.slice(0, 5))).toBe("%PDF-");
    const images = await createPdfFromImages([
      { bytes: PNG_1PX, kind: "png" },
      { bytes: PNG_1PX, kind: "png" },
    ]);
    expect(await pdfPageCount(images)).toBe(2);
  });

  it("edits text onto a page and appends a comments page", async () => {
    const source = await textPdf(1);
    const edited = await editPdfText(source, [
      { page: 0, x: 72, y: 700, text: "Approved", size: 14 },
    ]);
    expect(await pdfPageCount(edited)).toBe(1);
    const commented = await addComments(edited, [
      { page: 0, x: 100, y: 600, text: "Check this measurement", author: "Fredy" },
    ]);
    expect(await pdfPageCount(commented)).toBe(2);
  });

  it("prepares a form, lists its fields, fills and flattens it", async () => {
    const source = await textPdf(1);
    const prepared = await prepareForm(source, [
      { page: 0, x: 72, y: 640, width: 220, height: 18, name: "Customer name", kind: "text" },
      { page: 0, x: 72, y: 600, width: 14, height: 14, name: "Accept", kind: "checkbox" },
      {
        page: 0,
        x: 72,
        y: 560,
        width: 220,
        height: 18,
        name: "Roof type",
        kind: "dropdown",
        options: ["Metal", "Shingle", "Tile"],
      },
    ]);
    const fields = await listFormFields(prepared);
    expect(fields.map((field) => field.name)).toEqual(["Customer name", "Accept", "Roof type"]);
    const filled = await fillForm(prepared, {
      "Customer name": "Ricardo Rodriguez",
      Accept: true,
      "Roof type": "Metal",
    });
    const doc = await PDFDocument.load(filled);
    expect(doc.getForm().getFields()).toHaveLength(0); // flattened
  });

  it("stamps a signature image onto a page", async () => {
    const source = await textPdf(1);
    const signed = await signPdf(source, PNG_1PX, {
      page: 0,
      x: 72,
      y: 120,
      width: 160,
      printedName: "Fredy Ortez",
      dateText: "November 26, 2026",
    });
    expect(await pdfPageCount(signed)).toBe(1);
  });

  it("protects a PDF with AES encryption", async () => {
    const source = await textPdf(1);
    expect(await isPdfEncrypted(source)).toBe(false);
    const protectedBytes = await protectPdf(source, "open-sesame", "owner-key");
    expect(await isPdfEncrypted(protectedBytes)).toBe(true);
    const opened = await CantooDocument.load(protectedBytes, { password: "open-sesame" });
    expect(opened.getPageCount()).toBe(1);
    await expect(CantooDocument.load(protectedBytes, { password: "wrong" })).rejects.toThrow();
  });

  it("runs a lossless compression pass without breaking the file", async () => {
    const source = await createPdfFromText("Report", "Line item ".repeat(400));
    const compressed = await compressPdfLossless(source);
    expect(await pdfPageCount(compressed)).toBe(await pdfPageCount(source));
    expect(compressed.length).toBeLessThanOrEqual(source.length);
  });
});
