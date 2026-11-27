import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  CalendarDays,
  CaseSensitive,
  CheckSquare,
  Copy,
  Download,
  Eraser,
  FileSignature,
  Link2,
  Loader2,
  Mail,
  PenTool,
  Send,
  Signature,
  Trash2,
  Type,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { pdfPageCount } from "@/lib/pdf-tools";
import { renderPagePreview } from "@/lib/pdf-tools-browser";
import { sendCrmEmail } from "@/lib/crm-email.functions";
import {
  createSignatureRequest,
  getSignatureRequestDownload,
  listSignatureRequests,
  revokeSignatureRequest,
} from "@/lib/pdf-signature.functions";
import {
  FIELD_DEFAULT_SIZE,
  FIELD_LABELS,
  clampFieldToPage,
  displayRectToPdf,
  fractionToPdfPoint,
  type SignatureField,
  type SignatureFieldType,
} from "@/lib/pdf-signature-fields";

type SourceFile = { bytes: Uint8Array; name: string };
type PagePreviewData = { dataUrl: string; widthPt: number; heightPt: number };
type RequestSummary = Awaited<ReturnType<typeof listSignatureRequests>>[number];

const PALETTE: Array<{ type: SignatureFieldType; icon: typeof Signature }> = [
  { type: "signature", icon: Signature },
  { type: "initials", icon: PenTool },
  { type: "name", icon: CaseSensitive },
  { type: "date", icon: CalendarDays },
  { type: "text", icon: Type },
  { type: "checkbox", icon: CheckSquare },
];

const FIELD_STYLES: Record<SignatureFieldType, string> = {
  signature: "border-blue-600 bg-blue-500/15 text-blue-900",
  initials: "border-violet-600 bg-violet-500/15 text-violet-900",
  name: "border-teal-600 bg-teal-500/15 text-teal-900",
  date: "border-amber-600 bg-amber-500/15 text-amber-900",
  text: "border-slate-500 bg-slate-400/15 text-slate-800",
  checkbox: "border-green-600 bg-green-500/15 text-green-900",
};

const SIGNER_BADGES = ["bg-blue-600", "bg-rose-600"];

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function signingLink(token: string): string {
  return `${window.location.origin}/sign/${token}`;
}

type DragState =
  | { mode: "place"; startFx: number; startFy: number }
  | {
      mode: "move" | "resize";
      fieldId: string;
      startFx: number;
      startFy: number;
      original: { x: number; y: number; width: number; height: number };
    };

