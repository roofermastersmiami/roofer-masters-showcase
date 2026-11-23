import { describe, expect, it } from 'vitest';
import { aerialBox } from './public-aerial';
import { calibratedPlane, checkCalibration } from './roof-trace';

describe('roof photo calibration', () => {
  it('rejects missing, coincident and invalid scale references', () => {
    expect(checkCalibration([], 20, 2000).ok).toBe(false);
    expect(checkCalibration([{ x: 2, y: 2 }, { x: 2, y: 2 }], 20, 2000).ok).toBe(false);
    expect(checkCalibration([{ x: 0, y: 0 }, { x: 100, y: 0 }], 0, 2000).ok).toBe(false);
    expect(checkCalibration([{ x: Number.NaN, y: 0 }, { x: 100, y: 0 }], 20, 2000).ok).toBe(false);
  });

  it('rejects non-finite calibration points when building a plane', () => {
    expect(() => calibratedPlane(
      [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }],
      [{ x: 0, y: 0 }, { x: Number.POSITIVE_INFINITY, y: 0 }],
      20, 6, 'bad',
    )).toThrow(/finite numbers/);
  });

  it('rejects a calibration scale that underflows to zero', () => {
    const reference = [{ x: 0, y: 0 }, { x: 1e200, y: 0 }];
    expect(checkCalibration(reference, Number.MIN_VALUE, 1000).ok).toBe(false);
    expect(() => calibratedPlane(
      [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }],
      reference, Number.MIN_VALUE, 6, 'underflow',
    )).toThrow(/numeric range/);
  });

  it('calculates feet per pixel from a known distance', () => {
    const result = checkCalibration([{ x: 100, y: 100 }, { x: 500, y: 100 }], 40, 2000);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.ftPerPx).toBeCloseTo(0.1);
  });

  it('converts traced plan dimensions and entered pitch into a 3D facet', () => {
    const plane = calibratedPlane(
      [{ x: 0, y: 0 }, { x: 120, y: 0 }, { x: 120, y: 60 }, { x: 0, y: 60 }],
      [{ x: 0, y: 0 }, { x: 120, y: 0 }],
      120,
      6,
      'test-plane',
      { uphill: 'down' },
    );
    expect(plane.points.map(p => p.x)).toEqual([0, 120, 120, 0]);
    expect(plane.points.map(p => p.z)).toEqual([0, 0, 60, 60]);
    expect(plane.points.map(p => p.y)).toEqual([10, 10, 40, 40]);
  });

  it('rejects traced coordinates outside the drawing schema bounds', () => {
    expect(() => calibratedPlane(
      [{ x: 0, y: 0 }, { x: 501, y: 0 }, { x: 501, y: 20 }],
      [{ x: 0, y: 0 }, { x: 1, y: 0 }],
      20, 6, 'out-of-bounds',
    )).toThrow(/supported drawing bounds/);
  });

  it('rejects finite image coordinates that overflow during calibration', () => {
    expect(() => calibratedPlane(
      [{ x: 1e308, y: 0 }, { x: -1e308, y: 0 }, { x: 1e308, y: 20 }],
      [{ x: 0, y: 0 }, { x: 20, y: 0 }],
      20, 6, 'overflow',
    )).toThrow(/supported drawing bounds/);
  });

  it('rejects calibration distances above 500 feet', () => {
    expect(() => calibratedPlane(
      [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }],
      [{ x: 0, y: 0 }, { x: 20, y: 0 }],
      501, 6, 'bad',
    )).toThrow(/no more than 500 feet/);
  });

  it('rejects non-finite corner coordinates', () => {
    expect(() => calibratedPlane(
      [{ x: 0, y: 0 }, { x: Number.NaN, y: 0 }, { x: 20, y: 20 }],
      [{ x: 0, y: 0 }, { x: 20, y: 0 }], 1, 6, 'bad',
    )).toThrow(/finite numbers/);
  });

  it('rejects incomplete traced polygons and invalid pitch', () => {
    expect(() => calibratedPlane(
      [{ x: 0, y: 0 }, { x: 20, y: 0 }],
      [{ x: 0, y: 0 }, { x: 20, y: 0 }],
      1, 6, 'bad',
    )).toThrow();
    expect(() => calibratedPlane(
      [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }],
      [{ x: 0, y: 0 }, { x: 20, y: 0 }],
      1, 30, 'bad',
    )).toThrow();
  });
});

describe('public aerial map scale', () => {
  it('rejects invalid map coordinates and dimensions', () => {
    expect(() => aerialBox(Number.NaN, -80, 120, 2000)).toThrow(/latitude/);
    expect(() => aerialBox(90, -80, 120, 2000)).toThrow(/latitude/);
    expect(() => aerialBox(25, 181, 120, 2000)).toThrow(/longitude/);
    expect(() => aerialBox(25, -80, 0, 2000)).toThrow(/ground span/);
    expect(() => aerialBox(25, -80, 120, 0)).toThrow(/dimensions/);
    expect(() => aerialBox(25, -80, 120, 2000.5)).toThrow(/dimensions/);
  });

  it('keeps true ground feet-per-pixel stable across latitude', () => {
    const equator = aerialBox(0, -80, 120, 2000);
    const miami = aerialBox(25.76, -80.19, 120, 2000);
    expect(equator.feetPerPixel).toBeCloseTo(0.1968504, 5);
    expect(miami.feetPerPixel).toBeCloseTo(equator.feetPerPixel, 8);
    expect(equator.bbox[2]! - equator.bbox[0]!).toBeLessThan(miami.bbox[2]! - miami.bbox[0]!);
  });
});
