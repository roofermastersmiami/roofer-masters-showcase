import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const checkoutSchema = z.object({ token: z.string().uuid(), kind: z.enum(["deposit", "balance"]), environment: z.enum(["sandbox", "live"]) });
export const createInvoiceCheckout = createServerFn({ method: "POST" }).inputValidator((input: unknown) => checkoutSchema.parse(input)).handler(async ({ data }) => {
  const { createStripeClient, getStripeErrorMessage } = await import("./stripe.server");
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: invoice, error: invoiceError } = await supabaseAdmin.from("crm_invoices").select("id,number,title,environment").eq("token", data.token).eq("status", "issued").gt("expires_at", new Date().toISOString()).maybeSingle();
    if (invoiceError) throw new Error("Could not load invoice for checkout");
    if (!invoice || invoice.environment !== data.environment) return { error: "This invoice is unavailable in this payment environment." };
    const stripe = createStripeClient(data.environment);
    const { data: pending, error: pendingError } = await supabaseAdmin.from("invoice_checkouts").select("id,session_id").eq("invoice_id", invoice.id).eq("status", "pending").maybeSingle();
    if (pendingError) throw new Error("Could not verify existing checkout");
    if (pending) {
      if (!pending.session_id) return { error: "Checkout is being prepared. Please try again shortly." };
      const session = await stripe.checkout.sessions.retrieve(pending.session_id);
      if (session.status === "open") {
        if (!session.client_secret) throw new Error("Stripe checkout is missing its client secret");
        return { clientSecret: session.client_secret };
      }
      if (session.payment_status === "paid") {
        const { reconcileInvoiceSession } = await import("./invoice-payments.server");
        await reconcileInvoiceSession(pending.session_id, data.environment);
        return { error: "Payment received. Refresh this invoice for its updated balance." };
      }
      if (session.status === "complete") return { error: "Your payment is still processing. Please wait for confirmation." };
      const { data: expired, error: expireError } = await supabaseAdmin.from("invoice_checkouts").update({ status: "expired" }).eq("id", pending.id).eq("status", "pending").select("id").maybeSingle();
      if (expireError) throw expireError;
      if (!expired) return { error: "Checkout status changed while preparing payment. Refresh the invoice and try again." };
    }
    const { data: reservation, error: reserveError } = await supabaseAdmin.rpc("reserve_invoice_checkout", { p_token: data.token, p_environment: data.environment, p_kind: data.kind });
    if (reserveError || !reservation) return { error: reserveError?.message ?? "Could not prepare payment" };
    const reserved = z.object({ id: z.string().uuid(), amount: z.number().int().min(50) }).parse(reservation);
    try {
      const prices = await stripe.prices.list({ lookup_keys: ["roofing_invoice_base"], limit: 1 });
      const price = prices.data[0];
      if (!price) throw new Error("Roofing payment product is not configured");
      const productId = typeof price.product === "string" ? price.product : price.product.id;
      const origin = new URL(getRequest().url).origin;
      const description = `Roofer Masters invoice RM-${invoice.number} — ${invoice.title}`;
      const session = await stripe.checkout.sessions.create({
        mode: "payment", ui_mode: "embedded_page", payment_method_types: ["card"],
        line_items: [{ price_data: { currency: "usd", product: productId, unit_amount: reserved.amount, tax_behavior: "inclusive" }, quantity: 1 }],
        automatic_tax: { enabled: true }, billing_address_collection: "required",
        return_url: `${origin}/invoice/${data.token}?session_id={CHECKOUT_SESSION_ID}`,
        payment_intent_data: { description }, metadata: { invoiceId: invoice.id, checkoutId: reserved.id, environment: data.environment },
        expires_at: Math.floor(Date.now() / 1000) + 1800,
      }, { idempotencyKey: `invoice-checkout-${reserved.id}` });
      if (!session.client_secret) {
        await stripe.checkout.sessions.expire(session.id);
        throw new Error("Stripe checkout did not return a client secret");
      }
      const { data: registered, error } = await supabaseAdmin.from("invoice_checkouts").update({ session_id: session.id }).eq("id", reserved.id).eq("status", "pending").select("id").maybeSingle();
      if (error || !registered) {
        await stripe.checkout.sessions.expire(session.id);
        throw new Error(error ? "Could not register checkout; please try again" : "Checkout reservation changed before registration; please try again");
      }
      return { clientSecret: session.client_secret };
    } catch (error) {
      const { error: failureError } = await supabaseAdmin.from("invoice_checkouts").update({ status: "failed" }).eq("id", reserved.id).eq("status", "pending");
      if (failureError) throw new Error("Checkout setup failed and its reservation could not be released; owner review required");
      throw error;
    }
  } catch (error) { return { error: getStripeErrorMessage(error) }; }
});

