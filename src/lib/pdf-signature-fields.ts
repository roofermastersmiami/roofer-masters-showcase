import { z } from "zod";

/**
 * Shared model for PDF Studio signature requests (Acrobat-style field
 * placement). Fields live in PDF points with the origin at the BOTTOM-left
 * of the page — the same convention as the rest of the PDF tools — so a
 * field placed in the browser stamps at exactly the same spot in the
 * finished PDF.
 */

export const SIGNATURE_FIELD_TYPES = [
  "signature",
  "initials",
  "name",
  "date",
  "text",
  "checkbox",
] as const;
export type SignatureFieldType = (typeof SIGNATURE_FIELD_TYPES)[number];

export type SignatureField = {
  id: string;
  type: SignatureFieldType;
  /** 0-based page index. */
  page: number;
  /** PDF points from the left edge of the page. */
  x: number;
  /** PDF points from the BOTTOM edge of the page (the field's bottom edge). */
  y: number;
  /** Field box size in PDF points. */
  width: number;
  height: number;
  /** Which signer (index into the request's signers array) fills this field. */
  signerIndex: number;
  required: boolean;
  label: string;
};

export type SignatureSigner = {
  name: string;
  email: string;
  /** Capability token for this signer's private signing link. */
  token: string;
  completedAt: string | null;
};

export const FIELD_LABELS: Record<SignatureFieldType, string> = {
  signature: "Signature",
  initials: "Initials",
  name: "Full name",
  date: "Date signed",
  text: "Text",
  checkbox: "Checkbox",
};

/** Default box size (PDF points) when a field is placed with a click. */
export const FIELD_DEFAULT_SIZE: Record<SignatureFieldType, { width: number; height: number }> = {
  signature: { width: 180, height: 48 },
  initials: { width: 72, height: 36 },
  name: { width: 200, height: 28 },
  date: { width: 140, height: 28 },
  text: { width: 200, height: 28 },
  checkbox: { width: 20, height: 20 },
};

export const FIELD_MIN_SIZE = { width: 14, height: 12 };

export type PageSize = { widthPt: number; heightPt: number };

/** A rectangle in rendered pixels, origin at the TOP-left of the page image. */
export type DisplayRect = { left: number; top: number; width: number; height: number };

/** Pixels per PDF point for a page rendered/displayed at a given pixel width. */
export function renderScale(page: PageSize, displayWidthPx: number): number {
  return displayWidthPx / page.widthPt;
}

/** Convert a stored PDF-points field box to on-screen pixels (top-left origin). */
export function pdfRectToDisplay(
  field: Pick<SignatureField, "x" | "y" | "width" | "height">,
  page: PageSize,
  scale: number,
): DisplayRect {
  return {
    left: field.x * scale,
    top: (page.heightPt - field.y - field.height) * scale,
    width: field.width * scale,
    height: field.height * scale,
  };
}

/** Convert an on-screen rectangle (top-left origin pixels) back to PDF points. */
export function displayRectToPdf(
  rect: DisplayRect,
  page: PageSize,
  scale: number,
): { x: number; y: number; width: number; height: number } {
  return {
    x: rect.left / scale,
    y: page.heightPt - rect.top / scale - rect.height / scale,
    width: rect.width / scale,
    height: rect.height / scale,
  };
}

/**
 * Convert a pointer position inside a rendered page (as fractions of the
 * displayed width/height, 0..1 from the top-left) to PDF points.
 */
export function fractionToPdfPoint(
  fx: number,
  fy: number,
  page: PageSize,
): { x: number; y: number } {
  return { x: fx * page.widthPt, y: (1 - fy) * page.heightPt };
}

