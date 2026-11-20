export function PaymentTestModeBanner() {
  const token = import.meta.env['VITE_PAYMENTS_CLIENT_TOKEN'];
  if (!token?.startsWith("pk_live_") && !token?.startsWith("pk_test_")) return <div className="border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-center text-sm text-destructive">Online payments are unavailable until the payment account setup is complete.</div>;
  if (token.startsWith("pk_test_")) return <div className="border-b border-warning/30 bg-warning/10 px-4 py-2 text-center text-sm text-foreground">Test payments only — no real money will be charged.</div>;
  return null;
}