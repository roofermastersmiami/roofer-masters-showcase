import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { locateBuildingPin } from "@/lib/roof-analysis";

// The Miramar pattern from Fredy's 2026-11-27 report: the geocoder
// lands at (25.980179, -80.399509), on the street; the house is
// centred near (25.980211, -80.399791). Locate must place pin 1 on
// the footprint centroid the service selects, and any failure must
// fall back to the geocoded point (null here) exactly as before.
const GEOCODE = { lat: 25.980179, lon: -80.399509 };
const HOUSE_CENTROID = { lat: 25.98021, lon: -80.39979 };

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe("locateBuildingPin", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("returns the selected footprint centroid for the geocoded point", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(200, {
        status: "found",
        location: GEOCODE,
        footprint: {
          candidate_id: "6935a40f62203af2213020bf",
          provider: "Broward County Building Footprints",
          centroid: HOUSE_CENTROID,
        },
      }),
    );

    const result = await locateBuildingPin(
      "https://roof-detection.example.com",
      GEOCODE,
      "3062 SW 189TH AVE, MIRAMAR, FL, 33029",
    );

    expect(result).toEqual({
      lat: HOUSE_CENTROID.lat,
      lon: HOUSE_CENTROID.lon,
      candidateId: "6935a40f62203af2213020bf",
    });
    expect(fetch).toHaveBeenCalledWith(
      "https://roof-detection.example.com/v1/roof/locate",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          lat: GEOCODE.lat,
          lon: GEOCODE.lon,
          street_address: "3062 SW 189TH AVE, MIRAMAR, FL, 33029",
        }),
      }),
    );
  });

  it("returns null when the service finds no footprint near the point", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(200, { status: "not_found", location: GEOCODE }),
    );

    await expect(
      locateBuildingPin("https://roof-detection.example.com", GEOCODE),
    ).resolves.toBeNull();
  });

  it("returns null on a service error so the caller keeps the geocoded point", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(503, { detail: "providers unavailable" }));

    await expect(
      locateBuildingPin("https://roof-detection.example.com", GEOCODE),
    ).resolves.toBeNull();
  });

  it("returns null when the service cannot be reached", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("network down"));

    await expect(
      locateBuildingPin("https://roof-detection.example.com", GEOCODE),
    ).resolves.toBeNull();
  });

  it("returns null for a malformed centroid instead of placing a bad pin", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(200, {
        status: "found",
        footprint: { candidate_id: "x", centroid: { lat: "25.98", lon: -80.39979 } },
      }),
    );

    await expect(
      locateBuildingPin("https://roof-detection.example.com", GEOCODE),
    ).resolves.toBeNull();
  });
});
