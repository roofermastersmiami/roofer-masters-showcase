import { describe, expect, it } from "vitest";
import { encode as encodeJpeg } from "jpeg-js";
import { aerialTilePlan } from "@/lib/aerial-photo";
import {
  AERIAL_SOURCE_BROWARD,
  AERIAL_SOURCE_MIAMI_DADE,
  REPORT_AERIAL_SOURCE,
  aerialCountyFor,
  fetchReportAerialImage,
  fpacExportImageUrl,
  woolpertExportImageUrl,
} from "@/lib/report-aerial.server";

// Minimal JPEG: SOI + APP0 + payload + EOI (enough for the
// exportImage paths, which check the SOI marker and content type,
// not full decodability).
const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 1, 2, 3, 0xff, 0xd9]);

// A real, decodable 256×256 JPEG tile for the Broward stitch,
// which decodes every tile it composites. The pattern is
// position-dependent on purpose — R follows x, G follows y, B is
// constant — so a channel rotation or a misaligned composite in
// the stitch changes the expected pixel values and fails the
// test, instead of passing on a solid colour.
const TILE_JPEG: Uint8Array = (() => {
  const data = new Uint8Array(256 * 256 * 4);
  for (let y = 0; y < 256; y++) {
    for (let x = 0; x < 256; x++) {
      const i = (y * 256 + x) * 4;
      data[i] = x;
      data[i + 1] = y;
      data[i + 2] = 128;
      data[i + 3] = 255;
    }
  }
  return new Uint8Array(encodeJpeg({ width: 256, height: 256, data }, 95).data);
})();

function jpegResponse(bytes: Uint8Array = JPEG_BYTES) {
  return new Response(bytes as BodyInit, {
    status: 200,
    headers: { "content-type": "image/jpeg" },
  });
}

/** A fetcher that routes by URL substring; unmatched URLs 404.
 * Handlers receive the URL and may return a Response or an Error
 * (thrown). Every requested URL is recorded in `calls`. */
