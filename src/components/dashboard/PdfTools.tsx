import {
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { useServerFn } from "@tanstack/react-start";
import SignatureCanvas from "react-signature-canvas";
import { toast } from "sonner";
import {
  Archive,
  ClipboardList,
  Eraser,
  FileOutput,
  FilePlus2,
  FileSignature,
  Files,
  ListOrdered,
  Lock,
  Mail,
  MessageSquarePlus,
  PenLine,
  PenTool,
  ScanText,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { sendCrmEmail } from "@/lib/crm-email.functions";
import {
  addComments,
  combinePdfs,
  compressPdfLossless,
  createPdfFromImages,
  createPdfFromText,
  editPdfText,
  fillForm,
  listFormFields,
  organizePages,
  pdfPageCount,
  prepareForm,
  protectPdf,
  signPdf,
  type FormFieldInfo,
  type FormFieldSpec,
  type PdfComment,
  type PdfTextEdit,
} from "@/lib/pdf-tools";
import {
  exportPdfToImages,
  exportPdfToText,
  ocrPdfToSearchable,
  rasterizePdf,
  renderPagePreview,
  type RedactionRect,
} from "@/lib/pdf-tools-browser";
import { useCrm } from "./CrmContext";

type ToolId =
  | "export"
  | "edit"
  | "create"
  | "combine"
  | "organize"
  | "comments"
  | "esign"
  | "ocr"
  | "protect"
  | "redact"
  | "compress"
  | "form"
  | "sign";

const TOOLS: Array<{ id: ToolId; label: string; blurb: string; icon: typeof FileOutput }> = [
  { id: "export", label: "Export a PDF", blurb: "Pages to images or text", icon: FileOutput },
  { id: "edit", label: "Edit a PDF", blurb: "Add or cover text", icon: PenLine },
  { id: "create", label: "Create a PDF", blurb: "From text or photos", icon: FilePlus2 },
  { id: "combine", label: "Combine files", blurb: "Merge PDFs into one", icon: Files },
  { id: "organize", label: "Organize pages", blurb: "Reorder, delete, rotate", icon: ListOrdered },
  { id: "comments", label: "Add comments", blurb: "Numbered notes on pages", icon: MessageSquarePlus },
  { id: "esign", label: "Request e-signature", blurb: "Send documents to sign", icon: FileSignature },
  { id: "ocr", label: "Scan & OCR", blurb: "Make scans searchable", icon: ScanText },
  { id: "protect", label: "Protect a PDF", blurb: "AES-256 password lock", icon: Lock },
  { id: "redact", label: "Redact a PDF", blurb: "Permanently remove content", icon: Eraser },
  { id: "compress", label: "Compress a PDF", blurb: "Shrink the file size", icon: Archive },
  { id: "form", label: "Prepare a form", blurb: "Add fillable fields", icon: ClipboardList },
  { id: "sign", label: "Fill & Sign", blurb: "Fill forms, add signature", icon: PenTool },
];

type SourceFile = { bytes: Uint8Array; name: string };
type ResultFile = { bytes: Uint8Array; name: string };

function downloadBytes(bytes: Uint8Array, filename: string, type = "application/pdf") {
  const blob = new Blob([bytes as BlobPart], { type });
  downloadBlob(blob, filename);
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

async function fileBytes(file: File): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer());
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function baseName(name: string): string {
  return name.replace(/\.pdf$/i, "");
}

/** Page preview that reports clicks (and optional drag rectangles) in PDF points. */
function PagePreview({
  bytes,
  pageIndex,
  onPoint,
  onRect,
}: {
  bytes: Uint8Array;
  pageIndex: number;
  onPoint?: (x: number, y: number) => void;
  onRect?: (rect: { x: number; y: number; width: number; height: number }) => void;
}) {
  const [preview, setPreview] = useState<{ dataUrl: string; widthPt: number; heightPt: number } | null>(null);
  const dragStart = useRef<{ fx: number; fy: number } | null>(null);
  useEffect(() => {
    let cancelled = false;
    renderPagePreview(bytes, pageIndex)
      .then((result) => {
        if (!cancelled) setPreview(result);
      })
      .catch(() => {
        if (!cancelled) setPreview(null);
      });
    return () => {
      cancelled = true;
    };
  }, [bytes, pageIndex]);
  if (!preview)
    return <p className="py-8 text-center text-sm text-muted-foreground">Rendering page…</p>;
  const toPdf = (event: ReactMouseEvent<HTMLImageElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const fx = (event.clientX - rect.left) / rect.width;
    const fy = (event.clientY - rect.top) / rect.height;
    return { fx, fy, x: fx * preview.widthPt, y: preview.heightPt - fy * preview.heightPt };
  };
  return (
    <img
      src={preview.dataUrl}
      alt={`Page ${pageIndex + 1}`}
      className="w-full cursor-crosshair rounded border bg-white select-none"
      draggable={false}
      onMouseDown={(event) => {
        const point = toPdf(event);
        dragStart.current = { fx: point.fx, fy: point.fy };
      }}
      onMouseUp={(event) => {
        const end = toPdf(event);
        const start = dragStart.current;
        dragStart.current = null;
        if (onRect && start && (Math.abs(end.fx - start.fx) > 0.02 || Math.abs(end.fy - start.fy) > 0.02)) {
          const x = Math.min(start.fx, end.fx) * preview.widthPt;
          const topFy = Math.min(start.fy, end.fy);
          const width = Math.abs(end.fx - start.fx) * preview.widthPt;
          const height = Math.abs(end.fy - start.fy) * preview.heightPt;
          onRect({ x, y: preview.heightPt - topFy * preview.heightPt - height, width, height });
        } else if (onPoint) {
          onPoint(end.x, end.y);
        }
      }}
    />
  );
}

function PageNav({
  pageIndex,
  pageCount,
  onChange,
}: {
  pageIndex: number;
  pageCount: number;
  onChange: (index: number) => void;
}) {
  if (pageCount <= 1) return null;
  return (
    <div className="flex items-center gap-2 text-sm">
      <Button type="button" variant="outline" size="sm" disabled={pageIndex === 0} onClick={() => onChange(pageIndex - 1)}>
        Previous
      </Button>
      <span>
        Page {pageIndex + 1} of {pageCount}
      </span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={pageIndex >= pageCount - 1}
        onClick={() => onChange(pageIndex + 1)}
      >
        Next
      </Button>
    </div>
  );
}

function EmailComposer({ result, defaultSubject }: { result: ResultFile; defaultSubject?: string }) {
  const sendEmail = useServerFn(sendCrmEmail);
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState(defaultSubject ?? "");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  if (!open)
    return (
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        <Mail className="mr-2 size-4" /> Email this PDF
      </Button>
    );
  return (
    <div className="grid w-full gap-2 rounded border p-3">
      <Label>
        Send to
        <Input type="email" value={to} onChange={(event) => setTo(event.target.value)} placeholder="customer@email.com" />
      </Label>
      <Label>
        Subject
        <Input value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="Your document from Roofer Masters" />
      </Label>
      <Label>
        Message
        <Textarea rows={4} value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Hi, attached is your document…" />
      </Label>
      <div className="flex gap-2">
        <Button
          type="button"
          disabled={sending || !to || !subject || !message}
          onClick={async () => {
            setSending(true);
            try {
              const response = await sendEmail({
                data: {
                  to: to.trim(),
                  subject: subject.trim(),
                  message: message.trim(),
                  attachments: [
                    {
                      filename: result.name,
                      contentBase64: toBase64(result.bytes),
                      contentType: "application/pdf",
                    },
                  ],
                },
              });
              if (!response.sent) throw new Error("Email was not sent");
              toast.success(`Email sent to ${to.trim()} with ${result.name} attached`);
              setOpen(false);
            } catch (error) {
              toast.error(error instanceof Error ? error.message : "Email failed");
            } finally {
              setSending(false);
            }
          }}
        >
          {sending ? "Sending…" : "Send email"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Sends from the Roofer Masters mailbox. If email is not configured yet, the error message names the missing server
        settings.
      </p>
    </div>
  );
}

function ResultBar({ result }: { result: ResultFile }) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded border border-primary/30 bg-primary/5 p-3">
      <span className="text-sm font-medium">
        {result.name} — {(result.bytes.length / 1024).toFixed(0)} KB ready
      </span>
      <Button type="button" onClick={() => downloadBytes(result.bytes, result.name)}>
        Download
      </Button>
      <EmailComposer result={result} />
    </div>
  );
}

function SourcePicker({
  source,
  onSource,
  accept = "application/pdf",
}: {
  source: SourceFile | null;
  onSource: (source: SourceFile | null) => void;
  accept?: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        type="file"
        accept={accept}
        className="max-w-sm"
        onChange={async (event) => {
          const file = event.target.files?.[0];
          if (!file) return;
          onSource({ bytes: await fileBytes(file), name: file.name });
        }}
      />
      {source && <span className="text-sm text-muted-foreground">{source.name}</span>}
    </div>
  );
}

function useRun() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
}

