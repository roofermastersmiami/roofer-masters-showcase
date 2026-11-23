import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/site/Logo";
import { pageMeta } from "@/lib/seo";
import { authorizationResult, consentDecision, type ConsentProvider } from "@/lib/oauth-consent";

// Local wrapper for beta SDK typing; requests still use the installed auth SDK.
const oauth = () => (supabase.auth as typeof supabase.auth & { oauth: ConsentProvider }).oauth;
export const Route = createFileRoute("/.lovable/oauth/consent")({
  ssr: false,
  head: () => ({
    meta: [
      ...pageMeta(
        "Connect your assistant | Roofer Masters",
        "Approve or decline protected assistant access to your Roofer Masters CRM account.",
      ),
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  validateSearch: (search: Record<string, unknown>) => ({
    authorization_id:
      typeof search["authorization_id"] === "string" ? search["authorization_id"] : "",
  }),
  beforeLoad: async ({ search, location }) => {
    if (!search.authorization_id)
      throw new Error("Missing connection request. Start again from your assistant.");
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    if (!data.session)
      throw redirect({ to: "/auth", search: { next: location.pathname + location.searchStr } });
    return { accountEmail: data.session.user.email ?? "Your account" };
  },
  loader: async ({ location, context }) => {
    const id = new URLSearchParams(location.searchStr).get("authorization_id");
    if (!id) throw new Error("Missing connection request.");
    const details = authorizationResult(await oauth().getAuthorizationDetails(id));
    const immediate = details.redirect_url ?? details.redirect_to;
    if (immediate && !details.client) throw redirect({ href: immediate });
    return { details, email: context.accountEmail };
  },
  pendingComponent: () => (
    <main className="mx-auto max-w-xl px-6 py-16 text-muted-foreground">
      Loading connection request…
    </main>
  ),
  errorComponent: () => (
    <main className="mx-auto max-w-xl px-6 py-16">
      <h1 className="text-2xl font-bold">Connection request unavailable</h1>
      <p role="alert" className="mt-4 text-muted-foreground">
        This request may be expired, invalid, or temporarily unavailable. Start a new connection
        from your assistant.
      </p>
      <Button className="mt-6" onClick={() => window.location.reload()}>
        Try again
      </Button>
    </main>
  ),
  component: Consent,
});
function Consent() {
  const { details, email } = Route.useLoaderData();
  const { authorization_id } = Route.useSearch();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const name = details.client?.name ?? details.client?.client_name ?? "Your assistant";
  const scopes = details.scopes ?? (details.scope ?? "").split(/\s+/).filter(Boolean);
  async function decide(approve: boolean) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      window.location.assign(await consentDecision(oauth(), authorization_id, approve));
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Could not complete the connection. Try again.",
      );
      setBusy(false);
    }
  }
  return (
    <main className="mx-auto max-w-xl px-6 py-12">
      <Logo className="mb-8 h-20" />
      <h1 className="text-2xl font-bold">Connect {name} to Roofer Masters</h1>
      <p className="mt-4 text-muted-foreground">This lets {name} use this app as you.</p>
      <p className="mt-4 text-sm">Signed in as {email}</p>
      <p className="mt-2 break-all text-sm text-muted-foreground">
        Return address:{" "}
        {details.redirect_uri ??
          details.client?.redirect_uri ??
          "Provided by the connecting assistant"}
      </p>
      <ul className="my-6 list-disc space-y-2 pl-5 text-sm">
        {scopes.map((scope) => (
          <li key={scope}>
            {scope === "openid" || scope === "profile"
              ? "Share your basic profile"
              : scope === "email"
                ? "Share your email address"
                : `Additional permission requested: ${scope}`}
          </li>
        ))}
        <li>Read permitted leads, customer contacts and roof report status.</li>
        <li>Read invoices only with Owner or Accounting access.</li>
      </ul>
      <p className="text-sm text-muted-foreground">
        Your CRM permissions still apply. No sending, payments, sharing or deletion is granted.
      </p>
      {error && (
        <p role="alert" className="mt-4 text-destructive">
          {error}
        </p>
      )}
      <div className="mt-8 flex flex-wrap gap-3">
        <Button disabled={busy} onClick={() => void decide(true)}>
          {busy ? "Please wait…" : "Approve connection"}
        </Button>
        <Button variant="outline" disabled={busy} onClick={() => void decide(false)}>
          Cancel connection
        </Button>
      </div>
      <Button
        variant="ghost"
        className="mt-4"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            const { error: signOutError } = await supabase.auth.signOut();
            if (signOutError) throw signOutError;
            window.location.reload();
          } catch {
            setError("Could not switch accounts. Try again.");
            setBusy(false);
          }
        }}
      >
        Switch account
      </Button>
    </main>
  );
}
