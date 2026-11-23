import { createStripeClient, type StripeEnv } from "./stripe.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// Both verified webhooks and the customer return flow use the same idempotent settlement path.
export async function reconcileInvoiceSession(sessionId: string, environment: StripeEnv) {
  const session = await createStripeClient(environment).checkout.sessions.retrieve(sessionId);
  if (session.payment_status !== "paid") return false;
  if (
    session.currency !== "usd" ||
    !session.amount_total ||
    session.metadata?.["environment"] !== environment
  )
    throw new Error("Payment currency or environment mismatch");
  const { data: checkout } = await supabaseAdmin
    .from("invoice_checkouts")
    .select("id,invoice_id")
    .eq("session_id", sessionId)
    .eq("environment", environment)
    .maybeSingle();
  if (
    !checkout ||
    checkout.invoice_id !== session.metadata["invoiceId"] ||
    checkout.id !== session.metadata["checkoutId"]
  )
    throw new Error("Payment invoice mismatch");
  const { error } = await supabaseAdmin.rpc("settle_invoice_checkout", {
    p_session_id: sessionId,
    p_environment: environment,
    p_amount_cents: session.amount_total,
  });
  if (error) throw new Error("Payment received but could not be reconciled; owner review required");
  return true;
}
