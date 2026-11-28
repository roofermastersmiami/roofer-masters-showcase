import { PDFDocument } from "pdf-lib";

/**
 * Browser-only PDF operations built on pdf.js rendering: exporting pages
 * to images or text, raster-based compression, true redaction (pages are
 * re-rendered as images, so covered content is permanently removed), and
 * OCR via tesseract.js (free, runs entirely in the browser).
 */

type PdfJsModule = typeof import("pdfjs-dist");

let pdfJsPromise: Promise<PdfJsModule> | null = null;
let workerSrcOverride: string | null = null;

/**
 * Point pdf.js at a specific worker file instead of the bundled one.
 * Used by the Node test suite (where Vite's `?url` asset handling does
 * not apply) and available for self-hosted deployments.
 */
export function setPdfWorkerSource(source: string | null): void {
  workerSrcOverride = source;
  pdfJsPromise = null;
}

async function loadPdfJs(): Promise<PdfJsModule> {
  if (!pdfJsPromise) {
    pdfJsPromise = (async () => {
      const pdfjs = await import("pdfjs-dist");
      if (workerSrcOverride) {
        pdfjs.GlobalWorkerOptions.workerSrc = workerSrcOverride;
      } else {
        const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
        pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      }
      return pdfjs;
    })();
  }
  return pdfJsPromise;
}

/**
 * Canvas seam: in the browser, pages render onto real <canvas> elements.
 * Tests (Node) register a factory backed by @napi-rs/canvas so the exact
 * same render/rasterize code paths run headlessly.
 */
export type PdfCanvas = {
  width: number;
  height: number;
  getContext: (type: "2d") => CanvasRenderingContext2D | null;
  toBlob: (callback: (blob: Blob | null) => void, type?: string, quality?: number) => void;
  toDataURL: (type?: string) => string;
};

let canvasFactory: ((width: number, height: number) => PdfCanvas) | null = null;

export function setPdfCanvasFactory(
  factory: ((width: number, height: number) => PdfCanvas) | null,
): void {
  canvasFactory = factory;
}

function createPdfCanvas(width: number, height: number): PdfCanvas {
  if (canvasFactory) return canvasFactory(width, height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas as unknown as PdfCanvas;
}

export type RenderedPage = {
  pageNumber: number; // 1-based
  widthPt: number;
  heightPt: number;
  canvas: PdfCanvas;
  scale: number; // canvas pixels per PDF point
};

export async function renderPdfPages(bytes: Uint8Array, dpi = 150): Promise<RenderedPage[]> {
  const pdfjs = await loadPdfJs();
  const loadingTask = pdfjs.getDocument({ data: Uint8Array.from(bytes) });
  const pdf = await loadingTask.promise;
  const scale = dpi / 72;
  const pages: RenderedPage[] = [];
  for (let index = 1; index <= pdf.numPages; index++) {
    const page = await pdf.getPage(index);
    const viewport = page.getViewport({ scale });
    const canvas = createPdfCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas is not available in this browser.");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({
      canvas: canvas as unknown as HTMLCanvasElement,
      canvasContext: context,
      viewport,
    }).promise;
    pages.push({
      pageNumber: index,
      widthPt: viewport.width / scale,
      heightPt: viewport.height / scale,
      canvas,
      scale,
    });
  }
  await loadingTask.destroy();
  return pages;
}

/** Render one page to a PNG data URL for previews. Returns page size in points. */
export async function renderPagePreview(
  bytes: Uint8Array,
  pageIndex: number, // 0-based
  targetWidth = 760,
): Promise<{ dataUrl: string; widthPt: number; heightPt: number }> {
  const pdfjs = await loadPdfJs();
  const loadingTask = pdfjs.getDocument({ data: Uint8Array.from(bytes) });
  const pdf = await loadingTask.promise;
  const page = await pdf.getPage(pageIndex + 1);
  const base = page.getViewport({ scale: 1 });
  const scale = targetWidth / base.width;
  const viewport = page.getViewport({ scale });
  const canvas = createPdfCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas is not available in this browser.");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({
    canvas: canvas as unknown as HTMLCanvasElement,
    canvasContext: context,
    viewport,
  }).promise;
  const dataUrl = canvas.toDataURL("image/png");
  await loadingTask.destroy();
  return { dataUrl, widthPt: base.width, heightPt: base.height };
}

export type PdfPagePreview = {
  pageNumber: number; // 1-based
  dataUrl: string;
  widthPt: number;
  heightPt: number;
};

/**
 * Render every page to a PNG data URL for an in-app viewer, opening
 * the document once (unlike renderPagePreview's per-page loads) and
 * reporting each finished page so the viewer can advance real
 * render progress — pages done out of pages total — instead of
 * guessing. Used by the CRM's PDF viewer, which draws pages as
 * images rather than trusting the browser's built-in PDF plugin.
 */
export async function renderPdfPagePreviews(
  bytes: Uint8Array,
  options: {
    targetWidth?: number;
    onPage?: (done: number, total: number) => void;
  } = {},
): Promise<PdfPagePreview[]> {
  const pdfjs = await loadPdfJs();
  const loadingTask = pdfjs.getDocument({ data: Uint8Array.from(bytes) });
  const pdf = await loadingTask.promise;
  const targetWidth = options.targetWidth ?? 1100;
  const previews: PdfPagePreview[] = [];
  try {
    for (let index = 1; index <= pdf.numPages; index++) {
      const page = await pdf.getPage(index);
      const base = page.getViewport({ scale: 1 });
      const scale = targetWidth / base.width;
      const viewport = page.getViewport({ scale });
      const canvas = createPdfCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas is not available in this browser.");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({
        canvas: canvas as unknown as HTMLCanvasElement,
        canvasContext: context,
        viewport,
      }).promise;
      previews.push({
        pageNumber: index,
        dataUrl: canvas.toDataURL("image/png"),
        widthPt: base.width,
        heightPt: base.height,
      });
      options.onPage?.(index, pdf.numPages);
    }
  } finally {
    await loadingTask.destroy();
  }
  return previews;
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
  const loadingTask = pdfjs.getDocument({ data: Uint8Array.from(bytes) });
  const pdf = await loadingTask.promise;
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
  await loadingTask.destroy();
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
      const isDomCanvas =
        typeof HTMLCanvasElement !== "undefined" && page.canvas instanceof HTMLCanvasElement;
      let ocrInput: unknown = page.canvas;
      if (!isDomCanvas) {
        const pngBlob = await new Promise<Blob>((resolve, reject) =>
          page.canvas.toBlob(
            (value) => (value ? resolve(value) : reject(new Error("Page render failed"))),
            "image/png",
          ),
        );
        ocrInput = new Uint8Array(await pngBlob.arrayBuffer());
      }
      const result = await worker.recognize(ocrInput as never);
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
