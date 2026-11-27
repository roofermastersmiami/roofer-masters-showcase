import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { createPermitPacketPdf, displayPermitDate } from "@/lib/permit-packet";

describe("permit summary PDF", () => {
  it("creates a readable PDF containing the supplied permit record", async () => {
    const bytes = await createPermitPacketPdf({
      jobTitle: "Roof replacement",
      propertyAddress: "100 Example Street, Miami, FL",
      jurisdiction: "Miami-Dade County",
      permitType: "Roof replacement",
      permitNumber: "TEST-123",
      status: "issued",
      submittedAt: "2026-11-01T14:00:00.000Z",
      issuedAt: "2026-11-03T14:00:00.000Z",
      expiresAt: "2027-11-03",
      feeCents: 12500,
      applicationNotes: "Test record only",
      inspections: [
        {
          type: "Roof dry-in",
          status: "scheduled",
          scheduledAt: "2026-11-10T14:00:00.000Z",
          confirmationNumber: "CONF-456",
        },
      ],
    });

    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    const loaded = await PDFDocument.load(bytes);
    expect(loaded.getPageCount()).toBeGreaterThan(0);
  });

  it("creates a multi-page packet for long notes and unbroken portal values", async () => {
    const bytes = await createPermitPacketPdf({
      jobTitle: "Roof replacement",
      propertyAddress: "100 Example Street, Miami, FL",
      jurisdiction: "Miami-Dade County",
      permitType: "Roof replacement",
      portalUrl: `https://example.gov/${"permit-reference".repeat(60)}`,
      status: "draft",
      applicationNotes: "Long note " + "X".repeat(2400),
      inspections: [],
    });
    const loaded = await PDFDocument.load(bytes);
    expect(loaded.getPageCount()).toBeGreaterThan(1);
  });

  it("creates a valid packet when no inspections or optional details exist", async () => {
    const bytes = await createPermitPacketPdf({
      jobTitle: "Roof repair",
      propertyAddress: "",
      jurisdiction: "City of Miami",
      permitType: "Roof repair",
      status: "draft",
      inspections: [],
    });

    const loaded = await PDFDocument.load(bytes);
    expect(loaded.getPageCount()).toBe(1);
  });
});

describe("permit expiration date formatting", () => {
  it("preserves the stored calendar date without timezone conversion", () => {
    expect(displayPermitDate("2027-11-03")).toBe("November 3, 2027");
    expect(displayPermitDate("2024-02-29")).toBe("February 29, 2024");
    expect(displayPermitDate("2025-02-29")).toBe("2025-02-29");
  });

  it("handles missing and malformed date-only values safely", () => {
    expect(displayPermitDate(null)).toBe("Not recorded");
    expect(displayPermitDate("not-a-date")).toBe("not-a-date");
    expect(displayPermitDate("2027-02-30")).toBe("2027-02-30");
  });
});
