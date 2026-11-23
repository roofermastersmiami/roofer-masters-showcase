import { describe, expect, it } from 'vitest';
import { roofPreset } from './roof-geometry';
import { calculateRoofMaterialTakeoff } from './roof-material-takeoff';
describe('calculateRoofMaterialTakeoff', () => {
  it('calculates preliminary shingle quantities with waste', () => {
    const d = roofPreset('gable', 40, 30, 6); d.roof_type = 'Shingle Roof';
    const r = calculateRoofMaterialTakeoff(d, { wastePercent: 10 });
    expect(r.orderAreaSqft).toBeCloseTo(r.measuredAreaSqft * 1.1);
    expect(r.lines.some(x => x.item === 'Shingle bundles')).toBe(true);
    expect(r.warnings.some(x => x.includes('not site-verified'))).toBe(true);
  });
  it('reports metal coverage in area units without inventing a panel count', () => {
    const d = roofPreset('hip', 40, 60, 5); d.roof_type = 'Metal Roof';
    const r = calculateRoofMaterialTakeoff(d);
    expect(r.lines.some(x => x.item === 'Metal panel coverage allowance' && x.unit === 'sq ft')).toBe(true);
    expect(r.warnings.some(x => x.includes('not a panel count or cut list'))).toBe(true);
  });
  it('preserves fractional linear footage instead of rounding every edge up', () => {
    const d = roofPreset('gable', 40.25, 30.5, 6); d.roof_type = 'Shingle Roof';
    const r = calculateRoofMaterialTakeoff(d, { wastePercent: 0 });
    const drip = r.lines.find(x => x.item === 'Drip edge allowance');
    expect(drip?.quantity).toBeCloseTo(2 * (40.25 + 30.5), 1);
    expect(drip?.unit).toBe('linear ft');
  });
  it('rejects invalid product coverage assumptions', () => {
    const d = roofPreset('flat', 30, 40, 0);
    expect(() => calculateRoofMaterialTakeoff(d, { underlaymentRollCoverageSqft: 0 })).toThrow();
  });
});
