import { describe, expect, it } from 'vitest';
import { measureDrawing, roofPreset, toMaterialReport } from './roof-geometry';
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

  it('uses 16-inch net coverage for equivalent metal panel run length', () => {
    const d = roofPreset('gable', 40, 30, 6); d.roof_type = 'Metal Roof';
    const r = calculateRoofMaterialTakeoff(d);
    expect(r.metalPanelCoverageWidthInches).toBe(16);
    const run = r.lines.find(x => x.item === 'Equivalent metal panel run length');
    expect(run?.unit).toBe('linear ft');
    expect(run?.quantity).toBeCloseTo(r.orderAreaSqft / (16 / 12), 1);
  });

  it('uses a saved drawing panel width when no override is supplied', () => {
    const d = roofPreset('gable', 40, 30, 6); d.roof_type = 'Metal Roof';
    d.metal_panel_width_inches = 18;
    const r = calculateRoofMaterialTakeoff(d);
    expect(r.metalPanelCoverageWidthInches).toBe(18);
    const report = toMaterialReport(d);
    expect(report.panel_width_in).toBe(18);
  });
  it('keeps the legacy 16-inch default for drawings without a saved width', () => {
    const d = roofPreset('gable', 40, 30, 6); d.roof_type = 'Metal Roof';
    delete d.metal_panel_width_inches;
    expect(toMaterialReport(d).panel_width_in).toBe(16);
  });

  it('allows a different net coverage when a different panel profile is selected', () => {
    const d = roofPreset('gable', 40, 30, 6); d.roof_type = 'Metal Roof';
    const r = calculateRoofMaterialTakeoff(d, { metalPanelCoverageWidthInches: 18 });
    expect(r.metalPanelCoverageWidthInches).toBe(18);
  });

  it('preserves fractional linear footage instead of rounding every edge up', () => {
    const d = roofPreset('gable', 40.25, 30.5, 6); d.roof_type = 'Shingle Roof';
    const r = calculateRoofMaterialTakeoff(d, { wastePercent: 0 });
    const drip = r.lines.find(x => x.item === 'Drip edge allowance');
    expect(drip?.quantity).toBe(Math.round(measureDrawing(d).perimeter * 10) / 10);
    expect(drip?.unit).toBe('linear ft');
  });
  it('uses flat-system allowances for TPO and flat roofs', () => {
    const d = roofPreset('flat', 30, 40, 0); d.roof_type = 'TPO';
    const r = calculateRoofMaterialTakeoff(d);
    expect(r.lines.some(x => x.item === 'Roof membrane allowance' && x.unit === 'sq ft')).toBe(true);
    expect(r.warnings.some(x => x.includes('roll width'))).toBe(true);
  });

  it('publishes the confirmed 16-inch metal panel width in report data', () => {
    const d = roofPreset('gable', 40, 30, 6); d.roof_type = 'Metal Roof';
    const report = toMaterialReport(d);
    expect(report.panel_width_in).toBe(16);
    expect(report.roof_type).toBe('Metal Roof');
  });
  it('rounds package counts up while keeping measured footage fractional', () => {
    const d = roofPreset('gable', 40.25, 30.5, 6); d.roof_type = 'Shingle Roof';
    const r = calculateRoofMaterialTakeoff(d, { wastePercent: 0 });
    for (const line of r.lines.filter(x => ['bundles', 'rolls', 'fasteners'].includes(x.unit))) {
      expect(Number.isInteger(line.quantity)).toBe(true);
    }
    const drip = r.lines.find(x => x.item === 'Drip edge allowance');
    expect(drip?.quantity % 1).not.toBe(0);
  });

  it('rejects invalid product coverage assumptions', () => {
    const d = roofPreset('flat', 30, 40, 0);
    expect(() => calculateRoofMaterialTakeoff(d, { underlaymentRollCoverageSqft: 0 })).toThrow();
  });
});
