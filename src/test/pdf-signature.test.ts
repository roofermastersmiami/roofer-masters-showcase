import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
  StandardFonts,
  decodePDFRawStream,
} from "pdf-lib";
import { describe, expect, it } from "vitest";
import {
  allSignersCompleted,
  clampFieldToPage,
  createSignatureRequestSchema,
  displayRectToPdf,
  fractionToPdfPoint,
  missingRequiredValues,
  pdfRectToDisplay,
  renderScale,
  signerLinkIsActive,
  validateSignerValues,
  type SignatureField,
} from "@/lib/pdf-signature-fields";
import { stampSignerFields } from "@/lib/pdf-signature-stamp";

const PNG_1PX = new Uint8Array(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8Xw8AAwMCAO+ip1sAAAAASUVORK5CYII=",
    "base64",
  ),
);
const PNG_DATA_URL = `data:image/png;base64,${Buffer.from(PNG_1PX).toString("base64")}`;

const LETTER = { widthPt: 612, heightPt: 792 };

function field(partial: Partial<SignatureField>): SignatureField {
  return {
    id: "f1",
    type: "signature",
    page: 0,
    x: 72,
    y: 100,
    width: 180,
    height: 48,
    signerIndex: 0,
    required: true,
    label: "Signature",
    ...partial,
  };
}

describe("signature field coordinate conversion", () => {
  it("round-trips PDF points ↔ display pixels at several zooms", () => {
    const original = { x: 123.4, y: 456.7, width: 180, height: 48 };
    for (const displayWidth of [306, 612, 918, 1224]) {
      const scale = renderScale(LETTER, displayWidth);
      const display = pdfRectToDisplay(original, LETTER, scale);
      const back = displayRectToPdf(display, LETTER, scale);
      expect(back.x).toBeCloseTo(original.x, 6);
      expect(back.y).toBeCloseTo(original.y, 6);
      expect(back.width).toBeCloseTo(original.width, 6);
      expect(back.height).toBeCloseTo(original.height, 6);
    }
  });

  it("maps the top-left of the rendered page to the top-left in PDF points", () => {
    const display = pdfRectToDisplay({ x: 0, y: 692, width: 100, height: 100 }, LETTER, 2);
    expect(display.left).toBe(0);
    expect(display.top).toBe(0);
    const bottom = pdfRectToDisplay({ x: 0, y: 0, width: 100, height: 100 }, LETTER, 2);
    expect(bottom.top).toBe((792 - 100) * 2);
  });

  it("converts click fractions to PDF points (origin flips vertically)", () => {
    expect(fractionToPdfPoint(0, 0, LETTER)).toEqual({ x: 0, y: 792 });
    expect(fractionToPdfPoint(1, 1, LETTER)).toEqual({ x: 612, y: 0 });
    expect(fractionToPdfPoint(0.5, 0.5, LETTER)).toEqual({ x: 306, y: 396 });
  });

  it("clamps fields inside the page and enforces a minimum size", () => {
    const clamped = clampFieldToPage({ x: 590, y: -20, width: 180, height: 48 }, LETTER);
    expect(clamped.x).toBe(612 - 180);
    expect(clamped.y).toBe(0);
    const tiny = clampFieldToPage({ x: 10, y: 10, width: 2, height: 2 }, LETTER);
    expect(tiny.width).toBeGreaterThanOrEqual(14);
    expect(tiny.height).toBeGreaterThanOrEqual(12);
  });
});

/** Decode a page's content stream and pull out the text of every `<hex> Tj`. */
async function pageContent(bytes: Uint8Array, pageIndex: number) {
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(pageIndex);
  const contents = page.node.Contents();
  const streams: unknown[] = [];
  if (contents instanceof PDFArray) {
    for (const ref of contents.asArray()) streams.push(doc.context.lookup(ref));
  } else if (contents) {
    streams.push(doc.context.lookup(contents));
  }
  let raw = "";
  for (const stream of streams) {
    if (stream instanceof PDFRawStream)
      raw += new TextDecoder("latin1").decode(decodePDFRawStream(stream).decode());
  }
  const texts: string[] = [];
  for (const match of raw.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) {
    const hex = match[1]!;
    let text = "";
    for (let i = 0; i < hex.length; i += 2)
      text += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
    texts.push(text);
  }
  return { raw, text: texts.join(" ") };
}

async function threePagePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const label of ["Body of page one", "Body of page two", "Body of page three"]) {
    const page = doc.addPage([612, 792]);
    page.drawText(label, { x: 72, y: 720, size: 12, font });
  }
  return doc.save();
}

