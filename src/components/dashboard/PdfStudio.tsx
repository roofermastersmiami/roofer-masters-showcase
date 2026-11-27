import {
  useCallback,
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
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Download,
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
  RotateCw,
  ScanText,
  Upload,
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
  isPdfEncrypted,
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
  type SignaturePlacement,
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

/**
 * PDF Studio: an Acrobat-style workspace. One document stays open in the
 * central viewer (thumbnails, page navigation, zoom, rotate) while the
 * tools in the left rail operate on it. Every operation runs locally in
 * the browser; results can be downloaded to the computer, emailed, or
 * opened back in the studio to keep working.
 */

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
  { id: "edit", label: "Edit a PDF", blurb: "Add text on top of pages", icon: PenLine },
  { id: "create", label: "Create a PDF", blurb: "From text or photos", icon: FilePlus2 },
  { id: "combine", label: "Combine files", blurb: "Merge PDFs into one", icon: Files },
  {
    id: "organize",
    label: "Organize pages",
    blurb: "Reorder, delete, rotate, extract",
    icon: ListOrdered,
  },
  {
    id: "comments",
    label: "Add comments",
    blurb: "Numbered notes on pages",
    icon: MessageSquarePlus,
  },
  {
    id: "esign",
    label: "Request e-signatures",
    blurb: "Send documents to sign",
    icon: FileSignature,
  },
  { id: "ocr", label: "Scan & OCR", blurb: "Make scans searchable", icon: ScanText },
  { id: "protect", label: "Protect a PDF", blurb: "AES-256 password lock", icon: Lock },
  { id: "redact", label: "Redact a PDF", blurb: "Permanently remove content", icon: Eraser },
  { id: "compress", label: "Compress a PDF", blurb: "Shrink the file size", icon: Archive },
  { id: "form", label: "Prepare a form", blurb: "Add fillable fields", icon: ClipboardList },
  { id: "sign", label: "Fill & Sign", blurb: "Fill forms, add signature", icon: PenTool },
];

type StudioDoc = { bytes: Uint8Array; name: string };

type Interaction = {
  onPoint?: (x: number, y: number, pageIndex: number) => void;
  onRect?: (
    rect: { x: number; y: number; width: number; height: number },
    pageIndex: number,
  ) => void;
};

type PanelProps = {
  doc: StudioDoc | null;
  pageCount: number;
  pageIndex: number;
  thumbs: string[];
  onResult: (result: StudioDoc) => void;
  openDoc: (doc: StudioDoc) => void;
  registerInteraction: (interaction: Interaction | null) => void;
};

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

function EmailComposer({ result, defaultSubject }: { result: StudioDoc; defaultSubject?: string }) {
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
        <Input
          type="email"
          value={to}
          onChange={(event) => setTo(event.target.value)}
          placeholder="customer@email.com"
        />
      </Label>
      <Label>
        Subject
        <Input
          value={subject}
          onChange={(event) => setSubject(event.target.value)}
          placeholder="Your document from Roofer Masters"
        />
      </Label>
      <Label>
        Message
        <Textarea
          rows={4}
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder="Hi, attached is your document…"
        />
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
        Sends from the Roofer Masters mailbox. If email is not configured yet, the error message
        names the missing server settings.
      </p>
    </div>
  );
}

function ResultBar({
  result,
  onOpenInStudio,
}: {
  result: StudioDoc;
  onOpenInStudio: (doc: StudioDoc) => void;
}) {
  return (
    <div className="grid gap-2 rounded border border-primary/30 bg-primary/5 p-3">
      <span className="text-sm font-medium">
        {result.name} — {(result.bytes.length / 1024).toFixed(0)} KB ready
      </span>
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={() => downloadBytes(result.bytes, result.name)}>
          <Download className="mr-2 size-4" /> Download
        </Button>
        <Button type="button" variant="outline" onClick={() => onOpenInStudio(result)}>
          Open in studio
        </Button>
        <EmailComposer result={result} />
      </div>
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
  needsDoc,
  doc,
}: {
  children: ReactNode;
  error: string;
  needsDoc?: boolean;
  doc: StudioDoc | null;
}) {
  if (needsDoc && !doc)
    return (
      <p className="rounded border border-dashed p-4 text-sm text-muted-foreground">
        Open a PDF first — upload one from your computer or drag &amp; drop it anywhere on this page
        — then this tool works on it here in the studio.
      </p>
    );
  return (
    <div className="grid gap-3">
      {children}
      {error && (
        <p
          role="alert"
          className="rounded border border-destructive/40 bg-destructive/10 p-3 text-sm"
        >
          {error}
        </p>
      )}
    </div>
  );
}

