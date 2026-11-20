import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Copy, Link2, Mail, ExternalLink, Ban, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { createProposalShare, revokeProposalShare } from "@/lib/proposals.functions";
import { shareIsActive } from "@/lib/proposal-schema";
import { proposalSharesQuery, type Proposal } from "./proposal-data";
import type { Lead } from "./data";

export function ProposalShareDialog({ proposal, customer, onClose }: { proposal: Proposal; customer: Lead | undefined; onClose: () => void }) {
  const { data: shares = [], isLoading, error } = useQuery(proposalSharesQuery(proposal.id));
  const qc = useQueryClient();
  const create = useServerFn(createProposalShare);
  const revoke = useServerFn(revokeProposalShare);
  const [busy, setBusy] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ["proposal-shares", proposal.id] });
  async function createLink() { setBusy(true); try { await create({ data: { proposalId: proposal.id } }); await refresh(); toast.success("Sharing link created"); } catch (e) { toast.error(e instanceof Error ? e.message : "Could not create link"); } finally { setBusy(false); } }
  async function revokeLink(id: string) { setBusy(true); try { await revoke({ data: { id } }); await refresh(); toast.success("Link revoked"); } catch (e) { toast.error(e instanceof Error ? e.message : "Could not revoke link"); } finally { setBusy(false); } }
  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
    <DialogHeader><DialogTitle>Share proposal</DialogTitle><DialogDescription>{proposal.title}{customer ? ` · ${customer.name}` : ""}</DialogDescription></DialogHeader>
    <Button onClick={() => { void createLink(); }} disabled={busy}>{busy ? <Loader2 className="animate-spin" /> : <Link2 />} Create sharing link</Button>
    <p className="text-xs text-muted-foreground">Anyone with a link can view its PDF until it expires or you revoke it. Links expire after 30 days.</p>
    {isLoading && <p className="text-sm text-muted-foreground">Loading links…</p>}
    {error && <p className="text-sm text-destructive">Could not load sharing links.</p>}
    <div className="grid gap-4">{shares.map((share) => {
      const url = `${window.location.origin}/proposal/${share.token}`;
      const active = shareIsActive(share);
      const body = `Hello${customer ? ` ${customer.name}` : ""},\n\nHere is your roofing proposal from Roofer Masters:\n${url}\n\nPlease call 305-942-3093 with any questions.`;
      return <div key={share.id} className="rounded-lg border border-border p-4">
        <p className="text-xs font-semibold text-muted-foreground">{share.revoked_at ? "Revoked" : active ? `Expires ${new Date(share.expires_at).toLocaleDateString()}` : "Expired"}</p>
        {active && <><p className="mt-2 break-all text-sm text-foreground">{url}</p><div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={async () => { try { await navigator.clipboard.writeText(url); toast.success("Link copied"); } catch { toast.error("Could not copy link; select it to copy"); } }}><Copy /> Copy link</Button>
          <Button size="sm" variant="outline" asChild><a href={url} target="_blank" rel="noopener noreferrer"><ExternalLink /> View</a></Button>
          <Button size="sm" variant="outline" asChild><a href={`mailto:${customer?.email ?? ""}?subject=${encodeURIComponent(proposal.title + " | Roofer Masters")}&body=${encodeURIComponent(body)}`}><Mail /> Email draft</a></Button>
          <Button size="sm" variant="outline" asChild><a target="_blank" rel="noopener noreferrer" href={`https://wa.me/${customer?.phone?.replace(/\D/g, "").replace(/^(\d{10})$/, "1$1") ?? ""}?text=${encodeURIComponent(body)}`}>WhatsApp</a></Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => { if (confirm("Revoke this proposal link?")) void revokeLink(share.id); }}><Ban /> Revoke</Button>
        </div></>}
      </div>;
    })}</div>
  </DialogContent></Dialog>;
}