function routingFetcher(
  routes: { match: string; respond: (url: string) => Response | Error }[],
  calls: string[],
) {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    for (const route of routes) {
      if (url.includes(route.match)) {
        const result = route.respond(url);
        if (result instanceof Error) throw result;
        return result;
      }
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
}

// Test points (verified against the live services, 2026-11-27).
const MIRAMAR = { lat: 25.9802103, lon: -80.399521 }; // Broward
const WEST_PARK = { lat: 25.979306, lon: -80.186822 }; // Broward
const MIAMI = { lat: 25.7617, lon: -80.1918 }; // Miami-Dade
const SW_MIAMI_DADE = { lat: 25.65, lon: -80.42 }; // Miami-Dade (18100 SW 139th Ct area)
const JACKSONVILLE = { lat: 30.3322, lon: -81.6557 }; // neither county

describe("aerialCountyFor", () => {
  it("routes Broward points to the Broward chain", () => {
    expect(aerialCountyFor(MIRAMAR.lat, MIRAMAR.lon)).toBe("broward");
    expect(aerialCountyFor(WEST_PARK.lat, WEST_PARK.lon)).toBe("broward");
    expect(aerialCountyFor(26.1224, -80.1373)).toBe("broward"); // Fort Lauderdale
  });

  it("routes Miami-Dade points to the Miami-Dade chain", () => {
    expect(aerialCountyFor(MIAMI.lat, MIAMI.lon)).toBe("miami-dade");
    expect(aerialCountyFor(SW_MIAMI_DADE.lat, SW_MIAMI_DADE.lon)).toBe("miami-dade");
  });

  it("sends everything else to the universal fallback", () => {
    expect(aerialCountyFor(JACKSONVILLE.lat, JACKSONVILLE.lon)).toBe("other");
    // Broward latitude but west of the Aerials2026_V2 extent (the
    // Everglades): no county chain claims it.
    expect(aerialCountyFor(26.1, -80.6)).toBe("other");
  });
});

describe("export URL builders", () => {
  it("builds a Woolpert2025 exportImage URL for the ±42 m property window at native resolution", () => {
    const url = woolpertExportImageUrl(MIAMI.lat, MIAMI.lon);
    expect(url).toContain("imageserverintra.miamidade.gov");
    expect(url).toContain("Woolpert2025");
    expect(url).toContain("format=jpg");
    // Native pixels are 0.0762 m: an 84 m window is ~1102 px.
    expect(url).toContain("size=1102%2C1102");
    const bbox = new URL(url).searchParams.get("bbox")!.split(",").map(Number);
    expect(bbox[2]! - bbox[0]!).toBeCloseTo(
      (2 * 42) / (111320 * Math.cos((MIAMI.lat * Math.PI) / 180)),
      5,
    );
    expect(bbox[3]! - bbox[1]!).toBeCloseTo((2 * 42) / 110540, 5);
  });

  it("builds an FPAC NAIP exportImage URL (the universal fallback)", () => {
    const url = fpacExportImageUrl(MIRAMAR.lat, MIRAMAR.lon);
    expect(url).toContain("apps.geo.fpac.usda.gov");
    expect(url).toContain("conus_naip");
    expect(url).toContain("format=jpg");
    expect(url).toContain("size=1024%2C1024");
    const bbox = new URL(url).searchParams.get("bbox")!.split(",").map(Number);
    expect(bbox[3]! - bbox[1]!).toBeCloseTo((2 * 42) / 110540, 5);
  });
});

describe("report aerial source chain", () => {
  it("Miami-Dade: one Woolpert request, county attribution, bytes round-trip", async () => {
    const calls: string[] = [];
    const result = await fetchReportAerialImage(
      MIAMI.lat,
      MIAMI.lon,
      routingFetcher([{ match: "Woolpert2025", respond: () => jpegResponse() }], calls),
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("Woolpert2025");
    if (!("imageBase64" in result))
      throw new Error(`expected success, got ${JSON.stringify(result)}`);
    expect(new Uint8Array(Buffer.from(result.imageBase64, "base64"))).toEqual(JPEG_BYTES);
    expect(result.mime).toBe("image/jpeg");
    expect(result.source).toBe(AERIAL_SOURCE_MIAMI_DADE);
    expect(result.source).toBe("Miami-Dade County GIS");
  });

  it("Miami-Dade: a Woolpert failure falls back to FPAC NAIP", async () => {
    const calls: string[] = [];
    const result = await fetchReportAerialImage(
      MIAMI.lat,
      MIAMI.lon,
      routingFetcher(
        [
          { match: "Woolpert2025", respond: () => new Response("nope", { status: 503 }) },
          { match: "conus_naip", respond: () => jpegResponse() },
        ],
        calls,
      ),
    );
    expect(calls).toHaveLength(2);
    if (!("imageBase64" in result))
      throw new Error(`expected success, got ${JSON.stringify(result)}`);
    expect(result.source).toBe(REPORT_AERIAL_SOURCE);
    expect(result.source).toContain("NAIP");
  });

  it("other counties go straight to FPAC NAIP — no county source is touched", async () => {
    const calls: string[] = [];
    const result = await fetchReportAerialImage(
      JACKSONVILLE.lat,
      JACKSONVILLE.lon,
      routingFetcher([{ match: "conus_naip", respond: () => jpegResponse() }], calls),
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("conus_naip");
    if (!("imageBase64" in result))
      throw new Error(`expected success, got ${JSON.stringify(result)}`);
    expect(result.source).toBe(REPORT_AERIAL_SOURCE);
  });

  it("reports the fallback's HTTP failure when every source fails", async () => {
    const calls: string[] = [];
    const result = await fetchReportAerialImage(
      JACKSONVILLE.lat,
      JACKSONVILLE.lon,
      routingFetcher(
        [{ match: "conus_naip", respond: () => new Response("nope", { status: 503 }) }],
        calls,
      ),
    );
    expect(result).toEqual({ error: expect.stringContaining("503"), stage: "imagery" });
  });

  it("rejects a 200 response that is not a JPEG (ArcGIS error page)", async () => {
    const result = await fetchReportAerialImage(
      JACKSONVILLE.lat,
      JACKSONVILLE.lon,
      routingFetcher(
        [
          {
            match: "conus_naip",
            respond: () =>
              new Response("<html>error</html>", {
                status: 200,
                headers: { "content-type": "text/html" },
              }),
          },
        ],
        [],
      ),
    );
    expect(result).toMatchObject({ stage: "imagery_response" });
  });

  it("rejects unusable coordinates without calling the fetcher", async () => {
    const calls: string[] = [];
    const result = await fetchReportAerialImage(91, -80.39, routingFetcher([], calls));
    expect(result).toMatchObject({ stage: "coordinates" });
    expect(calls).toHaveLength(0);
  });
});

describe("Broward cover stitch", () => {
  it("stitches Aerials2026_V2 z20 tiles into one JPEG with county attribution", async () => {
    const calls: string[] = [];
    const result = await fetchReportAerialImage(
      MIRAMAR.lat,
      MIRAMAR.lon,
      routingFetcher([{ match: "Aerials2026_V2", respond: () => jpegResponse(TILE_JPEG) }], calls),
    );
    if (!("imageBase64" in result))
      throw new Error(`expected success, got ${JSON.stringify(result)}`);
    expect(result.source).toBe(AERIAL_SOURCE_BROWARD);
    // Only county tiles were requested — no Esri, no FPAC.
    expect(calls.length).toBeGreaterThan(0);
    for (const url of calls) {
      expect(url).toContain("Aerials2026_V2");
      expect(url).toContain("/tile/20/");
    }
    // The stitched JPEG is exactly the framed crop of the z20
    // tile plan, and it really decodes.
    const bytes = new Uint8Array(Buffer.from(result.imageBase64, "base64"));
    expect(bytes[0]).toBe(0xff);
    expect(bytes[1]).toBe(0xd8);
    const plan = aerialTilePlan(MIRAMAR.lat, MIRAMAR.lon, 20, 42);
    expect(calls).toHaveLength(plan.tiles.length);
    const { decode } = await import("jpeg-js");
    const decoded = decode(bytes, { useTArray: true });
    expect(decoded.width).toBe(plan.crop.size);
    expect(decoded.height).toBe(plan.crop.size);
    // Channel integrity: the output's top-left pixel is the tile
    // pattern at the crop origin (tile-local x ≈ crop.x, y ≈
    // crop.y within the first tile), and R still increases with x
    // across the frame. A one-byte misalignment in the composite
    // would put alpha (255) in the red channel everywhere and
    // fail both checks.
    const cropX = Math.round(plan.crop.x) % 256;
    const cropY = Math.round(plan.crop.y) % 256;
    const px = (x: number, y: number) => {
      const i = (y * decoded.width + x) * 4;
      return [decoded.data[i]!, decoded.data[i + 1]!, decoded.data[i + 2]!] as const;
    };
    const [r0, g0, b0] = px(0, 0);
    expect(Math.abs(r0 - cropX)).toBeLessThanOrEqual(16);
    expect(Math.abs(g0 - cropY)).toBeLessThanOrEqual(16);
    expect(Math.abs(b0 - 128)).toBeLessThanOrEqual(16);
    expect(px(200, 0)[0]).toBeGreaterThan(px(10, 0)[0]);
  });

  it("fills 404'd county slots with Esri tiles and says so in the attribution", async () => {
    const calls: string[] = [];
    let browardServed = 0;
    const result = await fetchReportAerialImage(
      MIRAMAR.lat,
      MIRAMAR.lon,
      routingFetcher(
        [
          {
            match: "Aerials2026_V2",
            respond: () => {
              browardServed += 1;
              // Only the first slot has county coverage; the rest
              // 404 (flight-block edge) and must fall back per tile.
              return browardServed === 1
                ? jpegResponse(TILE_JPEG)
                : new Response("no tile", { status: 404 });
            },
          },
          { match: "World_Imagery", respond: () => jpegResponse(TILE_JPEG) },
        ],
        calls,
      ),
    );
    if (!("imageBase64" in result))
      throw new Error(`expected success, got ${JSON.stringify(result)}`);
    expect(result.source).toContain("Broward County");
    expect(result.source).toContain("Esri");
    expect(calls.some((url) => url.includes("World_Imagery"))).toBe(true);
    expect(calls.some((url) => url.includes("conus_naip"))).toBe(false);
  });

  it("attributes an all-Esri stitch to Esri when the county has no tiles at all", async () => {
    const result = await fetchReportAerialImage(
      MIRAMAR.lat,
      MIRAMAR.lon,
      routingFetcher(
        [
          { match: "Aerials2026_V2", respond: () => new Response("no tile", { status: 404 }) },
          { match: "World_Imagery", respond: () => jpegResponse(TILE_JPEG) },
        ],
        [],
      ),
    );
    if (!("imageBase64" in result))
      throw new Error(`expected success, got ${JSON.stringify(result)}`);
    expect(result.source).toContain("Esri World Imagery");
    expect(result.source).not.toContain("Broward");
  });

  it("abandons the stitch for FPAC NAIP when a slot can't be filled either way", async () => {
    const calls: string[] = [];
    const result = await fetchReportAerialImage(
      MIRAMAR.lat,
      MIRAMAR.lon,
      routingFetcher(
        [
          { match: "Aerials2026_V2", respond: () => new Response("no tile", { status: 404 }) },
          { match: "World_Imagery", respond: () => new Response("no tile", { status: 404 }) },
          { match: "conus_naip", respond: () => jpegResponse() },
        ],
        calls,
      ),
    );
    if (!("imageBase64" in result))
      throw new Error(`expected success, got ${JSON.stringify(result)}`);
    expect(result.source).toBe(REPORT_AERIAL_SOURCE);
    expect(calls.some((url) => url.includes("conus_naip"))).toBe(true);
  });
});

describe("report aerial framing", () => {
  it("threads a caller-supplied half extent into the Woolpert window", async () => {
    const calls: string[] = [];
    const result = await fetchReportAerialImage(
      MIAMI.lat,
      MIAMI.lon,
      routingFetcher([{ match: "Woolpert2025", respond: () => jpegResponse() }], calls),
      25,
    );
    expect("imageBase64" in result).toBe(true);
    const bbox = new URL(calls[0]!).searchParams.get("bbox")!.split(",").map(Number);
    expect(bbox[3]! - bbox[1]!).toBeCloseTo((2 * 25) / 110540, 5);
    expect(bbox[2]! - bbox[0]!).toBeCloseTo(
      (2 * 25) / (111320 * Math.cos((MIAMI.lat * Math.PI) / 180)),
      5,
    );
  });

  it("clamps an out-of-range half extent to the supported window", async () => {
    const calls: string[] = [];
    await fetchReportAerialImage(
      MIAMI.lat,
      MIAMI.lon,
      routingFetcher([{ match: "Woolpert2025", respond: () => jpegResponse() }], calls),
      500,
    );
    const bbox = new URL(calls[0]!).searchParams.get("bbox")!.split(",").map(Number);
    expect(bbox[3]! - bbox[1]!).toBeCloseTo((2 * 60) / 110540, 5);
  });
});