function PanelShell({
  children,
  error,
  result,
}: {
  children: ReactNode;
  error: string;
  result: ResultFile | null;
}) {
  return (
    <div className="grid gap-3">
      {children}
      {error && (
        <p role="alert" className="rounded border border-destructive/40 bg-destructive/10 p-3 text-sm">
          {error}
        </p>
      )}
      {result && <ResultBar result={result} />}
    </div>
  );
}

function useSourceWithPages() {
  const [source, setSource] = useState<SourceFile | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [pageIndex, setPageIndex] = useState(0);
  useEffect(() => {
    let cancelled = false;
    if (!source) {
      setPageCount(0);
      return;
    }
    pdfPageCount(source.bytes)
      .then((count) => {
        if (!cancelled) {
          setPageCount(count);
          setPageIndex(0);
        }
      })
      .catch(() => {
        if (!cancelled) setPageCount(0);
      });
    return () => {
      cancelled = true;
    };
  }, [source]);
  return { source, setSource, pageCount, pageIndex, setPageIndex };
}

function ExportPanel() {
  const { busy, error, run } = useRun();
  const [source, setSource] = useState<SourceFile | null>(null);
  const [note, setNote] = useState("");
  return (
    <PanelShell error={error} result={null}>
      <SourcePicker source={source} onSource={setSource} />
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          disabled={!source || busy}
          onClick={() =>
            run(async () => {
              const images = await exportPdfToImages(source!.bytes, "png");
              images.forEach((blob, index) =>
                downloadBlob(blob, `${baseName(source!.name)}-page-${index + 1}.png`),
              );
              setNote(`Exported ${images.length} PNG image(s).`);
            })
          }
        >
          Export pages as PNG
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={!source || busy}
          onClick={() =>
            run(async () => {
              const images = await exportPdfToImages(source!.bytes, "jpeg");
              images.forEach((blob, index) =>
                downloadBlob(blob, `${baseName(source!.name)}-page-${index + 1}.jpg`),
              );
              setNote(`Exported ${images.length} JPG image(s).`);
            })
          }
        >
          Export pages as JPG
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={!source || busy}
          onClick={() =>
            run(async () => {
              const text = await exportPdfToText(source!.bytes);
              downloadBytes(new TextEncoder().encode(text), `${baseName(source!.name)}.txt`, "text/plain");
              setNote("Exported the text already inside the PDF. For scanned pages with no text, use Scan & OCR.");
            })
          }
        >
          Export text
        </Button>
      </div>
      {note && <p className="text-sm text-muted-foreground">{note}</p>}
    </PanelShell>
  );
}

