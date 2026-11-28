import { PDFDocument as CantooDocument } from "@cantoo/pdf-lib";
import { PDFDocument, StandardFonts, degrees, rgb, type PDFPage } from "pdf-lib";

/**
 * Free, in-browser PDF operations for the CRM's PDF Tools section.
 * Everything runs locally with pdf-lib (plus the cantoo fork for AES
 * encryption) — no paid API, no uploads to third-party services.
 */

const INK = rgb(0.13, 0.17, 0.21);
const NAVY = rgb(0.055, 0.16, 0.27);
const YELLOW = rgb(0.98, 0.8, 0.08);

export async function pdfPageCount(bytes: Uint8Array): Promise<number> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  return doc.getPageCount();
}

/** Combine several PDFs into one, in the order given. */
export async function combinePdfs(documents: Uint8Array[]): Promise<Uint8Array> {
  if (documents.length === 0) throw new Error("Add at least one PDF to combine.");
  const out = await PDFDocument.create();
  for (const bytes of documents) {
    const source = await PDFDocument.load(bytes);
    const pages = await out.copyPages(source, source.getPageIndices());
    pages.forEach((page) => out.addPage(page));
  }
  return out.save();
}

/**
 * Reorder, delete, and rotate pages. `pageOrder` lists the 0-based source
 * pages to keep, in the order they should appear; `rotations` maps a source
 * page index to extra clockwise degrees (90, 180, 270).
 */
export async function organizePages(
  bytes: Uint8Array,
  pageOrder: number[],
  rotations: Record<number, number> = {},
): Promise<Uint8Array> {
  const source = await PDFDocument.load(bytes);
  const count = source.getPageCount();
  if (pageOrder.length === 0) throw new Error("Keep at least one page.");
  for (const index of pageOrder) {
    if (!Number.isInteger(index) || index < 0 || index >= count)
      throw new Error(`Page ${index + 1} does not exist in this PDF.`);
  }
  const out = await PDFDocument.create();
  const copied = await out.copyPages(source, pageOrder);
  copied.forEach((page, position) => {
    const sourceIndex = pageOrder[position] ?? 0;
    const extra = rotations[sourceIndex] ?? 0;
    if (extra) page.setRotation(degrees((page.getRotation().angle + extra) % 360));
    out.addPage(page);
  });
  return out.save();
}

/** Create a simple text document PDF (title + wrapped body text). */
export async function createPdfFromText(title: string, body: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const PAGE_W = 612;
  const PAGE_H = 792;
  const MARGIN = 56;
  let page: PDFPage = doc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - 64;
  if (title.trim()) {
    page.drawText(title.trim().slice(0, 90), { x: MARGIN, y, size: 17, font: bold, color: NAVY });
    y -= 28;
  }
  const wrap = (text: string, size: number, maxWidth: number): string[] => {
    const lines: string[] = [];
    for (const paragraph of text.split(/\n/)) {
      if (!paragraph.trim()) {
        lines.push("");
        continue;
      }
      let line = "";
      for (const word of paragraph.split(/\s+/)) {
        const candidate = line ? `${line} ${word}` : word;
        if (font.widthOfTextAtSize(candidate, size) > maxWidth && line) {
          lines.push(line);
          line = word;
        } else {
          line = candidate;
        }
      }
      if (line) lines.push(line);
    }
    return lines;
  };
  for (const line of wrap(body, 11, PAGE_W - MARGIN * 2)) {
    if (y < 56) {
      page = doc.addPage([PAGE_W, PAGE_H]);
      y = PAGE_H - 64;
    }
    if (line) page.drawText(line, { x: MARGIN, y, size: 11, font, color: INK });
    y -= 16;
  }
  doc.setTitle(title || "Document");
  doc.setAuthor("Roofer Masters");
  return doc.save();
}

/** Create a PDF with one image per page (photos/scans), fitted to the page. */
export async function createPdfFromImages(
  images: Array<{ bytes: Uint8Array; kind: "png" | "jpg" }>,
): Promise<Uint8Array> {
  if (images.length === 0) throw new Error("Add at least one image.");
  const doc = await PDFDocument.create();
  for (const image of images) {
    const embedded =
      image.kind === "png" ? await doc.embedPng(image.bytes) : await doc.embedJpg(image.bytes);
    const maxW = 612 - 72;
    const maxH = 792 - 72;
    const fit = embedded.scaleToFit(maxW, maxH);
    const page = doc.addPage([612, 792]);
    page.drawImage(embedded, {
      x: (612 - fit.width) / 2,
      y: (792 - fit.height) / 2,
      width: fit.width,
      height: fit.height,
    });
  }
  return doc.save();
}

