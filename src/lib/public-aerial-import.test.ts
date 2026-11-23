import { describe, expect, it, vi } from "vitest";
import {
  aerialImageBlob,
  aerialInvocationError,
  shouldAutoLoadAddressAerial,
  uploadAerialImage,
} from "./public-aerial-import";

const pngDataUrl = (bytes: number[]) =>
  `data:image/png;base64,${btoa(String.fromCharCode(...bytes))}`;
const minimalPng = [
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1,
];

describe("public aerial image import", () => {
  it("decodes a bounded PNG data URL locally", () => {
    const blob = aerialImageBlob(pngDataUrl(minimalPng));
    expect(blob.type).toBe("image/png");
    expect(blob.size).toBe(minimalPng.length);
  });

  it("rejects non-PNG and oversized image payloads", () => {
    expect(() => aerialImageBlob("data:image/jpeg;base64,AAAA")).toThrow(/invalid image/i);
    expect(() => aerialImageBlob(pngDataUrl([1, 2, 3]))).toThrow(/damaged/i);
    const oversized = new Uint8Array(10 * 1024 * 1024 + 1);
    oversized.set(minimalPng);
    expect(() => aerialImageBlob(pngDataUrl(Array.from(oversized)))).toThrow(/larger than 10 MB/i);
  });

  it("reports storage rejection without exposing provider details", async () => {
    const upload = vi.fn().mockResolvedValue({ error: { message: "row level security denied" } });
    await expect(uploadAerialImage(pngDataUrl(minimalPng), upload)).rejects.toThrow(
      /permissions prevented saving/i,
    );
    expect(upload).toHaveBeenCalledOnce();
  });

  it("converts upload connection failures into a retryable message", async () => {
    const upload = vi.fn().mockRejectedValue(new Error("network"));
    await expect(uploadAerialImage(pngDataUrl(minimalPng), upload)).rejects.toThrow(
      /could not connect/i,
    );
  });

  it("classifies authorization failures separately from service outages", () => {
    expect(aerialInvocationError(new Error("403 forbidden"))).toMatch(/team role/i);
    expect(aerialInvocationError(new Error("timeout"))).toMatch(/temporarily unavailable/i);
  });
});

describe("automatic address aerial lookup", () => {
  it("loads only when an address exists and no aerial or prior attempt is present", () => {
    expect(
      shouldAutoLoadAddressAerial({
        address: "123 Main Street, Miami, FL",
        hasAerial: false,
        alreadyAttempted: false,
      }),
    ).toBe(true);
    expect(
      shouldAutoLoadAddressAerial({ address: " ", hasAerial: false, alreadyAttempted: false }),
    ).toBe(false);
    expect(
      shouldAutoLoadAddressAerial({
        address: "123 Main Street, Miami, FL",
        hasAerial: true,
        alreadyAttempted: false,
      }),
    ).toBe(false);
    expect(
      shouldAutoLoadAddressAerial({
        address: "123 Main Street, Miami, FL",
        hasAerial: false,
        alreadyAttempted: true,
      }),
    ).toBe(false);
  });
});
