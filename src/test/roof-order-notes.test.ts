import { describe, expect, it } from "vitest";
import { composeRoofOrderNotes, parseMeasurementPin } from "@/lib/roof-order-notes";

describe("composeRoofOrderNotes", () => {
  it("records building type, outbuilding flag and pin ahead of the user's notes", () => {
    const notes = composeRoofOrderNotes({
      buildingType: "multi_family",
      includeOutbuilding: true,
      pin: { lat: 25.979306, lon: -80.186822 },
      notes: "flat section only",
    });
    expect(notes).toBe(
      [
        "Building type: Multi-Family",
        "Include outbuilding: Yes",
        "Measurement pin: 25.979306, -80.186822",
        "",
        "flat section only",
      ].join("\n"),
    );
  });

  it("omits the pin line when no pin was placed and keeps defaults explicit", () => {
    const notes = composeRoofOrderNotes({
      buildingType: "single_family",
      includeOutbuilding: false,
      pin: null,
      notes: "",
    });
    expect(notes).toBe("Building type: Single Family\nInclude outbuilding: No");
  });
});

describe("parseMeasurementPin", () => {
  it("round-trips the pin recorded by composeRoofOrderNotes", () => {
    const notes = composeRoofOrderNotes({
      buildingType: "commercial",
      includeOutbuilding: false,
      pin: { lat: 25.9802109, lon: -80.3995228 },
      notes: "do not include metal awnings",
    });
    expect(parseMeasurementPin(notes)).toEqual({ lat: 25.980211, lon: -80.399523 });
  });

  it("returns null when the notes carry no usable pin", () => {
    expect(parseMeasurementPin(null)).toBeNull();
    expect(parseMeasurementPin(undefined)).toBeNull();
    expect(parseMeasurementPin("")).toBeNull();
    expect(parseMeasurementPin("Building type: Single Family")).toBeNull();
    expect(parseMeasurementPin("Measurement pin: 125.0, -80.0")).toBeNull();
    expect(parseMeasurementPin("Measurement pin: soon, later")).toBeNull();
  });
});
