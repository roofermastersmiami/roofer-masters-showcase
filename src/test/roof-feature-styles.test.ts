import { describe, expect, it } from "vitest";
import {
  PENETRATION_COLORS,
  ROOF_EDGE_STYLES,
  ROOF_FACE_COLORS,
  ROOF_FEATURE_LEGEND,
} from "@/lib/roof-feature-styles";

describe("roof feature identification styles", () => {
  it("assigns a distinct color to every roof edge classification", () => {
    const colors = Object.values(ROOF_EDGE_STYLES).map((style) => style.color);
    expect(colors).toHaveLength(6);
    expect(new Set(colors).size).toBe(colors.length);
    expect(ROOF_EDGE_STYLES.eave.label).toBe("Eave");
    expect(ROOF_EDGE_STYLES.ridge.label).toBe("Ridge");
    expect(ROOF_EDGE_STYLES.hip.label).toBe("Hip");
    expect(ROOF_EDGE_STYLES.valley.label).toBe("Valley");
  });

  it("provides separate face colors and a visible pipe marker", () => {
    expect(ROOF_FACE_COLORS.length).toBeGreaterThan(1);
    expect(new Set(ROOF_FACE_COLORS).size).toBe(ROOF_FACE_COLORS.length);
    expect(PENETRATION_COLORS.pipe).not.toBe(PENETRATION_COLORS.vent);
    expect(ROOF_FEATURE_LEGEND.some((feature) => feature.id === "pipe")).toBe(true);
    expect(ROOF_FEATURE_LEGEND.some((feature) => feature.id === "face")).toBe(true);
  });
});
