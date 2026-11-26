import { describe, expect, it } from "vitest";
import {
  DEFAULT_NOC_THRESHOLD_CENTS,
  getRecordedBudgetForNocScreening,
  requiresNoticeOfCommencement,
  canTransitionPermitApplication,
  canTransitionPermitInspection,
} from "@/lib/permitting-rules";

describe("Notice of Commencement threshold", () => {
  it("uses the requested $5,000 default threshold", () => {
    expect(DEFAULT_NOC_THRESHOLD_CENTS).toBe(500_000);
  });

  it("does not require an NOC when the contract value equals the threshold", () => {
    expect(requiresNoticeOfCommencement(500_000)).toEqual({
      required: false,
      reason: "value_at_or_below_threshold",
      thresholdCents: 500_000,
    });
  });

  it("requires an NOC only when the contract value exceeds the configured threshold", () => {
    expect(requiresNoticeOfCommencement(500_001).required).toBe(true);
    expect(requiresNoticeOfCommencement(600_000, 550_000).required).toBe(true);
    expect(requiresNoticeOfCommencement(550_000, 550_000).required).toBe(false);
  });

  it("treats the existing zero-cent job placeholder as an unrecorded budget", () => {
    expect(getRecordedBudgetForNocScreening(0)).toBeNull();
    expect(getRecordedBudgetForNocScreening(null)).toBeNull();
    expect(getRecordedBudgetForNocScreening(undefined)).toBeNull();
    expect(getRecordedBudgetForNocScreening(500_001)).toBe(500_001);
    expect(requiresNoticeOfCommencement(getRecordedBudgetForNocScreening(0)).reason).toBe(
      "value_unknown",
    );
  });

  it("marks missing contract values as unknown instead of treating them as zero", () => {
    expect(requiresNoticeOfCommencement(null)).toEqual({
      required: false,
      reason: "value_unknown",
      thresholdCents: 500_000,
    });
    expect(requiresNoticeOfCommencement(undefined).reason).toBe("value_unknown");
  });

  it("rejects invalid currency inputs instead of silently rounding", () => {
    expect(() => requiresNoticeOfCommencement(-1)).toThrow(RangeError);
    expect(() => requiresNoticeOfCommencement(1.5)).toThrow(RangeError);
    expect(() => requiresNoticeOfCommencement(100, -1)).toThrow(RangeError);
    expect(() => requiresNoticeOfCommencement(100, Number.MAX_SAFE_INTEGER + 1)).toThrow(
      RangeError,
    );
    expect(() => requiresNoticeOfCommencement(null, -1)).toThrow(RangeError);
  });
});

describe("permit application status transitions", () => {
  it("allows only intended forward and cancellation paths", () => {
    expect(canTransitionPermitApplication("draft", "ready_to_submit")).toBe(true);
    expect(canTransitionPermitApplication("ready_to_submit", "submitted")).toBe(true);
    expect(canTransitionPermitApplication("submitted", "issued")).toBe(true);
    expect(canTransitionPermitApplication("submitted", "rejected")).toBe(true);
    expect(canTransitionPermitApplication("issued", "expired")).toBe(true);
    expect(canTransitionPermitApplication("draft", "issued")).toBe(false);
    expect(canTransitionPermitApplication("issued", "submitted")).toBe(false);
    expect(canTransitionPermitApplication("rejected", "draft")).toBe(false);
    expect(canTransitionPermitApplication("cancelled", "submitted")).toBe(false);
  });
  it("allows unchanged state when editing details", () => {
    expect(canTransitionPermitApplication("submitted", "submitted")).toBe(true);
  });
});

describe("inspection status transitions", () => {
  it("requires scheduling before inspection outcomes", () => {
    expect(canTransitionPermitInspection("requested", "scheduled")).toBe(true);
    expect(canTransitionPermitInspection("scheduled", "passed")).toBe(true);
    expect(canTransitionPermitInspection("scheduled", "failed")).toBe(true);
    expect(canTransitionPermitInspection("requested", "passed")).toBe(false);
    expect(canTransitionPermitInspection("passed", "failed")).toBe(false);
    expect(canTransitionPermitInspection("cancelled", "scheduled")).toBe(false);
  });
  it("allows unchanged state when saving confirmation details", () => {
    expect(canTransitionPermitInspection("scheduled", "scheduled")).toBe(true);
  });
});

describe("complete permitting transition matrix", () => {
  it("keeps every application status limited to its explicitly supported next states", () => {
    const allowed: Record<
      "draft" | "ready_to_submit" | "submitted" | "issued" | "rejected" | "expired" | "cancelled",
      string[]
    > = {
      draft: ["draft", "ready_to_submit", "cancelled"],
      ready_to_submit: ["ready_to_submit", "submitted", "cancelled"],
      submitted: ["submitted", "issued", "rejected", "cancelled"],
      issued: ["issued", "expired"],
      rejected: ["rejected"],
      expired: ["expired"],
      cancelled: ["cancelled"],
    };
    const statuses = Object.keys(allowed) as Array<keyof typeof allowed>;

    for (const current of statuses) {
      for (const next of statuses) {
        expect(canTransitionPermitApplication(current, next)).toBe(
          allowed[current].includes(next),
        );
      }
    }
  });

  it("keeps every inspection status limited to its explicitly supported next states", () => {
    const allowed: Record<
      "requested" | "scheduled" | "passed" | "failed" | "cancelled",
      string[]
    > = {
      requested: ["requested", "scheduled", "cancelled"],
      scheduled: ["scheduled", "passed", "failed", "cancelled"],
      passed: ["passed"],
      failed: ["failed"],
      cancelled: ["cancelled"],
    };
    const statuses = Object.keys(allowed) as Array<keyof typeof allowed>;

    for (const current of statuses) {
      for (const next of statuses) {
        expect(canTransitionPermitInspection(current, next)).toBe(
          allowed[current].includes(next),
        );
      }
    }
  });
});
