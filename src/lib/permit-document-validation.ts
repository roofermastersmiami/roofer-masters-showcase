export const PERMIT_DOCUMENT_MAX_BYTES = 25 * 1024 * 1024;
export const PERMIT_DOCUMENT_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
] as const;

export type PermitDocumentValidation =
  | { valid: true; safeName: string }
  | { valid: false; reason: string };

export function validatePermitDocument(file: {
  name: string;
  type: string;
  size: number;
}): PermitDocumentValidation {
  if (!(PERMIT_DOCUMENT_MIME_TYPES as readonly string[]).includes(file.type)) {
    return { valid: false, reason: "Only PDF, JPG, and PNG permit documents are allowed." };
  }
  if (!Number.isFinite(file.size) || file.size < 0 || file.size > PERMIT_DOCUMENT_MAX_BYTES) {
    return { valid: false, reason: "Permit documents must be 25 MB or smaller." };
  }
  const safeName = file.name
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .slice(-100) || "permit-document";
  return { valid: true, safeName };
}

export function buildPermitDocumentPath(
  companyId: string,
  applicationId: string,
  safeName: string,
  uniqueId: string,
): string {
  return `${companyId}/${applicationId}/${uniqueId}-${safeName}`;
}
