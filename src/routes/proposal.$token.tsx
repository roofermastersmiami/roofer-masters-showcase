import { createFileRoute } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { FileText, Download, Phone, PenLine, Loader2, BadgeCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Logo } from "@/components/site/Logo";
import { SignaturePad } from "@/components/dashboard/SignaturePad";
import { getSharedProposal, signSharedProposal } from "@/lib/proposals.functions";

const sharedQuery = (token: string) => queryOptions({ queryKey: ["shared-proposal", token], queryFn: () => getSharedProposal({ data: { token } }), staleTime: 0 });
export const Route = createFileRoute("/proposal/$token")({
  head: () => ({ meta: [
    { title: "Your Roofing Proposal | Roofer Masters" },
    { name: "description", content: "View your private roofing proposal from Roofer Masters." },
    { property: "og:title", content: "Your Roofing Proposal | Roofer Masters" },
    { property: "og:description", content: "View your private roofing proposal from Roofer Masters." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
    { name: "robots", content: "noindex, nofollow" },
    { name: "referrer", content: "no-referrer" },
  ] }),
  loader: ({ params, context }) => context.queryClient.ensureQueryData(sharedQuery(params.token)),
  component: SharedProposal,
});

function toDataUrl(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:image/png;base64,${btoa(binary)}`;
}

function SignOff({ token, signedName, signedAt }: { token: string; signedName: string | null; signedAt: string | null }) {
  const sign = useServerFn(signSharedProposal);
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [signature, setSignature] = useState<Uint8Array | null>(null);
  const [busy, setBusy] = useState(false);
  if (signedName && signedAt) {
    return <div className="mt-6 rounded-lg border border-border bg-card p-5">
      <p className="flex items-center gap-2 font-semibold"><BadgeCheck className="text-primary" /> Signed by {signedName}</p>
      <p className="mt-1 text-sm text-muted-foreground">on {new Date(signedAt).toLocaleString()}. Roofer Masters will be in touch about next steps.</p>
    </div>;
  }
  async function submit() {
    if (!name.trim()) { toast.error("Enter your full name"); return; }
    if (!signature) { toast.error("Draw your signature and tap Use signature"); return; }
    setBusy(true);
    try {
      await sign({ data: { token, name: name.trim(), signature: toDataUrl(signature) } });
      await qc.invalidateQueries({ queryKey: ["shared-proposal", token] });
      toast.success("Proposal signed — thank you!");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Could not record your signature"); }
    finally { setBusy(false); }
  }
  return <div className="mt-6 rounded-lg border border-border bg-card p-5">
    <h2 className="flex items-center gap-2 text-lg font-bold"><PenLine /> Accept and sign</h2>
    <p className="mt-1 text-sm text-muted-foreground">To accept this proposal, enter your full name and draw your signature below. The date is recorded automatically.</p>
    <div className="mt-4 grid gap-4">
      <label className="grid gap-1 text-sm font-semibold">Full name
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your full name" maxLength={120} autoComplete="name" />
      </label>
      <SignaturePad onUse={setSignature} />
      {signature && <p className="text-sm font-medium text-primary">Signature captured — ready to sign.</p>}
      <Button onClick={() => { void submit(); }} disabled={busy}>{busy ? <Loader2 className="animate-spin" /> : <PenLine />} Sign proposal</Button>
    </div>
  </div>;
}

function SharedProposal() {
  const { token } = Route.useParams();
  const { data } = useSuspenseQuery(sharedQuery(token));
  return <div className="min-h-screen bg-muted">
    <header className="border-b border-border bg-card"><div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-4"><Logo className="h-14" /><Button asChild variant="outline"><a href="tel:3059423093"><Phone /> 305-942-3093</a></Button></div></header>
    <main className="mx-auto max-w-6xl p-4 sm:p-6">
      {data ? <><div className="mb-5 flex flex-wrap items-center justify-between gap-4"><h1 className="break-words text-2xl font-bold">{data.title}</h1><Button asChild><a href={data.url} target="_blank" rel="noopener noreferrer"><Download /> Open / download PDF</a></Button></div><iframe src={data.url} title={data.title} className="h-[75dvh] w-full border border-border bg-card" /><SignOff token={token} signedName={data.signedName} signedAt={data.signedAt} /></>
        : <div className="py-20 text-center"><FileText className="mx-auto mb-4 size-10 text-muted-foreground" /><h1 className="text-2xl font-bold">Proposal link unavailable</h1><p className="mt-3 text-muted-foreground">This link has expired or been revoked. Call Roofer Masters for a new copy.</p></div>}
    </main>
  </div>;
}