/** Central document viewer: thumbnail rail + page view with zoom/rotate. */
function StudioViewer({
  doc,
  pageCount,
  pageIndex,
  onPageChange,
  thumbs,
  interaction,
}: {
  doc: StudioDoc | null;
  pageCount: number;
  pageIndex: number;
  onPageChange: (index: number) => void;
  thumbs: string[];
  interaction: Interaction | null;
}) {
  const [pagePreview, setPagePreview] = useState<{
    dataUrl: string;
    widthPt: number;
    heightPt: number;
  } | null>(null);
  const [zoom, setZoom] = useState<"fit" | number>("fit");
  const [rotation, setRotation] = useState(0);
  const dragStart = useRef<{ fx: number; fy: number } | null>(null);

  useEffect(() => {
    setRotation(0);
    setPagePreview(null);
  }, [doc]);

  useEffect(() => {
    if (!doc) return;
    let cancelled = false;
    renderPagePreview(doc.bytes, pageIndex, 1100)
      .then((result) => {
        if (!cancelled) setPagePreview(result);
      })
      .catch(() => {
        if (!cancelled) setPagePreview(null);
      });
    return () => {
      cancelled = true;
    };
  }, [doc, pageIndex]);

  if (!doc)
    return (
      <div className="grid min-h-[420px] place-items-center rounded border border-dashed bg-muted/30 p-8 text-center">
        <div className="max-w-sm">
          <Upload className="mx-auto mb-3 size-10 text-muted-foreground" />
          <p className="font-medium">Open a PDF to start</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Drag &amp; drop a PDF anywhere on this page, or use the Open button above. The document
            opens here and every tool works on it — nothing leaves your computer.
          </p>
        </div>
      </div>
    );

  const interactive = Boolean(interaction && (interaction.onPoint || interaction.onRect));
  const toPdf = (event: ReactMouseEvent<HTMLImageElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const fx = (event.clientX - rect.left) / rect.width;
    const fy = (event.clientY - rect.top) / rect.height;
    return {
      fx,
      fy,
      x: fx * (pagePreview?.widthPt ?? 0),
      y: (pagePreview?.heightPt ?? 0) - fy * (pagePreview?.heightPt ?? 0),
    };
  };

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pageIndex === 0}
          onClick={() => onPageChange(pageIndex - 1)}
          aria-label="Previous page"
        >
          <ChevronLeft className="size-4" />
        </Button>
        <span className="text-sm">
          Page {pageCount === 0 ? 0 : pageIndex + 1} of {pageCount}
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pageIndex >= pageCount - 1}
          onClick={() => onPageChange(pageIndex + 1)}
          aria-label="Next page"
        >
          <ChevronRight className="size-4" />
        </Button>
        <select
          className="h-8 rounded border bg-background px-2 text-sm"
          value={zoom === "fit" ? "fit" : String(zoom)}
          onChange={(event) =>
            setZoom(event.target.value === "fit" ? "fit" : Number(event.target.value))
          }
          aria-label="Zoom"
        >
          <option value="fit">Fit width</option>
          <option value="50">50%</option>
          <option value="75">75%</option>
          <option value="100">100%</option>
          <option value="125">125%</option>
          <option value="150">150%</option>
          <option value="200">200%</option>
        </select>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setRotation((current) => (current + 90) % 360)}
        >
          <RotateCw className="mr-1 size-4" /> Rotate view
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => downloadBytes(doc.bytes, doc.name)}
        >
          <Download className="mr-1 size-4" /> Download
        </Button>
        {interactive && (
          <span className="text-xs font-medium text-primary">
            Click or drag on the page — the open tool is listening
            {rotation !== 0 ? " (rotate the view back to 0° to place precisely)" : ""}
          </span>
        )}
      </div>
      <div className="flex gap-2">
        {pageCount > 1 && (
          <div className="grid max-h-[70vh] w-24 shrink-0 gap-2 overflow-y-auto pr-1">
            {thumbs.map((thumb, index) => (
              <button
                key={index}
                type="button"
                onClick={() => onPageChange(index)}
                className={`rounded border p-1 ${
                  index === pageIndex ? "border-primary bg-primary/5" : "hover:bg-muted/50"
                }`}
              >
                <img src={thumb} alt={`Page ${index + 1}`} className="w-full rounded-sm bg-white" />
                <span className="mt-1 block text-center text-[11px] text-muted-foreground">
                  {index + 1}
                </span>
              </button>
            ))}
          </div>
        )}
        <div className="max-h-[70vh] flex-1 overflow-auto rounded border bg-muted/40 p-3">
          {pagePreview ? (
            <img
              src={pagePreview.dataUrl}
              alt={`Page ${pageIndex + 1} of ${doc.name}`}
              className={`mx-auto rounded bg-white shadow ${
                interactive && rotation === 0 ? "cursor-crosshair" : ""
              }`}
              style={{
                width: zoom === "fit" ? "100%" : `${zoom}%`,
                transform: rotation ? `rotate(${rotation}deg)` : undefined,
              }}
              draggable={false}
              onMouseDown={(event) => {
                if (!interactive || rotation !== 0) return;
                const point = toPdf(event);
                dragStart.current = { fx: point.fx, fy: point.fy };
              }}
              onMouseUp={(event) => {
                if (!interactive || rotation !== 0 || !pagePreview) return;
                const end = toPdf(event);
                const start = dragStart.current;
                dragStart.current = null;
                if (
                  interaction?.onRect &&
                  start &&
                  (Math.abs(end.fx - start.fx) > 0.02 || Math.abs(end.fy - start.fy) > 0.02)
                ) {
                  const x = Math.min(start.fx, end.fx) * pagePreview.widthPt;
                  const topFy = Math.min(start.fy, end.fy);
                  const width = Math.abs(end.fx - start.fx) * pagePreview.widthPt;
                  const height = Math.abs(end.fy - start.fy) * pagePreview.heightPt;
                  interaction.onRect(
                    {
                      x,
                      y: pagePreview.heightPt - topFy * pagePreview.heightPt - height,
                      width,
                      height,
                    },
                    pageIndex,
                  );
                } else if (interaction?.onPoint) {
                  interaction.onPoint(end.x, end.y, pageIndex);
                }
              }}
            />
          ) : (
            <p className="py-16 text-center text-sm text-muted-foreground">Rendering page…</p>
          )}
        </div>
      </div>
    </div>
  );
}

