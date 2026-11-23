import { describe, it, expect } from 'vitest';
import { aerialBox } from '@/lib/public-aerial';
describe('public aerial scale', () => {
  it('70 m over 1000 px is about 0.23 ft per pixel', () => { expect(aerialBox(25.47, -80.48, 70, 1000).feetPerPixel).toBeCloseTo(0.2297, 3); });
  it('widens the mercator box by 1/cos(latitude) so ground span stays 70 m', () => {
    const b = aerialBox(25.47, -80.48, 70, 1000).bbox; const left=b[0],right=b[2]; if(left===undefined||right===undefined)throw new Error('Missing bounds'); expect((right - left) * Math.cos(25.47 * Math.PI / 180)).toBeCloseTo(70, 3);
  });
});

it('rejects invalid coordinates and dimensions instead of producing invalid map bounds', () => {
  expect(() => aerialBox(90, -80, 70, 2000)).toThrow('Latitude');
  expect(() => aerialBox(25, 181, 70, 2000)).toThrow('Longitude');
  expect(() => aerialBox(25, -80, 0, 2000)).toThrow('Map span');
  expect(() => aerialBox(25, -80, 70, 0)).toThrow('Image size');
});
