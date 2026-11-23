import { describe, expect, it } from 'vitest';
import { drawingSchema, measureDrawing, planeInfo, roofPreset, type RoofDrawing } from './roof-geometry';

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

describe('roof preset input validation', () => {
  it('accepts ordinary roof dimensions and pitch', () => {
    expect(() => roofPreset('gable', 40, 30, 6)).not.toThrow();
  });

  it.each([
    ['zero width', 0, 30, 6],
    ['negative length', 40, -1, 6],
    ['infinite width', Number.POSITIVE_INFINITY, 30, 6],
    ['oversized width', 6001, 30, 6],
    ['negative pitch', 40, 30, -1],
    ['pitch over limit', 40, 30, 25],
    ['infinite pitch', 40, 30, Number.POSITIVE_INFINITY],
  ])('rejects %s', (_label, width, length, pitch) => {
    expect(() => roofPreset('gable', width, length, pitch)).toThrow();
  });
});

describe('roof polygon boundary validation', () => {
  it('rejects non-adjacent edges that touch at a point', () => {
    const plane = {
      id: 'touching-edges',
      name: 'Touching edges',
      points: [
        { x: 0, y: 10, z: 0 },
        { x: 4, y: 10, z: 0 },
        { x: 4, y: 10, z: 4 },
        { x: 2, y: 10, z: 0 },
        { x: 0, y: 10, z: 4 },
      ],
      edges: ['eave', 'eave', 'eave', 'eave', 'eave'] as const,
    };
    expect(() => planeInfo(plane)).toThrow(/edges cross or touch/);
  });
});

describe('roof drawing record identifiers', () => {
  it('rejects duplicate roof plane IDs', () => {
    expect(drawingSchema.safeParse({
      ...drawing,
      planes: [drawing.planes[0], { ...drawing.planes[0], name: 'Second plane' }],
    }).success).toBe(false);
  });

  it('rejects duplicate penetration IDs', () => {
    const penetration = { id: 'same-id', kind: 'pipe', x: 5, z: 6, width: 2, length: 3 };
    expect(drawingSchema.safeParse({
      ...drawing,
      penetrations: [penetration, { ...penetration, kind: 'vent' }],
    }).success).toBe(false);
  });
});

describe('roof drawing identifier validation', () => {
  it('rejects blank plane IDs and names', () => {
    expect(drawingSchema.safeParse({
      ...drawing,
      planes: [{ ...drawing.planes[0], id: '   ' }],
    }).success).toBe(false);
    expect(drawingSchema.safeParse({
      ...drawing,
      planes: [{ ...drawing.planes[0], name: '   ' }],
    }).success).toBe(false);
  });

  it('rejects blank penetration IDs', () => {
    expect(drawingSchema.safeParse({
      ...drawing,
      penetrations: [{ id: '  ', kind: 'pipe', x: 5, z: 6, width: 2, length: 3 }],
    }).success).toBe(false);
  });
});

describe('roof penetration footprint validation', () => {
  it('accepts a penetration fully inside the roof footprint', () => {
    expect(() => measureDrawing({
      ...drawing,
      penetrations: [{ id: 'pipe-inside', kind: 'pipe', x: 10, z: 10, width: 2, length: 2 }],
    } as RoofDrawing)).not.toThrow();
  });

  it('rejects a penetration that extends beyond the roof edge', () => {
    expect(() => measureDrawing({
      ...drawing,
      penetrations: [{ id: 'pipe-edge', kind: 'pipe', x: 20, z: 10, width: 2, length: 2 }],
    } as any)).toThrow(/must fit within the roof footprint/);
  });
});

describe('roof penetration overlap validation', () => {
  it('allows separate penetration footprints', () => {
    expect(() => measureDrawing({
      ...drawing,
      penetrations: [
        { id: 'pipe-a', kind: 'pipe', x: 5, z: 5, width: 2, length: 2 },
        { id: 'pipe-b', kind: 'pipe', x: 15, z: 15, width: 2, length: 2 },
      ],
    } as RoofDrawing)).not.toThrow();
  });

  it('rejects intersecting penetration footprints', () => {
    expect(() => measureDrawing({
      ...drawing,
      penetrations: [
        { id: 'pipe-a', kind: 'pipe', x: 5, z: 5, width: 4, length: 4 },
        { id: 'vent-b', kind: 'vent', x: 7, z: 5, width: 4, length: 4 },
      ],
    } as RoofDrawing)).toThrow(/penetrations .* overlap/);
  });
});