describe("stamping a signer's fields onto a real multi-page PDF", () => {
  const fields: SignatureField[] = [
    field({
      id: "name",
      type: "name",
      label: "Full name",
      page: 0,
      x: 72,
      y: 640,
      width: 220,
      height: 28,
    }),
    field({
      id: "date",
      type: "date",
      label: "Date signed",
      page: 0,
      x: 72,
      y: 600,
      width: 160,
      height: 28,
    }),
    field({
      id: "agree",
      type: "checkbox",
      label: "I agree",
      page: 1,
      x: 72,
      y: 640,
      width: 20,
      height: 20,
    }),
    field({
      id: "sig",
      type: "signature",
      label: "Signature",
      page: 2,
      x: 72,
      y: 100,
      width: 180,
      height: 48,
    }),
    field({
      id: "note",
      type: "text",
      label: "Note",
      page: 2,
      x: 72,
      y: 640,
      width: 220,
      height: 28,
      required: false,
    }),
    // Second signer's signature sits on page 1 — must NOT be stamped for signer 0.
    field({
      id: "sig2",
      type: "signature",
      label: "Co-signer",
      page: 0,
      x: 300,
      y: 100,
      signerIndex: 1,
    }),
  ];
  const values = {
    name: "Maria Piega",
    date: "November 27, 2026",
    agree: "true",
    sig: PNG_DATA_URL,
    note: "Approved as-is",
    sig2: PNG_DATA_URL,
  };

  it("stamps text values on the pages they were placed on", async () => {
    const stamped = await stampSignerFields(await threePagePdf(), fields, 0, values);
    const doc = await PDFDocument.load(stamped);
    expect(doc.getPageCount()).toBe(3);
    const page1 = await pageContent(stamped, 0);
    expect(page1.text).toContain("Maria Piega");
    expect(page1.text).toContain("November 27, 2026");
    expect(page1.text).toContain("Body of page one"); // original content untouched
    const page3 = await pageContent(stamped, 2);
    expect(page3.text).toContain("Approved as-is");
    const page2 = await pageContent(stamped, 1);
    expect(page2.text).not.toContain("Maria Piega");
  });

  it("draws the checkbox check mark as strokes at the placed position", async () => {
    const source = await threePagePdf();
    const before = await pageContent(source, 1);
    const stamped = await stampSignerFields(source, fields, 0, values);
    const after = await pageContent(stamped, 1);
    expect(after.raw.length).toBeGreaterThan(before.raw.length);
    // Field at (72, 640), 20×20: the check starts at (72 + 20·0.22, 640 + 20·0.32).
    expect(after.raw).toContain("76.4 646.4 m");
    expect(after.raw).toMatch(/\nS\n/); // stroke operator paints the check
  });

  it("stamps the signature image at the exact placed position, for the right signer only", async () => {
    const stamped = await stampSignerFields(await threePagePdf(), fields, 0, values);
    const page3 = await pageContent(stamped, 2);
    // pdf-lib emits the drawImage transform as a chain of `cm` matrices
    // before the image's Do operator; compose them (stream order) to get
    // the final placement of the unit square.
    const doIndex = page3.raw.indexOf(" Do");
    expect(doIndex).toBeGreaterThan(0);
    const matrices = [
      ...page3.raw
        .slice(0, doIndex)
        .matchAll(/([\d.-]+) ([\d.-]+) ([\d.-]+) ([\d.-]+) ([\d.-]+) ([\d.-]+) cm/g),
    ].map(
      (match) => match.slice(1).map(Number) as [number, number, number, number, number, number],
    );
    expect(matrices.length).toBeGreaterThan(0);
    const compose = (
      A: [number, number, number, number, number, number],
      B: [number, number, number, number, number, number],
    ): [number, number, number, number, number, number] => [
      A[0] * B[0] + A[2] * B[1],
      A[1] * B[0] + A[3] * B[1],
      A[0] * B[2] + A[2] * B[3],
      A[1] * B[2] + A[3] * B[3],
      A[0] * B[4] + A[2] * B[5] + A[4],
      A[1] * B[4] + A[3] * B[5] + A[5],
    ];
    let net: [number, number, number, number, number, number] = [1, 0, 0, 1, 0, 0];
    for (const matrix of matrices) net = compose(net, matrix);
    // The 1×1 PNG fits inside the 180×48 box (inset 4) as 44×44, centred:
    // x = 72 + (180 − 44)/2 = 140, y = 100 + (48 − 44)/2 = 102.
    expect(net[0]).toBeCloseTo(44, 0); // drawn width
    expect(net[3]).toBeCloseTo(44, 0); // drawn height
    expect(net[4]).toBeCloseTo(140, 0); // drawn x
    expect(net[5]).toBeCloseTo(102, 0); // drawn y
    // The XObject it draws is a real image.
    const doc = await PDFDocument.load(stamped);
    const resources = doc.getPage(2).node.Resources();
    const xobjects = resources?.lookup(PDFName.of("XObject"), PDFDict);
    const imageEntry = xobjects
      ?.entries()
      .find(([, obj]) => doc.context.lookup(obj) instanceof PDFRawStream);
    expect(imageEntry).toBeTruthy();
    // Signer 1's signature field is on page 1: nothing was drawn there.
    const page1 = await pageContent(stamped, 0);
    expect(page1.raw).not.toContain(" Do");
  });
});

