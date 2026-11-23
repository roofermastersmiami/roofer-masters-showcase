import logoMark from "@/assets/logo-mark.webp";
import {
  PDFDocument,
  StandardFonts,
  rgb,
  PDFTextField,
  PDFCheckBox,
  PDFDropdown,
  PDFOptionList,
} from "pdf-lib";
import type { ProposalDetails } from "./proposal-schema";

// PDF ink is document content, not an application theme color.
const ink = rgb(0.1, 0.12, 0.15);
const brand = rgb(0, 0.247, 0.416);
const clean = (text: string) =>
  text.replace(/[^\x20-\x7E\n\r\u00A0-\u00FF]/g, (c) =>
    c === "•" ? "-" : c === "—" || c === "–" ? "-" : "",
  );
async function loadLogoPng(): Promise<Uint8Array> {
  const response = await fetch(logoMark);
  const bitmap = await createImageBitmap(await response.blob());
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;

  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not prepare company logo.");

  context.drawImage(bitmap, 0, 0);
  bitmap.close();

  const png = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Logo conversion failed."))),
      "image/png",
    );
  });

  return new Uint8Array(await png.arrayBuffer());
}
export async function generateProposalPdf(
  details: ProposalDetails,
  customer?: { name: string; address: string | null; email: string | null },
) {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  let page = pdf.addPage([612, 792]);
  // A logo conversion failure must never prevent a customer proposal from being generated.
  try {
    const logo = await pdf.embedPng(await loadLogoPng());
    const logoSize = logo.scaleToFit(180, 62);
    page.drawImage(logo, {
      x: 50,
      y: 710,
      width: logoSize.width,
      height: logoSize.height,
    });
  } catch (error) {
    console.warn("Proposal logo could not be embedded; using text header.", error);
    page.drawText("ROOFER MASTERS", { x: 50, y: 738, font: bold, size: 20, color: brand });
    page.drawText("YOUR ROOF, OUR MASTERPIECE", {
      x: 50,
      y: 718,
      font: regular,
      size: 8,
      color: ink,
    });
  }

  let y = 690;
  const line = (text: string, size = 11, heading = false) => {
    const font = heading ? bold : regular;
    for (const paragraph of clean(text).split("\n")) {
      let row = "";
      const rows: string[] = [];
      for (const word of paragraph.split(" ")) {
        if (font.widthOfTextAtSize(row + word, size) > 500 && row) {
          rows.push(row.trim());
          row = "";
        }
        // Split a single unusually long token to preserve page margins.
        let rest = word;
        while (font.widthOfTextAtSize(rest, size) > 490) {
          let cut = rest.length - 1;
          while (cut > 1 && font.widthOfTextAtSize(rest.slice(0, cut), size) > 490) cut--;
          if (row) {
            rows.push(row.trim());
            row = "";
          }
          rows.push(rest.slice(0, cut));
          rest = rest.slice(cut);
        }
        row += rest + " ";
      }
      rows.push(row.trim());
      for (const rowText of rows) {
        if (y < 65) {
          page = pdf.addPage([612, 792]);
          y = 730;
        }
        page.drawText(rowText, { x: 50, y, font, size, color: heading ? brand : ink });
        y -= size + 7;
      }
    }
  };
  line("305-942-3093  |  roofermasters@gmail.com", 10);
  y -= 24;
  line(details.title, 19, true);
  line(details.category, 11);
  if (customer) {
    y -= 12;
    line(`Prepared for: ${customer.name}`);
    if (customer.address) line(customer.address);
    if (customer.email) line(customer.email);
  }
  y -= 20;
  line("SCOPE OF WORK", 12, true);
  line(details.scope || "Scope to be confirmed.");
  if (details.amount !== null) {
    y -= 16;
    line(
      `Proposal total: $${details.amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      14,
      true,
    );
  }
  if (details.terms) {
    y -= 18;
    line("TERMS & EXCLUSIONS", 12, true);
    line(details.terms);
  }
  return pdf.save();
}

export type PdfMark = {
  id: string;
  page: number;
  x: number;
  y: number;
  kind: "text" | "highlight" | "signature";
  text: string;
  size: number;
  image?: Uint8Array;
};
export type PdfField = {
  name: string;
  kind: "text" | "checkbox" | "choice";
  value: string;
  options: string[];
};

export async function getPdfFields(bytes: Uint8Array): Promise<PdfField[]> {
  const doc = await PDFDocument.load(bytes);
  return doc
    .getForm()
    .getFields()
    .flatMap((field): PdfField[] => {
      if (field instanceof PDFTextField)
        return [{ name: field.getName(), kind: "text", value: field.getText() ?? "", options: [] }];
      if (field instanceof PDFCheckBox)
        return [
          {
            name: field.getName(),
            kind: "checkbox",
            value: String(field.isChecked()),
            options: [],
          },
        ];
      if (field instanceof PDFDropdown || field instanceof PDFOptionList)
        return [
          {
            name: field.getName(),
            kind: "choice",
            value: field.getSelected()[0] ?? "",
            options: field.getOptions(),
          },
        ];
      return [];
    });
}

export async function applyPdfEdits(bytes: Uint8Array, marks: PdfMark[], fields: PdfField[]) {
  const doc = await PDFDocument.load(bytes);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const mark of marks) {
    const page = doc.getPage(mark.page);
    const { width, height } = page.getSize();
    const x = mark.x * width;
    const y = height * (1 - mark.y);
    if (mark.kind === "text") {
      // pdf-lib's default font supports Latin text. Refuse unsupported glyphs rather than silently losing them.
      font.encodeText(mark.text);
      const lines = mark.text.split("\n");
      for (const [i, text] of lines.entries())
        page.drawText(text, {
          x,
          y: y - mark.size - i * (mark.size + 3),
          size: mark.size,
          font,
          color: ink,
        });
    } else if (mark.kind === "highlight") {
      page.drawRectangle({
        x,
        y: y - 18,
        width: Math.min(160, width - x),
        height: 18,
        color: rgb(1, 0.85, 0.1),
        opacity: 0.35,
      });
    } else if (mark.image) {
      const image = await doc.embedPng(mark.image);
      const scaled = image.scaleToFit(150, 55);
      page.drawImage(image, { x, y: y - scaled.height, ...scaled });
    }
  }
  const form = doc.getForm();
  for (const field of fields) {
    if (field.kind === "text") form.getTextField(field.name).setText(field.value);
    if (field.kind === "checkbox") {
      const box = form.getCheckBox(field.name);
      if (field.value === "true") box.check();
      else box.uncheck();
    }
    if (field.kind === "choice" && field.value) {
      const target = form.getField(field.name);
      if (target instanceof PDFDropdown || target instanceof PDFOptionList)
        target.select(field.value);
    }
  }
  form.updateFieldAppearances(font);
  return doc.save();
}

export async function changePdfPages(
  bytes: Uint8Array,
  action: "rotate" | "delete" | "earlier" | "later" | "merge",
  pageIndex: number,
  extra?: Uint8Array,
) {
  const doc = await PDFDocument.load(bytes);
  if (action === "rotate") {
    const { degrees } = await import("pdf-lib");
    const page = doc.getPage(pageIndex);
    page.setRotation(degrees((page.getRotation().angle + 90) % 360));
  }
  if (action === "delete") {
    if (doc.getPageCount() === 1) throw new Error("Keep at least one page");
    doc.removePage(pageIndex);
  }
  if (action === "earlier" || action === "later") {
    const dest = action === "earlier" ? pageIndex - 1 : pageIndex + 1;
    if (dest >= 0 && dest < doc.getPageCount()) {
      const copy = await doc.copyPages(doc, [pageIndex]);
      const moved = copy[0];
      if (moved) {
        doc.removePage(pageIndex);
        doc.insertPage(dest, moved);
      }
    }
  }
  if (action === "merge" && extra) {
    const other = await PDFDocument.load(extra);
    for (const page of await doc.copyPages(other, other.getPageIndices())) doc.addPage(page);
  }
  return doc.save();
}
