import { describe, expect, it, vi } from "vitest";
import { fetchPublicAerial } from "./public-aerial.server";

const censusResponse = (overrides: Record<string, unknown> = {}) =>
  new Response(
    JSON.stringify({
      result: {
        addressMatches: [
          {
            matchedAddress: "123 Example St, Miami, FL 33101",
            coordinates: { x: -80.19, y: 25.76 },
            ...overrides,
          },
        ],
      },
    }),
    { headers: { "content-type": "application/json" } },
  );

function pngResponse(width = 2000, height = 2000) {
  const bytes = new Uint8Array(24);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  new DataView(bytes.buffer).setUint32(16, width);
  new DataView(bytes.buffer).setUint32(20, height);
  return new Response(bytes, { headers: { "content-type": "image/png" } });
}

describe("public aerial server integration", () => {
  it("uses only the fixed Census and USGS services and returns scale provenance", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(censusResponse())
      .mockResolvedValueOnce(pngResponse());
    const result = await fetchPublicAerial("123 Example St, Miami, FL", 120, fetcher);
    expect("image" in result).toBe(true);
    if ("image" in result) {
      expect(result.image).toMatch(/^data:image\/png;base64,/);
      expect(result.matchedAddress).toContain("Miami");
      expect(result.lat).toBe(25.76);
      expect(result.lon).toBe(-80.19);
      expect(result.feetPerPixel).toBeCloseTo((120 * 3.28084) / 2000, 8);
      expect(result.credit).toContain("USGS");
    }
    const urls = fetcher.mock.calls.map(([url]) => String(url));
    expect(urls[0]).toContain("geocoding.geo.census.gov");
    expect(urls[0]).toContain(encodeURIComponent("123 Example St, Miami, FL"));
    expect(urls[1]).toContain("imagery.nationalmap.gov");
    expect(urls.every((url) => !url.includes("example.com"))).toBe(true);
  });

  it("does not request imagery when Census returns no address match", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(JSON.stringify({ result: { addressMatches: [] } }), {
        headers: { "content-type": "application/json" },
      }),
    );
    const result = await fetchPublicAerial("No such address, Miami, FL", 120, fetcher);
    expect(result).toHaveProperty("stage", "address_not_found");
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("rejects non-image USGS responses instead of treating service errors as photos", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(censusResponse())
      .mockResolvedValueOnce(
        new Response("service unavailable", {
          headers: { "content-type": "text/plain" },
        }),
      );
    const result = await fetchPublicAerial("123 Example St, Miami, FL", 120, fetcher);
    expect(result).toHaveProperty("stage", "imagery_response");
  });

  it("rejects unexpected image dimensions because scale would be unreliable", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(censusResponse())
      .mockResolvedValueOnce(pngResponse(1024, 1024));
    const result = await fetchPublicAerial("123 Example St, Miami, FL", 120, fetcher);
    expect(result).toHaveProperty("stage", "imagery_dimensions");
  });

  it("reports Census transport failures without making an imagery request", async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error("network"));
    const result = await fetchPublicAerial("123 Example St, Miami, FL", 120, fetcher);
    expect(result).toHaveProperty("stage", "geocoding");
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
