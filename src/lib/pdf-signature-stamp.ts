import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import type { SignatureField } from "./pdf-signature-fields";

/**
 * Stamp a signer's completed field values onto a PDF at the exact field
 * boxes placed in PDF Studio. Additive only (pdf-lib): signature images
 * and text are drawn on top of the page; original content is never
 * modified or removed.
 */

const INK = rgb(0.13, 0.17, 0.21);
const NAVY = rgb(0.055, 0.16, 0.27);

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Fit a font size so `text` fits inside `width` points (shrinks, never grows past `max`). */
function fitFontSize(font: PDFFont, text: string, width: number, max: number): number {
  let size = max;
  while (size > 6 && font.widthOfTextAtSize(text, size) > width) size -= 0.5;
  return size;
}

/**
 * Stamp one signer's values. `values` maps field id → value: PNG data URL
 * for signature fields, plain text for name/date/text/initials, and
 * "true"/"false" for checkboxes.
 */
export async function stampSignerFields(
  bytes: Uint8Array,
  fields: SignatureField[],
  signerIndex: number,
  values: Record<string, string>,
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes);
  const pages = doc.getPages();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const script = await doc.embedFont(StandardFonts.TimesRomanItalic);
  for (const field of fields) {
    if (field.signerIndex !== signerIndex) continue;
    const value = values[field.id];
    if (value === undefined || value === "") continue;
    const page = pages[field.page];
    if (!page) throw new Error(`Page ${field.page + 1} does not exist in this PDF.`);
    if (field.type === "signature") {
      if (!value.startsWith("data:image/png")) continue;
      const image = await doc.embedPng(dataUrlToBytes(value));
      const fit = image.scaleToFit(field.width - 4, field.height - 4);
      page.drawImage(image, {
        x: field.x + (field.width - fit.width) / 2,
        y: field.y + (field.height - fit.height) / 2,
        width: fit.width,
        height: fit.height,
      });
    } else if (field.type === "checkbox") {
      if (value !== "true") continue;
      // Draw a check mark with two strokes (standard fonts have no ✓ glyph).
      const pad = Math.min(field.width, field.height) * 0.22;
      const x0 = field.x + pad;
      const y0 = field.y + field.height * 0.32;
      const x1 = field.x + field.width * 0.42;
      const y1 = field.y + pad * 0.7;
      const x2 = field.x + field.width - pad * 0.7;
      const y2 = field.y + field.height - pad * 0.7;
      const thickness = Math.max(1.4, Math.min(field.width, field.height) * 0.09);
      page.drawLine({ start: { x: x0, y: y0 }, end: { x: x1, y: y1 }, thickness, color: NAVY });
      page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness, color: NAVY });
    } else {
      const text = value.slice(0, 300);
      const useScript = field.type === "initials";
      const activeFont = useScript ? script : font;
      const maxSize = Math.min(field.height * 0.62, useScript ? 22 : 14);
      const size = fitFontSize(activeFont, text, field.width - 6, Math.max(maxSize, 7));
      page.drawText(text, {
        x: field.x + 3,
        y: field.y + (field.height - size) / 2 + size * 0.08,
        size,
        font: activeFont,
        color: INK,
      });
    }
  }
  return doc.save();
}
