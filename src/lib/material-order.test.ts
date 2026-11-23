import { describe, expect, it } from 'vitest';
import { materialOrder, type RoofReport } from './material-order';

const metalReport = (overrides: Partial<RoofReport> = {}): RoofReport => ({
  roof_type: 'Metal Roof' as const,
  area_sqft: 2400,
  waste_pct: 10,
  ridge_lf: 40,
  hips_lf: 20,
  valleys_lf: 0,
  eaves_lf: 80,
  rakes_lf: 40,
  panel_width_in: 16,
  pipes: 2,
  ...overrides,
});

describe('metal material order', () => {
  it('does not invent panel counts or average cut lengths from eave totals', () => {
    const lines = materialOrder(metalReport());
    expect(lines.some(line => line.unit === 'panels')).toBe(false);
    expect(lines.some(line => line.item.toLowerCase().includes('average panel length'))).toBe(false);
    const aggregate = lines.find(line => line.item.includes('aggregate only'));
    expect(aggregate?.unit).toBe('linear ft');
    expect(aggregate?.qty).toBeCloseTo((2400 * 1.1) / (16 / 12), 1);
  });

  it('accepts a configurable net coverage width through 60 inches', () => {
    const lines = materialOrder(metalReport({ panel_width_in: 60 }));
    const aggregate = lines.find(line => line.item.includes('60"'));
    expect(aggregate?.qty).toBeCloseTo((2400 * 1.1) / 5, 1);
  });

  it('uses the 16-inch company default when legacy reports omit panel width', () => {
    const { panel_width_in: _ignored, ...legacy } = metalReport();
    const lines = materialOrder(legacy);
    const aggregate = lines.find(line => line.item.includes('aggregate only'));
    expect(aggregate?.item).toContain('16" net coverage');
    expect(aggregate?.qty).toBeCloseTo((2400 * 1.1) / (16 / 12), 1);
  });

  it('rejects invalid panel coverage widths', () => {
    expect(() => materialOrder(metalReport({ panel_width_in: 5.99 }))).toThrow();
    expect(materialOrder(metalReport({ panel_width_in: 6 })).some(line => line.item.includes('6\"'))).toBe(true);
    expect(() => materialOrder(metalReport({ panel_width_in: 61 }))).toThrow();
  });
});