function FieldPage({
  preview,
  pageIndex,
  fields,
  selectedId,
  armedType,
  onPlace,
  onSelect,
  onChange,
}: {
  preview: PagePreviewData;
  pageIndex: number;
  fields: SignatureField[];
  selectedId: string | null;
  armedType: SignatureFieldType | null;
  onPlace: (field: SignatureField, pageIndex: number) => void;
  onSelect: (id: string | null) => void;
  onChange: (id: string, patch: Partial<SignatureField>) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const drag = useRef<DragState | null>(null);
  const [draft, setDraft] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);

  const fractions = (event: ReactPointerEvent) => {
    const rect = containerRef.current!.getBoundingClientRect();
    return {
      fx: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      fy: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
      scale: rect.width / preview.widthPt,
      rect,
    };
  };

  const handlePointerDown = (event: ReactPointerEvent) => {
    if (!armedType) return;
    const { fx, fy } = fractions(event);
    drag.current = { mode: "place", startFx: fx, startFy: fy };
    (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
  };

  const handlePointerMove = (event: ReactPointerEvent) => {
    const state = drag.current;
    if (!state) return;
    const { fx, fy, scale, rect } = fractions(event);
    if (state.mode === "place") {
      setDraft({
        left: Math.min(state.startFx, fx) * rect.width,
        top: Math.min(state.startFy, fy) * rect.height,
        width: Math.abs(fx - state.startFx) * rect.width,
        height: Math.abs(fy - state.startFy) * rect.height,
      });
      return;
    }
    const field = fields.find((item) => item.id === state.fieldId);
    if (!field) return;
    const dxPt = ((fx - state.startFx) * rect.width) / scale;
    const dyPt = -((fy - state.startFy) * rect.height) / scale;
    if (state.mode === "move") {
      const moved = clampFieldToPage(
        { ...state.original, x: state.original.x + dxPt, y: state.original.y + dyPt },
        preview,
      );
      onChange(state.fieldId, moved);
    } else {
      const resized = clampFieldToPage(
        {
          x: state.original.x,
          y: state.original.y + dyPt,
          width: state.original.width + dxPt,
          height: state.original.height - dyPt,
        },
        preview,
      );
      onChange(state.fieldId, resized);
    }
  };

  const handlePointerUp = (event: ReactPointerEvent) => {
    const state = drag.current;
    drag.current = null;
    if (!state || state.mode !== "place" || !armedType) {
      setDraft(null);
      return;
    }
    const { fx, fy, scale } = fractions(event);
    const draggedPdf = displayRectToPdf(
      {
        left: Math.min(state.startFx, fx) * preview.widthPt * scale,
        top: Math.min(state.startFy, fy) * preview.heightPt * scale,
        width: Math.abs(fx - state.startFx) * preview.widthPt * scale,
        height: Math.abs(fy - state.startFy) * preview.heightPt * scale,
      },
      preview,
      scale,
    );
    const fallback = FIELD_DEFAULT_SIZE[armedType];
    const anchor = fractionToPdfPoint(state.startFx, state.startFy, preview);
    const box =
      draggedPdf.width >= 16 && draggedPdf.height >= 14
        ? draggedPdf
        : {
            x: anchor.x,
            y: anchor.y - fallback.height,
            width: fallback.width,
            height: fallback.height,
          };
    const clamped = clampFieldToPage(box, preview);
    onPlace(
      {
        id: crypto.randomUUID(),
        type: armedType,
        page: pageIndex,
        ...clamped,
        signerIndex: 0, // patched by the parent with the active signer
        required: armedType !== "text",
        label: FIELD_LABELS[armedType],
      },
      pageIndex,
    );
    setDraft(null);
  };

  return (
    <div
      id={`sig-page-${pageIndex}`}
      ref={containerRef}
      className={`relative mx-auto w-full touch-none bg-white shadow-md ${
        armedType ? "cursor-crosshair" : ""
      }`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      <img
        src={preview.dataUrl}
        alt={`Page ${pageIndex + 1}`}
        className="block w-full select-none"
        draggable={false}
      />
      {fields
        .filter((field) => field.page === pageIndex)
        .map((field) => {
          const selected = field.id === selectedId;
          return (
            <div
              key={field.id}
              className={`absolute box-border rounded-sm border-2 text-[11px] font-medium ${
                FIELD_STYLES[field.type]
              } ${selected ? "ring-2 ring-primary ring-offset-1" : ""}`}
              style={{
                left: `${(field.x / preview.widthPt) * 100}%`,
                top: `${((preview.heightPt - field.y - field.height) / preview.heightPt) * 100}%`,
                width: `${(field.width / preview.widthPt) * 100}%`,
                height: `${(field.height / preview.heightPt) * 100}%`,
              }}
              onPointerDown={(event) => {
                event.stopPropagation();
                (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
                onSelect(field.id);
                if (armedType) return;
                const { fx, fy } = fractions(event);
                drag.current = {
                  mode: "move",
                  fieldId: field.id,
                  startFx: fx,
                  startFy: fy,
                  original: { x: field.x, y: field.y, width: field.width, height: field.height },
                };
              }}
            >
              <span className="pointer-events-none flex items-center gap-1 px-1 py-0.5">
                <span
                  className={`inline-block size-3.5 rounded-full text-center text-[9px] leading-3.5 text-white ${SIGNER_BADGES[field.signerIndex] ?? SIGNER_BADGES[0]}`}
                >
                  {field.signerIndex + 1}
                </span>
                {FIELD_LABELS[field.type]}
                {field.required ? " *" : ""}
              </span>
              {selected && (
                <span
                  aria-label="Resize field"
                  className="absolute right-0 bottom-0 size-3.5 cursor-nwse-resize rounded-tl bg-primary"
                  onPointerDown={(event) => {
                    event.stopPropagation();
                    const { fx, fy } = fractions(event);
                    drag.current = {
                      mode: "resize",
                      fieldId: field.id,
                      startFx: fx,
                      startFy: fy,
                      original: {
                        x: field.x,
                        y: field.y,
                        width: field.width,
                        height: field.height,
                      },
                    };
                  }}
                />
              )}
            </div>
          );
        })}
      {draft && (
        <div
          className="pointer-events-none absolute border-2 border-dashed border-primary bg-primary/10"
          style={{
            left: draft.left,
            top: draft.top,
            width: Math.max(draft.width, 4),
            height: Math.max(draft.height, 4),
          }}
        />
      )}
    </div>
  );
}

export function PdfSignatureStudio({ doc }: { doc: SourceFile | null }) {
  const source = doc;
  const createRequest = useServerFn(createSignatureRequest);
  const fetchRequests = useServerFn(listSignatureRequests);
  const fetchDownload = useServerFn(getSignatureRequestDownload);
  const revokeRequest = useServerFn(revokeSignatureRequest);
  const sendEmail = useServerFn(sendCrmEmail);

  const [previews, setPreviews] = useState<PagePreviewData[]>([]);
  const [renderError, setRenderError] = useState("");
  const [pageCount, setPageCount] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [fields, setFields] = useState<SignatureField[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [armedType, setArmedType] = useState<SignatureFieldType | null>(null);
  const [activeSigner, setActiveSigner] = useState(0);
  const [signer1, setSigner1] = useState({ name: "", email: "" });
  const [signer2, setSigner2] = useState({ name: "", email: "" });
  const [useSecondSigner, setUseSecondSigner] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");
  const [createdLinks, setCreatedLinks] = useState<Array<{
    name: string;
    email: string;
    token: string;
  }> | null>(null);
  const [requests, setRequests] = useState<RequestSummary[]>([]);
  const [listError, setListError] = useState("");
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const signers = useSecondSigner ? [signer1, signer2] : [signer1];
  const selectedField = fields.find((field) => field.id === selectedId) ?? null;

  const loadRequests = useCallback(async () => {
    try {
      setRequests(await fetchRequests());
      setListError("");
    } catch (error) {
      setListError(error instanceof Error ? error.message : "Could not load signature requests");
    }
  }, [fetchRequests]);

  useEffect(() => {
    void loadRequests();
  }, [loadRequests]);

  useEffect(() => {
    setFields([]);
    setSelectedId(null);
    setCreatedLinks(null);
    setSendError("");
    if (!source) {
      setPreviews([]);
      setPageCount(0);
      return;
    }
    let cancelled = false;
    setRenderError("");
    (async () => {
      try {
        const count = await pdfPageCount(source.bytes);
        const rendered: PagePreviewData[] = [];
        for (let index = 0; index < count; index++) {
          rendered.push(await renderPagePreview(source.bytes, index, Math.round(720 * zoom)));
        }
        if (!cancelled) {
          setPageCount(count);
          setPreviews(rendered);
        }
      } catch (error) {
        if (!cancelled) {
          setPreviews([]);
          setRenderError(
            error instanceof Error
              ? `Could not render this PDF: ${error.message}`
              : "Could not render this PDF.",
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // Zoom changes re-render at a higher resolution; fields stay in PDF points.
  }, [source, zoom]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!selectedId) return;
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if (event.key === "Delete" || event.key === "Backspace") {
        setFields((current) => current.filter((field) => field.id !== selectedId));
        setSelectedId(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId]);

  const patchField = (id: string, patch: Partial<SignatureField>) =>
    setFields((current) =>
      current.map((field) => (field.id === id ? { ...field, ...patch } : field)),
    );

  const copyLink = async (token: string) => {
    try {
      await navigator.clipboard.writeText(signingLink(token));
      toast.success("Signing link copied — send it to your customer");
    } catch {
      toast.error("Copy failed — long-press or right-click the link to copy it");
    }
  };

  const emailLink = async (signer: { name: string; email: string; token: string }) => {
    try {
      const response = await sendEmail({
        data: {
          to: signer.email,
          subject: `Please sign: ${source?.name ?? "your document"} — Roofer Masters`,
          message: `Hi ${signer.name},\n\nPlease review and sign your document from Roofer Masters using your private signing link:\n\n${signingLink(signer.token)}\n\nThe link is just for you — please don't forward it.\n\nThank you,\nRoofer Masters\n305-942-3093`,
          attachments: [],
        },
      });
      if (!response.sent) throw new Error("Email was not sent");
      toast.success(`Signing link emailed to ${signer.email}`);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Email is not available — copy the link and send it yourself",
      );
    }
  };

  const handleSend = async () => {
    setSendError("");
    if (!source) return setSendError("Choose a PDF first.");
    for (const [index, signer] of signers.entries()) {
      if (!signer.name.trim()) return setSendError(`Enter signer ${index + 1}'s full name.`);
      if (!/^\S+@\S+\.\S+$/.test(signer.email.trim()))
        return setSendError(`Enter a valid email for signer ${index + 1}.`);
      if (!fields.some((field) => field.signerIndex === index))
        return setSendError(
          `Signer ${index + 1} has no fields yet — place at least one field for them.`,
        );
    }
    setSending(true);
    try {
      const created = await createRequest({
        data: {
          documentName: source.name,
          documentBase64: toBase64(source.bytes),
          signers: signers.map((signer) => ({
            name: signer.name.trim(),
            email: signer.email.trim(),
          })),
          fields,
        },
      });
      setCreatedLinks(created.signers);
      toast.success("Signature request created — copy the link and send it to your customer");
      void loadRequests();
    } catch (error) {
      setSendError(error instanceof Error ? error.message : "Could not create the request");
    } finally {
      setSending(false);
    }
  };

  const download = async (requestId: string, kind: "original" | "signed") => {
    try {
      const { url } = await fetchDownload({ data: { requestId, kind } });
      window.open(url, "_blank", "noopener");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Download failed");
    }
  };

  return (
    <div className="grid gap-4">
      {!source && (
        <p className="rounded border border-dashed p-4 text-sm text-muted-foreground">
          Open a PDF first — upload one from your computer or drag &amp; drop it anywhere on this
          page — then place signature, date and name fields on it and send it to your customer with
          a private signing link.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {source && <span className="text-sm text-muted-foreground">{source.name}</span>}
        {pageCount > 0 && (
          <span className="text-sm text-muted-foreground">
            {pageCount} page{pageCount === 1 ? "" : "s"}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setZoom((value) => Math.max(0.5, +(value - 0.25).toFixed(2)))}
          >
            <ZoomOut className="size-4" />
          </Button>
          <span className="w-12 text-center text-sm">{Math.round(zoom * 100)}%</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setZoom((value) => Math.min(2, +(value + 0.25).toFixed(2)))}
          >
            <ZoomIn className="size-4" />
          </Button>
        </div>
      </div>

      {renderError && (
        <p
          role="alert"
          className="rounded border border-destructive/40 bg-destructive/10 p-3 text-sm"
        >
          {renderError}
        </p>
      )}

      {source && previews.length > 0 && (
        <div className="flex gap-3">
          {/* Thumbnail rail */}
          <div className="sticky top-2 hidden max-h-[75vh] w-24 shrink-0 flex-col gap-2 overflow-y-auto pr-1 lg:flex">
            {previews.map((preview, index) => (
              <button
                key={index}
                type="button"
                className="rounded border bg-white p-1 hover:border-primary"
                onClick={() =>
                  document
                    .getElementById(`sig-page-${index}`)
                    ?.scrollIntoView({ behavior: "smooth", block: "start" })
                }
              >
                <img src={preview.dataUrl} alt="" className="w-full" />
                <span className="block pt-1 text-center text-[11px] text-muted-foreground">
                  {index + 1}
                </span>
              </button>
            ))}
          </div>

          {/* Continuous page column */}
          <div className="max-h-[75vh] flex-1 overflow-y-auto rounded border bg-muted/60 p-4">
            <div className="mx-auto grid gap-4" style={{ maxWidth: Math.round(720 * zoom) }}>
              {previews.map((preview, index) => (
                <FieldPage
                  key={`${index}-${preview.dataUrl.length}`}
                  preview={preview}
                  pageIndex={index}
                  fields={fields}
                  selectedId={selectedId}
                  armedType={armedType}
                  onPlace={(field) => {
                    setFields((current) => [...current, { ...field, signerIndex: activeSigner }]);
                    setSelectedId(field.id);
                    setArmedType(null);
                  }}
                  onSelect={setSelectedId}
                  onChange={patchField}
                />
              ))}
            </div>
          </div>

          {/* Acrobat-style right pane */}
          <div className="w-72 shrink-0">
            <div className="sticky top-2 grid gap-4 rounded border p-3">
              <div className="grid gap-2">
                <p className="flex items-center gap-2 text-sm font-semibold">
                  <FileSignature className="size-4 text-primary" /> Who signs
                </p>
                <Label>
                  Signer 1 full name
                  <Input
                    value={signer1.name}
                    onChange={(event) => setSigner1({ ...signer1, name: event.target.value })}
                    placeholder="Customer name"
                  />
                </Label>
                <Label>
                  Signer 1 email
                  <Input
                    type="email"
                    value={signer1.email}
                    onChange={(event) => setSigner1({ ...signer1, email: event.target.value })}
                    placeholder="customer@email.com"
                  />
                </Label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={useSecondSigner}
                    onChange={(event) => {
                      setUseSecondSigner(event.target.checked);
                      if (!event.target.checked) {
                        setFields((current) =>
                          current.map((field) =>
                            field.signerIndex === 1 ? { ...field, signerIndex: 0 } : field,
                          ),
                        );
                        setActiveSigner(0);
                      }
                    }}
                  />
                  Add a second signer
                </label>
                {useSecondSigner && (
                  <>
                    <Label>
                      Signer 2 full name
                      <Input
                        value={signer2.name}
                        onChange={(event) => setSigner2({ ...signer2, name: event.target.value })}
                        placeholder="Second signer"
                      />
                    </Label>
                    <Label>
                      Signer 2 email
                      <Input
                        type="email"
                        value={signer2.email}
                        onChange={(event) => setSigner2({ ...signer2, email: event.target.value })}
                        placeholder="second@email.com"
                      />
                    </Label>
                  </>
                )}
              </div>

              <div className="grid gap-2">
                <p className="text-sm font-semibold">Add fields</p>
                {signers.length > 1 && (
                  <div className="flex gap-1">
                    {signers.map((signer, index) => (
                      <Button
                        key={index}
                        type="button"
                        size="sm"
                        variant={activeSigner === index ? "default" : "outline"}
                        onClick={() => setActiveSigner(index)}
                      >
                        <span
                          className={`mr-1 inline-block size-2.5 rounded-full ${SIGNER_BADGES[index]}`}
                        />
                        {signer.name.trim() || `Signer ${index + 1}`}
                      </Button>
                    ))}
                  </div>
                )}
                <div className="grid grid-cols-2 gap-1.5">
                  {PALETTE.map((item) => (
                    <Button
                      key={item.type}
                      type="button"
                      size="sm"
                      variant={armedType === item.type ? "default" : "outline"}
                      className="justify-start"
                      onClick={() =>
                        setArmedType((current) => (current === item.type ? null : item.type))
                      }
                    >
                      <item.icon className="mr-1.5 size-4" />
                      {FIELD_LABELS[item.type]}
                    </Button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  {armedType
                    ? `Click on the document — or drag a box — to place the ${FIELD_LABELS[armedType]} field for signer ${activeSigner + 1}.`
                    : "Pick a field, then click on the document where it belongs. Drag fields to move them; drag the corner square to resize."}
                </p>
              </div>

              {selectedField && (
                <div className="grid gap-2 rounded border bg-muted/40 p-2">
                  <p className="text-sm font-semibold">
                    {FIELD_LABELS[selectedField.type]} — page {selectedField.page + 1}
                  </p>
                  <Label>
                    Label
                    <Input
                      value={selectedField.label}
                      onChange={(event) =>
                        patchField(selectedField.id, { label: event.target.value })
                      }
                    />
                  </Label>
                  <Label>
                    For signer
                    <select
                      className="h-9 w-full rounded border bg-background px-2"
                      value={selectedField.signerIndex}
                      onChange={(event) =>
                        patchField(selectedField.id, {
                          signerIndex: Number(event.target.value),
                        })
                      }
                    >
                      {signers.map((signer, index) => (
                        <option key={index} value={index}>
                          {signer.name.trim() || `Signer ${index + 1}`}
                        </option>
                      ))}
                    </select>
                  </Label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={selectedField.required}
                      onChange={(event) =>
                        patchField(selectedField.id, { required: event.target.checked })
                      }
                    />
                    Required
                  </label>
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    onClick={() => {
                      setFields((current) =>
                        current.filter((field) => field.id !== selectedField.id),
                      );
                      setSelectedId(null);
                    }}
                  >
                    <Trash2 className="mr-1.5 size-4" /> Delete field
                  </Button>
                </div>
              )}

              <div className="grid gap-2">
                <Button
                  type="button"
                  disabled={sending || !source}
                  onClick={() => void handleSend()}
                >
                  {sending ? (
                    <Loader2 className="mr-2 size-4 animate-spin" />
                  ) : (
                    <Send className="mr-2 size-4" />
                  )}
                  Send signature request
                </Button>
                {sendError && (
                  <p role="alert" className="text-sm text-destructive">
                    {sendError}
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  You get a private signing link for each signer — copy it and text or email it to
                  your customer. They sign in their browser; no account needed.
                </p>
              </div>

              {createdLinks && (
                <div className="grid gap-2 rounded border border-primary/30 bg-primary/5 p-2">
                  <p className="flex items-center gap-1.5 text-sm font-semibold">
                    <Link2 className="size-4" /> Signing links — ready to send
                  </p>
                  {createdLinks.map((signer) => (
                    <div key={signer.token} className="grid gap-1">
                      <span className="text-xs font-medium">
                        {signer.name} ({signer.email})
                      </span>
                      <div className="flex gap-1">
                        <Input readOnly value={signingLink(signer.token)} className="h-8 text-xs" />
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => void copyLink(signer.token)}
                        >
                          <Copy className="size-3.5" />
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          title="Email the link (only works if CRM email is configured)"
                          onClick={() => void emailLink(signer)}
                        >
                          <Mail className="size-3.5" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Requests list */}
      <div className="grid gap-2">
        <h4 className="flex items-center gap-2 font-medium">
          <FileSignature className="size-4 text-primary" /> Signature requests
        </h4>
        {listError && (
          <p role="alert" className="text-sm text-destructive">
            {listError}
          </p>
        )}
        {requests.length === 0 && !listError && (
          <p className="text-sm text-muted-foreground">
            No signature requests yet — open a PDF above, place the fields, and send your first one.
          </p>
        )}
        <ul className="grid gap-2">
          {requests.map((request) => {
            const done = request.signers.filter((signer) => signer.completedAt).length;
            const status = request.revokedAt
              ? "Revoked"
              : request.status === "completed"
                ? "Completed"
                : `Pending — ${done} of ${request.signers.length} signed`;
            return (
              <li key={request.id} className="grid gap-2 rounded border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{request.documentName}</span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      request.status === "completed" && !request.revokedAt
                        ? "bg-green-100 text-green-900"
                        : request.revokedAt
                          ? "bg-red-100 text-red-900"
                          : "bg-amber-100 text-amber-900"
                    }`}
                  >
                    {status}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Sent {new Date(request.createdAt).toLocaleDateString()} · {request.fieldCount}{" "}
                    fields · link expires {new Date(request.expiresAt).toLocaleDateString()}
                  </span>
                  <span className="ml-auto flex gap-1">
                    {request.hasSignedCopy && (
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => void download(request.id, "signed")}
                      >
                        <Download className="mr-1.5 size-4" /> Signed PDF
                      </Button>
                    )}
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => void download(request.id, "original")}
                    >
                      <Download className="mr-1.5 size-4" /> Original
                    </Button>
                    {!request.revokedAt && request.status !== "completed" && (
                      <Button
                        type="button"
                        size="sm"
                        variant={revokingId === request.id ? "destructive" : "ghost"}
                        onClick={async () => {
                          if (revokingId !== request.id) {
                            setRevokingId(request.id);
                            return;
                          }
                          setRevokingId(null);
                          try {
                            await revokeRequest({ data: { requestId: request.id } });
                            toast.success("Signing links revoked");
                            void loadRequests();
                          } catch (error) {
                            toast.error(
                              error instanceof Error ? error.message : "Could not revoke",
                            );
                          }
                        }}
                      >
                        <Eraser className="mr-1.5 size-4" />
                        {revokingId === request.id ? "Confirm revoke" : "Revoke"}
                      </Button>
                    )}
                  </span>
                </div>
                <div className="grid gap-1">
                  {request.signers.map((signer) => (
                    <div key={signer.token} className="flex flex-wrap items-center gap-2 text-sm">
                      <span>
                        {signer.name} ({signer.email})
                      </span>
                      {signer.completedAt ? (
                        <span className="text-green-700">
                          Signed {new Date(signer.completedAt).toLocaleString()}
                        </span>
                      ) : request.revokedAt ? (
                        <span className="text-muted-foreground">Link revoked</span>
                      ) : (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => void copyLink(signer.token)}
                        >
                          <Copy className="mr-1.5 size-3.5" /> Copy signing link
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