function ExportPanel({ doc }: PanelProps) {
  const { busy, error, run } = useRun();
  const [note, setNote] = useState("");
  const [text, setText] = useState("");
  return (
    <PanelShell error={error} needsDoc doc={doc}>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          disabled={!doc || busy}
          onClick={() =>
            run(async () => {
              const images = await exportPdfToImages(doc!.bytes, "png");
              images.forEach((blob, index) =>
                downloadBlob(blob, `${baseName(doc!.name)}-page-${index + 1}.png`),
              );
              setNote(`Exported ${images.length} PNG image(s) — check your downloads.`);
            })
          }
        >
          Export pages as PNG
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={!doc || busy}
          onClick={() =>
            run(async () => {
              const images = await exportPdfToImages(doc!.bytes, "jpeg");
              images.forEach((blob, index) =>
                downloadBlob(blob, `${baseName(doc!.name)}-page-${index + 1}.jpg`),
              );
              setNote(`Exported ${images.length} JPG image(s) — check your downloads.`);
            })
          }
        >
          Export pages as JPG
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={!doc || busy}
          onClick={() =>
            run(async () => {
              const extracted = await exportPdfToText(doc!.bytes);
              setText(extracted);
              downloadBytes(
                new TextEncoder().encode(extracted),
                `${baseName(doc!.name)}.txt`,
                "text/plain",
              );
              setNote(
                "Exported the text already inside the PDF. For scanned pages with no text, use Scan & OCR.",
              );
            })
          }
        >
          Export text
        </Button>
      </div>
      {note && <p className="text-sm text-muted-foreground">{note}</p>}
      {text && (
        <Label>
          Extracted text (also downloaded as a .txt file)
          <Textarea rows={10} readOnly value={text} />
        </Label>
      )}
    </PanelShell>
  );
}

function EditPanel({ doc, pageIndex, onResult, registerInteraction }: PanelProps) {
  const { busy, error, run } = useRun();
  const [edits, setEdits] = useState<PdfTextEdit[]>([]);
  const [text, setText] = useState("");
  const [size, setSize] = useState("12");
  const [cover, setCover] = useState(false);
  const [pending, setPending] = useState<{ x: number; y: number; page: number } | null>(null);
  useEffect(() => {
    registerInteraction({
      onPoint: (x, y, page) => setPending({ x, y, page }),
    });
    return () => registerInteraction(null);
  }, [registerInteraction]);
  useEffect(() => {
    setEdits([]);
    setPending(null);
  }, [doc]);
  return (
    <PanelShell error={error} needsDoc doc={doc}>
      <p className="text-sm text-muted-foreground">
        Click on the page in the viewer where the text should go, type it, then add it. Edit adds
        new text on top of the page (with an optional white cover box) — it does not rewrite the
        text already in the file. Use Redact when content must be permanently removed.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <Label className="grow">
          Text to add
          {pending
            ? ` — page ${pending.page + 1} at (${pending.x.toFixed(0)}, ${pending.y.toFixed(0)})`
            : " — click the page first"}
          <Input
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Click the page, then type…"
          />
        </Label>
        <Label>
          Size
          <Input
            type="number"
            className="w-20"
            value={size}
            onChange={(event) => setSize(event.target.value)}
          />
        </Label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={cover}
            onChange={(event) => setCover(event.target.checked)}
          />
          Cover what's underneath
        </label>
        <Button
          type="button"
          variant="outline"
          disabled={!pending || !text.trim()}
          onClick={() => {
            const fontSize = Math.min(48, Math.max(6, Number(size) || 12));
            const edit: PdfTextEdit = {
              page: pending!.page,
              x: pending!.x,
              y: pending!.y,
              text: text.trim(),
              size: fontSize,
            };
            if (cover) {
              edit.whiteout = {
                width: text.trim().length * fontSize * 0.55 + 6,
                height: fontSize * 1.5,
              };
            }
            setEdits((current) => [...current, edit]);
            setText("");
          }}
        >
          Add text
        </Button>
      </div>
      {edits.length > 0 && (
        <p className="text-sm text-muted-foreground">
          {edits.length} edit(s) queued:{" "}
          {edits.map((edit) => `"${edit.text}" (p.${edit.page + 1})`).join(", ")}
        </p>
      )}
      <div className="flex gap-2">
        <Button
          type="button"
          disabled={busy || edits.length === 0}
          onClick={() =>
            run(async () => {
              const bytes = await editPdfText(doc!.bytes, edits);
              onResult({ bytes, name: `${baseName(doc!.name)}-edited.pdf` });
            })
          }
        >
          Apply edits
        </Button>
        <span className="self-center text-xs text-muted-foreground">
          Currently viewing page {pageIndex + 1}
        </span>
      </div>
    </PanelShell>
  );
}

