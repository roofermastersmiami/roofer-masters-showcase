import { describe, expect, it } from 'vitest';
import { drawingSchema, planeInfo } from './roof-geometry';

const drawing = {
  planes: [{
    id: 'plane-1',
    name: 'Main roof',
    points: [
      { x: 0, y: 10, z: 0 },
      { x: 20, y: 10, z: 0 },
      { x: 20, y: 10, z: 20 },
      { x: 0, y: 10, z: 20 },
    ],
    edges: ['eave', 'eave', 'eave', 'eave'],
  }],
  penetrations: [],
  waste: 10,
  roof_type: 'Metal Roof',
  notes: '',
  condition: '',
  verified: false,
};

describe('roof drawing penetration validation', () => {
  it('accepts a finite penetration within the drawing coordinate bounds', () => {
    expect(drawingSchema.safeParse({
      ...drawing,
      penetrations: [{ id: 'pipe-1', kind: 'pipe', x: 5, z: 6, width: 2, length: 3 }],
    }).success).toBe(true);
  });

  it.each([
    ['infinite x', { x: Number.POSITIVE_INFINITY, z: 6, width: 2, length: 3 }],
    ['out-of-bounds z', { x: 5, z: 10001, width: 2, length: 3 }],
    ['infinite width', { x: 5, z: 6, width: Number.POSITIVE_INFINITY, length: 3 }],
    ['infinite length', { x: 5, z: 6, width: 2, length: Number.POSITIVE_INFINITY }],
  ])('rejects %s', (_label, dimensions) => {
    expect(drawingSchema.safeParse({
      ...drawing,
      penetrations: [{ id: 'bad-penetration', kind: 'pipe', ...dimensions }],
    }).success).toBe(false);
  });
});

describe('roof plane vertex validation', () => {
  it('rejects consecutive duplicate roof corners before area calculation', () => {
    const plane = {
      id: 'duplicate-corner',
      name: 'Duplicate corner',
      points: [
        { x: 0, y: 10, z: 0 },
        { x: 20, y: 10, z: 0 },
        { x: 20, y: 10, z: 0 },
        { x: 0, y: 10, z: 20 },
      ],
      edges: ['eave', 'eave', 'eave', 'eave'] as const,
    };
    expect(() => planeInfo(plane)).toThrow(/corners must be distinct/);
  });
});
