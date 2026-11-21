import { z } from 'zod';
import { reportSchema } from './material-order';

export const REPORT_PROVIDERS = [
  { value: 'manual', label: 'Manual / existing report' },
  { value: 'eagleview', label: 'EagleView' },
  { value: 'gaf', label: 'GAF QuickMeasure' },
  { value: 'roofr', label: 'Roofr' },
  { value: 'hover', label: 'HOVER' },
  { value: 'other', label: 'Other provider' },
] as const;
export const REPORT_STATUSES = ['requested', 'ordered', 'received', 'reviewed', 'cancelled'] as const;
export const REPORT_STATUS_LABELS = { requested: 'Request saved · not submitted', ordered: 'Ordered externally · owner recorded', received: 'Report received · unreviewed', reviewed: 'Measurements reviewed', cancelled: 'Cancelled' };
export const roofOrderSchema = z.object({
  customer_id: z.string().uuid(),
  address: z.string().trim().min(8, 'Enter the full customer property address').max(250),
  title: z.string().trim().min(1).max(180),
  provider: z.enum(['manual', 'eagleview', 'gaf', 'roofr', 'hover', 'other']),
  notes: z.string().max(4000),
});
export const ownRoofReportSchema=roofOrderSchema.extend({provider:z.literal('manual')});
export const updateRoofOrderSchema = z.object({
  id: z.string().uuid(), updated_at: z.string(), status: z.enum(REPORT_STATUSES),
  provider_reference: z.string().trim().max(150), notes: z.string().max(4000),
  measurements: reportSchema.nullable(),
});
export function assertReportStatus(order: { status: string; provider: string; provider_reference: string; file_path: string | null; measurements: unknown }) {
  if (order.status === 'ordered' && (order.provider === 'manual' || !order.provider_reference.trim())) throw new Error('Record a provider order reference first');
  if (order.status === 'received' && !order.file_path) throw new Error('Attach the completed PDF first');
  if (order.status === 'reviewed') {
    if (!reportSchema.safeParse(order.measurements).success) throw new Error('Review and complete the roof measurements first');
    if (order.provider !== 'manual' && !order.file_path) throw new Error('Attach the provider report before reviewing it');
  }
}
export function reviewedReport(order: { status: string; reviewed_at: string | null; measurements: unknown }) {
  if (order.status !== 'reviewed' || !order.reviewed_at) throw new Error('Save owner-reviewed measurements before transferring them');
  return reportSchema.parse(order.measurements);
}