describe("signature request lifecycle rules", () => {
  const future = new Date(Date.now() + 86_400_000).toISOString();
  const past = new Date(Date.now() - 86_400_000).toISOString();

  it("keeps a signer link active only while unrevoked, unexpired and unsigned", () => {
    const request = { revoked_at: null, expires_at: future };
    expect(signerLinkIsActive(request, { completedAt: null })).toBe(true);
    expect(signerLinkIsActive(request, { completedAt: future })).toBe(false);
    expect(signerLinkIsActive({ ...request, revoked_at: past }, { completedAt: null })).toBe(false);
    expect(signerLinkIsActive({ revoked_at: null, expires_at: past }, { completedAt: null })).toBe(
      false,
    );
  });

  it("reports missing required values per signer, with checkbox semantics", () => {
    const fields = [
      field({ id: "a", type: "name", label: "Full name" }),
      field({ id: "b", type: "checkbox", label: "I agree" }),
      field({ id: "c", type: "text", label: "Note", required: false }),
      field({ id: "d", type: "signature", label: "Other signature", signerIndex: 1 }),
    ];
    expect(missingRequiredValues(fields, 0, {})).toEqual(["Full name", "I agree"]);
    expect(missingRequiredValues(fields, 0, { a: "Maria", b: "false" })).toEqual(["I agree"]);
    expect(missingRequiredValues(fields, 0, { a: "Maria", b: "true" })).toEqual([]);
    expect(missingRequiredValues(fields, 1, {})).toEqual(["Other signature"]);
  });

  it("validates signature payloads and text lengths", () => {
    const fields = [
      field({ id: "s", type: "signature" }),
      field({ id: "t", type: "text", label: "Note" }),
    ];
    expect(validateSignerValues(fields, 0, { s: PNG_DATA_URL })).toBeNull();
    expect(validateSignerValues(fields, 0, { s: "not-a-signature" })).toMatch(/drawn or typed/);
    expect(validateSignerValues(fields, 0, { t: "x".repeat(301) })).toMatch(/too long/);
    // Another signer's fields are not validated against this signer.
    expect(validateSignerValues(fields, 1, { s: "junk" })).toBeNull();
  });

  it("completes a request only when every signer has signed", () => {
    expect(allSignersCompleted([{ completedAt: "x" }, { completedAt: "y" }])).toBe(true);
    expect(allSignersCompleted([{ completedAt: "x" }, { completedAt: null }])).toBe(false);
    expect(allSignersCompleted([])).toBe(false);
  });

  it("validates the create-request payload (1–2 signers, placed fields)", () => {
    const base = {
      documentName: "Roof report.pdf",
      documentBase64: "JVBERi0xLjQ=",
      signers: [{ name: "Maria Piega", email: "maria@example.com" }],
      fields: [field({})],
    };
    expect(createSignatureRequestSchema.safeParse(base).success).toBe(true);
    expect(
      createSignatureRequestSchema.safeParse({
        ...base,
        signers: [...base.signers, ...base.signers, ...base.signers],
      }).success,
    ).toBe(false);
    expect(createSignatureRequestSchema.safeParse({ ...base, fields: [] }).success).toBe(false);
    expect(
      createSignatureRequestSchema.safeParse({
        ...base,
        signers: [{ name: "Maria", email: "not-an-email" }],
      }).success,
    ).toBe(false);
  });
});

describe("CRM entry points open the new PDF Studio (Fredy's requirement)", () => {
  const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

  it("roof reports: Fill & Sign hands the report PDF to PDF Studio, old signer dialog is gone", () => {
    const source = read("src/components/dashboard/RoofReports.tsx");
    expect(source).toContain("openPdfStudio");
    expect(source).toContain("fillAndSign");
    expect(source).not.toContain("PdfContractSigner");
    expect(existsSync(resolve(process.cwd(), "src/components/PdfContractSigner.tsx"))).toBe(false);
  });

  it("proposals: Edit PDF opens the proposal in PDF Studio, old editor dialog is gone", () => {
    const source = read("src/components/dashboard/Proposals.tsx");
    expect(source).toContain("openPdfStudio");
    expect(source).not.toContain("PdfEditor");
    expect(existsSync(resolve(process.cwd(), "src/components/dashboard/PdfEditor.tsx"))).toBe(
      false,
    );
  });

  it("the studio renders the signature studio for the esign tool and consumes handed-off PDFs", () => {
    const studio = read("src/components/dashboard/PdfStudio.tsx");
    expect(studio).toContain("PdfSignatureStudio");
    expect(studio).toContain("pdfStudioRequest");
    const context = read("src/components/dashboard/CrmContext.tsx");
    expect(context).toContain("openPdfStudio");
  });
});
