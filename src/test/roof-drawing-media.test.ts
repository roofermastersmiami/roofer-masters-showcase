import { describe, expect, it } from "vitest";
import { roofDrawingMediaSchema } from "@/lib/roof-drawing-media";

const aerialMedia = {
  path: "roof-media/property-1/aerial.png",
  name: "Property aerial",
  category: "aerial" as const,
  source: "USGS National Map NAIP imagery",
  matched_address: "100 Main Street, Miami, FL",
  latitude: 25.7617,
  longitude: -80.1918,
};

describe("saved roof drawing media metadata", () => {
  it("preserves aerial source, address, and coordinates through server validation", () => {
    const parsed = roofDrawingMediaSchema.parse([aerialMedia]);
    expect(parsed[0]).toMatchObject(aerialMedia);
  });

  it("continues accepting ordinary job photos without aerial metadata", () => {
    expect(
      roofDrawingMediaSchema.parse([
        { path: "roof-media/job-1/before.jpg", name: "Before", category: "before" },
      ]),
    ).toEqual([{ path: "roof-media/job-1/before.jpg", name: "Before", category: "before" }]);
  });

  it.each([
    { latitude: 91 },
    { latitude: -91 },
    { longitude: 181 },
    { longitude: -181 },
  ])("rejects invalid geographic coordinates: %o", (coordinates) => {
    expect(roofDrawingMediaSchema.safeParse([{ ...aerialMedia, ...coordinates }]).success).toBe(
      false,
    );
  });

  it("rejects unsafe storage paths while retaining valid location metadata", () => {
    expect(
      roofDrawingMediaSchema.safeParse([{ ...aerialMedia, path: "../private/aerial.png" }])
        .success,
    ).toBe(false);
  });
});