function CreatePanel() {
  const { busy, error, run } = useRun();
  const [result, setResult] = useState<ResultFile | null>(null);
  const [mode, setMode] = useState<"text" | "images">("text");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [images, setImages] = useState<Array<{ bytes: Uint8Array; kind: "png" | "jpg"; name: string }>>([]);
  return (
    <PanelShell error={error} result={result}>
      <div className="flex gap-2">
        <Button type="button" variant={mode === "text" ? "default" : "outline"} onClick={() => setMode("text")}>
          From text
        </Button>
        <Button type="button" variant={mode === "images" ? "default" : "outline"} onClick={() => setMode("images")}>
          From photos / images
        </Button>
      </div>
      {mode === "text" ? (
        <div className="grid gap-2">
          <Label>
            Title
            <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Document title" />
          </Label>
          <Label>
            Text
            <Textarea rows={10} value={body} onChange={(event) => setBody(event.target.value)} placeholder="Type or paste the document text…" />
          </Label>
          <Button
            type="button"
            disabled={busy || !body.trim()}
            onClick={() =>
              run(async () => {
                const bytes = await createPdfFromText(title, body);
                setResult({ bytes, name: `${title.trim() || "document"}.pdf` });
              })
            }
          >
            Create PDF
          </Button>
        </div>
      ) : (
        <div className="grid gap-2">
          <Input
            type="file"
            accept="image/png,image/jpeg"
            multiple
            className="max-w-sm"
            onChange={async (event) => {
              const files = [...(event.target.files ?? [])];
              const loaded = await Promise.all(
                files.map(async (file) => ({
                  bytes: await fileBytes(file),
                  kind: (file.type === "image/png" ? "png" : "jpg") as "png" | "jpg",
                  name: file.name,
                })),
              );
              setImages((current) => [...current, ...loaded]);
            }}
          />
          {images.length > 0 && (
            <p className="text-sm text-muted-foreground">
              {images.length} image(s): {images.map((image) => image.name).join(", ")}
            </p>
          )}
          <Button
            type="button"
            disabled={busy || images.length === 0}
            onClick={() =>
              run(async () => {
                const bytes = await createPdfFromImages(images);
                setResult({ bytes, name: "images.pdf" });
              })
            }
          >
            Create PDF from images
          </Button>
        </div>
      )}
    </PanelShell>
  );
}