export type PdfTextEdit = {
  page: number; // 0-based
  x: number; // PDF points from left
  y: number; // PDF points from bottom
  text: string;
  size?: number;
  whiteout?: { width: number; height: number };
};

/** Edit a PDF: stamp text (optionally over a whiteout box) onto pages. */
export async function editPdfText(bytes: Uint8Array, edits: PdfTextEdit[]): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = doc.getPages();
  for (const edit of edits) {
    const page = pages[edit.page];
    if (!page) throw new Error(`Page ${edit.page + 1} does not exist in this PDF.`);
    const size = edit.size ?? 12;
    if (edit.whiteout) {
      page.drawRectangle({
        x: edit.x - 2,
        y: edit.y - 2,
        width: edit.whiteout.width,
        height: edit.whiteout.height,
        color: rgb(1, 1, 1),
      });
    }
    page.drawText(edit.text.slice(0, 300), { x: edit.x, y: edit.y, size, font, color: INK });
  }
  return doc.save();
}

export type PdfComment = {
  page: number; // 0-based
  x: number;
  y: number;
  text: string;
  author?: string;
};

/**
 * Add comments: a numbered yellow note marker is stamped at each comment
 * position and a comments page is appended listing every note, so comments
 * are visible in any PDF viewer (no proprietary annotation layer needed).
 */
export async function addComments(bytes: Uint8Array, comments: PdfComment[]): Promise<Uint8Array> {
  if (comments.length === 0) throw new Error("Add at least one comment.");
  const doc = await PDFDocument.load(bytes);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const pages = doc.getPages();
  comments.forEach((comment, index) => {
    const page = pages[comment.page];
    if (!page) throw new Error(`Page ${comment.page + 1} does not exist in this PDF.`);
    page.drawRectangle({
      x: comment.x,
      y: comment.y,
      width: 16,
      height: 16,
      color: YELLOW,
      borderColor: rgb(0.6, 0.45, 0),
      borderWidth: 0.75,
    });
    const label = String(index + 1);
    page.drawText(label, {
      x: comment.x + 8 - bold.widthOfTextAtSize(label, 9) / 2,
      y: comment.y + 4.5,
      size: 9,
      font: bold,
      color: rgb(0.2, 0.15, 0),
    });
  });
  const listPage = doc.addPage([612, 792]);
  listPage.drawText("COMMENTS", { x: 56, y: 728, size: 16, font: bold, color: NAVY });
  let y = 696;
  comments.forEach((comment, index) => {
    const heading = `${index + 1}.  Page ${comment.page + 1}${comment.author ? `  —  ${comment.author}` : ""}`;
    listPage.drawText(heading.slice(0, 95), { x: 56, y, size: 10.5, font: bold, color: INK });
    y -= 15;
    const text = comment.text.slice(0, 400);
    let line = "";
    const lines: string[] = [];
    for (const word of text.split(/\s+/)) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, 10) > 480 && line) {
        lines.push(line);
        line = word;
      } else line = candidate;
    }
    if (line) lines.push(line);
    for (const wrapped of lines) {
      listPage.drawText(wrapped, { x: 68, y, size: 10, font, color: INK });
      y -= 14;
    }
    y -= 10;
  });
  return doc.save();
}

export type FormFieldSpec = {
  page: number; // 0-based
  x: number;
  y: number;
  width: number;
  height: number;
  name: string;
  kind: "text" | "checkbox" | "dropdown";
  options?: string[];
};

/** Prepare a form: add fillable AcroForm fields to a PDF. */
export async function prepareForm(bytes: Uint8Array, fields: FormFieldSpec[]): Promise<Uint8Array> {
  if (fields.length === 0) throw new Error("Add at least one form field.");
  const doc = await PDFDocument.load(bytes);
  const form = doc.getForm();
  const pages = doc.getPages();
  const usedNames = new Set<string>();
  for (const field of fields) {
    const page = pages[field.page];
    if (!page) throw new Error(`Page ${field.page + 1} does not exist in this PDF.`);
    const name = field.name.trim().slice(0, 60);
    if (!name || usedNames.has(name))
      throw new Error(`Form field name "${name}" is empty or duplicated.`);
    usedNames.add(name);
    if (field.kind === "checkbox") {
      const checkbox = form.createCheckBox(name);
      checkbox.addToPage(page, {
        x: field.x,
        y: field.y,
        width: Math.max(12, field.height),
        height: Math.max(12, field.height),
        borderWidth: 1,
      });
    } else if (field.kind === "dropdown") {
      const dropdown = form.createDropdown(name);
      dropdown.addOptions(field.options?.length ? field.options : ["Option 1", "Option 2"]);
      dropdown.addToPage(page, {
        x: field.x,
        y: field.y,
        width: field.width,
        height: field.height,
        borderWidth: 1,
      });
    } else {
      const textField = form.createTextField(name);
      textField.addToPage(page, {
        x: field.x,
        y: field.y,
        width: field.width,
        height: field.height,
        borderWidth: 1,
      });
    }
  }
  return doc.save();
}

