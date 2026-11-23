import { useState } from "react";
import { FileUp, Loader2, Save, FileText } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ROOF_CATEGORIES, proposalSchema, starterScope, validPdfHeader } from "@/lib/proposal-schema";
import { generateProposalPdf } from "@/lib/proposal-pdf";
import { readProposalPdf, uploadProposalPdf, type Proposal } from "./proposal-data";
import type { Lead } from "./data";

export type ComposerConfig = { template: boolean; existing?: Proposal; fromTemplate?: Proposal; leadId?: string };
export function ProposalComposer({ config, leads, onClose, onSaved }: { config: ComposerConfig; leads: Lead[]; onClose: () => void; onSaved: (proposal: Proposal) => void }) {
  const source = config.existing ?? config.fromTemplate;
  const [title, setTitle] = useState(config.existing?.title ?? (config.fromTemplate ? `${config.fromTemplate.category} proposal` : config.template ? "Metal Roof template" : "Metal Roof proposal"));
  const [category, setCategory] = useState<string>(source?.category ?? "Metal Roof");
  const [leadId, setLeadId] = useState(config.existing?.lead_id ?? config.leadId ?? "none");
  const [scope, setScope] = useState(source?.scope ?? starterScope("Metal Roof"));
  const [terms, setTerms] = useState(source?.terms ?? "");
  const [amount, setAmount] = useState(source?.amount != null ? String(source.amount) : "");
  const [file, setFile] = useState<File | null>(null);
  const [pdfSource, setPdfSource] = useState<"details" | "existing">(source?.file_path ? "existing" : "details");
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true);
    let newPath: string | null = null;
    try {
      const details = proposalSchema.parse({ title, category, is_template: config.template, lead_id: config.template || leadId === "none" ? null : leadId, scope, terms, amount: amount === "" ? null : Number(amount) });
      const id = config.existing?.id ?? crypto.randomUUID();
      let path = config.existing?.file_path ?? null;
      if (file) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (!validPdfHeader(bytes)) throw new Error("Choose a valid PDF file");
        const { PDFDocument } = await import("pdf-lib"); await PDFDocument.load(bytes);
        newPath = await uploadProposalPdf(id, bytes); path = newPath;
      } else if (pdfSource === "details") {
        newPath = await uploadProposalPdf(id, await generateProposalPdf(details, leads.find((l) => l.id === details.lead_id))); path = newPath;
      } else if (config.fromTemplate?.file_path) {
        newPath = await uploadProposalPdf(id, await readProposalPdf(config.fromTemplate.file_path)); path = newPath;
      }
      const payload = { ...details, file_path: path };
      const result = config.existing
        ? await supabase.from("proposals").update(payload).eq("id", id).select("*").single()
        : await supabase.from("proposals").insert({ ...payload, id }).select("*").single();
      if (result.error || !result.data) throw result.error ?? new Error("Could not save proposal");
      if (newPath && config.existing?.file_path) await supabase.storage.from("roofing-proposals").remove([config.existing.file_path]);
      toast.success(config.template ? "Template saved" : "Proposal saved"); onSaved(result.data);
    } catch (e) {
      if (newPath) await supabase.storage.from("roofing-proposals").remove([newPath]);
      toast.error(e instanceof Error ? e.message : "Could not save");
    } finally { setBusy(false); }
  }
  const close = () => { if (busy) return; if (!dirty || confirm("Discard unsaved proposal details?")) onClose(); };
  return <Dialog open onOpenChange={(open) => { if (!open) close(); }}><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
    <DialogHeader><DialogTitle>{config.existing ? "Edit" : "Create"} {config.template ? "roofing template" : "proposal"}</DialogTitle><DialogDescription className="sr-only">Proposal details and PDF source</DialogDescription></DialogHeader>
    <form onSubmit={save} onChange={() => { setDirty(true); if (!file) setPdfSource("details"); }} className="grid gap-5">
      <div className="grid gap-2"><Label htmlFor="proposal-title">{config.template ? "Template name" : "Proposal title"}</Label><Input id="proposal-title" required maxLength={160} value={title} onChange={(e) => setTitle(e.target.value)} /></div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2"><Label htmlFor="proposal-category">Roof category</Label><Select value={category} onValueChange={(value) => { setCategory(value); setDirty(true); }}><SelectTrigger id="proposal-category"><SelectValue /></SelectTrigger><SelectContent>{ROOF_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent></Select></div>
        {!config.template && <div className="grid gap-2"><Label htmlFor="proposal-customer">Customer</Label><Select value={leadId} onValueChange={(value) => { setLeadId(value); setDirty(true); }}><SelectTrigger id="proposal-customer"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">No customer selected</SelectItem>{leads.map((lead) => <SelectItem key={lead.id} value={lead.id}>{lead.name}</SelectItem>)}</SelectContent></Select></div>}
      </div>
      <div className="grid gap-2"><Label htmlFor="proposal-scope">Scope of work</Label><Textarea id="proposal-scope" rows={7} value={scope} onChange={(e) => setScope(e.target.value)} /></div>
      <div className="grid gap-4 sm:grid-cols-[1fr_180px]"><div className="grid gap-2"><Label htmlFor="proposal-terms">Terms & exclusions</Label><Textarea id="proposal-terms" rows={4} value={terms} onChange={(e) => setTerms(e.target.value)} /></div><div className="grid content-start gap-2"><Label htmlFor="proposal-amount">Total ($)</Label><Input id="proposal-amount" type="number" min={0} max={9999999999} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} /></div></div>
      <div className="border-t border-border pt-4">
        <Label className="mb-3 block">PDF source</Label>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant={pdfSource === "details" && !file ? "secondary" : "outline"} onClick={() => { setPdfSource("details"); setFile(null); setDirty(true); }}><FileText /> Generate from details</Button>
          {source?.file_path && <Button type="button" variant={pdfSource === "existing" && !file ? "secondary" : "outline"} onClick={() => { setPdfSource("existing"); setFile(null); setDirty(true); }}><FileText /> {config.fromTemplate ? "Use template PDF" : "Keep current PDF"}</Button>}
          <Button type="button" variant="outline" asChild><label className="cursor-pointer"><FileUp /> Upload PDF<input type="file" accept="application/pdf,.pdf" aria-label="Upload proposal PDF" className="sr-only" onChange={(e) => { const selected = e.target.files?.[0]; if (selected) { if (selected.size > 20 * 1024 * 1024) { toast.error("PDF must be under 20 MB"); return; } setFile(selected); setDirty(true); } }} /></label></Button>
        </div>
        <p className="mt-2 break-all text-xs text-muted-foreground">{file ? file.name : pdfSource === "existing" ? config.fromTemplate ? "Template PDF" : "Current PDF" : "New PDF · customer, scope, total and terms"}</p>
      </div>
      <div className="flex justify-end gap-2 border-t border-border pt-4"><Button type="button" variant="outline" disabled={busy} onClick={close}>Cancel</Button><Button type="submit" disabled={busy}>{busy ? <Loader2 className="animate-spin" /> : <Save />} {config.template ? "Save template" : "Save proposal"}</Button></div>
    </form>
  </DialogContent></Dialog>;
}