describe('penetrations crossing concave roof boundaries', () => {
  it('rejects a penetration whose corners fit but whose interior crosses a roof notch', () => {
    const concaveDrawing = {
      ...drawing,
      planes: [{
        id: 'u-shaped-roof',
        name: 'U-shaped roof',
        points: [
          { x: 0, y: 10, z: 0 },
          { x: 20, y: 10, z: 0 },
          { x: 20, y: 10, z: 20 },
          { x: 13, y: 10, z: 20 },
          { x: 13, y: 10, z: 7 },
          { x: 7, y: 10, z: 7 },
          { x: 7, y: 10, z: 20 },
          { x: 0, y: 10, z: 20 },
        ],
        edges: ['eave', 'eave', 'eave', 'eave', 'eave', 'eave', 'eave', 'eave'],
      }],
      penetrations: [{ id: 'wide-vent', kind: 'vent', x: 10, z: 7, width: 12, length: 6 }],
    };
    expect(() => measureDrawing(concaveDrawing as RoofDrawing)).toThrow(/must fit within the roof footprint/);
  });
});

describe('exact penetration containment', () => {
  it('detects a narrow roof notch missed by sparse boundary samples', () => {
    const notchedRoof = {
      ...drawing,
      planes: [{
        id: 'narrow-notch',
        name: 'Narrow notch roof',
        points: [
          { x: 0, y: 10, z: 0 },
          { x: 20, y: 10, z: 0 },
          { x: 20, y: 10, z: 20 },
          { x: 9.5, y: 10, z: 20 },
          { x: 9.5, y: 10, z: 7 },
          { x: 9.3, y: 10, z: 7 },
          { x: 9.3, y: 10, z: 20 },
          { x: 0, y: 10, z: 20 },
        ],
        edges: Array(8).fill('eave'),
      }],
      penetrations: [{ id: 'wide-skylight', kind: 'skylight', x: 10, z: 7, width: 12, length: 6 }],
    };
    expect(() => measureDrawing(notchedRoof as RoofDrawing)).toThrow(/must fit within the roof footprint/);
  });
});

describe('roof plane coordinate validation', () => {
  it.each([
    ['infinite x', { x: Number.POSITIVE_INFINITY, y: 10, z: 0 }],
    ['infinite y', { x: 0, y: Number.POSITIVE_INFINITY, z: 0 }],
    ['infinite z', { x: 0, y: 10, z: Number.NEGATIVE_INFINITY }],
    ['NaN coordinate', { x: Number.NaN, y: 10, z: 0 }],
  ])('rejects %s', (_label, point) => {
    expect(drawingSchema.safeParse({
      ...drawing,
      planes: [{ ...drawing.planes[0], points: [point, ...drawing.planes[0].points.slice(1)] }],
    }).success).toBe(false);
  });
});

describe('roof preset measurement compatibility', () => {
  it.each(['gable', 'hip', 'flat', 'shed', 'mansard', 'complex'] as const)('measures the %s preset', (shape) => {
    const preset = roofPreset(shape, 40, 30, 6);
    expect(() => measureDrawing(preset)).not.toThrow();
  });
});

describe('roof preset shape validation', () => {
  it('rejects unsupported runtime shape values', () => {
    expect(() => roofPreset('dome' as never)).toThrow(/Unsupported roof preset shape/);
  });
});

describe('partial shared roof edges', () => {
  it('subtracts a T-junction attachment from the exterior perimeter', () => {
    const result = measureDrawing(roofPreset('complex', 40, 30, 6));
    // 40x30 main footprint plus a 20x15 wing attached along 15 feet.
    expect(result.perimeter).toBeCloseTo(180, 2);
  });
});