function CombinePanel() {
  const { busy, error, run } = useRun();
  const [result, setResult] = useState<ResultFile | null>(null);
  const [files, setFiles] = useState<SourceFile[]>([]);
  return (
    <PanelShell error={error} result={result}>
      <Input
        type="file"
        accept="application/pdf"
        multiple
        className="max-w-sm"
        onChange={async (event) => {
          const selected = [...(event.target.files ?? [])];
          const loaded = await Promise.all(
            selected.map(async (file) => ({ bytes: await fileBytes(file), name: file.name })),
          );
          setFiles((current) => [...current, ...loaded]);
        }}
      />
      {files.length > 0 && (
        <ol className="grid gap-1 text-sm">
          {files.map((file, index) => (
            <li key={`${file.name}-${index}`} className="flex items-center gap-2">
              <span>
                {index + 1}. {file.name}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setFiles((current) => current.filter((_, i) => i !== index))}
              >
                Remove
              </Button>
            </li>
          ))}
        </ol>
      )}
      <Button
        type="button"
        disabled={busy || files.length < 2}
        onClick={() =>
          run(async () => {
            const bytes = await combinePdfs(files.map((file) => file.bytes));
            setResult({ bytes, name: "combined.pdf" });
          })
        }
      >
        Combine into one PDF
      </Button>
    </PanelShell>
  );
}

function OrganizePanel() {
  const { busy, error, run } = useRun();
  const { source, setSource, pageCount } = useSourceWithPages();
  const [result, setResult] = useState<ResultFile | null>(null);
  const [order, setOrder] = useState("");
  const [rotatePage, setRotatePage] = useState("");
  const [rotateDegrees, setRotateDegrees] = useState("90");
  const [rotations, setRotations] = useState<Record<number, number>>({});
  useEffect(() => {
    if (pageCount > 0 && !order) setOrder(Array.from({ length: pageCount }, (_, i) => i + 1).join(", "));
  }, [pageCount, order]);
  return (
    <PanelShell error={error} result={result}>
      <SourcePicker source={source} onSource={setSource} />
      {pageCount > 0 && (
        <div className="grid gap-2">
          <Label>
            New page order (comma-separated page numbers; leave a page out to delete it)
            <Input value={order} onChange={(event) => setOrder(event.target.value)} />
          </Label>
          <div className="flex flex-wrap items-end gap-2">
            <Label>
              Rotate page
              <Input value={rotatePage} onChange={(event) => setRotatePage(event.target.value)} placeholder="Page #" className="w-24" />
            </Label>
            <Label>
              By
              <select
                className="h-9 rounded border bg-background px-2"
                value={rotateDegrees}
                onChange={(event) => setRotateDegrees(event.target.value)}
              >
                <option value="90">90°</option>
                <option value="180">180°</option>
                <option value="270">270°</option>
              </select>
            </Label>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                const page = Number(rotatePage);
                if (Number.isInteger(page) && page >= 1 && page <= pageCount)
                  setRotations((current) => ({ ...current, [page - 1]: Number(rotateDegrees) }));
              }}
            >
              Add rotation
            </Button>
            {Object.keys(rotations).length > 0 && (
              <span className="text-sm text-muted-foreground">
                Rotations: {Object.entries(rotations).map(([page, deg]) => `p.${Number(page) + 1} → ${deg}°`).join(", ")}
              </span>
            )}
          </div>
          <Button
            type="button"
            disabled={busy}
            onClick={() =>
              run(async () => {
                const indices = order
                  .split(",")
                  .map((part) => Number(part.trim()) - 1)
                  .filter((value) => Number.isInteger(value) && value >= 0);
                const bytes = await organizePages(source!.bytes, indices, rotations);
                setResult({ bytes, name: `${baseName(source!.name)}-organized.pdf` });
              })
            }
          >
            Apply page order
          </Button>
        </div>
      )}
    </PanelShell>
  );
}

function ProtectPanel() {
  const { busy, error, run } = useRun();
  const [source, setSource] = useState<SourceFile | null>(null);
  const [result, setResult] = useState<ResultFile | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  return (
    <PanelShell error={error} result={result}>
      <SourcePicker source={source} onSource={setSource} />
      <div className="flex flex-wrap gap-2">
        <Label>
          Password to open
          <Input type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
        </Label>
        <Label>
          Confirm password
          <Input type="password" value={confirm} onChange={(event) => setConfirm(event.target.value)} />
        </Label>
      </div>
      <Button
        type="button"
        disabled={busy || !source || !password || password !== confirm}
        onClick={() =>
          run(async () => {
            const bytes = await protectPdf(source!.bytes, password);
            setResult({ bytes, name: `${baseName(source!.name)}-protected.pdf` });
          })
        }
      >
        Protect with AES-256 password
      </Button>
      <p className="text-sm text-muted-foreground">
        The file cannot be opened without the password, and copying/editing are disabled. Keep the password somewhere safe —
        it cannot be recovered from the file.
      </p>
    </PanelShell>
  );
}

