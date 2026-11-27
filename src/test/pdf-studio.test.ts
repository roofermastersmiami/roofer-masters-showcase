/**
 * PDF Studio functional test pass.
 *
 * Every studio tool is exercised end-to-end against real, content-bearing
 * PDFs generated in the test (multi-page proposal with known text on known
 * pages, a form, a photo PDF, an image-only "scan"). Browser engines
 * (pdf.js rendering, rasterize/redact/compress, tesseract OCR) run through
 * the module's canvas/worker seams backed by @napi-rs/canvas, so the exact
 * production code paths are tested headlessly.
 */
import { Blob as NodeBlob } from "node:buffer";
import { mkdtempSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createCanvas, DOMMatrix, ImageData, Path2D, type Canvas } from "@napi-rs/canvas";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { PDFDocument as CantooDocument } from "@cantoo/pdf-lib";
import { describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Test-realm setup: this Node build lacks a few stage-4 APIs pdf.js 6 uses
// (standard in current browsers). Polyfill them in both realms.
// ---------------------------------------------------------------------------
{
  const patchMap = (MapCtor: typeof Map) => {
    const proto = MapCtor.prototype as unknown as {
      getOrInsert?: (key: unknown, value: unknown) => unknown;
      getOrInsertComputed?: (key: unknown, fn: (key: unknown) => unknown) => unknown;
    };
    if (typeof proto.getOrInsertComputed !== "function") {
      proto.getOrInsertComputed = function (this: Map<unknown, unknown>, key, fn) {
        if (!this.has(key)) this.set(key, fn(key));
        return this.get(key);
      };
      proto.getOrInsert = function (this: Map<unknown, unknown>, key, value) {
        if (!this.has(key)) this.set(key, value);
        return this.get(key);
      };
    }
  };
  const patchWeakMap = (WeakMapCtor: typeof WeakMap) => {
    const proto = WeakMapCtor.prototype as unknown as {
      getOrInsert?: (key: object, value: unknown) => unknown;
      getOrInsertComputed?: (key: object, fn: (key: object) => unknown) => unknown;
      has: (key: object) => boolean;
      set: (key: object, value: unknown) => unknown;
      get: (key: object) => unknown;
    };
    if (typeof proto.getOrInsertComputed !== "function") {
      proto.getOrInsertComputed = function (this: WeakMap<object, unknown>, key, fn) {
        if (!this.has(key)) this.set(key, fn(key));
        return this.get(key);
      };
      proto.getOrInsert = function (this: WeakMap<object, unknown>, key, value) {
        if (!this.has(key)) this.set(key, value);
        return this.get(key);
      };
    }
  };
  const patchUint8 = (Uint8Ctor: typeof Uint8Array) => {
    const proto = Object.getPrototypeOf(Uint8Ctor.prototype) as Record<string, unknown>;
    if (typeof new Uint8Ctor(0).toHex !== "function") {
      proto.toHex = function (this: Uint8Array) {
        return [...this].map((b) => b.toString(16).padStart(2, "0")).join("");
      };
    }
  };
  patchMap(Map);
  patchWeakMap(WeakMap);
  patchUint8(Uint8Array);
  const win = globalThis as unknown as {
    window?: { Map: typeof Map; WeakMap: typeof WeakMap; Uint8Array: typeof Uint8Array };
  };
  if (win.window) {
    patchMap(win.window.Map);
    patchWeakMap(win.window.WeakMap);
    patchUint8(win.window.Uint8Array);
  }
  (globalThis as Record<string, unknown>).DOMMatrix ??= DOMMatrix;
  (globalThis as Record<string, unknown>).ImageData ??= ImageData;
  (globalThis as Record<string, unknown>).Path2D ??= Path2D;
}

// tesseract.js decides "browser vs node" from `typeof document` when its
// modules load; under jsdom it misdetects and mangles its worker path.
// Load a fresh native copy with `document` hidden so it runs in Node mode.
vi.mock("tesseract.js", async () => {
  const req = createRequire(import.meta.url);
  const entry = req.resolve("tesseract.js");
  for (const key of Object.keys(req.cache)) {
    if (key.includes("tesseract")) delete req.cache[key];
  }
  const globals = globalThis as Record<string, unknown>;
  const savedDocument = globals.document;
  const savedWindow = globals.window;
  globals.document = undefined;
  globals.window = undefined;
  try {
    const fresh = req(entry) as typeof import("tesseract.js");
    const cachePath = mkdtempSync(join(tmpdir(), "tess-cache-"));
    return {
      ...fresh,
      createWorker: ((langs: string, oem?: unknown, options?: Record<string, unknown>) =>
        fresh.createWorker(
          langs as never,
          oem as never,
          {
            cachePath,
            ...options,
          } as never,
        )) as typeof fresh.createWorker,
    };
  } finally {
    globals.document = savedDocument;
    globals.window = savedWindow;
  }
});

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
import {
  exportPdfToImages,
  exportPdfToText,
  ocrPdfToSearchable,
  rasterizePdf,
  renderPagePreview,
  renderPdfPages,
  setPdfCanvasFactory,
  setPdfWorkerSource,
  type PdfCanvas,
} from "@/lib/pdf-tools-browser";

// Canvas seam backed by @napi-rs/canvas; keep the raw canvases so tests can
// sample pixels (redaction verification).
const rawCanvases: Canvas[] = [];
setPdfWorkerSource(resolve(process.cwd(), "node_modules/pdfjs-dist/build/pdf.worker.min.mjs"));
setPdfCanvasFactory((width, height) => {
  const canvas = createCanvas(width, height);
  rawCanvases.push(canvas);
  return {
    width,
    height,
    getContext: (type: "2d") => canvas.getContext(type) as never,
    toBlob: (callback, type, quality) => {
      void (async () => {
        try {
          const mime = type ?? "image/png";
          const buffer =
            mime === "image/jpeg"
              ? await canvas.encode("jpeg", Math.round((quality ?? 0.92) * 100))
              : canvas.toBuffer("image/png");
          callback(new NodeBlob([new Uint8Array(buffer)], { type: mime }) as Blob);
        } catch {
          callback(null);
        }
      })();
    },
    toDataURL: (type) => canvas.toDataURL(type ?? "image/png"),
  } as PdfCanvas;
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const PNG_1PX = new Uint8Array(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8Xw8AAwMCAO+ip1sAAAAASUVORK5CYII=",
    "base64",
  ),
);

/** 3-page proposal with distinct, findable text per page. */
async function proposalPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const p1 = doc.addPage([612, 792]);
  p1.drawText("Pierre Montagna Metal Roof", { x: 56, y: 720, size: 16, font: bold });
  p1.drawText("TOTAL PRICE 44500", { x: 56, y: 690, size: 14, font });
  const p2 = doc.addPage([612, 792]);
  p2.drawText("Scope of work tear off and dispose", { x: 56, y: 720, size: 12, font });
  const p3 = doc.addPage([612, 792]);
  p3.drawText("Warranty terms twenty years", { x: 56, y: 720, size: 12, font });
  return doc.save();
}

async function extraPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const label of ["Appendix A materials", "Appendix B schedule"]) {
    const page = doc.addPage([612, 792]);
    page.drawText(label, { x: 56, y: 720, size: 12, font });
  }
  return doc.save();
}

