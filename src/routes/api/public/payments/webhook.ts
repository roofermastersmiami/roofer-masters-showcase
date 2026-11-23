import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/api/public/payments/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const environment = new URL(request.url).searchParams.get("env");
        if (environment !== "sandbox" && environment !== "live")
          return new Response("Invalid environment", { status: 400 });
        const { createStripeClient } = await import("@/lib/stripe.server");
        const secret =
          environment === "sandbox"
            ? process.env["PAYMENTS_SANDBOX_WEBHOOK_SECRET"]
            : process.env["PAYMENTS_LIVE_WEBHOOK_SECRET"];
        const signature = request.headers.get("stripe-signature");
        if (!signature || !secret) return new Response("Missing signature", { status: 400 });
        const body = await request.text();
        try {
          const event = await createStripeClient(environment).webhooks.constructEventAsync(
            body,
            signature,
            secret,
          );
          if (
            event.type === "checkout.session.completed" ||
            event.type === "checkout.session.async_payment_succeeded"
          ) {
            const { reconcileInvoiceSession } = await import("@/lib/invoice-payments.server");
            await reconcileInvoiceSession(event.data.object.id, environment);
          }
          if (
            event.type === "checkout.session.expired" ||
            event.type === "checkout.session.async_payment_failed"
          ) {
            const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
            const { error } = await supabaseAdmin
              .from("invoice_checkouts")
              .update({ status: event.type === "checkout.session.expired" ? "expired" : "failed" })
              .eq("session_id", event.data.object.id)
              .eq("environment", environment)
              .eq("status", "pending");
            if (error) throw error;
          }
          return Response.json({ received: true });
        } catch {
          return new Response("Webhook could not be verified or reconciled", { status: 400 });
        }
      },
    },
  },
});
