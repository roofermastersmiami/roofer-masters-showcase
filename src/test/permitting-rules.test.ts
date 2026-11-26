import { describe, expect, it } from "vitest";
import {
  DEFAULT_NOC_THRESHOLD_CENTS,
  requiresNoticeOfCommencement,
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

  it("rejects invalid currency inputs instead of silently rounding", () => {
    expect(() => requiresNoticeOfCommencement(-1)).toThrow(RangeError);
    expect(() => requiresNoticeOfCommencement(1.5)).toThrow(RangeError);
    expect(() => requiresNoticeOfCommencement(100, -1)).toThrow(RangeError);
    expect(() => requiresNoticeOfCommencement(100, Number.MAX_SAFE_INTEGER + 1)).toThrow(
      RangeError,
    );
  });
});