/** A photo-heavy PDF: one large JPEG page, built through the Create engine. */
async function photoPdf(): Promise<Uint8Array> {
  const canvas = createCanvas(2000, 1500);
  const ctx = canvas.getContext("2d");
  const gradient = ctx.createLinearGradient(0, 0, 2000, 1500);
  gradient.addColorStop(0, "#7a4a21");
  gradient.addColorStop(0.5, "#2e5e8c");
  gradient.addColorStop(1, "#3f7a3a");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 2000, 1500);
  for (let i = 0; i < 900; i++) {
    ctx.fillStyle = `rgb(${100 + ((i * 37) % 120)},${80 + ((i * 53) % 140)},${60 + ((i * 91) % 160)})`;
    ctx.fillRect((i * 613) % 2000, (i * 389) % 1500, 26, 26);
  }
  const jpeg = await canvas.encode("jpeg", 95);
  return createPdfFromImages([{ bytes: new Uint8Array(jpeg), kind: "jpg" }]);
}

/** An image-only "scan": text exists only as pixels, no text layer. */
async function scannedPdf(): Promise<Uint8Array> {
  const canvas = createCanvas(2000, 1200);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, 2000, 1200);
  ctx.fillStyle = "#000000";
  ctx.font = "bold 130px sans-serif";
  ctx.fillText("ROOFER MASTERS", 80, 300);
  ctx.font = "90px sans-serif";
  ctx.fillText("Metal roof proposal", 80, 520);
  const jpeg = await canvas.encode("jpeg", 92);
  return createPdfFromImages([{ bytes: new Uint8Array(jpeg), kind: "jpg" }]);
}

