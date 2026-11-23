import { z } from "zod";
import { shareIsActive } from "./proposal-schema";

export const portalInput = z.object({
  token: z.string().uuid(),
  environment: z.enum(["sandbox", "live"]).nullable(),
});
export const portalLinkIsActive = shareIsActive;
export function portalInvoiceVisible(
  invoice: { status: string; environment: string; expires_at: string },
  environment: string | null,
  now = Date.now(),
) {
  return (
    invoice.status === "issued" &&
    invoice.environment === environment &&
    Date.parse(invoice.expires_at) > now
  );
}
export function portalSignatureVisible(
  share: { signed_at: string | null; revoked_at: string | null; expires_at: string },
  now = Date.now(),
) {
  return Boolean(share.signed_at) && shareIsActive(share, now);
}