function CompressPanel() {
  const { busy, error, run } = useRun();
  const [source, setSource] = useState<SourceFile | null>(null);
  const [result, setResult] = useState<ResultFile | null>(null);
  return (
    <PanelShell error={error} result={result}>
      <SourcePicker source={source} onSource={setSource} />
      {source && (
        <p className="text-sm text-muted-foreground">Current size: {(source.bytes.length / 1024).toFixed(0)} KB</p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          disabled={busy || !source}
          onClick={() =>
            run(async () => {
              const bytes = await rasterizePdf(source!.bytes, { dpi: 150, quality: 0.8 });
              setResult({ bytes, name: `${baseName(source!.name)}-compressed.pdf` });
            })
          }
        >
          Strong compression (150 dpi images)
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={busy || !source}
          onClick={() =>
            run(async () => {
              const bytes = await rasterizePdf(source!.bytes, { dpi: 100, quality: 0.7 });
              setResult({ bytes, name: `${baseName(source!.name)}-smallest.pdf` });
            })
          }
        >
          Smallest size (100 dpi)
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={busy || !source}
          onClick={() =>
            run(async () => {
              const bytes = await compressPdfLossless(source!.bytes);
              setResult({ bytes, name: `${baseName(source!.name)}-optimized.pdf` });
            })
          }
        >
          Lossless (keeps selectable text)
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        Image modes rebuild pages as photos — best for scanned or photo-heavy PDFs. Lossless keeps the original text and
        vector content and only rebuilds the file structure.
      </p>
    </PanelShell>
  );
}

function EditPanel() {
  const { busy, error, run } = useRun();
  const { source, setSource, pageCount, pageIndex, setPageIndex } = useSourceWithPages();
  const [result, setResult] = useState<ResultFile | null>(null);
  const [edits, setEdits] = useState<PdfTextEdit[]>([]);
  const [text, setText] = useState("");
  const [size, setSize] = useState("12");
  const [cover, setCover] = useState(false);
  const [pendingPoint, setPendingPoint] = useState<{ x: number; y: number } | null>(null);
  return (
    <PanelShell error={error} result={result}>
      <SourcePicker source={source} onSource={setSource} />
      {source && (
        <div className="grid gap-2">
          <PageNav pageIndex={pageIndex} pageCount={pageCount} onChange={setPageIndex} />
          <p className="text-sm text-muted-foreground">Click on the page where the text should go, type it, then add it.</p>
          <PagePreview
            bytes={source.bytes}
            pageIndex={pageIndex}
            onPoint={(x, y) => setPendingPoint({ x, y })}
          />
          <div className="flex flex-wrap items-end gap-2">
            <Label className="grow">
              Text to add{pendingPoint ? ` at (${pendingPoint.x.toFixed(0)}, ${pendingPoint.y.toFixed(0)})` : ""}
              <Input value={text} onChange={(event) => setText(event.target.value)} placeholder="Click the page, then type…" />
            </Label>
            <Label>
              Size
              <Input type="number" className="w-20" value={size} onChange={(event) => setSize(event.target.value)} />
            </Label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={cover} onChange={(event) => setCover(event.target.checked)} />
              Cover what's underneath
            </label>
            <Button
              type="button"
              variant="outline"
              disabled={!pendingPoint || !text.trim()}
              onClick={() => {
                const fontSize = Math.min(48, Math.max(6, Number(size) || 12));
                setEdits((current) => [
                  ...current,
                  {
                    page: pageIndex,
                    x: pendingPoint!.x,
                    y: pendingPoint!.y,
                    text: text.trim(),
                    size: fontSize,
                    whiteout: cover
                      ? { width: text.trim().length * fontSize * 0.55 + 6, height: fontSize * 1.5 }
                      : undefined,
                  },
                ]);
                setText("");
              }}
            >
              Add text
            </Button>
          </div>
          {edits.length > 0 && (
            <p className="text-sm text-muted-foreground">
              {edits.length} edit(s) queued: {edits.map((edit) => `"${edit.text}" (p.${edit.page + 1})`).join(", ")}
            </p>
          )}
          <Button
            type="button"
            disabled={busy || edits.length === 0}
            onClick={() =>
              run(async () => {
                const bytes = await editPdfText(source.bytes, edits);
                setResult({ bytes, name: `${baseName(source.name)}-edited.pdf` });
              })
            }
          >
            Apply edits
          </Button>
          <p className="text-sm text-muted-foreground">
            Edit adds new text (with an optional white cover box). The original text stays in the file underneath a cover
            box — use Redact when content must be permanently removed.
          </p>
        </div>
      )}
    </PanelShell>
  );
}

function CommentsPanel() {
  const { busy, error, run } = useRun();
  const { source, setSource, pageCount, pageIndex, setPageIndex } = useSourceWithPages();
  const [result, setResult] = useState<ResultFile | null>(null);
  const [comments, setComments] = useState<PdfComment[]>([]);
  const [text, setText] = useState("");
  const [pendingPoint, setPendingPoint] = useState<{ x: number; y: number } | null>(null);
  return (
    <PanelShell error={error} result={result}>
      <SourcePicker source={source} onSource={setSource} />
      {source && (
        <div className="grid gap-2">
          <PageNav pageIndex={pageIndex} pageCount={pageCount} onChange={setPageIndex} />
          <p className="text-sm text-muted-foreground">Click where the note belongs, write the comment, and add it.</p>
          <PagePreview bytes={source.bytes} pageIndex={pageIndex} onPoint={(x, y) => setPendingPoint({ x, y })} />
          <div className="flex flex-wrap items-end gap-2">
            <Label className="grow">
              Comment{pendingPoint ? ` on page ${pageIndex + 1}` : ""}
              <Input value={text} onChange={(event) => setText(event.target.value)} placeholder="Click the page, then write the note…" />
            </Label>
            <Button
              type="button"
              variant="outline"
              disabled={!pendingPoint || !text.trim()}
              onClick={() => {
                setComments((current) => [
                  ...current,
                  { page: pageIndex, x: pendingPoint!.x, y: pendingPoint!.y, text: text.trim(), author: "Roofer Masters" },
                ]);
                setText("");
              }}
            >
              Add comment
            </Button>
          </div>
          {comments.length > 0 && (
            <ol className="grid gap-1 text-sm">
              {comments.map((comment, index) => (
                <li key={index}>
                  {index + 1}. (page {comment.page + 1}) {comment.text}
                </li>
              ))}
            </ol>
          )}
          <Button
            type="button"
            disabled={busy || comments.length === 0}
            onClick={() =>
              run(async () => {
                const bytes = await addComments(source.bytes, comments);
                setResult({ bytes, name: `${baseName(source.name)}-commented.pdf` });
              })
            }
          >
            Add comments to PDF
          </Button>
          <p className="text-sm text-muted-foreground">
            Each comment becomes a numbered yellow marker on the page plus a comments page at the end, so the notes are
            visible in any PDF viewer.
          </p>
        </div>
      )}
    </PanelShell>
  );
}

function RedactPanel() {
  const { busy, error, run } = useRun();
  const { source, setSource, pageCount, pageIndex, setPageIndex } = useSourceWithPages();
  const [result, setResult] = useState<ResultFile | null>(null);
  const [rects, setRects] = useState<RedactionRect[]>([]);
  return (
    <PanelShell error={error} result={result}>
      <SourcePicker source={source} onSource={setSource} />
      {source && (
        <div className="grid gap-2">
          <PageNav pageIndex={pageIndex} pageCount={pageCount} onChange={setPageIndex} />
          <p className="text-sm text-muted-foreground">
            Drag a box over anything that must be removed — a price, an address, a signature. Repeat on any page.
          </p>
          <PagePreview
            bytes={source.bytes}
            pageIndex={pageIndex}
            onRect={(rect) => setRects((current) => [...current, { page: pageIndex, ...rect }])}
          />
          {rects.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span>
                {rects.length} redaction box(es): {rects.map((rect) => `p.${rect.page + 1}`).join(", ")}
              </span>
              <Button type="button" variant="ghost" size="sm" onClick={() => setRects([])}>
                Clear all
              </Button>
            </div>
          )}
          <Button
            type="button"
            disabled={busy || rects.length === 0}
            onClick={() =>
              run(async () => {
                const bytes = await rasterizePdf(source.bytes, { dpi: 200, quality: 0.9, redactions: rects });
                setResult({ bytes, name: `${baseName(source.name)}-redacted.pdf` });
              })
            }
          >
            Redact permanently
          </Button>
          <p className="text-sm text-muted-foreground">
            Redaction rebuilds every page as an image with the boxes burned in — the covered content is gone from the file,
            not just hidden. Text in the result is no longer selectable.
          </p>
        </div>
      )}
    </PanelShell>
  );
}

function FormPanel() {
  const { busy, error, run } = useRun();
  const { source, setSource, pageCount, pageIndex, setPageIndex } = useSourceWithPages();
  const [result, setResult] = useState<ResultFile | null>(null);
  const [fields, setFields] = useState<FormFieldSpec[]>([]);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<FormFieldSpec["kind"]>("text");
  const [pendingPoint, setPendingPoint] = useState<{ x: number; y: number } | null>(null);
  return (
    <PanelShell error={error} result={result}>
      <SourcePicker source={source} onSource={setSource} />
      {source && (
        <div className="grid gap-2">
          <PageNav pageIndex={pageIndex} pageCount={pageCount} onChange={setPageIndex} />
          <p className="text-sm text-muted-foreground">Click where a fillable field should start, name it, and add it.</p>
          <PagePreview bytes={source.bytes} pageIndex={pageIndex} onPoint={(x, y) => setPendingPoint({ x, y })} />
          <div className="flex flex-wrap items-end gap-2">
            <Label>
              Field name
              <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Customer signature date" />
            </Label>
            <Label>
              Type
              <select className="h-9 rounded border bg-background px-2" value={kind} onChange={(event) => setKind(event.target.value as FormFieldSpec["kind"])}>
                <option value="text">Text</option>
                <option value="checkbox">Checkbox</option>
                <option value="dropdown">Dropdown</option>
              </select>
            </Label>
            <Button
              type="button"
              variant="outline"
              disabled={!pendingPoint || !name.trim()}
              onClick={() => {
                setFields((current) => [
                  ...current,
                  {
                    page: pageIndex,
                    x: pendingPoint!.x,
                    y: pendingPoint!.y,
                    width: kind === "checkbox" ? 14 : 220,
                    height: kind === "checkbox" ? 14 : 18,
                    name: name.trim(),
                    kind,
                    options: kind === "dropdown" ? ["Yes", "No"] : undefined,
                  },
                ]);
                setName("");
              }}
            >
              Add field
            </Button>
          </div>
          {fields.length > 0 && (
            <p className="text-sm text-muted-foreground">
              Fields: {fields.map((field) => `${field.name} (${field.kind}, p.${field.page + 1})`).join(", ")}
            </p>
          )}
          <Button
            type="button"
            disabled={busy || fields.length === 0}
            onClick={() =>
              run(async () => {
                const bytes = await prepareForm(source.bytes, fields);
                setResult({ bytes, name: `${baseName(source.name)}-form.pdf` });
              })
            }
          >
            Prepare form
          </Button>
        </div>
      )}
    </PanelShell>
  );
}

function SignPanel() {
  const { busy, error, run } = useRun();
  const { source, setSource, pageCount, pageIndex, setPageIndex } = useSourceWithPages();
  const [result, setResult] = useState<ResultFile | null>(null);
  const [fields, setFields] = useState<FormFieldInfo[]>([]);
  const [values, setValues] = useState<Record<string, string | boolean>>({});
  const [printedName, setPrintedName] = useState("");
  const [signPoint, setSignPoint] = useState<{ x: number; y: number; page: number } | null>(null);
  const signaturePad = useRef<SignatureCanvas>(null);
  useEffect(() => {
    if (!source) {
      setFields([]);
      return;
    }
    listFormFields(source.bytes)
      .then(setFields)
      .catch(() => setFields([]));
  }, [source]);
  return (
    <PanelShell error={error} result={result}>
      <SourcePicker source={source} onSource={setSource} />
      {source && (
        <div className="grid gap-3">
          {fields.length > 0 && (
            <div className="grid gap-2">
              <p className="text-sm font-medium">Fill the form fields</p>
              {fields.map((field) => (
                <Label key={field.name}>
                  {field.name}
                  {field.kind === "checkbox" ? (
                    <input
                      type="checkbox"
                      className="ml-2"
                      checked={Boolean(values[field.name])}
                      onChange={(event) => setValues((current) => ({ ...current, [field.name]: event.target.checked }))}
                    />
                  ) : (
                    <Input
                      value={typeof values[field.name] === "string" ? (values[field.name] as string) : ""}
                      onChange={(event) => setValues((current) => ({ ...current, [field.name]: event.target.value }))}
                    />
                  )}
                </Label>
              ))}
            </div>
          )}
          <div className="grid gap-2">
            <p className="text-sm font-medium">Draw your signature</p>
            <div className="w-fit rounded border bg-white">
              <SignatureCanvas ref={signaturePad} canvasProps={{ width: 340, height: 120 }} />
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => signaturePad.current?.clear()}>
                Clear signature
              </Button>
            </div>
            <Label>
              Printed name (optional)
              <Input value={printedName} onChange={(event) => setPrintedName(event.target.value)} className="max-w-sm" />
            </Label>
          </div>
          <PageNav pageIndex={pageIndex} pageCount={pageCount} onChange={setPageIndex} />
          <p className="text-sm text-muted-foreground">Click on the page where the signature should be stamped.</p>
          <PagePreview
            bytes={source.bytes}
            pageIndex={pageIndex}
            onPoint={(x, y) => setSignPoint({ x, y, page: pageIndex })}
          />
          <Button
            type="button"
            disabled={busy}
            onClick={() =>
              run(async () => {
                let bytes = source.bytes;
                const filledValues = Object.fromEntries(
                  Object.entries(values).filter(([, value]) => value !== "" && value !== undefined),
                );
                if (fields.length && Object.keys(filledValues).length) {
                  bytes = await fillForm(bytes, filledValues, false);
                }
                if (signPoint) {
                  const canvas = signaturePad.current?.getTrimmedCanvas();
                  if (!canvas) throw new Error("Draw your signature first.");
                  const signatureBlob = await new Promise<Blob>((resolve, reject) =>
                    canvas.toBlob(
                      (blob) => (blob ? resolve(blob) : reject(new Error("Signature capture failed"))),
                      "image/png",
                    ),
                  );
                  const signatureBytes = new Uint8Array(await signatureBlob.arrayBuffer());
                  bytes = await signPdf(bytes, signatureBytes, {
                    page: signPoint.page,
                    x: signPoint.x,
                    y: signPoint.y,
                    width: 170,
                    printedName: printedName.trim() || undefined,
                    dateText: new Date().toLocaleDateString("en-US", {
                      month: "long",
                      day: "numeric",
                      year: "numeric",
                    }),
                  });
                }
                if (bytes === source.bytes) throw new Error("Fill a field or place a signature first.");
                setResult({ bytes, name: `${baseName(source.name)}-signed.pdf` });
              })
            }
          >
            Fill &amp; sign
          </Button>
        </div>
      )}
    </PanelShell>
  );
}

