import { describe, expect, it } from "vitest";
import {
  LOCATE_PROGRESS_PHASES,
  locateProgressPercent,
  timedProgressPercent,
} from "@/lib/analysis-progress";

describe("locateProgressPercent", () => {
  it("starts at 0 for a fresh run and resets the same way", () => {
    expect(locateProgressPercent("geocoding", 0)).toBe(0);
    // A new run always passes previousPercent 0, so it starts over
    // instead of inheriting the last run's number.
    expect(locateProgressPercent("geocoding", 0, 0)).toBe(0);
  });

  it("creeps monotonically within a phase and never reaches 100 early", () => {
    for (const phase of ["geocoding", "building"] as const) {
      let previous = 0;
      for (let elapsed = 0; elapsed <= 3600; elapsed += 17) {
        const percent = locateProgressPercent(phase, elapsed, previous);
        expect(percent).toBeGreaterThanOrEqual(previous);
        expect(percent).toBeLessThan(100);
        previous = percent;
      }
      // Even after an hour in one phase the creep stays inside the
      // phase's band — it cannot pin at the top on its own.
      expect(previous).toBeLessThanOrEqual(LOCATE_PROGRESS_PHASES[phase].cap);
    }
  });

  it("never goes backwards across the phase change", () => {
    const endOfGeocoding = locateProgressPercent("geocoding", 600, 0);
    const startOfBuilding = locateProgressPercent("building", 0, endOfGeocoding);
    expect(startOfBuilding).toBeGreaterThanOrEqual(endOfGeocoding);
    expect(startOfBuilding).toBe(LOCATE_PROGRESS_PHASES.building.floor);
  });

  it("respects the previous percent over the phase floor", () => {
    expect(locateProgressPercent("building", 0, 88)).toBe(88);
    expect(locateProgressPercent("geocoding", 0, 12)).toBe(12);
  });

  it("is exactly 100 only on completion", () => {
    expect(locateProgressPercent("building", 0, 0, true)).toBe(100);
    expect(locateProgressPercent("geocoding", 0, 0, true)).toBe(100);
    expect(locateProgressPercent("building", 3600, 99)).toBeLessThan(100);
  });
});

describe("timedProgressPercent", () => {
  it("honours an arbitrary band and time constant", () => {
    const band = { floor: 10, cap: 50, tauSeconds: 10 };
    expect(timedProgressPercent(band, 0)).toBe(10);
    const midway = timedProgressPercent(band, 10);
    expect(midway).toBeGreaterThan(10);
    expect(midway).toBeLessThan(50);
    expect(timedProgressPercent(band, 3600)).toBeLessThanOrEqual(50);
    expect(timedProgressPercent(band, 0, 0, true)).toBe(100);
  });
});
