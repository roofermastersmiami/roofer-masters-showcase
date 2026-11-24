import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import * as pdfjsLib from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import SignatureCanvas from "react-signature-canvas";
import { CalendarDays, Check, FilePlus2, Lock, PenLine, Plus, Trash2, Type, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

type FieldKind = "signature" | "name" | "date" | "initials" | "text";
type SignField = {
  id: string;
  kind: FieldKind;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  value: string;
  imageData?: string;
};
type PdfPage = { width: number; height: number };

export interface PdfContractSignerProps {
  reportId: string;
  leadId: string | null;
  propertyAddress: string;
  sourcePdfPath?: string | null;
  sourceBucket?: string;
  isClientMode?: boolean;
  onSaved?: (path: string) => void;
}

const today = () => {
  const d = new Date();
  return [String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0"), d.getFullYear()].join("/");
};
const fieldLabel: Record<FieldKind, string> = {
  signature: "Signature", name: "Full name", date: "Date signed", initials: "Initials", text: "Custom text",
};
const makeField = (kind: FieldKind, page: number): SignField => ({
  id: crypto.randomUUID(), kind, page, x: 0.12, y: 0.72, width: kind === "signature" ? 0.3 : 0.25,
  height: kind === "signature" ? 0.09 : 0.045, fontSize: kind === "signature" ? 22 : 12,
  value: kind === "date" ? today() : kind === "name" ? "" : kind === "initials" ? "" : kind === "text" ? "" : "",
});

export function PdfContractSigner({
  reportId, leadId, propertyAddress, sourcePdfPath, sourceBucket = "roofing-proposals",
  isClientMode = false, onSaved,
}: PdfContractSignerProps) {
  const [sourceBytes, setSourceBytes] = useState<Uint8Array | null>(null);
  const [pages, setPages] = useState<PdfPage[]>([]);
  const [fields, setFields] = useState<SignField[]>([]);
  const [activePage, setActivePage] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [signatureOpen, setSignatureOpen] = useState(false);
  const [signatureMode, setSignatureMode] = useState<"draw" | "type">("draw");
  const [typedSignature, setTypedSignature] = useState("");
  const signatureRef = useRef<SignatureCanvas>(null);
  const pageRefs = useRef<Array<HTMLDivElement | null>>([]);
  const canvasRefs = useRef<Array<HTMLCanvasElement | null>>([]);
  const dragRef = useRef<{ id: string; pointerX: number; pointerY: number; startX: number; startY: number; rect: DOMRect } | null>(null);
  const selected = fields.find((field) => field.id === selectedId) ?? null;

  const loadPdf = useCallback(async (bytes: Uint8Array, name: string) => {
    setLoading(true);
    try {
      const document = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
      const nextPages: PdfPage[] = [];
      for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
        const page = await document.getPage(pageNumber);
        const viewport = page.getViewport({ scale: 1 });
        nextPages.push({ width: viewport.width, height: viewport.height });
      }
      setSourceBytes(bytes);
      setPages(nextPages);
      setFields([]);
      setActivePage(0);
      setSelectedId(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not read this PDF");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!sourcePdfPath) return;
    void (async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase.storage.from(sourceBucket).download(sourcePdfPath);
        if (error || !data) throw error ?? new Error("PDF file not found");
        if (!cancelled) await loadPdf(new Uint8Array(await data.arrayBuffer()), sourcePdfPath.split("/").pop() || "roof-report.pdf");
      } catch (error) {
        if (!cancelled) toast.error(error instanceof Error ? error.message : "Could not load source PDF");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [loadPdf, sourceBucket, sourcePdfPath]);

  useEffect(() => {
    if (!sourceBytes || !pages.length) return;
    let cancelled = false;
    const render = async () => {
      try {
        const doc = await pdfjsLib.getDocument({ data: sourceBytes.slice() }).promise;
        for (let index = 0; index < doc.numPages; index++) {
          if (cancelled) return;
          const page = await doc.getPage(index + 1);
          const host = pageRefs.current[index];
          const canvas = canvasRefs.current[index];
          if (!host || !canvas) continue;
          const pageSize = pages[index];
          if (!pageSize) continue;
          const scale = Math.min(1.6, Math.max(0.7, (host.clientWidth || 760) / pageSize.width));
          const viewport = page.getViewport({ scale: scale * (window.devicePixelRatio || 1) });
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          canvas.style.width = `${viewport.width / (window.devicePixelRatio || 1)}px`;
          canvas.style.height = `${viewport.height / (window.devicePixelRatio || 1)}px`;
          const context = canvas.getContext("2d");
          if (context) await page.render({ canvas: context, canvasContext: context, viewport, canvas: canvas as HTMLCanvasElement } as never).promise;
        }
      } catch (error) {
        if (!cancelled) toast.error(error instanceof Error ? error.message : "Could not render PDF pages");
      }
    };
    void render();
    return () => { cancelled = true; };
  }, [sourceBytes, pages]);

  const addField = (kind: FieldKind) => {
    if (!pages.length) { toast.error("Upload or load a PDF first"); return; }
    const field = makeField(kind, activePage);
    setFields((current) => [...current, field]);
    setSelectedId(field.id);
    if (kind === "signature") setSignatureOpen(true);
  };

  const updateField = (id: string, patch: Partial<SignField>) =>
    setFields((current) => current.map((field) => field.id === id ? { ...field, ...patch } : field));

  const beginDrag = (event: PointerEvent<HTMLDivElement>, field: SignField) => {
    if (isClientMode || (event.target as HTMLElement).closest("input,button")) return;
    const host = pageRefs.current[field.page];
    if (!host) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { id: field.id, pointerX: event.clientX, pointerY: event.clientY, startX: field.x, startY: field.y, rect: host.getBoundingClientRect() };
    setSelectedId(field.id);
  };
  const moveDrag = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || isClientMode) return;
    updateField(drag.id, {
      x: Math.max(0, Math.min(1 - (fields.find((f) => f.id === drag.id)?.width ?? 0.2), drag.startX + (event.clientX - drag.pointerX) / drag.rect.width)),
      y: Math.max(0, Math.min(1 - (fields.find((f) => f.id === drag.id)?.height ?? 0.05), drag.startY + (event.clientY - drag.pointerY) / drag.rect.height)),
    });
  };

  const saveSignature = () => {
    const field = fields.find((item) => item.id === selectedId && item.kind === "signature");
    if (!field) { toast.error("Select a signature field first"); return; }
    let data = "";
    if (signatureMode === "draw") {
      if (!signatureRef.current || signatureRef.current.isEmpty()) { toast.error("Draw your signature first"); return; }
      data = signatureRef.current.getTrimmedCanvas().toDataURL("image/png");
    } else {
      if (!typedSignature.trim()) { toast.error("Enter the signer name first"); return; }
      const canvas = document.createElement("canvas");
      canvas.width = 900; canvas.height = 220;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#111827"; ctx.font = "italic 92px cursive"; ctx.textBaseline = "middle";
      ctx.fillText(typedSignature.trim(), 12, 110);
      data = canvas.toDataURL("image/png");
    }
    updateField(field.id, { imageData: data, value: signatureMode === "type" ? typedSignature.trim() : "Signed" });
    setSignatureOpen(false);
    toast.success("Signature added to the document");
  };

  const exportPdf = async () => {
    if (!sourceBytes || !leadId) { toast.error("A source PDF and linked customer lead are required"); return; }
    if (!fields.length) { toast.error("Add at least one signing field"); return; }
    const incomplete = fields.find((field) => field.kind === "signature" && !field.imageData || field.kind !== "signature" && !field.value.trim());
    if (incomplete) { setSelectedId(incomplete.id); toast.error(`Complete the ${fieldLabel[incomplete.kind]} field before saving`); return; }
    setSaving(true);
    try {
      const pdf = await PDFDocument.load(sourceBytes);
      const font = await pdf.embedFont(StandardFonts.TimesRomanItalic);
      for (const field of fields) {
        const page = pdf.getPage(field.page);
        const size = page.getSize();
        const x = field.x * size.width;
        const width = field.width * size.width;
        const height = field.height * size.height;
        const y = size.height - field.y * size.height - height;
        if (field.kind === "signature" && field.imageData) {
          const png = await pdf.embedPng(field.imageData);
          const scale = Math.min(width / png.width, height / png.height);
          page.drawImage(png, { x, y: y + (height - png.height * scale) / 2, width: png.width * scale, height: png.height * scale });
        } else {
          page.drawText(field.value, { x: x + 3, y: y + Math.max(2, (height - field.fontSize) / 2), size: field.fontSize, font: field.kind === "signature" ? font : await pdf.embedFont(StandardFonts.Helvetica), color: rgb(0.05, 0.08, 0.13), maxWidth: Math.max(20, width - 6) });
        }
      }
      const bytes = await pdf.save();
      const safeAddress = propertyAddress.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "property";
      const path = `${leadId}/${reportId}/${Date.now()}-${safeAddress}-signed.pdf`;
      const blob = new Blob([bytes], { type: "application/pdf" });
      const { error } = await supabase.storage.from("signed-contracts").upload(path, blob, { contentType: "application/pdf", upsert: false });
      if (error) throw error;
      const downloadUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = downloadUrl; anchor.download = `${safeAddress}-signed.pdf`;
      anchor.click(); URL.revokeObjectURL(downloadUrl);
      onSaved?.(path);
      toast.success("Signed PDF flattened, downloaded, and saved to the customer record");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save signed PDF");
    } finally {
      setSaving(false);
    }
  };

  const uploadFile = async (file?: File) => {
    if (!file) return;
    if (file.type !== "application/pdf" || file.size > 30 * 1024 * 1024) { toast.error("Choose a PDF file smaller than 30 MB"); return; }
    await loadPdf(new Uint8Array(await file.arrayBuffer()), file.name);
  };

  const fieldTools: { kind: FieldKind; label: string; icon: typeof PenLine }[] = [
    { kind: "signature", label: "Signature", icon: PenLine }, { kind: "name", label: "Full name", icon: Type },
    { kind: "date", label: "Date signed", icon: CalendarDays }, { kind: "initials", label: "Initials", icon: Type },
    { kind: "text", label: "Custom text", icon: Plus },
  ];
  const activePageFields = useMemo(() => fields.filter((field) => field.page === activePage), [fields, activePage]);

  return (
    <section className="flex min-h-[70vh] flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><h3 className="font-semibold">PDF Fill & Sign</h3><p className="text-xs text-muted-foreground">{propertyAddress} · Free local PDF editing</p></div>
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted"><Upload className="size-4" /> Upload PDF<input className="sr-only" type="file" accept="application/pdf" onChange={(e) => { void uploadFile(e.target.files?.[0]); e.currentTarget.value = ""; }} /></label>
      </div>
      <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card p-2">
        {fieldTools.map(({ kind, label, icon: Icon }) => <Button key={kind} type="button" size="sm" variant="outline" disabled={!sourceBytes || isClientMode} onClick={() => addField(kind)}><Icon className="mr-1 size-4" />{label}</Button>)}
        {isClientMode && <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground"><Lock className="size-3" /> Field positions locked</span>}
        <Button className="ml-auto" size="sm" onClick={() => void exportPdf()} disabled={!sourceBytes || saving || loading || !leadId}><Check className="mr-1 size-4" />{saving ? "Saving…" : "Save & Download Signed PDF"}</Button>
      </div>
      {selected && !isClientMode && <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-muted/30 p-3">
        <div className="min-w-40 flex-1"><label className="mb-1 block text-xs text-muted-foreground">{fieldLabel[selected.kind]}</label><Input value={selected.value} placeholder={selected.kind === "signature" ? "Add signature using the signature pad" : "Enter field value"} disabled={selected.kind === "signature"} onChange={(e) => updateField(selected.id, { value: e.target.value })} /></div>
        <div className="w-24"><label className="mb-1 block text-xs text-muted-foreground">Font size</label><Input type="number" min={6} max={48} value={selected.fontSize} onChange={(e) => updateField(selected.id, { fontSize: Math.max(6, Math.min(48, Number(e.target.value) || 12)) })} /></div>
        <div className="w-24"><label className="mb-1 block text-xs text-muted-foreground">Width %</label><Input type="number" min={5} max={90} value={Math.round(selected.width * 100)} onChange={(e) => updateField(selected.id, { width: Math.max(0.05, Math.min(0.9, Number(e.target.value) / 100 || 0.2)) })} /></div>
        {selected.kind === "signature" && <Button type="button" variant="outline" onClick={() => setSignatureOpen(true)}><PenLine className="mr-1 size-4" />{selected.imageData ? "Edit signature" : "Add signature"}</Button>}
        <Button type="button" variant="destructive" size="icon" aria-label="Delete selected field" onClick={() => { setFields((all) => all.filter((f) => f.id !== selected.id)); setSelectedId(null); }}><Trash2 className="size-4" /></Button>
      </div>}
      {!leadId && <p role="alert" className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">This roof report is not linked to a customer lead. Link the customer before saving a signed contract.</p>}
      {loading && <p className="p-4 text-sm text-muted-foreground">Loading PDF pages…</p>}
      {!sourceBytes && !loading && <div className="rounded-lg border border-dashed p-12 text-center text-sm text-muted-foreground"><FilePlus2 className="mx-auto mb-2 size-8" />Upload a PDF or open a report that already has a measurement PDF.</div>}
      {sourceBytes && <div className="min-h-0 flex-1 overflow-auto rounded-lg bg-muted/60 p-3">
        <div className="mx-auto flex max-w-5xl flex-col items-center gap-5">
          {pages.map((page, index) => <div key={index} className="w-full">
            <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground"><span>Page {index + 1} of {pages.length}</span><Button size="sm" variant={activePage === index ? "secondary" : "ghost"} onClick={() => setActivePage(index)}>Edit this page</Button></div>
            <div ref={(el) => { pageRefs.current[index] = el; }} className="relative mx-auto w-full overflow-hidden bg-white shadow-md" style={{ aspectRatio: `${page.width} / ${page.height}`, maxWidth: "850px" }}>
              <canvas ref={(el) => { canvasRefs.current[index] = el; }} className="block h-auto w-full" />
              <div className="absolute inset-0" onPointerMove={moveDrag} onPointerUp={() => { dragRef.current = null; }} onPointerCancel={() => { dragRef.current = null; }}>
                {fields.filter((field) => field.page === index).map((field) => <div key={field.id} role="button" tabIndex={0} aria-label={`${fieldLabel[field.kind]} field`} onClick={() => { setSelectedId(field.id); if (field.kind === "signature" && !field.imageData) setSignatureOpen(true); }} onPointerDown={(event) => beginDrag(event, field)} className={`absolute flex cursor-move items-center overflow-hidden border-2 px-1 ${selectedId === field.id ? "border-blue-600 bg-blue-100/60" : "border-blue-400/70 bg-blue-50/40"}`} style={{ left: `${field.x * 100}%`, top: `${field.y * 100}%`, width: `${field.width * 100}%`, height: `${field.height * 100}%`, fontSize: `${field.fontSize}px` }}>
                  {field.imageData ? <img src={field.imageData} alt="Signature preview" className="h-full max-w-full object-contain" /> : <span className="truncate text-blue-900">{field.value || fieldLabel[field.kind]}</span>}
                </div>)}
              </div>
            </div>
          </div>)}
        </div>
      </div>}
      <Dialog open={signatureOpen} onOpenChange={setSignatureOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader><DialogTitle>Add signature</DialogTitle><DialogDescription>Draw your signature or type your name in a cursive style. It will be embedded into the exported PDF.</DialogDescription></DialogHeader>
          <div className="flex gap-2"><Button variant={signatureMode === "draw" ? "default" : "outline"} onClick={() => setSignatureMode("draw")}>Draw</Button><Button variant={signatureMode === "type" ? "default" : "outline"} onClick={() => setSignatureMode("type")}>Type to sign</Button></div>
          {signatureMode === "draw" ? <div className="rounded-md border bg-white"><SignatureCanvas ref={signatureRef} penColor="#111827" canvasProps={{ width: 700, height: 220, className: "h-44 w-full touch-none" }} /></div> : <Input value={typedSignature} onChange={(e) => setTypedSignature(e.target.value)} placeholder="Type full legal name" className="h-16 text-2xl italic" style={{ fontFamily: "cursive" }} />}
          <div className="flex justify-between"><Button variant="outline" onClick={() => { signatureRef.current?.clear(); setTypedSignature(""); }}>Clear</Button><Button onClick={saveSignature}><Check className="mr-1 size-4" />Apply signature</Button></div>
        </DialogContent>
      </Dialog>
    </section>
  );
}

export default PdfContractSigner;
