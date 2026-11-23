import { z } from 'zod';
import { shareIsActive } from './proposal-schema';

export const portalInput = z.object({ token: z.string().uuid(), environment: z.enum(['sandbox', 'live']).nullable() });
export const portalLinkIsActive = shareIsActive;
export function portalInvoiceVisible(invoice: { status: string; environment: string; expires_at: string }, environment: string | null, now = Date.now()) {
  if (!invoice || typeof invoice !== 'object' || Array.isArray(invoice)) return false;
  if (typeof invoice.status !== 'string' || typeof invoice.environment !== 'string' || typeof invoice.expires_at !== 'string') return false;
  if (environment !== null && environment !== 'sandbox' && environment !== 'live') return false;
  if (!Number.isFinite(now)) return false;
  const expiresAt = Date.parse(invoice.expires_at);
  return invoice.status === 'issued' && invoice.environment === environment && Number.isFinite(expiresAt) && expiresAt > now;
}
export function portalSignatureVisible(share: { signed_at: string | null; revoked_at: string | null; expires_at: string }, now = Date.now()) {
  if (!share || typeof share !== 'object' || Array.isArray(share) || !Number.isFinite(now)) return false;
  if (typeof share.expires_at !== 'string' || (share.signed_at !== null && typeof share.signed_at !== 'string') || (share.revoked_at !== null && typeof share.revoked_at !== 'string')) return false;
  return Boolean(share.signed_at) && shareIsActive(share, now);
}