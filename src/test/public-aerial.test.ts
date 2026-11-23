import { describe, it, expect } from 'vitest';
import { aerialBox } from '@/lib/public-aerial';
describe('public aerial scale', () => {
  it('70 m over 1000 px is about 0.23 ft per pixel', () => { expect(aerialBox(25.47, -80.48, 70, 1000).feetPerPixel).toBeCloseTo(0.2297, 3); });
  it('widens the mercator box by 1/cos(latitude) so ground span stays 70 m', () => {
    const b = aerialBox(25.47, -80.48, 70, 1000).bbox; const left=b[0],right=b[2]; if(left===undefined||right===undefined)throw new Error('Missing bounds'); expect((right - left) * Math.cos(25.47 * Math.PI / 180)).toBeCloseTo(70, 3);
  });
});
import { shouldAutoLoadAddressAerial } from "@/lib/public-aerial-import";
describe("automatic address aerial eligibility", () => {
  it("loads once for a non-empty address when no aerial exists", () => {
    expect(shouldAutoLoadAddressAerial({ address: "123 Main St, Miami, FL", hasAerial: false, alreadyAttempted: false })).toBe(true);
  });
  it("does not load without an address, when an aerial exists, or after an attempt", () => {
    expect(shouldAutoLoadAddressAerial({ address: "  ", hasAerial: false, alreadyAttempted: false })).toBe(false);
    expect(shouldAutoLoadAddressAerial({ address: "123 Main St", hasAerial: true, alreadyAttempted: false })).toBe(false);
    expect(shouldAutoLoadAddressAerial({ address: "123 Main St", hasAerial: false, alreadyAttempted: true })).toBe(false);
  });
});
