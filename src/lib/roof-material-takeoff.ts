import { z } from 'zod';
import { measureDrawing, type RoofDrawing } from './roof-geometry';
const inputSchema = z.object({
  shingleBundleCoverageSqft: z.number().positive().default(33.3),
  underlaymentRollCoverageSqft: z.number().positive().default(400),
  fastenersPerSquare: z.number().positive().default(80),
  metalPanelCoverageWidthInches: z.number().positive().max(60).default(16),
  wastePercent: z.number().min(0).max(50).default(10),
});
export type TakeoffOptions = z.input<typeof inputSchema>;
export type MaterialLine = { item: string; quantity: number; unit: string; basis: string };
const ceil = (n: number) => Math.ceil(Math.max(0, n));
/** Preliminary allowance only. Confirm field dimensions, product data, code and manufacturer specifications before ordering. */
export function calculateRoofMaterialTakeoff(drawing: RoofDrawing, rawOptions: TakeoffOptions = {}) {
  const options = inputSchema.parse({ ...rawOptions, wastePercent: rawOptions.wastePercent ?? drawing.waste, metalPanelCoverageWidthInches: rawOptions.metalPanelCoverageWidthInches ?? drawing.metal_panel_width_inches ?? 16 });
  const measured = measureDrawing(drawing);
  const area = measured.area * (1 + options.wastePercent / 100);
  const squares = area / 100;
  const lines: MaterialLine[] = [];
  const add = (item: string, quantity: number, unit: string, basis: string) => {
    if (!Number.isFinite(quantity) || quantity <= 0) return;
    const wholeUnit = ['bundles', 'rolls', 'fasteners'].includes(unit);
    lines.push({ item, quantity: wholeUnit ? ceil(quantity) : Math.round(quantity * 10) / 10, unit, basis });
  };
  if (drawing.roof_type === 'Shingle Roof') {
    add('Shingle bundles', area / options.shingleBundleCoverageSqft, 'bundles', 'Sloped area with selected waste; verify bundle coverage');
    add('Underlayment rolls', area / options.underlaymentRollCoverageSqft, 'rolls', 'Area divided by assumed roll coverage');
    add('Drip edge allowance', measured.perimeter, 'linear ft', 'Exterior perimeter; separate eaves and rakes in field');
    add('Starter strip allowance', measured.edges.eave + measured.edges.rake, 'linear ft', 'Eaves and rakes; verify manufacturer requirements');
    add('Ridge cap allowance', measured.edges.ridge + measured.edges.hip, 'linear ft', 'Ridge and hip lengths');
    add('Fasteners allowance', squares * options.fastenersPerSquare, 'fasteners', 'Allowance only; confirm deck and fastening schedule');
  } else if (drawing.roof_type === 'Metal Roof') {
    add('Metal panel coverage allowance', area, 'sq ft', 'Area allowance only; panel count and cut lengths require each measured panel run and layout');
    add('Equivalent metal panel run length', area / (options.metalPanelCoverageWidthInches / 12), 'linear ft', `Area divided by ${options.metalPanelCoverageWidthInches}-inch net coverage; aggregate equivalent only, not a cut list`);
    add('Underlayment rolls', area / options.underlaymentRollCoverageSqft, 'rolls', 'Area divided by assumed roll coverage');
    add('Ridge and hip trim', measured.edges.ridge + measured.edges.hip, 'linear ft', 'Measured ridge and hip edges');
    add('Valley trim', measured.edges.valley, 'linear ft', 'Measured valley edges');
    add('Eave trim', measured.edges.eave, 'linear ft', 'Measured eave edges');
    add('Rake trim', measured.edges.rake, 'linear ft', 'Measured rake edges');
    add('Fasteners allowance', squares * options.fastenersPerSquare, 'fasteners', 'Generic allowance only; replace with selected panel system fastening schedule');
  } else if (drawing.roof_type === 'Tile Roof') {
    add('Tile coverage', area, 'sq ft', 'Area with waste; convert using exact tile exposure and model');
    add('Underlayment rolls', area / options.underlaymentRollCoverageSqft, 'rolls', 'Area divided by assumed roll coverage');
    add('Ridge and hip accessories', measured.edges.ridge + measured.edges.hip, 'linear ft', 'Measured ridge and hip lengths');
    add('Valley flashing', measured.edges.valley, 'linear ft', 'Measured valley lengths');
  } else {
    add('Roof membrane allowance', area, 'sq ft', 'Area with waste; verify roll layout');
    add('System cover / underlayment allowance', area, 'sq ft', 'Assembly-dependent; confirm specification');
    add('Perimeter flashing allowance', measured.perimeter, 'linear ft', 'Exterior perimeter only; wall transitions need field detail');
  }
  return {
    roofType: drawing.roof_type, measuredAreaSqft: measured.area, wastePercent: options.wastePercent,
    ...(drawing.roof_type === 'Metal Roof' ? { metalPanelCoverageWidthInches: options.metalPanelCoverageWidthInches } : {}),
    orderAreaSqft: area, squares: measured.squares, orderSquares: squares, lines,
    warnings: [
      'Preliminary takeoff only. Verify dimensions, roof assembly, product coverage, code and manufacturer specifications before purchasing.',
      ...(drawing.verified ? [] : ['Drawing is not site-verified; quantities are not final.']),
      ...(drawing.roof_type === 'Metal Roof' ? ['Metal panel width defaults to 16 inches of net coverage. Equivalent run length is an area-based aggregate only, not a panel count or cut list. Measure each panel run and account for sidelaps, endlaps and trim before ordering.'] : []),
      ...(drawing.roof_type === 'Tile Roof' ? ['Tile piece counts require the exact tile model, headlap, exposure and accessory system.'] : []),
      ...((drawing.roof_type === 'TPO' || drawing.roof_type === 'Flat Roof') ? ['Flat-roof membrane layout depends on roll width, seam direction, parapets, penetrations and attachment method.'] : []),
    ],
  };
}