function OcrPanel() {
  const { busy, error, run } = useRun();
  const [source, setSource] = useState<SourceFile | null>(null);
  const [result, setResult] = useState<ResultFile | null>(null);
  const [progress, setProgress] = useState("");
  const [text, setText] = useState("");
  return (
    <PanelShell error={error} result={result}>
      <SourcePicker source={source} onSource={setSource} accept="application/pdf,image/png,image/jpeg" />
      <Button
        type="button"
        disabled={busy || !source}
        onClick={() =>
          run(async () => {
            let bytes = source!.bytes;
            if (!source!.name.toLowerCase().endsWith(".pdf")) {
              const kind = source!.name.toLowerCase().endsWith(".png") ? "png" : "jpg";
              bytes = await createPdfFromImages([{ bytes, kind }]);
            }
            const outcome = await ocrPdfToSearchable(bytes, {
              onProgress: (page, total) => setProgress(`Reading page ${page} of ${total}…`),
            });
            setProgress("");
            setText(outcome.text);
            setResult({ bytes: outcome.bytes, name: `${baseName(source!.name)}-searchable.pdf` });
          })
        }
      >
        {busy ? progress || "Running OCR…" : "Run OCR — make searchable PDF"}
      </Button>
      <p className="text-sm text-muted-foreground">
        Works on scanned PDFs and photos of documents. Recognition runs in your browser (free); the first run downloads the
        English language pack. The result keeps the page images and adds an invisible text layer, so the PDF becomes
        searchable and copyable.
      </p>
      {text && (
        <Label>
          Recognized text
          <Textarea rows={8} readOnly value={text} />
        </Label>
      )}
    </PanelShell>
  );
}

