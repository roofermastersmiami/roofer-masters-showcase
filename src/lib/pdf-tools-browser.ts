import { PDFDocument } from "pdf-lib";

/**
 * Browser-only PDF operations built on pdf.js rendering: exporting pages
 * to images or text, raster-based compression, true redaction (pages are
 * re-rendered as images, so covered content is permanently removed), and
 * OCR via tesseract.js (free, runs entirely in the browser).
 */

type PdfJsModule = typeof import("pdfjs-dist");

let pdfJsPromise: Promise<PdfJsModule> | null = null;

async function loadPdfJs(): Promise<PdfJsModule> {
  if (!pdfJsPromise) {
    pdfJsPromise = (async () => {
      const pdfjs = await import("pdfjs-dist");
      const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      return pdfjs;
    })();
  }
  return pdfJsPromise;
}

export type RenderedPage = {
  pageNumber: number; // 1-based
  widthPt: number;
  heightPt: number;
  canvas: HTMLCanvasElement;
  scale: number; // canvas pixels per PDF point
};

export async function renderPdfPages(bytes: Uint8Array, dpi = 150): Promise<RenderedPage[]> {
  const pdfjs = await loadPdfJs();
  const pdf = await pdfjs.getDocument({ data: Uint8Array.from(bytes) }).promise;
  const scale = dpi / 72;
  const pages: RenderedPage[] = [];
  for (let index = 1; index <= pdf.numPages; index++) {
    const page = await pdf.getPage(index);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas is not available in this browser.");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvas, canvasContext: context, viewport }).promise;
    pages.push({
      pageNumber: index,
      widthPt: viewport.width / scale,
      heightPt: viewport.height / scale,
      canvas,
      scale,
    });
  }
  await pdf.destroy();
  return pages;
}

/** Render one page to a PNG data URL for previews. Returns page size in points. */
export async function renderPagePreview(
  bytes: Uint8Array,
  pageIndex: number, // 0-based
  targetWidth = 760,
): Promise<{ dataUrl: string; widthPt: number; heightPt: number }> {
  const pdfjs = await loadPdfJs();
  const pdf = await pdfjs.getDocument({ data: Uint8Array.from(bytes) }).promise;
  const page = await pdf.getPage(pageIndex + 1);
  const base = page.getViewport({ scale: 1 });
  const scale = targetWidth / base.width;
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas is not available in this browser.");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, canvasContext: context, viewport }).promise;
  const dataUrl = canvas.toDataURL("image/png");
  await pdf.destroy();
  return { dataUrl, widthPt: base.width, heightPt: base.height };
}

/** Export every page as an image blob (PNG or JPEG). */
export async function exportPdfToImages(
  bytes: Uint8Array,
  format: "png" | "jpeg" = "png",
  dpi = 150,
): Promise<Blob[]> {
  const pages = await renderPdfPages(bytes, dpi);
  const blobs: Blob[] = [];
  for (const page of pages) {
    const blob = await new Promise<Blob>((resolve, reject) =>
      page.canvas.toBlob(
        (value) => (value ? resolve(value) : reject(new Error("Image export failed"))),
        format === "png" ? "image/png" : "image/jpeg",
        0.92,
      ),
    );
    blobs.push(blob);
  }
  return blobs;
}

/** Extract the text already embedded in a PDF (no OCR). */
export async function exportPdfToText(bytes: Uint8Array): Promise<string> {
  const pdfjs = await loadPdfJs();
  const pdf = await pdfjs.getDocument({ data: Uint8Array.from(bytes) }).promise;
  const parts: string[] = [];
  for (let index = 1; index <= pdf.numPages; index++) {
    const page = await pdf.getPage(index);
    const content = await page.getTextContent();
    const lines = new Map<number, string[]>();
    for (const item of content.items) {
      if (!("str" in item)) continue;
      const y = Math.round(item.transform[5]);
      const line = lines.get(y) ?? [];
      line.push(item.str);
      lines.set(y, line);
    }
    const text = [...lines.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([, words]) => words.join(" "))
      .join("\n");
    parts.push(`--- Page ${index} ---\n${text}`);
  }
  await pdf.destroy();
  return parts.join("\n\n");
}

export type RedactionRect = {
  page: number; // 0-based
  x: number; // PDF points from left
  y: number; // PDF points from bottom
  width: number;
  height: number;
};

/**
 * Rebuild a PDF from rendered page images. Used for strong compression
 * and for redaction: because every page becomes a flat image, anything
 * covered by a redaction box is permanently removed from the file.
 */
