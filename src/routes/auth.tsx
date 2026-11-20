import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { LovableMark } from "@lovable.dev/cloud-auth-js/react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Logo } from "@/components/site/Logo";
import { BUSINESS } from "@/lib/site";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Owner Login | Roofer Masters" },
      { name: "description", content: "Secure login for the Roofer Masters owner dashboard." },
      { property: "og:title", content: "Owner Login | Roofer Masters" },
      { property: "og:description", content: "Secure login for the Roofer Masters owner dashboard." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AuthPage,
});

type Mode = "signin" | "signup" | "forgot";

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) navigate({ to: "/dashboard", replace: true });
    });
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" && session) navigate({ to: "/dashboard", replace: true });
    });
    return () => data.subscription.unsubscribe();
  }, [navigate]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setNotice("");
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin + "/dashboard" },
        });
        if (error) throw error;
        setNotice("Check your inbox to confirm your email, then sign in.");
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/reset-password`,
        });
        if (error) throw error;
        setNotice("If that email has an account, a reset link is on its way.");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  async function social(provider: "google" | "lovable") {
    const result = await lovable.auth.signInWithOAuth(provider, { redirect_uri: window.location.origin + "/auth" });
    if (result.error) toast.error(result.error.message ?? "Sign-in failed");
  }

  return (
    <div className="grid min-h-screen bg-gradient-steel lg:grid-cols-2">
      <div className="relative hidden overflow-hidden bg-gradient-navy p-12 text-navy-foreground lg:flex lg:flex-col lg:justify-between">
        <div className="grid-lines pointer-events-none absolute inset-0" />
        <div className="relative inline-block self-start rounded-2xl bg-card p-5 shadow-elegant">
          <Logo className="h-28" />
        </div>
        <div className="relative">
          <h1 className="text-5xl font-black leading-tight">Owner dashboard</h1>
          <p className="mt-4 max-w-md text-navy-foreground/75">
            Manage every call-back request, quote, contact form and chat in one place, and move each
            lead from New to Won.
          </p>
        </div>
        <p className="relative text-sm text-navy-foreground/60">{BUSINESS.phoneDisplay} · {BUSINESS.email}</p>
      </div>

      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-md">
          <div className="mb-8 flex justify-center lg:hidden">
            <Logo className="h-24" />
          </div>
          <div className="rounded-3xl border border-border bg-card p-7 shadow-elegant">
            <h2 className="text-2xl font-black text-foreground">
              {mode === "signin" ? "Sign in" : mode === "signup" ? "Create owner account" : "Reset password"}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {mode === "signup"
                ? `Use ${BUSINESS.email} to get owner access.`
                : "Roofer Masters team access only."}
            </p>

            {mode !== "forgot" && (
              <div className="mt-6 grid gap-3">
                <button
                  type="button"
                  onClick={() => social("google")}
                  className="inline-flex h-11 items-center justify-center gap-[10px] rounded-xl border border-[#747775] bg-[#FFFFFF] px-3 font-medium text-[#1F1F1F] text-sm"
                  style={{ fontFamily: "'Google Sans', Manrope, sans-serif" }}
                >
                  <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24"><path fill="#4285F4" d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82z"/><path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09C3.26 21.3 7.31 24 12 24z"/><path fill="#FBBC05" d="M5.27 14.29c-.25-.72-.38-1.49-.38-2.29s.14-1.57.38-2.29V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.98-3.09z"/><path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.98 3.09c.95-2.85 3.6-4.96 6.73-4.96z"/></svg>
                  Continue with Google
                </button>
                <Button type="button" variant="outline" className="h-11 rounded-xl" onClick={() => social("lovable")}>
                  <LovableMark className="size-[18px]" />
                  Continue with Lovable
                </Button>
                <div className="relative my-2 text-center text-xs text-muted-foreground">
                  <span className="relative z-10 bg-card px-2">or with email</span>
                  <span className="absolute inset-x-0 top-1/2 h-px bg-border" />
                </div>
              </div>
            )}

            <form onSubmit={onSubmit} className="grid gap-4">
              <div className="grid gap-1.5">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="h-11" />
              </div>
              {mode !== "forgot" && (
                <div className="grid gap-1.5">
                  <Label htmlFor="password">Password</Label>
                  <Input id="password" type="password" autoComplete={mode === "signup" ? "new-password" : "current-password"} required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} className="h-11" />
                </div>
              )}
              {notice && <p className="rounded-lg bg-accent px-3 py-2 text-sm text-accent-foreground">{notice}</p>}
              <Button type="submit" variant="hero" size="lg" className="h-12 rounded-xl" disabled={busy}>
                {busy && <Loader2 className="animate-spin" />}
                {mode === "signin" ? "Sign in" : mode === "signup" ? "Create account" : "Send reset link"}
              </Button>
            </form>

            <div className="mt-5 flex flex-wrap justify-between gap-2 text-sm">
              {mode === "signin" ? (
                <>
                  <button type="button" className="font-semibold text-primary" onClick={() => setMode("signup")}>Create owner account</button>
                  <button type="button" className="text-muted-foreground" onClick={() => setMode("forgot")}>Forgot password?</button>
                </>
              ) : (
                <button type="button" className="font-semibold text-primary" onClick={() => setMode("signin")}>← Back to sign in</button>
              )}
            </div>
          </div>
          <a href="/" className="mt-6 block text-center text-sm text-muted-foreground hover:text-foreground">← Back to website</a>
        </div>
      </div>
    </div>
  );
}