/** Clamp a field box so it stays fully inside its page. */
export function clampFieldToPage(
  field: Pick<SignatureField, "x" | "y" | "width" | "height">,
  page: PageSize,
): { x: number; y: number; width: number; height: number } {
  const width = Math.min(Math.max(field.width, FIELD_MIN_SIZE.width), page.widthPt);
  const height = Math.min(Math.max(field.height, FIELD_MIN_SIZE.height), page.heightPt);
  return {
    x: Math.min(Math.max(field.x, 0), page.widthPt - width),
    y: Math.min(Math.max(field.y, 0), page.heightPt - height),
    width,
    height,
  };
}

const fieldSchema = z.object({
  id: z.string().min(1).max(64),
  type: z.enum(SIGNATURE_FIELD_TYPES),
  page: z.number().int().min(0).max(200),
  x: z.number().finite().min(0).max(2000),
  y: z.number().finite().min(0).max(2000),
  width: z.number().finite().min(8).max(2000),
  height: z.number().finite().min(8).max(2000),
  signerIndex: z.number().int().min(0).max(1),
  required: z.boolean(),
  label: z.string().trim().max(80),
});

export const signatureSignerInputSchema = z.object({
  name: z.string().trim().min(1, "Enter the signer's name").max(120),
  email: z.string().trim().email("Enter a valid email").max(160),
});

export const createSignatureRequestSchema = z.object({
  documentName: z.string().trim().min(1).max(200),
  // ~10 MB of PDF as base64.
  documentBase64: z
    .string()
    .regex(/^[A-Za-z0-9+/=]+$/, "Document must be base64")
    .max(14_000_000, "That PDF is too large (10 MB limit)"),
  signers: z.array(signatureSignerInputSchema).min(1).max(2),
  fields: z.array(fieldSchema).min(1, "Place at least one field").max(80),
});
export type CreateSignatureRequestInput = z.infer<typeof createSignatureRequestSchema>;

export const completeSignatureRequestSchema = z.object({
  token: z.string().uuid(),
  values: z.record(z.string().min(1).max(64), z.string().max(400_000)),
});
export type CompleteSignatureRequestInput = z.infer<typeof completeSignatureRequestSchema>;

/** Route/server-fn parameter carrying only a signer's capability token. */
export const signerTokenParamSchema = z.object({
  token: z.string().uuid(),
});

/** True while a signer's capability link can still be used to sign. */
export function signerLinkIsActive(
  request: { revoked_at: string | null; expires_at: string },
  signer: { completedAt: string | null },
  now = Date.now(),
): boolean {
  return !request.revoked_at && !signer.completedAt && new Date(request.expires_at).getTime() > now;
}

/**
 * Validate the values a signer submitted against the fields assigned to
 * them. Returns the labels of required fields that are still missing.
 * Signature/initials-by-drawing values are PNG data URLs; everything else
 * is plain text (checkboxes use "true"/"false").
 */
export function missingRequiredValues(
  fields: SignatureField[],
  signerIndex: number,
  values: Record<string, string>,
): string[] {
  const missing: string[] = [];
  for (const field of fields) {
    if (field.signerIndex !== signerIndex || !field.required) continue;
    const value = values[field.id];
    if (field.type === "checkbox") {
      if (value !== "true") missing.push(field.label);
    } else if (!value || !value.trim()) {
      missing.push(field.label);
    }
  }
  return missing;
}

/** Validate submitted values: signatures must be PNG data URLs, text is capped. */
export function validateSignerValues(
  fields: SignatureField[],
  signerIndex: number,
  values: Record<string, string>,
): string | null {
  for (const field of fields) {
    if (field.signerIndex !== signerIndex) continue;
    const value = values[field.id];
    if (value === undefined) continue;
    if (field.type === "signature") {
      if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(value))
        return "A signature must be drawn or typed before signing.";
      if (value.length > 400_000) return "That signature image is too large.";
    } else if (value.length > 300) {
      return `The value for "${field.label}" is too long.`;
    }
  }
  return null;
}

/** Request status derived from its signers (all signed → completed). */
export function allSignersCompleted(signers: Array<{ completedAt: string | null }>): boolean {
  return signers.length > 0 && signers.every((signer) => signer.completedAt);
}
