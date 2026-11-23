import { describe, expect, it } from "vitest";
import {
  roofOrderSchema,
  ownRoofReportSchema,
  assertReportStatus,
  reviewedReport,
  roofOrderTransferRoles,
} from "@/lib/roof-order-schema";
const customer = "bc1ce3a1-e666-4169-9c65-4e17b3d156bb";
const report = {
  roof_type: "Metal Roof",
  area_sqft: 2000,
  waste_pct: 10,
  ridge_lf: 40,
  hips_lf: 0,
  valleys_lf: 20,
  eaves_lf: 80,
  rakes_lf: 60,
  panel_width_in: 16,
  pipes: 2,
};
describe("roof report transfer permissions", () => {
  it("matches destination permissions to the database job policies", () => {
    expect(roofOrderTransferRoles("estimate")).toEqual(["office", "sales"]);
    expect(roofOrderTransferRoles("materials")).toEqual(["production_manager"]);
  });
});

describe("address-based roof report requests", () => {
  it("starts only company-owned reports, not paid provider orders", () => {
    const input = {
      customer_id: customer,
      address: "123 Customer Road, Homestead FL",
      title: "Report",
      provider: "manual",
      notes: "",
    };
    expect(ownRoofReportSchema.safeParse(input).success).toBe(true);
    expect(ownRoofReportSchema.safeParse({ ...input, provider: "eagleview" }).success).toBe(false);
  });
  it("requires a customer property address instead of deriving measurements from an address", () => {
    expect(
      roofOrderSchema.safeParse({
        customer_id: customer,
        address: "",
        title: "Report",
        provider: "manual",
        notes: "",
      }).success,
    ).toBe(false);
    const parsed = roofOrderSchema.parse({
      customer_id: customer,
      address: "  123 Customer Road, Homestead FL 33030  ",
      title: "Report",
      provider: "manual",
      notes: "",
    });
    expect(parsed.address).toBe("123 Customer Road, Homestead FL 33030");
    expect("measurements" in parsed).toBe(false);
  });
  it("requires a recorded provider reference before claiming an external order", () => {
    expect(() =>
      assertReportStatus({
        status: "ordered",
        provider: "eagleview",
        provider_reference: "",
        file_path: null,
        measurements: null,
      }),
    ).toThrow("reference");
    expect(() =>
      assertReportStatus({
        status: "ordered",
        provider: "eagleview",
        provider_reference: "EV-123",
        file_path: null,
        measurements: null,
      }),
    ).not.toThrow();
  });
  it("does not call a request received without an attached report", () =>
    expect(() =>
      assertReportStatus({
        status: "received",
        provider: "manual",
        provider_reference: "",
        file_path: null,
        measurements: null,
      }),
    ).toThrow("PDF"));
  it("rejects review of a provider report without its original PDF", () =>
    expect(() =>
      assertReportStatus({
        status: "reviewed",
        provider: "eagleview",
        provider_reference: "EV-123",
        file_path: null,
        measurements: report,
      }),
    ).toThrow("Attach"));
  it("blocks unreviewed and cancelled measurements from estimate or material handoff", () => {
    for (const status of ["requested", "received", "cancelled"])
      expect(() => reviewedReport({ status, reviewed_at: null, measurements: report })).toThrow(
        "owner-reviewed",
      );
    expect(
      reviewedReport({
        status: "reviewed",
        reviewed_at: "2026-11-21T02:37:00Z",
        measurements: report,
      }).area_sqft,
    ).toBe(2000);
  });
});
