import { describe, expect, it } from "vitest";
import {
  buildPermitDocumentPath,
  PERMIT_DOCUMENT_MAX_BYTES,
  validatePermitDocument,
} from "@/lib/permit-document-validation";

describe("permit document validation", () => {
  it.each(["application/pdf", "image/jpeg", "image/png"])(
    "accepts supported MIME type %s",
    (type) => {
      expect(validatePermitDocument({ name: "permit.pdf", type, size: 1024 }).valid).toBe(true);
    },
  );

  it("rejects unsupported file types", () => {
    expect(
      validatePermitDocument({ name: "permit.exe", type: "application/octet-stream", size: 10 }),
    ).toEqual({ valid: false, reason: "Only PDF, JPG, and PNG permit documents are allowed." });
  });

  it("accepts exactly 25 MB and rejects larger or invalid sizes", () => {
    expect(
      validatePermitDocument({
        name: "permit.pdf",
        type: "application/pdf",
        size: PERMIT_DOCUMENT_MAX_BYTES,
      }).valid,
    ).toBe(true);
    expect(
      validatePermitDocument({
        name: "permit.pdf",
        type: "application/pdf",
        size: PERMIT_DOCUMENT_MAX_BYTES + 1,
      }).valid,
    ).toBe(false);
    expect(
      validatePermitDocument({ name: "permit.pdf", type: "application/pdf", size: -1 }).valid,
    ).toBe(false);
  });

  it("sanitizes filenames and builds tenant/application-scoped paths", () => {
    const result = validatePermitDocument({
      name: "../../permit #1.pdf",
      type: "application/pdf",
      size: 1,
    });
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.safeName).toBe("..-..-permit--1.pdf");
    expect(
      buildPermitDocumentPath("company-id", "application-id", result.safeName, "unique-id"),
    ).toBe("company-id/application-id/unique-id-..-..-permit--1.pdf");
  });

  it("provides a fallback for empty filenames", () => {
    const result = validatePermitDocument({ name: "💾", type: "application/pdf", size: 1 });
    expect(result).toEqual({ valid: true, safeName: "permit-document" });
  });
});
