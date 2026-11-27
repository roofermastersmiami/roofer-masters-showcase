import { describe, expect, it } from "vitest";
import {
  analysisProgressPercent,
  formatElapsedClock,
  type AnalysisProgressSnapshot,
} from "@/lib/analysis-progress";

const at = (stage: string | null, extra: Partial<AnalysisProgressSnapshot> = {}, previous = 0) =>
  analysisProgressPercent({ status: "running", stage, stageElapsedSeconds: 0, ...extra }, previous);

describe("analysisProgressPercent", () => {
  it("is 100 only when the job completes", () => {
    expect(analysisProgressPercent({ status: "complete", stage: "complete" }, 42)).toBe(100);
    expect(analysisProgressPercent({ status: "complete", stage: "fitting_planes" }, 0)).toBe(100);
    expect(at("fitting_planes", { stageElapsedSeconds: 60 * 60 })).toBeLessThan(100);
  });

  it("starts low while queued", () => {
    const percent = analysisProgressPercent({ status: "queued", stage: "queued" });
    expect(percent).toBeGreaterThanOrEqual(1);
    expect(percent).toBeLessThanOrEqual(3);
  });

  it("gives the early stages ascending bands", () => {
    const floors = ["starting", "geocoding", "footprint", "lidar"].map((stage) => at(stage));
    for (let i = 1; i < floors.length; i++) {
      expect(floors[i]!).toBeGreaterThan(floors[i - 1]!);
    }
    expect(at("lidar", { stageElapsedSeconds: 60 * 60 })).toBeLessThanOrEqual(14);
  });

  it("scales the tile-download fraction across the widest band", () => {
    expect(at("downloading_tiles", { downloadFraction: 0 })).toBe(14);
    expect(at("downloading_tiles", { downloadFraction: 0.5 })).toBe(45);
    expect(at("downloading_tiles", { downloadFraction: 1 })).toBe(76);
    expect(at("downloading_tiles", { downloadFraction: 0.24 })).toBe(29);
  });

  it("keeps the download percent monotonic as the fraction grows", () => {
    let previous = 0;
    for (const fraction of [0, 0.1, 0.1, 0.35, 0.34, 0.8, 1]) {
      const next = at("downloading_tiles", { downloadFraction: fraction }, previous);
      expect(next).toBeGreaterThanOrEqual(previous);
      previous = next;
    }
    expect(previous).toBe(76);
  });

  it("creeps toward the cap while a stage lasts, without crossing it", () => {
    const early = at("fitting_planes", { stageElapsedSeconds: 5 });
    const later = at("fitting_planes", { stageElapsedSeconds: 120 }, early);
    const muchLater = at("fitting_planes", { stageElapsedSeconds: 60 * 60 }, later);
    expect(early).toBeGreaterThanOrEqual(76);
    expect(later).toBeGreaterThan(early);
    expect(muchLater).toBeGreaterThan(later);
    expect(muchLater).toBeLessThanOrEqual(95);
  });

  it("never exceeds 99 while the job is still running", () => {
    expect(at("measuring", { stageElapsedSeconds: 60 * 60 })).toBeLessThanOrEqual(90);
    expect(
      analysisProgressPercent(
        { status: "running", stage: "some_future_stage", stageElapsedSeconds: 60 * 60 },
        50,
      ),
    ).toBeLessThanOrEqual(99);
    expect(at("downloading_tiles", { downloadFraction: 1 }, 98)).toBe(98);
  });

  it("never goes backwards when stages repeat or regress", () => {
    // A poll can repeat an earlier stage after a later one was seen; the
    // displayed number must hold, not rewind.
    expect(at("lidar", {}, 45)).toBe(45);
    expect(at("geocoding", {}, 45)).toBe(45);
    expect(at("downloading_tiles", { downloadFraction: 0.1 }, 45)).toBe(45);
  });

  it("holds the previous percent for a failed job", () => {
    expect(analysisProgressPercent({ status: "failed", stage: "failed" }, 57)).toBe(57);
  });

  it("floors at 1 before the first poll reports a stage", () => {
    expect(analysisProgressPercent({ status: "running", stage: null })).toBe(1);
    expect(analysisProgressPercent({})).toBe(1);
  });
});

describe("formatElapsedClock", () => {
  it("formats minutes and zero-padded seconds", () => {
    expect(formatElapsedClock(0)).toBe("0:00");
    expect(formatElapsedClock(7)).toBe("0:07");
    expect(formatElapsedClock(65)).toBe("1:05");
    expect(formatElapsedClock(600)).toBe("10:00");
    expect(formatElapsedClock(3599)).toBe("59:59");
  });
});
