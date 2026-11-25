import { describe, expect, it } from "vitest";
import {
  restoreRoofDrawingMedia,
  roofDrawingMediaSchema,
} from "@/lib/roof-drawing-media";

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

  it("restores persisted aerial metadata for the reopened measurement workspace", () => {
    const persisted = roofDrawingMediaSchema.parse([aerialMedia]);
    expect(restoreRoofDrawingMedia(persisted)).toEqual([aerialMedia]);
  });

  it("continues accepting and restoring ordinary job photos without aerial metadata", () => {
    const photo = {
      path: "roof-media/job-1/before.jpg",
      name: "Before",
      category: "before" as const,
    };
    expect(roofDrawingMediaSchema.parse([photo])).toEqual([photo]);
    expect(restoreRoofDrawingMedia([photo])).toEqual([photo]);
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

  it("ignores out-of-range legacy coordinates when restoring old rows", () => {
    expect(
      restoreRoofDrawingMedia([{ ...aerialMedia, latitude: 999, longitude: -999 }]),
    ).toEqual([
      {
        path: aerialMedia.path,
        name: aerialMedia.name,
        category: aerialMedia.category,
        source: aerialMedia.source,
        matched_address: aerialMedia.matched_address,
      },
    ]);
  });

  it("rejects unsafe storage paths while retaining valid location metadata", () => {
    expect(
      roofDrawingMediaSchema.safeParse([{ ...aerialMedia, path: "../private/aerial.png" }])
        .success,
    ).toBe(false);
  });

  it("ignores malformed entries in persisted media JSON", () => {
    expect(restoreRoofDrawingMedia([null, "invalid", { path: 4 }, aerialMedia])).toEqual([
      aerialMedia,
    ]);
  });
});
