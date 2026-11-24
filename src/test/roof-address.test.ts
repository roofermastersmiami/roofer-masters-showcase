import { describe, expect, it } from "vitest";
import { parseRoofAddressMatch } from "@/lib/roof-address";

describe("parseRoofAddressMatch", () => {
  it("returns the normalized Census match and valid coordinates", () => {
    expect(
      parseRoofAddressMatch(
        {
          result: {
            addressMatches: [
              {
                matchedAddress: "123 MAIN ST, MIAMI, FL, 33130",
                coordinates: { x: -80.1918, y: 25.7617 },
              },
            ],
          },
        },
        "123 Main St, Miami, FL",
      ),
    ).toEqual({
      matchedAddress: "123 MAIN ST, MIAMI, FL, 33130",
      lat: 25.7617,
      lon: -80.1918,
    });
  });

  it("uses the submitted address when Census omits matchedAddress", () => {
    expect(
      parseRoofAddressMatch(
        { result: { addressMatches: [{ coordinates: { x: -80, y: 25 } }] } },
        "123 Main Street, Miami, FL",
      )?.matchedAddress,
    ).toBe("123 Main Street, Miami, FL");
  });

  it.each([
    null,
    {},
    { result: { addressMatches: [] } },
    { result: { addressMatches: [{ coordinates: { x: 181, y: 25 } }] } },
    { result: { addressMatches: [{ coordinates: { x: -80, y: Number.NaN } }] } },
    { result: { addressMatches: [{ coordinates: { x: -80, y: 91 } }] } },
  ])("rejects malformed or out-of-range geocoder data: %o", (payload) => {
    expect(parseRoofAddressMatch(payload, "123 Main Street, Miami, FL")).toBeNull();
  });
});
