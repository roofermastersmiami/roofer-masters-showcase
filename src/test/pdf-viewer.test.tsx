import { Blob as NodeBlob } from "node:buffer";
import { resolve } from "node:path";
import { createCanvas, type Canvas } from "@napi-rs/canvas";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PdfViewer } from "@/components/dashboard/PdfViewer";
import { setPdfCanvasFactory, setPdfWorkerSource, type PdfCanvas } from "@/lib/pdf-tools-browser";

/**
 * The report PDF viewer Fredy actually clicks. The old viewer was
 * an iframe pointed at a blob: URL — when the browser's PDF plugin
 * would not render it, the dialog sat white forever with no error
 * and no progress. These tests drive the replacement through the
 * real fetch + pdf.js render path (storage and network stubbed at
 * the seams, rendering fully real): a visible percentage while the
 * PDF loads, page images when it is ready, and an honest error
 * with retry/download when it cannot load.
 */

const createSignedUrl = vi.fn();
const storageDownload = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    storage: {
      from: () => ({ createSignedUrl, download: storageDownload }),
    },
  },
}));

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

async function reportPdfFixture(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let page = 1; page <= 3; page++) {
    const sheet = doc.addPage([612, 792]);
    sheet.drawText(`Roof measurement report — page ${page}`, { x: 54, y: 720, size: 14, font });
  }
  return doc.save();
}

function streamingResponse(bytes: Uint8Array, chunkSize: number) {
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
    headers: new Headers({ "content-length": String(bytes.length) }),
    body: stream,
    arrayBuffer: async () => bytes.slice().buffer,
  };
}

const REPORT_PATH = "roof-report/order-1/report.pdf";

beforeEach(() => {
  createSignedUrl.mockReset();
  storageDownload.mockReset();
  createSignedUrl.mockResolvedValue({
    data: { signedUrl: "https://storage.example/signed/report.pdf" },
    error: null,
  });
  storageDownload.mockResolvedValue({ data: null, error: new Error("object not found") });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("PdfViewer", () => {
  it("shows a loading percentage while the PDF downloads, then renders its pages as images", async () => {
    const fixture = await reportPdfFixture();
    let releaseFetch!: () => void;
    const gate = new Promise<void>((resolveGate) => {
      releaseFetch = resolveGate;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        await gate;
        return streamingResponse(fixture, 211);
      }),
    );

    render(<PdfViewer bucket="roofing-proposals" path={REPORT_PATH} />);

    // While the bytes are still in flight there is a visible,
    // labelled percentage — not a blank white pane.
    const status = await screen.findByRole("status");
    expect(status.textContent).toMatch(/Downloading PDF…/);
    expect(status.textContent).toMatch(/\d+%/);
    expect(screen.queryByAltText("Page 1")).toBeNull();

    releaseFetch();

    expect(await screen.findByAltText("Page 1", undefined, { timeout: 15000 })).toBeTruthy();
    expect(screen.getByAltText("Page 2")).toBeTruthy();
    expect(screen.getByAltText("Page 3")).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows a real error with retry and download actions when the PDF cannot load — never an endless white page", async () => {
    const fixture = await reportPdfFixture();
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("network down"))
      .mockImplementation(async () => streamingResponse(fixture, 211));
    vi.stubGlobal("fetch", fetchMock);
    const onDownload = vi.fn();

    render(<PdfViewer bucket="roofing-proposals" path={REPORT_PATH} onDownload={onDownload} />);

    const alert = await screen.findByRole("alert", undefined, { timeout: 15000 });
    expect(alert.textContent).toMatch(/could not be displayed/i);
    expect(alert.textContent).toMatch(/object not found/);

    fireEvent.click(screen.getByRole("button", { name: /download the pdf instead/i }));
    expect(onDownload).toHaveBeenCalledTimes(1);

    // Retry runs the whole load again and lands on the rendered pages.
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(await screen.findByAltText("Page 1", undefined, { timeout: 15000 })).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
