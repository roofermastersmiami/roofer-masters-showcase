import { describe, it, expect } from 'vitest';
import { aerialBox } from '@/lib/public-aerial';
describe('public aerial scale', () => {
  it('70 m over 1000 px is about 0.23 ft per pixel', () => { expect(aerialBox(25.47, -80.48, 70, 1000).feetPerPixel).toBeCloseTo(0.2297, 3); });
  it('widens the mercator box by 1/cos(latitude) so ground span stays 70 m', () => {
    const b = aerialBox(25.47, -80.48, 70, 1000).bbox; expect((b[2]! - b[0]!) * Math.cos(25.47 * Math.PI / 180)).toBeCloseTo(70, 3);
  });
});
