import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  FileText,
  Plus,
  Search,
  Pencil,
  Send,
  Download,
  Trash2,
  Copy,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { ROOF_CATEGORIES } from "@/lib/proposal-schema";
import { proposalsQuery, readProposalPdf, downloadPdf, type Proposal } from "./proposal-data";
import { ProposalComposer, type ComposerConfig } from "./ProposalComposer";
import { ProposalShareDialog } from "./ProposalShareDialog";
import { PdfEditor } from "./PdfEditor";
import type { Lead } from "./data";

export function Proposals({
  leads,
  requestedLeadId,
  onRequestHandled,
}: {
  leads: Lead[];
  requestedLeadId: string | null;
  onRequestHandled: () => void;
}) {
  const { data: proposals = [], isLoading, error } = useQuery(proposalsQuery);
  const qc = useQueryClient();
  const [view, setView] = useState("proposals");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [customerFilter, setCustomerFilter] = useState("all");
  const [composer, setComposer] = useState<ComposerConfig | null>(null);
  const [editing, setEditing] = useState<Proposal | null>(null);
  const [sharing, setSharing] = useState<Proposal | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["proposals"] });
  useEffect(() => {
    if (requestedLeadId) {
      setView("proposals");
      setCustomerFilter(requestedLeadId);
      onRequestHandled();
    }
  }, [requestedLeadId, onRequestHandled]);
  const filtered = proposals.filter(
    (p) =>
      p.is_template === (view === "templates") &&
      (category === "all" || p.category === category) &&
      (view === "templates" || customerFilter === "all" || p.lead_id === customerFilter) &&
      `${p.title} ${leads.find((l) => l.id === p.lead_id)?.name ?? ""}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  async function download(proposal: Proposal) {
    if (!proposal.file_path) return;
    setBusyId(proposal.id);
    try {
      downloadPdf(await readProposalPdf(proposal.file_path), proposal.title);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Download failed");
    } finally {
      setBusyId(null);
    }
  }
  async function remove(proposal: Proposal) {
    if (!confirm(`Delete ${proposal.title} and revoke its sharing links?`)) return;
    setBusyId(proposal.id);
    try {
      const { error: deleteError } = await supabase
        .from("proposals")
        .delete()
        .eq("id", proposal.id)
        .eq("company_id", proposal.company_id);
      if (deleteError) throw deleteError;
      if (proposal.file_path)
        await supabase.storage.from("roofing-proposals").remove([proposal.file_path]);
      await refresh();
      toast.success("Deleted");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not delete");
    } finally {
      setBusyId(null);
    }
  }
  return (
    <section>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <Tabs value={view} onValueChange={setView}>
          <TabsList>
            <TabsTrigger value="proposals">Proposals</TabsTrigger>
            <TabsTrigger value="templates">Roofing templates</TabsTrigger>
          </TabsList>
        </Tabs>
        <Button
          onClick={() =>
            setComposer({
              template: view === "templates",
              ...(customerFilter !== "all" ? { leadId: customerFilter } : {}),
            })
          }
        >
          <Plus /> {view === "templates" ? "New template" : "New proposal"}
        </Button>
      </div>
      <div className="mt-5 flex flex-wrap gap-3">
        <div className="relative min-w-40 flex-1">
          <Search className="absolute top-3 left-3 size-4 text-muted-foreground" />
          <Input
            aria-label="Search proposals"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search proposals…"
            className="pl-9"
          />
        </div>
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger aria-label="Filter roof category" className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All roof categories</SelectItem>
            {ROOF_CATEGORIES.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {view === "proposals" && (
          <Select value={customerFilter} onValueChange={setCustomerFilter}>
            <SelectTrigger aria-label="Filter customer" className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All customers</SelectItem>
              {leads.map((l) => (
                <SelectItem key={l.id} value={l.id}>
                  {l.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
      {isLoading && <p className="py-12 text-center text-muted-foreground">Loading proposals…</p>}
      {error && (
        <p className="py-8 text-destructive">Could not load proposals. Refresh to try again.</p>
      )}
      {!isLoading && !error && filtered.length === 0 && (
        <div className="flex flex-col items-center gap-3 border-b border-border py-16 text-center">
          <FileText className="size-10 text-muted-foreground" />
          <h2 className="text-xl font-bold">
            {view === "templates" ? "No roofing templates yet" : "No proposals yet"}
          </h2>
          <Button
            variant="outline"
            onClick={() =>
              setComposer({
                template: view === "templates",
                ...(customerFilter !== "all" ? { leadId: customerFilter } : {}),
              })
            }
          >
            <Plus /> {view === "templates" ? "Create template" : "Create proposal"}
          </Button>
        </div>
      )}
      <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {filtered.map((proposal) => {
          const customer = leads.find((l) => l.id === proposal.lead_id);
          return (
            <article
              key={proposal.id}
              className="flex min-w-0 flex-col rounded-lg border border-border bg-card p-5 shadow-card"
            >
              <div className="flex items-start gap-3">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-accent text-primary">
                  <FileText />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold uppercase text-muted-foreground">
                    {proposal.category}
                  </p>
                  <h3 className="mt-1 break-words text-lg font-bold">{proposal.title}</h3>
                </div>
              </div>
              <p className="mt-4 text-sm text-muted-foreground">
                {proposal.is_template
                  ? "Reusable template"
                  : (customer?.name ?? "No customer selected")}
              </p>
              <div className="mt-2 flex flex-wrap justify-between gap-2 text-sm">
                <span className="font-semibold">
                  {proposal.amount != null
                    ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
                        proposal.amount,
                      )
                    : "No total set"}
                </span>
                <span className="text-muted-foreground">
                  {new Date(proposal.updated_at).toLocaleDateString()}
                </span>
              </div>
              <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-border pt-4">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!proposal.file_path}
                  onClick={() => setEditing(proposal)}
                >
                  <Pencil /> Edit PDF
                </Button>
                {proposal.is_template ? (
                  <Button
                    size="sm"
                    onClick={() => {
                      setView("proposals");
                      setComposer({
                        template: false,
                        fromTemplate: proposal,
                        ...(customerFilter !== "all" ? { leadId: customerFilter } : {}),
                      });
                    }}
                  >
                    <Copy /> Use template
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    disabled={!proposal.file_path}
                    onClick={() => setSharing(proposal)}
                  >
                    <Send /> Share
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  title="Edit proposal details"
                  aria-label={`Edit details for ${proposal.title}`}
                  onClick={() =>
                    setComposer({ template: proposal.is_template, existing: proposal })
                  }
                >
                  <FileText className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  title="Download PDF"
                  aria-label={`Download ${proposal.title}`}
                  disabled={!proposal.file_path || busyId === proposal.id}
                  onClick={() => {
                    void download(proposal);
                  }}
                >
                  {busyId === proposal.id ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Download className="size-4" />
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  title="Delete proposal"
                  aria-label={`Delete ${proposal.title}`}
                  disabled={busyId === proposal.id}
                  onClick={() => {
                    void remove(proposal);
                  }}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </article>
          );
        })}
      </div>
      {composer && (
        <ProposalComposer
          config={composer}
          leads={leads}
          onClose={() => setComposer(null)}
          onSaved={() => {
            setComposer(null);
            void refresh();
          }}
        />
      )}
      {editing && (
        <PdfEditor
          proposal={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            void refresh();
          }}
        />
      )}
      {sharing && (
        <ProposalShareDialog
          proposal={sharing}
          customer={leads.find((l) => l.id === sharing.lead_id)}
          onClose={() => setSharing(null)}
        />
      )}
    </section>
  );
}
