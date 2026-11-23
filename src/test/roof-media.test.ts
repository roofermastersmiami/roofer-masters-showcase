import { describe, expect, it } from "vitest";
import { isSafeRoofMediaPath } from "@/lib/roof-media";

describe("roof media storage paths", () => {
  it("accepts ordinary bucket-relative object paths", () => {
    expect(isSafeRoofMediaPath("job-123/before/roof.jpg")).toBe(true);
    expect(isSafeRoofMediaPath("aerials/2026/roof.png")).toBe(true);
  });

  it("rejects both single and repeated backslashes", () => {
    const backslash = String.fromCharCode(92);

    expect(isSafeRoofMediaPath(`job${backslash}roof.jpg`)).toBe(false);
    expect(isSafeRoofMediaPath(`job${backslash}${backslash}roof.jpg`)).toBe(false);
    expect(isSafeRoofMediaPath(`job${backslash}${backslash}${backslash}roof.jpg`)).toBe(false);
  });

  it.each([
    "",
    "/absolute/roof.jpg",
    "../private.jpg",
    "job/../../private.jpg",
    "job//roof.jpg",
    "job/./roof.jpg",
    "job\\roof.jpg",
    "job\\\\roof.jpg",
    "job/%2e%2e/private.jpg",
    "job/roof photo.jpg",
    "job/roof?.jpg",
    "x".repeat(301),
  ])("rejects unsafe path %s", (path) => expect(isSafeRoofMediaPath(path)).toBe(false));
});
