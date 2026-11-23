import pdfWorkerUrl from "pdfjs-dist/legacy/build/pdf.worker.mjs?url";

/**
 * Extract selectable text from a PDF entirely in the browser.
 * The PDF bytes are never uploaded; image-only/scanned pages return little or no text.
 */
export async function extractRoofReportPdfText(file: File): Promise<string> {
  if (typeof window === "undefined") {
    throw new Error("PDF reading is available in the browser only.");
  }
  if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
    throw new Error("Choose a PDF file.");
  }
  if (file.size > 25 * 1024 * 1024) {
    throw new Error("PDF is larger than 25 MB. Use a smaller report.");
  }

  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

  const bytes = new Uint8Array(await file.arrayBuffer());
  const document = await pdfjs.getDocument({ data: bytes }).promise;
  try {
    if (document.numPages > 100) {
      throw new Error("PDF has more than 100 pages. Split the report into smaller files.");
    }
    const pages: string[] = [];
    let extractedLength = 0;
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const pageText = content.items
        .filter((item) => "str" in item)
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ");
      const remaining = 100_000 - extractedLength;
      if (remaining <= 0) break;
      pages.push(pageText.slice(0, remaining));
      extractedLength += Math.min(pageText.length, remaining);
      page.cleanup();
    }
    return pages.join("\\n");
  } finally {
    await document.destroy();
  }
}
