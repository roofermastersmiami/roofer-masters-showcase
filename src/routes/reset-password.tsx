import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Logo } from "@/components/site/Logo";

export const Route = createFileRoute("/reset-password")({
  head: () => ({
    meta: [
      { title: "Set a New Password | Roofer Masters" },
      { name: "description", content: "Choose a new password for your Roofer Masters owner account." },
      { property: "og:title", content: "Set a New Password | Roofer Masters" },
      { property: "og:description", content: "Choose a new password for your Roofer Masters owner account." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ResetPassword,
});

function ResetPassword() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Password updated");
    navigate({ to: "/dashboard" });
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-steel p-6">
      <form onSubmit={onSubmit} className="w-full max-w-md rounded-3xl border border-border bg-card p-7 shadow-elegant">
        <div className="mb-6 flex justify-center">
          <Logo className="h-20" />
        </div>
        <h1 className="text-2xl font-black text-foreground">Set a new password</h1>
        <div className="mt-5 grid gap-1.5">
          <Label htmlFor="pw">New password</Label>
          <Input id="pw" type="password" minLength={8} required autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className="h-11" />
        </div>
        <Button type="submit" variant="hero" size="lg" className="mt-5 h-12 w-full rounded-xl" disabled={busy}>
          Save password
        </Button>
      </form>
    </div>
  );
}
