import { describe, expect, it } from "vitest";
import { fetchReportAerialImage, naipExportImageUrl } from "@/lib/report-aerial.server";

// Minimal JPEG: SOI + APP0 + payload + EOI (the module checks the
// SOI marker and content type, not full decodability).
const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 1, 2, 3, 0xff, 0xd9]);

function fakeFetcher(response: Response | Error, calls: string[]) {
  return (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    if (response instanceof Error) throw response;
    return response;
  }) as typeof fetch;
}

describe("report aerial server fetch (step 8)", () => {
  it("builds a USGS NAIP exportImage URL for the ±42 m property window", () => {
    const url = naipExportImageUrl(25.9802103, -80.399521);
    expect(url).toContain("imagery.nationalmap.gov");
    expect(url).toContain("USGSNAIPImagery");
    expect(url).toContain("format=jpg");
    const bbox = new URL(url).searchParams.get("bbox")!.split(",").map(Number);
    expect(bbox[2]! - bbox[0]!).toBeCloseTo(
      (2 * 42) / (111320 * Math.cos((25.98 * Math.PI) / 180)),
      5,
    );
    expect(bbox[3]! - bbox[1]!).toBeCloseTo((2 * 42) / 110540, 5);
  });

  it("returns base64 JPEG bytes and the NAIP attribution on success", async () => {
    const calls: string[] = [];
    const result = await fetchReportAerialImage(
      25.9802103,
      -80.399521,
      fakeFetcher(
        new Response(JPEG_BYTES, { status: 200, headers: { "content-type": "image/jpeg" } }),
        calls,
      ),
    );
    expect(calls).toHaveLength(1);
    if (!("imageBase64" in result))
      throw new Error(`expected success, got ${JSON.stringify(result)}`);
    expect(new Uint8Array(Buffer.from(result.imageBase64, "base64"))).toEqual(JPEG_BYTES);
    expect(result.mime).toBe("image/jpeg");
    expect(result.source).toContain("NAIP");
  });

  it("reports an HTTP failure instead of falling back silently", async () => {
    const result = await fetchReportAerialImage(
      25.98,
      -80.39,
      fakeFetcher(new Response("nope", { status: 503 }), []),
    );
    expect(result).toEqual({ error: expect.stringContaining("503"), stage: "imagery" });
  });

  it("rejects a 200 response that is not a JPEG (ArcGIS error page)", async () => {
    const result = await fetchReportAerialImage(
      25.98,
      -80.39,
      fakeFetcher(
        new Response("<html>error</html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
        [],
      ),
    );
    expect(result).toMatchObject({ stage: "imagery_response" });
  });

  it("rejects unusable coordinates without calling the fetcher", async () => {
    const calls: string[] = [];
    const result = await fetchReportAerialImage(
      91,
      -80.39,
      fakeFetcher(new Response(JPEG_BYTES), calls),
    );
    expect(result).toMatchObject({ stage: "coordinates" });
    expect(calls).toHaveLength(0);
  });
});
