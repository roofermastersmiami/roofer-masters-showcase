import { useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Type,
  Highlighter,
  PenLine,
  MousePointer2,
  Undo2,
  RotateCw,
  Trash2,
  ArrowUp,
  ArrowDown,
  Files,
  Download,
  Save,
  ZoomIn,
  ZoomOut,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  applyPdfEdits,
  changePdfPages,
  getPdfFields,
  type PdfField,
  type PdfMark,
} from "@/lib/proposal-pdf";
import { readProposalPdf, saveProposalPdf, downloadPdf, type Proposal } from "./proposal-data";
import { SignaturePad } from "./SignaturePad";

type Tool = "select" | "text" | "highlight" | "signature";
export function PdfEditor({
  proposal,
  onClose,
  onSaved,
}: {
  proposal: Proposal;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [fields, setFields] = useState<PdfField[]>([]);
  const [marks, setMarks] = useState<PdfMark[]>([]);
  const [history, setHistory] = useState<Uint8Array[]>([]);
  const [pageIndex, setPageIndex] = useState(0);
  const [pages, setPages] = useState(0);
  const [rotation, setRotation] = useState(0);
  const [pageWidth, setPageWidth] = useState(612);
  const [zoom, setZoom] = useState(1);
  const [tool, setTool] = useState<Tool>("select");
  const [text, setText] = useState("");
  const [size, setSize] = useState(12);
  const [signature, setSignature] = useState<Uint8Array | null>(null);
  const [busy, setBusy] = useState(false);
  const [rendering, setRendering] = useState(true);
  const [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);
  const [filePath, setFilePath] = useState(proposal.file_path);
  const canvas = useRef<HTMLCanvasElement>(null);
  const mergeInput = useRef<HTMLInputElement>(null);
  const viewport = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!proposal.file_path) return;
    let active = true;
    readProposalPdf(proposal.file_path)
      .then(async (data) => {
        const formFields = await getPdfFields(data);
        if (active) {
          setBytes(data);
          setFields(formFields);
        }
      })
      .catch((e: unknown) => {
        if (active) {
          setError(e instanceof Error ? e.message : "Could not open PDF");
          setRendering(false);
        }
      });
    return () => {
      active = false;
    };
  }, [proposal.file_path]);

  useEffect(() => {
    if (!bytes) return;
    let disposed = false;
    let cleanUp = () => {};
    setRendering(true);
    setError("");
    async function render() {
      const pdfjs = await import("pdfjs-dist");
      const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      const loading = pdfjs.getDocument({ data: Uint8Array.from(bytes ?? []) });
      cleanUp = () => {
        void loading.destroy();
      };
      const pdf = await loading.promise;
      if (disposed) {
        await loading.destroy();
        return;
      }
      setPages(pdf.numPages);
      const page = await pdf.getPage(Math.min(pageIndex + 1, pdf.numPages));
      const base = page.getViewport({ scale: 1 });
      setRotation(page.rotate);
      setPageWidth(page.view[2] ?? 612);
      const scale =
        Math.min((viewport.current?.clientWidth ?? 650) / base.width - 0.06, 1.2) * zoom;
      const view = page.getViewport({ scale: Math.max(0.25, scale) });
      const element = canvas.current;
      const ctx = element?.getContext("2d");
      if (!element || !ctx || disposed) return;
      const ratio = window.devicePixelRatio || 1;
      element.width = view.width * ratio;
      element.height = view.height * ratio;
      element.style.width = `${view.width}px`;
      element.style.height = `${view.height}px`;
      await page.render({
        canvas: element,
        canvasContext: ctx,
        viewport: view,
        transform: [ratio, 0, 0, ratio, 0, 0],
      }).promise;
      if (!disposed) setRendering(false);
    }
    render().catch((e: unknown) => {
      if (!disposed) {
        setError(e instanceof Error ? e.message : "Could not render PDF");
        setRendering(false);
      }
    });
    return () => {
      disposed = true;
      cleanUp();
    };
  }, [bytes, pageIndex, zoom]);

  async function replaceBytes(next: Uint8Array, previous: Uint8Array) {
    const nextFields = await getPdfFields(next);
    setHistory((h) => [...h.slice(-9), previous]);
    setBytes(next);
    setMarks([]);
    setFields(nextFields);
    setDirty(true);
  }
  async function pageAction(
    action: "rotate" | "delete" | "earlier" | "later" | "merge",
    extra?: Uint8Array,
  ) {
    if (!bytes) return;
    setBusy(true);
    try {
      const applied = await applyPdfEdits(bytes, marks, fields);
      const next = await changePdfPages(applied, action, pageIndex, extra);
      await replaceBytes(next, bytes);
      if (action === "delete") setPageIndex(Math.max(0, pageIndex - 1));
      if (action === "earlier") setPageIndex(Math.max(0, pageIndex - 1));
      if (action === "later") setPageIndex(Math.min(pages - 1, pageIndex + 1));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Page edit failed");
    } finally {
      setBusy(false);
    }
  }
  async function save(download = false) {
    if (!bytes) return;
    setBusy(true);
    try {
      const result = await applyPdfEdits(bytes, marks, fields);
      if (download) downloadPdf(result, proposal.title);
      else {
        const path = await saveProposalPdf({ ...proposal, file_path: filePath }, result);
        setFilePath(path);
        setBytes(result);
        setMarks([]);
        setHistory([]);
        setDirty(false);
        onSaved();
        toast.success("Edited PDF saved");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save PDF");
    } finally {
      setBusy(false);
    }
  }
  async function undo() {
    if (marks.length) {
      setMarks((m) => m.slice(0, -1));
      return;
    }
    const prev = history[history.length - 1];
    if (prev) {
      setBytes(prev);
      setHistory((h) => h.slice(0, -1));
      setFields(await getPdfFields(prev));
      setDirty(true);
    }
  }
  const close = () => {
    if (!dirty || confirm("Discard unsaved PDF edits?")) onClose();
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent className="flex h-[94dvh] w-[96vw] max-w-[1500px] flex-col gap-0 overflow-hidden p-0 sm:max-w-[1500px]">
        <DialogHeader className="border-b border-border px-5 py-4 pr-12">
          <DialogTitle className="truncate">PDF editor · {proposal.title}</DialogTitle>
          <DialogDescription className="sr-only">Edit proposal PDF</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-1 border-b border-border bg-muted/40 px-3 py-2">
          <ToolButton
            icon={MousePointer2}
            label="Select"
            active={tool === "select"}
            onClick={() => setTool("select")}
          />
          <ToolButton
            icon={Type}
            label="Add text"
            active={tool === "text"}
            onClick={() => setTool("text")}
          />
          <ToolButton
            icon={Highlighter}
            label="Highlight"
            active={tool === "highlight"}
            onClick={() => setTool("highlight")}
          />
          <ToolButton
            icon={PenLine}
            label="Add signature"
            active={tool === "signature"}
            onClick={() => setTool("signature")}
          />
          <span className="mx-1 h-6 w-px bg-border" />
          <ToolButton
            icon={Undo2}
            label="Undo PDF edit"
            disabled={busy || (!marks.length && !history.length)}
            onClick={() => {
              void undo();
            }}
          />
          <ToolButton
            icon={RotateCw}
            label="Rotate page"
            disabled={busy || !bytes}
            onClick={() => {
              void pageAction("rotate");
            }}
          />
          <ToolButton
            icon={Trash2}
            label="Delete page"
            disabled={busy || pages <= 1}
            onClick={() => {
              if (confirm("Delete this page?")) void pageAction("delete");
            }}
          />
          <ToolButton
            icon={ArrowUp}
            label="Move page earlier"
            disabled={busy || pageIndex === 0}
            onClick={() => {
              void pageAction("earlier");
            }}
          />
          <ToolButton
            icon={ArrowDown}
            label="Move page later"
            disabled={busy || pageIndex >= pages - 1}
            onClick={() => {
              void pageAction("later");
            }}
          />
          <ToolButton
            icon={Files}
            label="Merge PDF"
            disabled={busy || !bytes}
            onClick={() => mergeInput.current?.click()}
          />
          <input
            ref={mergeInput}
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            aria-label="Merge PDF file"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (file) {
                if (file.size > 20 * 1024 * 1024) {
                  toast.error("PDF must be under 20 MB");
                  return;
                }
                await pageAction("merge", new Uint8Array(await file.arrayBuffer()));
              }
              e.target.value = "";
            }}
          />
          <div className="ml-auto flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={busy || !bytes}
              onClick={() => {
                void save(true);
              }}
            >
              <Download /> <span className="hidden sm:inline">Download</span>
            </Button>
            <Button
              size="sm"
              disabled={busy || !bytes}
              onClick={() => {
                void save();
              }}
            >
              {busy ? <Loader2 className="animate-spin" /> : <Save />} Save PDF
            </Button>
          </div>
        </div>
        <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
          <aside className="max-h-52 shrink-0 overflow-y-auto border-b border-border bg-card p-4 sm:max-h-none sm:w-64 sm:border-r sm:border-b-0">
            {tool === "text" && (
              <div className="grid gap-3">
                <Label htmlFor="pdf-text">Text to add</Label>
                <Textarea
                  id="pdf-text"
                  rows={4}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                />
                <Label htmlFor="pdf-font-size">Font size</Label>
                <Input
                  id="pdf-font-size"
                  type="number"
                  min={6}
                  max={72}
                  value={size}
                  onChange={(e) => setSize(Math.max(6, Math.min(72, Number(e.target.value) || 12)))}
                />
              </div>
            )}
            {tool === "highlight" && <h3 className="text-sm font-semibold">Highlight</h3>}
            {tool === "signature" && (
              <SignaturePad
                onUse={(data) => {
                  setSignature(data);
                  toast.success("Signature ready to place");
                }}
              />
            )}
            {tool === "select" && <h3 className="text-sm font-semibold">Document fields</h3>}
            {rotation !== 0 && tool !== "select" && (
              <p className="mt-3 text-sm text-warning">
                Rotate the page to 0° before placing annotations.
              </p>
            )}
            {fields.length > 0 && (
              <div className="mt-5 grid gap-4">
                {fields.map((field, index) => (
                  <div key={field.name} className="grid gap-1.5">
                    <Label htmlFor={`pdf-field-${index}`} className="break-words">
                      {field.name}
                    </Label>
                    {field.kind === "checkbox" ? (
                      <Checkbox
                        id={`pdf-field-${index}`}
                        checked={field.value === "true"}
                        onCheckedChange={(checked) => {
                          setFields((f) =>
                            f.map((v, i) =>
                              i === index ? { ...v, value: String(checked === true) } : v,
                            ),
                          );
                          setDirty(true);
                        }}
                      />
                    ) : field.kind === "choice" ? (
                      <Select
                        value={field.value}
                        onValueChange={(value) => {
                          setFields((f) => f.map((v, i) => (i === index ? { ...v, value } : v)));
                          setDirty(true);
                        }}
                      >
                        <SelectTrigger id={`pdf-field-${index}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {field.options.filter(Boolean).map((opt) => (
                            <SelectItem key={opt} value={opt}>
                              {opt}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input
                        id={`pdf-field-${index}`}
                        value={field.value}
                        onChange={(e) => {
                          setFields((f) =>
                            f.map((v, i) => (i === index ? { ...v, value: e.target.value } : v)),
                          );
                          setDirty(true);
                        }}
                      />
                    )}
                  </div>
                ))}
              </div>
            )}
            {tool === "select" && fields.length === 0 && (
              <p className="mt-2 text-sm text-muted-foreground">No fillable fields</p>
            )}
            {marks.length > 0 && (
              <div className="mt-6 grid gap-2">
                <h3 className="text-sm font-semibold">Added annotations</h3>
                {marks.map((mark) => (
                  <div key={mark.id} className="flex items-center gap-2 text-xs">
                    <span className="min-w-0 flex-1 truncate">
                      P{mark.page + 1} · {mark.kind === "text" ? mark.text : mark.kind}
                    </span>
                    <ToolButton
                      icon={Trash2}
                      label="Remove annotation"
                      onClick={() => setMarks((m) => m.filter((v) => v.id !== mark.id))}
                    />
                  </div>
                ))}
              </div>
            )}
          </aside>
          <div
            ref={viewport}
            className="relative min-h-0 min-w-0 flex-1 overflow-auto bg-muted p-4 text-center"
          >
            {error && <p className="mb-4 text-sm text-destructive">{error}</p>}
            {rendering && (
              <div className="absolute inset-x-0 top-6 z-10 flex justify-center">
                <Loader2 className="animate-spin text-primary" />
              </div>
            )}
            <div
              className={`relative mx-auto inline-block bg-card shadow-card ${tool !== "select" ? "cursor-crosshair" : ""}`}
              onClick={(e) => {
                if (!bytes || rendering || tool === "select" || rotation !== 0) return;
                if (tool === "text" && !text.trim()) {
                  toast.error("Enter the text to add");
                  return;
                }
                if (tool === "signature" && !signature) {
                  toast.error("Draw a signature first");
                  return;
                }
                const rect = e.currentTarget.getBoundingClientRect();
                const mark: PdfMark = {
                  id: crypto.randomUUID(),
                  page: pageIndex,
                  x: Math.min(0.75, Math.max(0, (e.clientX - rect.left) / rect.width)),
                  y: Math.min(0.9, Math.max(0, (e.clientY - rect.top) / rect.height)),
                  kind: tool,
                  text,
                  size,
                  ...(tool === "signature" && signature ? { image: signature } : {}),
                };
                setMarks((m) => [...m, mark]);
                setDirty(true);
              }}
            >
              <canvas ref={canvas} aria-label={`PDF page ${pageIndex + 1}`} className="block" />
              {rotation === 0 &&
                marks
                  .filter((m) => m.page === pageIndex)
                  .map((mark) => (
                    <div
                      key={mark.id}
                      className={`pointer-events-none absolute text-left ${mark.kind === "highlight" ? "h-5 bg-star/35" : ""}`}
                      style={{
                        left: `${mark.x * 100}%`,
                        top: `${mark.y * 100}%`,
                        width:
                          mark.kind === "highlight"
                            ? `${(160 / pageWidth) * 100}%`
                            : mark.kind === "signature"
                              ? `${(150 / pageWidth) * 100}%`
                              : undefined,
                        fontSize:
                          (mark.size *
                            (canvas.current?.getBoundingClientRect().width ?? pageWidth)) /
                          pageWidth,
                      }}
                    >
                      {mark.kind === "text" && (
                        <span className="whitespace-pre text-foreground">{mark.text}</span>
                      )}
                      {mark.kind === "signature" && mark.image && (
                        <SignaturePreview bytes={mark.image} />
                      )}
                    </div>
                  ))}
            </div>
          </div>
        </div>
        <footer className="flex items-center justify-center gap-2 border-t border-border bg-card px-3 py-2">
          <ToolButton
            icon={ChevronLeft}
            label="Previous page"
            disabled={pageIndex === 0}
            onClick={() => setPageIndex((p) => p - 1)}
          />
          <span className="min-w-20 text-center text-sm">
            {pages ? pageIndex + 1 : 0} / {pages}
          </span>
          <ToolButton
            icon={ChevronRight}
            label="Next page"
            disabled={pageIndex >= pages - 1}
            onClick={() => setPageIndex((p) => p + 1)}
          />
          <span className="mx-2 h-5 w-px bg-border" />
          <ToolButton
            icon={ZoomOut}
            label="Zoom out"
            disabled={zoom <= 0.5}
            onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}
          />
          <span className="min-w-12 text-center text-xs">{Math.round(zoom * 100)}%</span>
          <ToolButton
            icon={ZoomIn}
            label="Zoom in"
            disabled={zoom >= 2}
            onClick={() => setZoom((z) => Math.min(2, z + 0.25))}
          />
          {dirty && <span className="ml-2 text-xs text-muted-foreground">Unsaved</span>}
        </footer>
      </DialogContent>
    </Dialog>
  );
}

function ToolButton({
  icon: Icon,
  label,
  active = false,
  disabled = false,
  onClick,
}: {
  icon: typeof Type;
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      size="icon"
      variant={active ? "secondary" : "ghost"}
      className="size-9 shrink-0 rounded-md"
      disabled={disabled}
      onClick={onClick}
    >
      <Icon className="size-4" />
    </Button>
  );
}
function SignaturePreview({ bytes }: { bytes: Uint8Array }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    const next = URL.createObjectURL(new Blob([Uint8Array.from(bytes)], { type: "image/png" }));
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [bytes]);
  return url ? <img src={url} alt="Signature" className="w-full" /> : null;
}