function CreatePanel({ onResult }: PanelProps) {
  const { busy, error, run } = useRun();
  const [mode, setMode] = useState<"text" | "images">("text");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [images, setImages] = useState<
    Array<{ bytes: Uint8Array; kind: "png" | "jpg"; name: string }>
  >([]);
  return (
    <PanelShell error={error} doc={null}>
      <div className="flex gap-2">
        <Button
          type="button"
          variant={mode === "text" ? "default" : "outline"}
          onClick={() => setMode("text")}
        >
          From text
        </Button>
        <Button
          type="button"
          variant={mode === "images" ? "default" : "outline"}
          onClick={() => setMode("images")}
        >
          From photos / images
        </Button>
      </div>
      {mode === "text" ? (
        <div className="grid gap-2">
          <Label>
            Title
            <Input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Document title"
            />
          </Label>
          <Label>
            Text
            <Textarea
              rows={10}
              value={body}
              onChange={(event) => setBody(event.target.value)}
              placeholder="Type or paste the document text…"
            />
          </Label>
          <Button
            type="button"
            disabled={busy || !body.trim()}
            onClick={() =>
              run(async () => {
                const bytes = await createPdfFromText(title, body);
                onResult({ bytes, name: `${title.trim() || "document"}.pdf` });
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
                onResult({ bytes, name: "images.pdf" });
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

function CombinePanel({ onResult }: PanelProps) {
  const { busy, error, run } = useRun();
  const [files, setFiles] = useState<StudioDoc[]>([]);
  return (
    <PanelShell error={error} doc={null}>
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
            onResult({ bytes, name: "combined.pdf" });
          })
        }
      >
        Combine into one PDF
      </Button>
    </PanelShell>
  );
}

function OrganizePanel({ doc, pageCount, thumbs, onResult }: PanelProps) {
  const { busy, error, run } = useRun();
  const [order, setOrder] = useState<number[]>([]);
  const [rotations, setRotations] = useState<Record<number, number>>({});
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  useEffect(() => {
    setOrder(Array.from({ length: pageCount }, (_, i) => i));
    setRotations({});
  }, [doc, pageCount]);
  return (
    <PanelShell error={error} needsDoc doc={doc}>
      <p className="text-sm text-muted-foreground">
        Drag pages to reorder them. Use the buttons on a page to rotate it, pull it out as its own
        PDF, or delete it. Then apply the new order.
      </p>
      {doc && order.length > 0 && (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {order.map((sourceIndex, position) => (
            <div
              key={`${sourceIndex}-${position}`}
              draggable
              onDragStart={() => setDragIndex(position)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => {
                if (dragIndex === null || dragIndex === position) return;
                setOrder((current) => {
                  const next = [...current];
                  const [moved] = next.splice(dragIndex, 1);
                  next.splice(position, 0, moved!);
                  return next;
                });
                setDragIndex(null);
              }}
              className="grid gap-1 rounded border bg-background p-2"
            >
              {thumbs[sourceIndex] ? (
                <img
                  src={thumbs[sourceIndex]}
                  alt={`Page ${sourceIndex + 1}`}
                  className="w-full rounded-sm bg-white"
                  style={{
                    transform: rotations[sourceIndex]
                      ? `rotate(${rotations[sourceIndex]}deg)`
                      : undefined,
                  }}
                />
              ) : (
                <div className="grid aspect-[3/4] place-items-center rounded-sm bg-muted text-xs">
                  Page {sourceIndex + 1}
                </div>
              )}
              <span className="text-center text-xs text-muted-foreground">
                New p.{position + 1} · was p.{sourceIndex + 1}
                {rotations[sourceIndex] ? ` · ${rotations[sourceIndex]}°` : ""}
              </span>
              <div className="flex justify-center gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setRotations((current) => ({
                      ...current,
                      [sourceIndex]: ((current[sourceIndex] ?? 0) + 90) % 360,
                    }))
                  }
                >
                  Rotate
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    run(async () => {
                      const bytes = await organizePages(doc.bytes, [sourceIndex]);
                      downloadBytes(bytes, `${baseName(doc.name)}-page-${sourceIndex + 1}.pdf`);
                    })
                  }
                >
                  Extract
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={order.length <= 1}
                  onClick={() => setOrder((current) => current.filter((_, i) => i !== position))}
                >
                  Delete
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
      <Button
        type="button"
        disabled={busy || !doc || order.length === 0}
        onClick={() =>
          run(async () => {
            const bytes = await organizePages(doc!.bytes, order, rotations);
            onResult({ bytes, name: `${baseName(doc!.name)}-organized.pdf` });
          })
        }
      >
        Apply page order
      </Button>
    </PanelShell>
  );
}

function CommentsPanel({ doc, onResult, registerInteraction }: PanelProps) {
  const { busy, error, run } = useRun();
  const [comments, setComments] = useState<PdfComment[]>([]);
  const [text, setText] = useState("");
  const [pending, setPending] = useState<{ x: number; y: number; page: number } | null>(null);
  useEffect(() => {
    registerInteraction({ onPoint: (x, y, page) => setPending({ x, y, page }) });
    return () => registerInteraction(null);
  }, [registerInteraction]);
  useEffect(() => {
    setComments([]);
    setPending(null);
  }, [doc]);
  return (
    <PanelShell error={error} needsDoc doc={doc}>
      <p className="text-sm text-muted-foreground">
        Click in the viewer where the note belongs, write the comment, and add it. Each comment
        becomes a numbered yellow marker on the page plus a comments page at the end, so the notes
        are visible in any PDF viewer.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <Label className="grow">
          Comment{pending ? ` — page ${pending.page + 1}` : " — click the page first"}
          <Input
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Click the page, then write the note…"
          />
        </Label>
        <Button
          type="button"
          variant="outline"
          disabled={!pending || !text.trim()}
          onClick={() => {
            setComments((current) => [
              ...current,
              {
                page: pending!.page,
                x: pending!.x,
                y: pending!.y,
                text: text.trim(),
                author: "Roofer Masters",
              },
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
            const bytes = await addComments(doc!.bytes, comments);
            onResult({ bytes, name: `${baseName(doc!.name)}-commented.pdf` });
          })
        }
      >
        Add comments to PDF
      </Button>
    </PanelShell>
  );
}

function EsignPanel({ doc }: PanelProps) {
  const { openProposals } = useCrm();
  return (
    <div className="grid gap-3">
      <p className="text-sm text-muted-foreground">
        For a tracked signature with a signing record, send the proposal from Estimates &amp;
        proposals — the customer signs through a secure link and the signed PDF is stored on the
        job. To simply email the open PDF with a signature request, use the button below.
      </p>
      <div>
        <Button type="button" onClick={() => openProposals()}>
          Open Estimates &amp; proposals
        </Button>
      </div>
      {doc ? (
        <EmailComposer result={doc} defaultSubject="Please review and sign — Roofer Masters" />
      ) : (
        <p className="text-sm text-muted-foreground">
          Open a PDF in the studio to email it from here.
        </p>
      )}
    </div>
  );
}

function OcrPanel({ doc, onResult, openDoc }: PanelProps) {
  const { busy, error, run } = useRun();
  const [progress, setProgress] = useState("");
  const [text, setText] = useState("");
  return (
    <PanelShell error={error} doc={doc}>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          disabled={busy || !doc}
          onClick={() =>
            run(async () => {
              const outcome = await ocrPdfToSearchable(doc!.bytes, {
                onProgress: (page, total) => setProgress(`Reading page ${page} of ${total}…`),
              });
              setProgress("");
              setText(outcome.text);
              onResult({ bytes: outcome.bytes, name: `${baseName(doc!.name)}-searchable.pdf` });
            })
          }
        >
          {busy ? progress || "Running OCR…" : "Run OCR on the open PDF"}
        </Button>
        <span className="text-sm text-muted-foreground">or start from a photo of a document:</span>
        <Input
          type="file"
          accept="image/png,image/jpeg"
          className="max-w-xs"
          onChange={async (event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            const bytes = await fileBytes(file);
            const kind = file.name.toLowerCase().endsWith(".png") ? "png" : "jpg";
            const pdfBytes = await createPdfFromImages([{ bytes, kind }]);
            openDoc({ bytes: pdfBytes, name: `${baseName(file.name)}.pdf` });
            toast.success("Photo opened as a PDF — now run OCR on it.");
          }}
        />
      </div>
      <p className="text-sm text-muted-foreground">
        Works on scanned PDFs and photos of documents. Recognition runs in your browser (free); the
        first run downloads the English language pack. The result keeps the page images and adds an
        invisible text layer, so the PDF becomes searchable and copyable.
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

function ProtectPanel({ doc, onResult }: PanelProps) {
  const { busy, error, run } = useRun();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [encrypted, setEncrypted] = useState<boolean | null>(null);
  useEffect(() => {
    setEncrypted(null);
    if (!doc) return;
    let cancelled = false;
    isPdfEncrypted(doc.bytes)
      .then((value) => {
        if (!cancelled) setEncrypted(value);
      })
      .catch(() => {
        if (!cancelled) setEncrypted(null);
      });
    return () => {
      cancelled = true;
    };
  }, [doc]);
  return (
    <PanelShell error={error} needsDoc doc={doc}>
      {encrypted !== null && (
        <p className="text-sm text-muted-foreground">
          The open PDF is {encrypted ? "already password-protected." : "not password-protected."}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Label>
          Password to open
          <Input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </Label>
        <Label>
          Confirm password
          <Input
            type="password"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
          />
        </Label>
      </div>
      <Button
        type="button"
        disabled={busy || !doc || !password || password !== confirm}
        onClick={() =>
          run(async () => {
            const bytes = await protectPdf(doc!.bytes, password);
            onResult({ bytes, name: `${baseName(doc!.name)}-protected.pdf` });
          })
        }
      >
        Protect with AES-256 password
      </Button>
      <p className="text-sm text-muted-foreground">
        Real AES-256 encryption: the file cannot be opened without the password, and copying and
        editing are disabled. Keep the password somewhere safe — it cannot be recovered from the
        file.
      </p>
    </PanelShell>
  );
}

function RedactPanel({ doc, onResult, registerInteraction }: PanelProps) {
  const { busy, error, run } = useRun();
  const [rects, setRects] = useState<RedactionRect[]>([]);
  useEffect(() => {
    registerInteraction({
      onRect: (rect, page) => setRects((current) => [...current, { page, ...rect }]),
    });
    return () => registerInteraction(null);
  }, [registerInteraction]);
  useEffect(() => {
    setRects([]);
  }, [doc]);
  return (
    <PanelShell error={error} needsDoc doc={doc}>
      <p className="text-sm text-muted-foreground">
        Drag a box in the viewer over anything that must be removed — a price, an address, a
        signature. Repeat on any page, then redact.
      </p>
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
            const bytes = await rasterizePdf(doc!.bytes, {
              dpi: 200,
              quality: 0.9,
              redactions: rects,
            });
            onResult({ bytes, name: `${baseName(doc!.name)}-redacted.pdf` });
          })
        }
      >
        Redact permanently
      </Button>
      <p className="text-sm text-muted-foreground">
        Redaction rebuilds every page as an image with the boxes burned in — the covered content is
        gone from the file, not just hidden. Text in the result is no longer selectable.
      </p>
    </PanelShell>
  );
}

function CompressPanel({ doc, onResult }: PanelProps) {
  const { busy, error, run } = useRun();
  return (
    <PanelShell error={error} needsDoc doc={doc}>
      {doc && (
        <p className="text-sm text-muted-foreground">
          Current size: {(doc.bytes.length / 1024).toFixed(0)} KB
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          disabled={busy || !doc}
          onClick={() =>
            run(async () => {
              const bytes = await rasterizePdf(doc!.bytes, { dpi: 150, quality: 0.8 });
              onResult({ bytes, name: `${baseName(doc!.name)}-compressed.pdf` });
            })
          }
        >
          Strong compression (150 dpi images)
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={busy || !doc}
          onClick={() =>
            run(async () => {
              const bytes = await rasterizePdf(doc!.bytes, { dpi: 100, quality: 0.7 });
              onResult({ bytes, name: `${baseName(doc!.name)}-smallest.pdf` });
            })
          }
        >
          Smallest size (100 dpi)
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={busy || !doc}
          onClick={() =>
            run(async () => {
              const bytes = await compressPdfLossless(doc!.bytes);
              onResult({ bytes, name: `${baseName(doc!.name)}-optimized.pdf` });
            })
          }
        >
          Lossless (keeps selectable text)
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        Image modes rebuild pages as photos — best for scanned or photo-heavy PDFs, and the file
        usually gets much smaller. Lossless keeps the original text and vector content and only
        rebuilds the file structure, so the savings are smaller.
      </p>
    </PanelShell>
  );
}

function FormPanel({ doc, onResult, registerInteraction }: PanelProps) {
  const { busy, error, run } = useRun();
  const [fields, setFields] = useState<FormFieldSpec[]>([]);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<FormFieldSpec["kind"]>("text");
  const [pending, setPending] = useState<{ x: number; y: number; page: number } | null>(null);
  useEffect(() => {
    registerInteraction({ onPoint: (x, y, page) => setPending({ x, y, page }) });
    return () => registerInteraction(null);
  }, [registerInteraction]);
  useEffect(() => {
    setFields([]);
    setPending(null);
  }, [doc]);
  return (
    <PanelShell error={error} needsDoc doc={doc}>
      <p className="text-sm text-muted-foreground">
        Click in the viewer where a fillable field should start, name it, and add it.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <Label>
          Field name
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. Customer name"
          />
        </Label>
        <Label>
          Type
          <select
            className="h-9 rounded border bg-background px-2"
            value={kind}
            onChange={(event) => setKind(event.target.value as FormFieldSpec["kind"])}
          >
            <option value="text">Text</option>
            <option value="checkbox">Checkbox</option>
            <option value="dropdown">Dropdown</option>
          </select>
        </Label>
        <Button
          type="button"
          variant="outline"
          disabled={!pending || !name.trim()}
          onClick={() => {
            const spec: FormFieldSpec = {
              page: pending!.page,
              x: pending!.x,
              y: pending!.y,
              width: kind === "checkbox" ? 14 : 220,
              height: kind === "checkbox" ? 14 : 18,
              name: name.trim(),
              kind,
            };
            if (kind === "dropdown") spec.options = ["Yes", "No"];
            setFields((current) => [...current, spec]);
            setName("");
          }}
        >
          Add field{pending ? ` (page ${pending.page + 1})` : ""}
        </Button>
      </div>
      {fields.length > 0 && (
        <p className="text-sm text-muted-foreground">
          Fields:{" "}
          {fields.map((field) => `${field.name} (${field.kind}, p.${field.page + 1})`).join(", ")}
        </p>
      )}
      <Button
        type="button"
        disabled={busy || fields.length === 0}
        onClick={() =>
          run(async () => {
            const bytes = await prepareForm(doc!.bytes, fields);
            onResult({ bytes, name: `${baseName(doc!.name)}-form.pdf` });
          })
        }
      >
        Prepare form
      </Button>
    </PanelShell>
  );
}

function SignPanel({ doc, onResult, registerInteraction }: PanelProps) {
  const { busy, error, run } = useRun();
  const [fields, setFields] = useState<FormFieldInfo[]>([]);
  const [values, setValues] = useState<Record<string, string | boolean>>({});
  const [printedName, setPrintedName] = useState("");
  const [signPoint, setSignPoint] = useState<{ x: number; y: number; page: number } | null>(null);
  const signaturePad = useRef<SignatureCanvas>(null);
  useEffect(() => {
    registerInteraction({
      onPoint: (x, y, page) => setSignPoint({ x, y, page }),
    });
    return () => registerInteraction(null);
  }, [registerInteraction]);
  useEffect(() => {
    if (!doc) {
      setFields([]);
      return;
    }
    setSignPoint(null);
    setValues({});
    listFormFields(doc.bytes)
      .then(setFields)
      .catch(() => setFields([]));
  }, [doc]);
  return (
    <PanelShell error={error} needsDoc doc={doc}>
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
                  onChange={(event) =>
                    setValues((current) => ({ ...current, [field.name]: event.target.checked }))
                  }
                />
              ) : (
                <Input
                  value={
                    typeof values[field.name] === "string" ? (values[field.name] as string) : ""
                  }
                  onChange={(event) =>
                    setValues((current) => ({ ...current, [field.name]: event.target.value }))
                  }
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
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => signaturePad.current?.clear()}
          >
            Clear signature
          </Button>
        </div>
        <Label>
          Printed name (optional)
          <Input
            value={printedName}
            onChange={(event) => setPrintedName(event.target.value)}
            className="max-w-sm"
          />
        </Label>
      </div>
      <p className="text-sm text-muted-foreground">
        Click in the viewer where the signature should be stamped
        {signPoint ? ` — page ${signPoint.page + 1} selected` : ""}.
      </p>
      <Button
        type="button"
        disabled={busy || !doc}
        onClick={() =>
          run(async () => {
            let bytes = doc!.bytes;
            const filledValues = Object.fromEntries(
              Object.entries(values).filter(([, value]) => value !== "" && value !== undefined),
            );
            if (fields.length && Object.keys(filledValues).length) {
              bytes = await fillForm(bytes, filledValues, false);
            }
            if (signPoint) {
              if (signaturePad.current?.isEmpty()) throw new Error("Draw your signature first.");
              const canvas = signaturePad.current?.getTrimmedCanvas();
              if (!canvas) throw new Error("Draw your signature first.");
              const signatureBlob = await new Promise<Blob>((resolve, reject) =>
                canvas.toBlob(
                  (blob) => (blob ? resolve(blob) : reject(new Error("Signature capture failed"))),
                  "image/png",
                ),
              );
              const signatureBytes = new Uint8Array(await signatureBlob.arrayBuffer());
              const placement: SignaturePlacement = {
                page: signPoint.page,
                x: signPoint.x,
                y: signPoint.y,
                width: 170,
                dateText: new Date().toLocaleDateString("en-US", {
                  month: "long",
                  day: "numeric",
                  year: "numeric",
                }),
              };
              if (printedName.trim()) placement.printedName = printedName.trim();
              bytes = await signPdf(bytes, signatureBytes, placement);
            }
            if (bytes === doc!.bytes) throw new Error("Fill a field or place a signature first.");
            onResult({ bytes, name: `${baseName(doc!.name)}-signed.pdf` });
          })
        }
      >
        Fill &amp; sign
      </Button>
    </PanelShell>
  );
}

export function PdfStudio() {
  const [tool, setTool] = useState<ToolId>("create");
  const [doc, setDoc] = useState<StudioDoc | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [pageIndex, setPageIndex] = useState(0);
  const [thumbs, setThumbs] = useState<string[]>([]);
  const [result, setResult] = useState<StudioDoc | null>(null);
  const [interaction, setInteraction] = useState<Interaction | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const registerInteraction = useCallback((next: Interaction | null) => {
    setInteraction(next);
  }, []);

  const openDoc = useCallback((next: StudioDoc) => {
    setDoc(next);
    setResult(null);
    setPageIndex(0);
  }, []);

  useEffect(() => {
    setInteraction(null);
  }, [tool]);

  useEffect(() => {
    let cancelled = false;
    if (!doc) {
      setPageCount(0);
      setThumbs([]);
      return;
    }
    pdfPageCount(doc.bytes)
      .then(async (count) => {
        if (cancelled) return;
        setPageCount(count);
        const rendered: string[] = [];
        for (let index = 0; index < count; index++) {
          const preview = await renderPagePreview(doc.bytes, index, 160);
          rendered.push(preview.dataUrl);
          if (cancelled) return;
        }
        setThumbs(rendered);
      })
      .catch(() => {
        if (!cancelled) {
          setPageCount(0);
          setThumbs([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [doc]);

  const active = TOOLS.find((item) => item.id === tool) ?? TOOLS[0]!;
  const panelProps: PanelProps = {
    doc,
    pageCount,
    pageIndex,
    thumbs,
    onResult: setResult,
    openDoc,
    registerInteraction,
  };

  return (
    <div
      className={`grid gap-4 ${dragOver ? "rounded outline-2 outline-dashed outline-primary" : ""}`}
      onDragOver={(event) => {
        event.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={async (event) => {
        event.preventDefault();
        setDragOver(false);
        const file = event.dataTransfer.files?.[0];
        if (file && file.name.toLowerCase().endsWith(".pdf")) {
          openDoc({ bytes: await fileBytes(file), name: file.name });
        } else if (file) {
          toast.error("Drop a PDF file to open it in the studio.");
        }
      }}
    >
      <div className="flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <h2 className="text-lg font-semibold">PDF Studio</h2>
          <p className="text-sm text-muted-foreground">
            Every Acrobat-style tool, free — the work happens in your browser, so documents never
            leave your computer except when you email them.
          </p>
        </div>
        <input
          ref={fileInput}
          type="file"
          accept="application/pdf"
          className="hidden"
          onChange={async (event) => {
            const file = event.target.files?.[0];
            if (file) openDoc({ bytes: await fileBytes(file), name: file.name });
            event.target.value = "";
          }}
        />
        <Button type="button" onClick={() => fileInput.current?.click()}>
          <Upload className="mr-2 size-4" /> Open a PDF
        </Button>
        {doc && (
          <span className="text-sm text-muted-foreground">
            {doc.name} · {(doc.bytes.length / 1024).toFixed(0)} KB · {pageCount} page
            {pageCount === 1 ? "" : "s"}
          </span>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
        <div className="grid content-start gap-1">
          {TOOLS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTool(item.id)}
              className={`grid gap-0.5 rounded border p-2.5 text-left transition-colors ${
                tool === item.id ? "border-primary bg-primary/5" : "hover:bg-muted/50"
              }`}
            >
              <span className="flex items-center gap-2 text-sm font-medium">
                <item.icon className="size-4 shrink-0 text-primary" /> {item.label}
              </span>
              <span className="pl-6 text-xs text-muted-foreground">{item.blurb}</span>
            </button>
          ))}
        </div>

        <div className="grid content-start gap-4">
          <StudioViewer
            doc={doc}
            pageCount={pageCount}
            pageIndex={pageIndex}
            onPageChange={setPageIndex}
            thumbs={thumbs}
            interaction={interaction}
          />
          <div className="rounded border p-4">
            <h3 className="mb-3 font-medium">{active.label}</h3>
            {result && (
              <div className="mb-3">
                <ResultBar result={result} onOpenInStudio={openDoc} />
              </div>
            )}
            {tool === "export" && <ExportPanel {...panelProps} />}
            {tool === "edit" && <EditPanel {...panelProps} />}
            {tool === "create" && <CreatePanel {...panelProps} />}
            {tool === "combine" && <CombinePanel {...panelProps} />}
            {tool === "organize" && <OrganizePanel {...panelProps} />}
            {tool === "comments" && <CommentsPanel {...panelProps} />}
            {tool === "esign" && <EsignPanel {...panelProps} />}
            {tool === "ocr" && <OcrPanel {...panelProps} />}
            {tool === "protect" && <ProtectPanel {...panelProps} />}
            {tool === "redact" && <RedactPanel {...panelProps} />}
            {tool === "compress" && <CompressPanel {...panelProps} />}
            {tool === "form" && <FormPanel {...panelProps} />}
            {tool === "sign" && <SignPanel {...panelProps} />}
          </div>
        </div>
      </div>
    </div>
  );
}