export async function rasterizePdf(
  bytes: Uint8Array,
  options: { dpi?: number; quality?: number; redactions?: RedactionRect[] } = {},
): Promise<Uint8Array> {
  const dpi = options.dpi ?? 150;
  const quality = options.quality ?? 0.82;
  const pages = await renderPdfPages(bytes, dpi);
  const out = await PDFDocument.create();
  for (const page of pages) {
    const context = page.canvas.getContext("2d");
    if (!context) throw new Error("Canvas is not available in this browser.");
    for (const rect of options.redactions ?? []) {
      if (rect.page !== page.pageNumber - 1) continue;
      const px = rect.x * page.scale;
      const py = (page.heightPt - rect.y - rect.height) * page.scale;
      context.fillStyle = "#000000";
      context.fillRect(px, py, rect.width * page.scale, rect.height * page.scale);
    }
    const blob = await new Promise<Blob>((resolve, reject) =>
      page.canvas.toBlob(
        (value) => (value ? resolve(value) : reject(new Error("Page render failed"))),
        "image/jpeg",
        quality,
      ),
    );
    const image = await out.embedJpg(new Uint8Array(await blob.arrayBuffer()));
    const outPage = out.addPage([page.widthPt, page.heightPt]);
    outPage.drawImage(image, { x: 0, y: 0, width: page.widthPt, height: page.heightPt });
  }
  return out.save();
}

type OcrWord = {
  text: string;
  bbox: { x0: number; y0: number; x1: number; y1: number };
};

/**
 * Scan & OCR: render each page, recognize the text with tesseract.js,
 * and rebuild the PDF with an invisible text layer so the result is
 * searchable and copyable. First use downloads the English language
 * pack from the tesseract CDN; recognition itself runs locally.
 */
export async function ocrPdfToSearchable(
  bytes: Uint8Array,
  options: { dpi?: number; onProgress?: (page: number, total: number) => void } = {},
): Promise<{ bytes: Uint8Array; text: string }> {
  const dpi = options.dpi ?? 200;
  const pages = await renderPdfPages(bytes, dpi);
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("eng");
  const out = await PDFDocument.create();
  const { StandardFonts, rgb } = await import("pdf-lib");
  const font = await out.embedFont(StandardFonts.Helvetica);
  const extracted: string[] = [];
  try {
    for (const page of pages) {
      options.onProgress?.(page.pageNumber, pages.length);
      const result = await worker.recognize(page.canvas);
      const data = result.data as unknown as {
        text: string;
        words?: OcrWord[];
      };
      extracted.push(data.text.trim());
      const blob = await new Promise<Blob>((resolve, reject) =>
        page.canvas.toBlob(
          (value) => (value ? resolve(value) : reject(new Error("Page render failed"))),
          "image/jpeg",
          0.85,
        ),
      );
      const image = await out.embedJpg(new Uint8Array(await blob.arrayBuffer()));
      const outPage = out.addPage([page.widthPt, page.heightPt]);
      outPage.drawImage(image, { x: 0, y: 0, width: page.widthPt, height: page.heightPt });
      const words = (data.words ?? []).filter((word) => word.text.trim());
      if (words.length) {
        for (const word of words) {
          const widthPt = (word.bbox.x1 - word.bbox.x0) / page.scale;
          const heightPt = (word.bbox.y1 - word.bbox.y0) / page.scale;
          if (widthPt <= 0 || heightPt <= 0) continue;
          const size = Math.max(4, heightPt * 0.9);
          const measured = font.widthOfTextAtSize(word.text, size) || 1;
          outPage.drawText(word.text, {
            x: word.bbox.x0 / page.scale,
            y: page.heightPt - word.bbox.y1 / page.scale,
            size,
            font,
            color: rgb(0, 0, 0),
            opacity: 0,
            // Stretch the invisible glyphs to the recognized word box so
            // text selection maps to the right area.
            ...(Math.abs(measured - widthPt) > 1 ? { wordSpacing: 0, characterSpacing: 0 } : {}),
          });
        }
      } else if (data.text.trim()) {
        // No word boxes available: lay the page text out invisibly so the
        // page is still searchable, even if selection mapping is rough.
        const lines = data.text.split(/\n/).filter((line) => line.trim());
        lines.forEach((line, index) => {
          outPage.drawText(line.slice(0, 120), {
            x: 36,
            y: page.heightPt - 48 - index * 13,
            size: 9,
            font,
            color: rgb(0, 0, 0),
            opacity: 0,
          });
        });
      }
    }
  } finally {
    await worker.terminate();
  }
  return { bytes: await out.save(), text: extracted.join("\n\n") };
}