function EsignPanel() {
  const { openProposals } = useCrm();
  const [source, setSource] = useState<SourceFile | null>(null);
  const emailResult: ResultFile | null = source ? { bytes: source.bytes, name: source.name } : null;
  return (
    <div className="grid gap-3">
      <p className="text-sm text-muted-foreground">
        For a tracked signature with a signing record, send the proposal from Estimates &amp; proposals — the customer signs
        through a secure link and the signed PDF is stored on the job. To simply email any PDF with a signature request, pick
        the file below.
      </p>
      <Button type="button" onClick={() => openProposals()}>
        Open Estimates &amp; proposals
      </Button>
      <SourcePicker source={source} onSource={setSource} />
      {emailResult && (
        <EmailComposer result={emailResult} defaultSubject="Please review and sign — Roofer Masters" />
      )}
    </div>
  );
}

export function PdfTools() {
  const [tool, setTool] = useState<ToolId>("create");
  const active = TOOLS.find((item) => item.id === tool) ?? TOOLS[0]!;
  return (
    <div className="grid gap-4">
      <div>
        <h2 className="text-lg font-semibold">PDF Tools</h2>
        <p className="text-sm text-muted-foreground">
          Every Acrobat-style tool, free — the work happens in your browser, so documents never leave your computer except
          when you email them.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {TOOLS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTool(item.id)}
            className={`grid gap-1 rounded border p-3 text-left transition-colors ${
              tool === item.id ? "border-primary bg-primary/5" : "hover:bg-muted/50"
            }`}
          >
            <span className="flex items-center gap-2 font-medium">
              <item.icon className="size-4 text-primary" /> {item.label}
            </span>
            <span className="text-xs text-muted-foreground">{item.blurb}</span>
          </button>
        ))}
      </div>
      <div className="rounded border p-4">
        <h3 className="mb-3 font-medium">{active.label}</h3>
        {tool === "export" && <ExportPanel />}
        {tool === "edit" && <EditPanel />}
        {tool === "create" && <CreatePanel />}
        {tool === "combine" && <CombinePanel />}
        {tool === "organize" && <OrganizePanel />}
        {tool === "comments" && <CommentsPanel />}
        {tool === "esign" && <EsignPanel />}
        {tool === "ocr" && <OcrPanel />}
        {tool === "protect" && <ProtectPanel />}
        {tool === "redact" && <RedactPanel />}
        {tool === "compress" && <CompressPanel />}
        {tool === "form" && <FormPanel />}
        {tool === "sign" && <SignPanel />}
      </div>
    </div>
  );
}
