import { describe, expect, it } from 'vitest';
import { isSafeRoofMediaPath } from '@/lib/roof-media';

describe('roof media storage paths', () => {
  it('accepts ordinary bucket-relative object paths', () => {
    expect(isSafeRoofMediaPath('job-123/before/roof.jpg')).toBe(true);
    expect(isSafeRoofMediaPath('aerials/2026/roof.png')).toBe(true);
  });

  it.each(['', '/absolute/roof.jpg', '../private.jpg', 'job/../../private.jpg', 'job//roof.jpg', 'job/./roof.jpg', 'job\\\\roof.jpg', 'x'.repeat(301)])(
    'rejects unsafe path %s',
    (path) => expect(isSafeRoofMediaPath(path)).toBe(false),
  );
});