// ---------------------------------------------------------------------------
// Test matrix
// ---------------------------------------------------------------------------
describe("PDF Studio functional test pass", () => {
  it("combine: page count is the sum and page order is preserved", async () => {
    const combined = await combinePdfs([await proposalPdf(), await extraPdf()]);
    expect(await pdfPageCount(combined)).toBe(5);
    const text = await exportPdfToText(combined);
    expect(text.indexOf("Pierre Montagna")).toBeGreaterThanOrEqual(0);
    expect(text.indexOf("Warranty terms")).toBeGreaterThan(text.indexOf("Pierre Montagna"));
    expect(text.indexOf("Appendix A")).toBeGreaterThan(text.indexOf("Warranty terms"));
    expect(text.indexOf("Appendix B")).toBeGreaterThan(text.indexOf("Appendix A"));
  }, 120000);

  it("organize: reorder + delete + rotate verified in the output", async () => {
    const source = await proposalPdf();
    const organized = await organizePages(source, [2, 0], { 2: 90 });
    expect(await pdfPageCount(organized)).toBe(2);
    const doc = await PDFDocument.load(organized);
    expect(doc.getPage(0).getRotation().angle).toBe(90);
    expect(doc.getPage(1).getRotation().angle).toBe(0);
    const text = await exportPdfToText(organized);
    expect(text).toContain("Warranty terms");
    expect(text).toContain("Pierre Montagna");
    expect(text).not.toContain("Scope of work");
    expect(text.indexOf("Warranty terms")).toBeLessThan(text.indexOf("Pierre Montagna"));
  }, 120000);

  it("organize extract: a single page comes out as its own PDF", async () => {
    const extracted = await organizePages(await proposalPdf(), [1]);
    expect(await pdfPageCount(extracted)).toBe(1);
    expect(await exportPdfToText(extracted)).toContain("Scope of work");
  }, 120000);

  it("edit: stamped text is present in the output text layer", async () => {
    const edited = await editPdfText(await proposalPdf(), [
      { page: 0, x: 56, y: 620, text: "APPROVED BY FREDY", size: 14 },
      {
        page: 2,
        x: 56,
        y: 620,
        text: "Covered note",
        size: 12,
        whiteout: { width: 120, height: 20 },
      },
    ]);
    const text = await exportPdfToText(edited);
    expect(text).toContain("APPROVED BY FREDY");
    expect(text).toContain("Covered note");
    expect(await pdfPageCount(edited)).toBe(3);
  }, 120000);

  it("comments: markers plus a comments page carrying the note text", async () => {
    const commented = await addComments(await proposalPdf(), [
      { page: 0, x: 100, y: 600, text: "Check this measurement twice", author: "Fredy" },
      { page: 2, x: 120, y: 500, text: "Confirm warranty wording", author: "Fredy" },
    ]);
    expect(await pdfPageCount(commented)).toBe(4);
    const text = await exportPdfToText(commented);
    expect(text).toContain("COMMENTS");
    expect(text).toContain("Check this measurement twice");
    expect(text).toContain("Confirm warranty wording");
  }, 120000);

  it("create: text PDF paginates and image PDF has one page per image", async () => {
    const text = await createPdfFromText("Field Notes", "Roofer Masters ".repeat(600));
    expect(await pdfPageCount(text)).toBeGreaterThan(1);
    expect(new TextDecoder().decode(text.slice(0, 5))).toBe("%PDF-");
    expect(await exportPdfToText(text)).toContain("Field Notes");
    const images = await createPdfFromImages([
      { bytes: PNG_1PX, kind: "png" },
      { bytes: PNG_1PX, kind: "png" },
      { bytes: PNG_1PX, kind: "png" },
    ]);
    expect(await pdfPageCount(images)).toBe(3);
  }, 120000);

  it("export: every page becomes an image; text export finds all pages", async () => {
    const source = await proposalPdf();
    const pngs = await exportPdfToImages(source, "png", 72);
    expect(pngs).toHaveLength(3);
    for (const blob of pngs) {
      expect(blob.type).toBe("image/png");
      expect(blob.size).toBeGreaterThan(1000);
    }
    const jpgs = await exportPdfToImages(source, "jpeg", 72);
    expect(jpgs).toHaveLength(3);
    expect(jpgs[0]!.type).toBe("image/jpeg");
    const text = await exportPdfToText(source);
    expect(text).toContain("--- Page 1 ---");
    expect(text).toContain("--- Page 3 ---");
  }, 120000);

  it("viewer: page preview renders at the right size with a PNG data URL", async () => {
    const preview = await renderPagePreview(await proposalPdf(), 1, 300);
    expect(preview.widthPt).toBe(612);
    expect(preview.heightPt).toBe(792);
    expect(preview.dataUrl.startsWith("data:image/png")).toBe(true);
    expect(preview.dataUrl.length).toBeGreaterThan(1000);
  }, 120000);

  it("redact: the box is burned in black and the covered text is unrecoverable", async () => {
    const source = await proposalPdf();
    const redacted = await rasterizePdf(source, {
      dpi: 150,
      quality: 0.9,
      // Covers "TOTAL PRICE 44500" (x 56.., baseline y 690, size 14 on page 1)
      redactions: [{ page: 0, x: 40, y: 678, width: 320, height: 42 }],
    });
    expect(await pdfPageCount(redacted)).toBe(3);
    const text = await exportPdfToText(redacted);
    expect(text).not.toContain("44500");
    expect(text).not.toContain("TOTAL PRICE");

    // Pixel check: render page 1 of the result and sample the redacted band
    // (must be solid black) and the title band (must still show dark text on
    // white, i.e. the rest of the page survived).
    const before = rawCanvases.length;
    await renderPdfPages(redacted, 72);
    const pageCanvas = rawCanvases[before];
    expect(pageCanvas).toBeDefined();
    const ctx = pageCanvas!.getContext("2d");
    const sample = (x: number, y: number, w: number, h: number) => {
      const data = ctx.getImageData(x, y, w, h).data;
      let total = 0;
      let darkest = 255;
      for (let i = 0; i < data.length; i += 4) {
        const brightness = (data[i]! + data[i + 1]! + data[i + 2]!) / 3;
        total += brightness;
        if (brightness < darkest) darkest = brightness;
      }
      return { mean: total / (data.length / 4), darkest };
    };
    // Redaction band in pixels at 72dpi (scale 1): x 40..360, top = 792-678-42 = 72..114
    const band = sample(60, 80, 260, 24);
    expect(band.mean).toBeLessThan(25);
    // Title band: "Pierre Montagna" baseline y 720 → top ≈ 792-736=56..76
    const title = sample(56, 56, 260, 20);
    expect(title.mean).toBeGreaterThan(150);
    expect(title.darkest).toBeLessThan(100);
  }, 180000);

  it("compress (raster): photo PDF shrinks substantially and stays valid", async () => {
    const source = await photoPdf();
    const compressed = await rasterizePdf(source, { dpi: 100, quality: 0.7 });
    expect(await pdfPageCount(compressed)).toBe(1);
    expect(compressed.length).toBeLessThan(source.length * 0.6);
  }, 180000);

  it("compress (lossless): never grows the file and keeps the pages", async () => {
    const source = await createPdfFromText("Report", "Line item ".repeat(400));
    const compressed = await compressPdfLossless(source);
    expect(await pdfPageCount(compressed)).toBe(await pdfPageCount(source));
    expect(compressed.length).toBeLessThanOrEqual(source.length);
  }, 120000);

  it("prepare + fill form: values read back, then flatten locks them in", async () => {
    const prepared = await prepareForm(await proposalPdf(), [
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
    expect(fields).toEqual([
      { name: "Customer name", kind: "text" },
      { name: "Accept", kind: "checkbox" },
      { name: "Roof type", kind: "dropdown" },
    ]);
    const filled = await fillForm(
      prepared,
      { "Customer name": "Ricardo Rodriguez", Accept: true, "Roof type": "Metal" },
      false,
    );
    const filledDoc = await PDFDocument.load(filled);
    const form = filledDoc.getForm();
    expect(form.getTextField("Customer name").getText()).toBe("Ricardo Rodriguez");
    expect(form.getCheckBox("Accept").isChecked()).toBe(true);
    expect(form.getDropdown("Roof type").getSelected()).toEqual(["Metal"]);
    const flattened = await fillForm(prepared, { "Customer name": "Ricardo Rodriguez" });
    const flatDoc = await PDFDocument.load(flattened);
    expect(flatDoc.getForm().getFields()).toHaveLength(0);
    expect(await exportPdfToText(flattened)).toContain("Ricardo Rodriguez");
  }, 120000);

  it("fill & sign: signature image and printed name land on the page", async () => {
    const source = await proposalPdf();
    const signed = await signPdf(source, PNG_1PX, {
      page: 0,
      x: 72,
      y: 120,
      width: 160,
      printedName: "Fredy Ortez",
      dateText: "November 27, 2026",
    });
    expect(await pdfPageCount(signed)).toBe(3);
    expect(signed.length).toBeGreaterThan(source.length);
    const text = await exportPdfToText(signed);
    expect(text).toContain("Fredy Ortez");
    expect(text).toContain("November 27, 2026");
  }, 120000);

  it("protect: AES-256 output opens with the password and rejects a wrong one", async () => {
    const source = await proposalPdf();
    expect(await isPdfEncrypted(source)).toBe(false);
    const protectedBytes = await protectPdf(source, "open-sesame", "owner-key");
    expect(await isPdfEncrypted(protectedBytes)).toBe(true);
    const opened = await CantooDocument.load(protectedBytes, { password: "open-sesame" });
    expect(opened.getPageCount()).toBe(3);
    await expect(CantooDocument.load(protectedBytes, { password: "wrong" })).rejects.toThrow();
  }, 120000);

  it("OCR: an image-only scan becomes a searchable PDF with recovered text", async () => {
    const scan = await scannedPdf();
    const before = await exportPdfToText(scan);
    expect(before.toUpperCase()).not.toContain("ROOFER");
    const outcome = await ocrPdfToSearchable(scan, { dpi: 150 });
    expect(outcome.text.toUpperCase()).toContain("ROOFER");
    expect(outcome.text.toUpperCase()).toContain("MASTERS");
    expect(await pdfPageCount(outcome.bytes)).toBe(1);
    const after = await exportPdfToText(outcome.bytes);
    expect(after.toUpperCase()).toContain("ROOFER");
  }, 300000);

  it("studio shell: every result can be downloaded and reopened in the studio", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/components/dashboard/PdfStudio.tsx"),
      "utf8",
    );
    // ResultBar carries both required actions…
    expect(source).toContain("Download");
    expect(source).toContain("Open in studio");
    expect(source).toContain("downloadBytes(result.bytes, result.name)");
    // …and the viewer itself can download the currently open document.
    expect(source).toContain("downloadBytes(doc.bytes, doc.name)");
    // Drag & drop opening is wired.
    expect(source).toContain("onDrop");
    expect(source).toContain("dataTransfer.files");
  });
});