export const confirmInvoiceCheckout = createServerFn({ method: "POST" }).inputValidator((input: unknown) => z.object({ token: z.string().uuid(), session_id: z.string().regex(/^cs_[a-zA-Z0-9_]+$/), environment: z.enum(["sandbox", "live"]) }).parse(input)).handler(async ({ data }) => {
  const { getStripeErrorMessage } = await import("./stripe.server");
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: invoice, error: invoiceError } = await supabaseAdmin.from("crm_invoices").select("id").eq("token", data.token).eq("environment", data.environment).eq("status", "issued").gt("expires_at", new Date().toISOString()).maybeSingle();
    if (invoiceError) throw new Error("Could not verify invoice");
    if (!invoice) return { error: "Invoice unavailable" };
    const { data: checkout, error: checkoutError } = await supabaseAdmin.from("invoice_checkouts").select("id").eq("session_id", data.session_id).eq("invoice_id", invoice.id).eq("environment", data.environment).maybeSingle();
    if (checkoutError) throw new Error("Could not verify payment session");
    if (!checkout) return { error: "Payment session does not belong to this invoice" };
    const { reconcileInvoiceSession } = await import("./invoice-payments.server");
    return { paid: await reconcileInvoiceSession(data.session_id, data.environment) };
  } catch (error) { return { error: getStripeErrorMessage(error) }; }
});

export const cancelInvoiceCheckout = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).inputValidator((input: unknown) => z.object({ invoice_id: z.string().uuid() }).parse(input)).handler(async ({ data, context }) => {
  const { createStripeClient, getStripeErrorMessage } = await import("./stripe.server");
  try {
    const { data: owner, error: roleError } = await context.supabase.rpc('has_any_role',{_user_id:context.userId,_roles:['admin','accounting']});
    if (roleError) throw new Error("Could not verify accounting permissions");
    if (!owner) return { error: "You do not have access to this action" };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: checkout, error: checkoutError } = await supabaseAdmin.from("invoice_checkouts").select("id,session_id,environment").eq("invoice_id", data.invoice_id).eq("status", "pending").maybeSingle();
    if (checkoutError) throw new Error("Could not load pending checkout");
    if (!checkout) return { ok: true };
    if (!checkout.session_id) return { error: "Checkout is being prepared; please wait" };
    const env = z.enum(["sandbox", "live"]).parse(checkout.environment);
    const stripe = createStripeClient(env);
    const session = await stripe.checkout.sessions.retrieve(checkout.session_id);
    if (session.payment_status === "paid") {
      const { reconcileInvoiceSession } = await import("./invoice-payments.server");
      await reconcileInvoiceSession(checkout.session_id, env);
      return { ok: true };
    }
    if (session.status === "complete") return { error: "Payment is processing and cannot be canceled yet" };
    if (session.status === "open") await stripe.checkout.sessions.expire(checkout.session_id);
    const { data: expired, error } = await supabaseAdmin.from("invoice_checkouts").update({ status: "expired" }).eq("id", checkout.id).eq("status", "pending").select("id").maybeSingle();
    if (error) throw error;
    if (!expired) {
      const { data: current, error: currentError } = await supabaseAdmin.from("invoice_checkouts").select("status").eq("id", checkout.id).maybeSingle();
      if (currentError) throw new Error("Could not verify checkout status after cancellation");
      if (current?.status === "paid" || current?.status === "expired") return { ok: true };
      return { error: "Checkout status changed. Refresh the invoice before trying again." };
    }
    return { ok: true };
  } catch (error) { return { error: getStripeErrorMessage(error) }; }
});