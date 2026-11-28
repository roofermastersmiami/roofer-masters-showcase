import { Blob as NodeBlob } from "node:buffer";
import { resolve } from "node:path";
import { createCanvas, type Canvas } from "@napi-rs/canvas";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchStoragePdf, type PdfFetchProgress } from "@/lib/pdf-fetch";
import {
  renderPdfPagePreviews,
  setPdfCanvasFactory,
  setPdfWorkerSource,
  type PdfCanvas,
} from "@/lib/pdf-tools-browser";

/**
 * The report viewer's data path. The white-screen bug was the old
 * viewer handing a blob: URL to the browser's PDF plugin; these
 * tests pin the replacement's contract: the viewer reads the exact
 * bucket + path the auto-finish engine uploads report PDFs to
 * (roofing-proposals, roof-report/<order-id>/<uuid>.pdf), reports
 * real byte progress, and renders the fetched bytes into page
 * images through the real pdf.js path.
 */

// ---------------------------------------------------------------------------
// Storage seam: records the bucket the viewer asks for.
// ---------------------------------------------------------------------------
const seenBuckets: string[] = [];
const createSignedUrl = vi.fn();
const storageDownload = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    storage: {
      from: (bucket: string) => {
        seenBuckets.push(bucket);
        return { createSignedUrl, download: storageDownload };
      },
    },
  },
}));

// Canvas seam backed by @napi-rs/canvas (same as pdf-studio.test.ts).
setPdfWorkerSource(resolve(process.cwd(), "src/test/pdfjs-worker.mjs"));
setPdfCanvasFactory((width, height) => {
  const canvas: Canvas = createCanvas(width, height);
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

/** A real generated PDF: three pages with drawn text, standing in
 * for a measurement report the engine produced. */
async function reportPdfFixture(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let page = 1; page <= 3; page++) {
    const sheet = doc.addPage([612, 792]);
    sheet.drawText(`Roof measurement report — page ${page}`, { x: 54, y: 720, size: 14, font });
    sheet.drawText("4311 SW 32nd Dr, West Park, FL 33023", { x: 54, y: 696, size: 11, font });
  }
  return doc.save();
}

/** A fetch Response whose body streams the bytes in fixed chunks. */
function streamingResponse(bytes: Uint8Array, chunkSize: number, withLength = true) {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        controller.enqueue(bytes.slice(offset, offset + chunkSize));
      }
      controller.close();
    },
  });
  return {
    ok: true,
    status: 200,
    headers: new Headers(withLength ? { "content-length": String(bytes.length) } : {}),
    body: stream,
    arrayBuffer: async () => bytes.slice().buffer,
  };
}

const ORDER_ID = "11111111-1111-4111-8111-111111111111";
const REPORT_PATH = `roof-report/${ORDER_ID}/22222222-2222-4222-8222-222222222222.pdf`;

beforeEach(() => {
  seenBuckets.length = 0;
  createSignedUrl.mockReset();
  storageDownload.mockReset();
  createSignedUrl.mockResolvedValue({
    data: { signedUrl: "https://storage.example/signed/report.pdf" },
    error: null,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchStoragePdf", () => {
  it("reads the exact bucket and path the auto-finish engine uploads report PDFs to, with real byte progress", async () => {
    const fixture = await reportPdfFixture();
    const fetchMock = vi.fn(async () => streamingResponse(fixture, 257));
    vi.stubGlobal("fetch", fetchMock);

    const progress: PdfFetchProgress[] = [];
    const bytes = await fetchStoragePdf("roofing-proposals", REPORT_PATH, {
      onProgress: (next) => progress.push(next),
    });

    // The engine uploads to supabase.storage.from("roofing-proposals")
    // at roof-report/<order-id>/<uuid>.pdf (src/lib/auto-finish.ts);
    // the viewer must ask for exactly that object.
    expect(seenBuckets).toEqual(["roofing-proposals"]);
    expect(createSignedUrl).toHaveBeenCalledWith(REPORT_PATH, expect.any(Number));
    expect(fetchMock).toHaveBeenCalledWith(
      "https://storage.example/signed/report.pdf",
      expect.objectContaining({ signal: expect.anything() }),
    );
    expect(bytes).toEqual(fixture);
    expect(progress.length).toBeGreaterThan(1);
    const fractions = progress.map((entry) => entry.fraction);
    expect(fractions[fractions.length - 1]).toBe(1);
    for (let index = 1; index < fractions.length; index++) {
      expect(fractions[index]!).toBeGreaterThanOrEqual(fractions[index - 1]!);
    }
    expect(progress[progress.length - 1]!.total).toBe(fixture.length);
    expect(progress[progress.length - 1]!.loaded).toBe(fixture.length);
  });

  it("falls back to the storage download when the signed URL cannot be created", async () => {
    const fixture = await reportPdfFixture();
    createSignedUrl.mockResolvedValue({ data: null, error: new Error("no signed url") });
    storageDownload.mockResolvedValue({
      data: new NodeBlob([new Uint8Array(fixture)], { type: "application/pdf" }),
      error: null,
    });
    const bytes = await fetchStoragePdf("roofing-proposals", REPORT_PATH);
    expect(storageDownload).toHaveBeenCalledWith(REPORT_PATH);
    expect(bytes).toEqual(fixture);
  });

  it("rejects stored bytes that are not a PDF instead of handing them to a viewer", async () => {
    const notPdf = new TextEncoder().encode("this is not a pdf at all");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => streamingResponse(notPdf, 4)),
    );
    await expect(fetchStoragePdf("roofing-proposals", REPORT_PATH)).rejects.toThrow(
      /not a valid PDF/,
    );
  });

  it("surfaces the storage error when both paths fail", async () => {
    createSignedUrl.mockResolvedValue({ data: null, error: new Error("no signed url") });
    storageDownload.mockResolvedValue({ data: null, error: new Error("object not found") });
    await expect(fetchStoragePdf("roofing-proposals", REPORT_PATH)).rejects.toThrow(
      /object not found/,
    );
  });
});

describe("renderPdfPagePreviews", () => {
  it("renders every page of a real report PDF to an image, reporting pages as they finish", async () => {
    const fixture = await reportPdfFixture();
    const seen: Array<[number, number]> = [];
    const previews = await renderPdfPagePreviews(fixture, {
      targetWidth: 300,
      onPage: (done, total) => seen.push([done, total]),
    });
    expect(previews).toHaveLength(3);
    expect(seen).toEqual([
      [1, 3],
      [2, 3],
      [3, 3],
    ]);
    for (const preview of previews) {
      expect(preview.dataUrl.startsWith("data:image/png")).toBe(true);
      expect(preview.dataUrl.length).toBeGreaterThan(1000);
      expect(preview.widthPt).toBe(612);
      expect(preview.heightPt).toBe(792);
    }
  });
});
