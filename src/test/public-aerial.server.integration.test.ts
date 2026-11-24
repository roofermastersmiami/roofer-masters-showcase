import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchPublicAerial } from "@/lib/public-aerial.server";

const ADDRESS = "123 Test Avenue, Homestead, FL 33030";
const LAT = 25.519645301311;
const LON = -80.415675822018;
const SPAN_METERS = 120;
const PIXELS = 2000;

function png(width = PIXELS, height = PIXELS) {
  const bytes = new Uint8Array(24);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

function censusResponse(lat = LAT, lon = LON) {
  return Response.json({
    result: {
      addressMatches: [
        {
          coordinates: { x: lon, y: lat },
          matchedAddress: "123 TEST AVENUE, HOMESTEAD, FLORIDA, 33030",
        },
      ],
    },
  });
}

function usgsResponse(width = PIXELS, height = PIXELS) {
  return new Response(png(width, height), {
    headers: { "content-type": "image/png" },
  });
}

function successfulFetch() {
  return vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(censusResponse())
    .mockResolvedValueOnce(usgsResponse());
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Census-to-USGS aerial server integration", () => {
  it("geocodes the entered address and requests matching imagery without claiming ground resolution", async () => {
    const fetcher = successfulFetch();
    const result = await fetchPublicAerial(ADDRESS, SPAN_METERS, fetcher);

    expect(result).not.toHaveProperty("error");
    if ("error" in result) throw new Error(result.error);

    expect(result.lat).toBe(LAT);
    expect(result.lon).toBe(LON);
    expect(result.matchedAddress).toContain("HOMESTEAD");
    expect(result).not.toHaveProperty("feetPerPixel");

    const censusCall = fetcher.mock.calls[0];
    const imageryCall = fetcher.mock.calls[1];
    if (!censusCall || !imageryCall) throw new Error("Expected Census and USGS requests");

    const censusUrl = new URL(String(censusCall[0]));
    expect(censusUrl.hostname).toBe("geocoding.geo.census.gov");
    expect(censusUrl.searchParams.get("address")).toBe(ADDRESS);
    expect(censusUrl.searchParams.get("benchmark")).toBe("Public_AR_Current");
    expect(censusUrl.searchParams.get("format")).toBe("json");
    expect(censusCall[1]?.headers).toMatchObject({ Accept: "application/json" });

    const imageryUrl = new URL(String(imageryCall[0]));
    expect(imageryUrl.hostname).toBe("imagery.nationalmap.gov");
    expect(imageryUrl.pathname).toBe("/arcgis/rest/services/USGSNAIPPlus/ImageServer/exportImage");
    expect(imageryUrl.searchParams.get("f")).toBe("image");
    expect(imageryUrl.searchParams.get("format")).toBe("png");
    expect(imageryUrl.searchParams.get("bboxSR")).toBe("3857");
    expect(imageryUrl.searchParams.get("imageSR")).toBe("3857");
    expect(imageryUrl.searchParams.get("size")).toBe("2000,2000");

    const radius = 6378137;
    const centerX = (radius * LON * Math.PI) / 180;
    const centerY = radius * Math.log(Math.tan(Math.PI / 4 + (LAT * Math.PI) / 360));
    const halfSpan = SPAN_METERS / Math.cos((LAT * Math.PI) / 180) / 2;
    const actualBbox = imageryUrl.searchParams.get("bbox")?.split(",").map(Number);
    expect(actualBbox).toHaveLength(4);
    expect(actualBbox?.[0]).toBeCloseTo(centerX - halfSpan, 5);
    expect(actualBbox?.[1]).toBeCloseTo(centerY - halfSpan, 5);
    expect(actualBbox?.[2]).toBeCloseTo(centerX + halfSpan, 5);
    expect(actualBbox?.[3]).toBeCloseTo(centerY + halfSpan, 5);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("stops after Census reports no address match", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ result: { addressMatches: [] } }));

    await expect(fetchPublicAerial(ADDRESS, SPAN_METERS, fetcher)).resolves.toMatchObject({
      stage: "address_not_found",
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("does not request imagery when Census returns unusable coordinates", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(censusResponse(91, LON));

    await expect(fetchPublicAerial(ADDRESS, SPAN_METERS, fetcher)).resolves.toMatchObject({
      stage: "geocoding_response",
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("rejects non-image USGS responses and unexpected PNG dimensions", async () => {
    const htmlFetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(censusResponse())
      .mockResolvedValueOnce(
        new Response("<html>service unavailable</html>", {
          headers: { "content-type": "text/html" },
        }),
      );
    await expect(fetchPublicAerial(ADDRESS, SPAN_METERS, htmlFetcher)).resolves.toMatchObject({
      stage: "imagery_response",
    });
    expect(htmlFetcher).toHaveBeenCalledTimes(2);

    const dimensionsFetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(censusResponse())
      .mockResolvedValueOnce(usgsResponse(1024, 1024));
    await expect(fetchPublicAerial(ADDRESS, SPAN_METERS, dimensionsFetcher)).resolves.toMatchObject(
      { stage: "imagery_dimensions" },
    );
    expect(dimensionsFetcher).toHaveBeenCalledTimes(2);
  });

  it("does not retry or make follow-up requests after either network failure", async () => {
    const censusNetworkFailure = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error("Census network unavailable"));
    await expect(
      fetchPublicAerial(ADDRESS, SPAN_METERS, censusNetworkFailure),
    ).resolves.toMatchObject({ stage: "geocoding" });
    expect(censusNetworkFailure).toHaveBeenCalledTimes(1);

    const imageryNetworkFailure = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(censusResponse())
      .mockRejectedValueOnce(new Error("USGS network unavailable"));
    await expect(
      fetchPublicAerial(ADDRESS, SPAN_METERS, imageryNetworkFailure),
    ).resolves.toMatchObject({ stage: "imagery" });
    expect(imageryNetworkFailure).toHaveBeenCalledTimes(2);
  });
});
