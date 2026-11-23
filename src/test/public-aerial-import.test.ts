import { describe, it, expect, vi } from "vitest";
import { fetchPublicAerial } from "@/lib/public-aerial.server";
import {
  aerialImageBlob,
  uploadAerialImage,
  aerialInvocationError,
  shouldAutoLoadAddressAerial,
} from "@/lib/public-aerial-import";
function png(width = 2000, height = 2000) {
  const bytes = new Uint8Array(24);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}
const geo = () =>
  Response.json({
    result: {
      addressMatches: [{ coordinates: { x: -80.48, y: 25.47 }, matchedAddress: "Test address" }],
    },
  });
const image = () => new Response(png(), { headers: { "content-type": "image/png" } });
function source(second: Response) {
  return vi.fn<typeof fetch>().mockResolvedValueOnce(geo()).mockResolvedValueOnce(second);
}
const encoded = () => `data:image/png;base64,${btoa(String.fromCharCode(...png()))}`;
describe("free aerial retrieval", () => {
  it("exports a fixed USGS 3857 PNG and returns ground scale for 120 m / 2000 px", async () => {
    const fetcher = source(image());
    const r = await fetchPublicAerial("Test address", 120, fetcher);
    expect("error" in r, "error" in r ? r.error : "").toBe(false);
    if ("error" in r) throw new Error(r.error);
    expect(r.feetPerPixel).toBeCloseTo(0.1968504, 7);
    expect(r.image).toBe(encoded());
    const call = fetcher.mock.calls[1];
    if (!call) throw new Error("USGS was not requested");
    const url = new URL(String(call[0]));
    expect(url.hostname).toBe("imagery.nationalmap.gov");
    expect(url.searchParams.get("f")).toBe("image");
    expect(url.searchParams.get("bboxSR")).toBe("3857");
    expect(url.searchParams.get("size")).toBe("2000,2000");
    expect(call[1]?.redirect).toBe("follow");
    expect(new Headers(call[1]?.headers).get("accept")).toContain("application/json");
  });
  it("reports geocoder timeout without attempting imagery", async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error("timeout"));
    expect(await fetchPublicAerial("Test address", 120, fetcher)).toMatchObject({
      stage: "geocoding",
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("rejects an HTML page returned with HTTP 200 by the Census geocoder", async () => {
    const html = new Response("<html>service page</html>", {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
    const result = await fetchPublicAerial(
      "Test address",
      120,
      vi.fn<typeof fetch>().mockResolvedValue(html),
    );
    expect(result).toMatchObject({ stage: "geocoding_response" });
    if ("error" in result) {
      expect(result.error).toContain("text/html");
      expect(result.error).toContain("Add image");
    }
  });
  it("reports unreadable Census JSON", async () => {
    expect(
      await fetchPublicAerial(
        "Test address",
        120,
        vi.fn<typeof fetch>().mockResolvedValue(new Response("broken")),
      ),
    ).toMatchObject({ stage: "geocoding_response" });
  });
  it("reports an unmatched address", async () => {
    expect(
      await fetchPublicAerial(
        "Test address",
        120,
        vi.fn<typeof fetch>().mockResolvedValue(Response.json({ result: { addressMatches: [] } })),
      ),
    ).toMatchObject({ stage: "address_not_found" });
  });
  it("rejects invalid coordinates before calling USGS", async () => {
    const f = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        result: { addressMatches: [{ coordinates: { x: 0, y: 90 }, matchedAddress: "Test" }] },
      }),
    );
    expect(await fetchPublicAerial("Test address", 120, f)).toMatchObject({
      stage: "geocoding_response",
    });
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("reports USGS HTTP failure", async () =>
    expect(
      await fetchPublicAerial("Test address", 120, source(new Response("down", { status: 503 }))),
    ).toMatchObject({ stage: "imagery" }));
  it("reports USGS timeout", async () => {
    const f = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(geo())
      .mockRejectedValueOnce(new Error("timeout"));
    expect(await fetchPublicAerial("Test address", 120, f)).toMatchObject({ stage: "imagery" });
  });
  it("rejects ArcGIS JSON errors even with HTTP 200", async () =>
    expect(
      await fetchPublicAerial("Test address", 120, source(Response.json({ error: { code: 500 } }))),
    ).toMatchObject({ stage: "imagery_response" }));
  it("rejects an empty PNG", async () =>
    expect(
      await fetchPublicAerial(
        "Test address",
        120,
        source(new Response("", { headers: { "content-type": "image/png" } })),
      ),
    ).toMatchObject({ stage: "imagery_response" }));
  it("rejects map dimensions that would invalidate scale", async () =>
    expect(
      await fetchPublicAerial(
        "Test address",
        120,
        source(new Response(png(500), { headers: { "content-type": "image/png" } })),
      ),
    ).toMatchObject({ stage: "imagery_dimensions" }));
  it("rejects images over the private storage limit", async () =>
    expect(
      await fetchPublicAerial(
        "Test address",
        120,
        source(
          new Response(png(), {
            headers: {
              "content-type": "image/png",
              "content-length": String(10 * 1024 * 1024 + 1),
            },
          }),
        ),
      ),
    ).toMatchObject({ stage: "imagery_size" }));
});
describe("private aerial upload", () => {
  it("decodes PNG locally and passes its actual bytes to upload", async () => {
    const upload = vi.fn().mockResolvedValue({ error: null });
    await uploadAerialImage(encoded(), upload);
    const blob = upload.mock.calls[0]?.[0] as Blob | undefined;
    if (!blob) throw new Error("No upload");
    const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (reader.result instanceof ArrayBuffer) resolve(reader.result);
        else reject(new Error("Invalid blob"));
      };
      reader.onerror = () => reject(new Error("Read failed"));
      reader.readAsArrayBuffer(blob);
    });
    expect(blob.type).toBe("image/png");
    expect(new Uint8Array(buffer)).toEqual(png());
  });
  it("does not upload malformed data", async () => {
    const upload = vi.fn();
    await expect(uploadAerialImage("data:image/png;base64,broken", upload)).rejects.toThrow(
      "damaged",
    );
    expect(upload).not.toHaveBeenCalled();
  });
  it("rejects a non-PNG response", () =>
    expect(() => aerialImageBlob("data:text/html;base64,AAAA")).toThrow("invalid image"));
  it("distinguishes storage permission denial", async () =>
    await expect(
      uploadAerialImage(encoded(), async () => ({
        error: { message: "new row violates row-level security policy" },
      })),
    ).rejects.toThrow("permissions prevented"));
  it("distinguishes storage rejection", async () =>
    await expect(
      uploadAerialImage(encoded(), async () => ({ error: { message: "storage unavailable" } })),
    ).rejects.toThrow("storage rejected"));
  it("distinguishes storage connection failure", async () =>
    await expect(
      uploadAerialImage(encoded(), async () => {
        throw new Error("network");
      }),
    ).rejects.toThrow("upload could not connect"));
  it("distinguishes invocation authorization from connectivity", () => {
    expect(aerialInvocationError(new Error("Unauthorized"))).toContain("team role");
    expect(aerialInvocationError(new Error("Failed to fetch"))).toContain("connection");
  });
});

describe("automatic address aerial loading", () => {
  it("loads free imagery once for a new address report without an aerial", () => {
    expect(
      shouldAutoLoadAddressAerial({
        isNewReport: true,
        address: "123 Main St, Miami, FL",
        hasAerial: false,
        alreadyAttempted: false,
      }),
    ).toBe(true);
  });
  it("does not auto-load for existing drawings, missing addresses, saved aerials or retries", () => {
    const base = {
      isNewReport: true,
      address: "123 Main St, Miami, FL",
      hasAerial: false,
      alreadyAttempted: false,
    };
    expect(shouldAutoLoadAddressAerial({ ...base, isNewReport: false })).toBe(false);
    expect(shouldAutoLoadAddressAerial({ ...base, address: " " })).toBe(false);
    expect(shouldAutoLoadAddressAerial({ ...base, hasAerial: true })).toBe(false);
    expect(shouldAutoLoadAddressAerial({ ...base, alreadyAttempted: true })).toBe(false);
  });
});