export type FormFieldInfo = { name: string; kind: "text" | "checkbox" | "dropdown" | "other" };

/** List the fillable fields already present in a PDF. */
export async function listFormFields(bytes: Uint8Array): Promise<FormFieldInfo[]> {
  const doc = await PDFDocument.load(bytes);
  const form = doc.getForm();
  return form.getFields().map((field) => {
    const typeName = field.constructor.name;
    const kind = typeName.includes("Text")
      ? "text"
      : typeName.includes("CheckBox")
        ? "checkbox"
        : typeName.includes("Dropdown") || typeName.includes("OptionList")
          ? "dropdown"
          : "other";
    return { name: field.getName(), kind: kind as FormFieldInfo["kind"] };
  });
}

/** Fill form fields and (by default) flatten so values cannot be changed. */
export async function fillForm(
  bytes: Uint8Array,
  values: Record<string, string | boolean>,
  flatten = true,
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes);
  const form = doc.getForm();
  for (const [name, value] of Object.entries(values)) {
    if (typeof value === "boolean") {
      const checkbox = form.getCheckBox(name);
      if (value) checkbox.check();
      else checkbox.uncheck();
    } else {
      const fields = form.getFields().filter((field) => field.getName() === name);
      const field = fields[0];
      if (!field) throw new Error(`Form field "${name}" was not found.`);
      const typeName = field.constructor.name;
      if (typeName.includes("Dropdown") || typeName.includes("OptionList")) {
        form.getDropdown(name).select(value);
      } else {
        form.getTextField(name).setText(value);
      }
    }
  }
  form.updateFieldAppearances();
  if (flatten) form.flatten();
  return doc.save();
}

export type SignaturePlacement = {
  page: number; // 0-based
  x: number;
  y: number;
  width: number; // signature image width in points; height scales by aspect
  printedName?: string;
  dateText?: string;
};

/** Fill & Sign: stamp a signature image (plus printed name/date) onto a page. */
export async function signPdf(
  bytes: Uint8Array,
  signaturePng: Uint8Array,
  placement: SignaturePlacement,
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes);
  const pages = doc.getPages();
  const page = pages[placement.page];
  if (!page) throw new Error(`Page ${placement.page + 1} does not exist in this PDF.`);
  const image = await doc.embedPng(signaturePng);
  const aspect = image.height / image.width;
  const height = placement.width * aspect;
  page.drawImage(image, { x: placement.x, y: placement.y, width: placement.width, height });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  let labelY = placement.y - 13;
  if (placement.printedName) {
    page.drawText(placement.printedName.slice(0, 60), {
      x: placement.x,
      y: labelY,
      size: 9,
      font,
      color: INK,
    });
    labelY -= 12;
  }
  if (placement.dateText) {
    page.drawText(placement.dateText.slice(0, 40), {
      x: placement.x,
      y: labelY,
      size: 9,
      font,
      color: INK,
    });
  }
  return doc.save();
}

/**
 * Protect a PDF with AES-256 encryption (cantoo pdf-lib fork).
 * Opening the file requires the user password.
 */
export async function protectPdf(
  bytes: Uint8Array,
  userPassword: string,
  ownerPassword?: string,
): Promise<Uint8Array> {
  if (!userPassword) throw new Error("Set a password to protect the PDF.");
  const doc = await CantooDocument.load(bytes);
  doc.encrypt({
    userPassword,
    ownerPassword: ownerPassword || userPassword,
    permissions: {
      printing: "highResolution",
      modifying: false,
      copying: false,
      annotating: false,
    },
  });
  return doc.save();
}

/** Check whether a PDF is password-protected (loads without decrypting). */
export async function isPdfEncrypted(bytes: Uint8Array): Promise<boolean> {
  const doc = await CantooDocument.load(bytes, { ignoreEncryption: true });
  return doc.isEncrypted;
}

/** Lossless compression pass: rebuild the file with object streams. */
export async function compressPdfLossless(bytes: Uint8Array): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const compressed = await doc.save({ useObjectStreams: true });
  // A small PDF can gain a few bytes from object-stream metadata.
  // Keep the original valid file when the serialization is not smaller.
  return compressed.length < bytes.length ? compressed : bytes;
}
