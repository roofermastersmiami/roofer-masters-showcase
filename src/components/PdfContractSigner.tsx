import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import SignatureCanvas from "react-signature-canvas";
import {
  CalendarDays,
  Check,
  FilePlus2,
  Lock,
  Mail,
  PenLine,
  Plus,
  Trash2,
  Type,
  Save,
  Send,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { emailRoofReportPdfs } from "@/lib/pdf-email.functions";
import { cn } from "@/lib/utils";

type FieldKind = "signature" | "name" | "date" | "initials" | "text" | "erase";
export type PdfSignField = {
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
const EMPTY_FIELDS: PdfSignField[] = [];

export interface PdfContractSignerProps {
  reportId: string;
  leadId: string | null;
  propertyAddress: string;
  sourcePdfPath?: string | null;
  sourceBucket?: string;
  isClientMode?: boolean;
  onSaved?: (path: string) => void;
  initialFields?: PdfSignField[];
  onFieldsChange?: (fields: PdfSignField[]) => void;
}

const today = () => {
  const d = new Date();
  return [
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
    d.getFullYear(),
  ].join("/");
};
const fieldLabel: Record<FieldKind, string> = {
  signature: "Signature",
  name: "Full name",
  date: "Date signed",
  initials: "Initials",
  text: "Custom text",
  erase: "Whiteout / erase",
};
const makeField = (kind: FieldKind, page: number): PdfSignField => ({
  id: crypto.randomUUID(),
  kind,
  page,
  x: 0.12,
  y: 0.72,
  width: kind === "signature" ? 0.3 : kind === "erase" ? 0.35 : 0.25,
  height: kind === "signature" ? 0.09 : kind === "erase" ? 0.07 : 0.045,
  fontSize: kind === "signature" ? 22 : 12,
  value:
    kind === "date"
      ? today()
      : kind === "name"
        ? ""
        : kind === "initials"
          ? ""
          : kind === "text"
            ? ""
            : "",
});

export function PdfContractSigner({
  reportId,
  leadId,
  propertyAddress,
  sourcePdfPath,
  sourceBucket = "roofing-proposals",
  isClientMode = false,
  onSaved,
  initialFields = EMPTY_FIELDS,
  onFieldsChange,
}: PdfContractSignerProps) {
  const [sourceBytes, setSourceBytes] = useState<Uint8Array | null>(null);
  const [sourceFileName, setSourceFileName] = useState("document.pdf");
  const [templates, setTemplates] = useState<Array<{ id: string; name: string; file_path: string; fields: PdfSignField[] }>>([]);
  const [templateName, setTemplateName] = useState("");
  const [templateBusy, setTemplateBusy] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const [emailTo, setEmailTo] = useState("");
  const [emailSubject, setEmailSubject] = useState("Roofing documents from Roofer Masters");
  const [emailMessage, setEmailMessage] = useState("Hello,\n\nPlease find the attached roofing documents.");
  const [companySignature, setCompanySignature] = useState("Thank you,\nRoofer Masters\n(305) 942-3093\nroofermasters@gmail.com\nroofermastersmiami.com");
  const [drawFieldMode, setDrawFieldMode] = useState(false);
  const [drawDraft, setDrawDraft] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const drawStartRef = useRef<{ page: number; x: number; y: number; rect: DOMRect } | null>(null);
  const resizeRef = useRef<{ id: string; pointerX: number; pointerY: number; width: number; height: number; rect: DOMRect } | null>(null);
  const [emailFiles, setEmailFiles] = useState<File[]>([]);
  const [includeCurrentPdf, setIncludeCurrentPdf] = useState(true);
  const [savedAttachments, setSavedAttachments] = useState<Array<{ path: string; filename: string }>>([]);
  const [emailBusy, setEmailBusy] = useState(false);
  const [pages, setPages] = useState<PdfPage[]>([]);
  const [fields, setFields] = useState<PdfSignField[]>(initialFields);
  const [clientFieldOpen, setClientFieldOpen] = useState(false);
  const [activePage, setActivePage] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [signatureOpen, setSignatureOpen] = useState(false);
  const [signatureMode, setSignatureMode] = useState<"draw" | "type">("draw");
  const [typedSignature, setTypedSignature] = useState("");
  const signatureRef = useRef<SignatureCanvas>(null);
  const pageRefs = useRef<Array<HTMLDivElement | null>>([]);
  const pageScrollRefs = useRef<Array<HTMLDivElement | null>>([]);
  const canvasRefs = useRef<Array<HTMLCanvasElement | null>>([]);
  const dragRef = useRef<{
    id: string;
    pointerX: number;
    pointerY: number;
    startX: number;
    startY: number;
    rect: DOMRect;
  } | null>(null);
  const selected = fields.find((field) => field.id === selectedId) ?? null;
  useEffect(() => {
    onFieldsChange?.(fields);
  }, [fields, onFieldsChange]);

  const loadPdf = useCallback(
    async (bytes: Uint8Array, name: string, savedFields: PdfSignField[] = initialFields) => {
      setLoading(true);
      try {
        const pdfjsLib = await import("pdfjs-dist");
        pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
        const document = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
        const nextPages: PdfPage[] = [];
        const detectedFields: PdfSignField[] = [];
        for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
          const page = await document.getPage(pageNumber);
          const viewport = page.getViewport({ scale: 1 });
          nextPages.push({ width: viewport.width, height: viewport.height });
          const annotations = await page.getAnnotations();
          for (const annotation of annotations) {
            if (annotation.subtype !== "Widget" || !Array.isArray(annotation.rect)) continue;
            if (annotation.fieldType !== "Tx" && annotation.fieldType !== "Sig") continue;
            const rect = viewport.convertToViewportRectangle(annotation.rect);
            const left = Math.max(0, Math.min(rect[0], rect[2]));
            const top = Math.max(0, Math.min(rect[1], rect[3]));
            const right = Math.min(viewport.width, Math.max(rect[0], rect[2]));
            const bottom = Math.min(viewport.height, Math.max(rect[1], rect[3]));
            const width = right - left;
            const height = bottom - top;
            if (width < 4 || height < 4) continue;
            detectedFields.push({
              ...makeField(annotation.fieldType === "Sig" ? "signature" : "text", pageNumber - 1),
              x: left / viewport.width,
              y: top / viewport.height,
              width: width / viewport.width,
              height: height / viewport.height,
              value: annotation.fieldType === "Sig" ? "" : String(annotation.fieldValue ?? ""),
            });
          }
        }
        setSourceBytes(bytes);
        setSourceFileName(name);
        setPages(nextPages);
        setFields(savedFields.length ? savedFields : detectedFields);
        setActivePage(0);
        setSelectedId(null);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not read this PDF");
      } finally {
        setLoading(false);
      }
    },
    [initialFields],
  );

  useEffect(() => {
    let cancelled = false;
    if (!sourcePdfPath) return;
    void (async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase.storage.from(sourceBucket).download(sourcePdfPath);
        if (error || !data) throw error ?? new Error("PDF file not found");
        if (!cancelled)
          await loadPdf(
            new Uint8Array(await data.arrayBuffer()),
            sourcePdfPath.split("/").pop() || "roof-report.pdf",
          );
      } catch (error) {
        if (!cancelled)
          toast.error(error instanceof Error ? error.message : "Could not load source PDF");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadPdf, sourceBucket, sourcePdfPath]);

  useEffect(() => {
    if (!sourceBytes || !pages.length) return;
    let cancelled = false;
    const render = async () => {
      try {
        const pdfjsLib = await import("pdfjs-dist");
        pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
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
          if (context)
            await page.render({ canvas, canvasContext: context, viewport } as never).promise;
        }
      } catch (error) {
        if (!cancelled)
          toast.error(error instanceof Error ? error.message : "Could not render PDF pages");
      }
    };
    void render();
    return () => {
      cancelled = true;
    };
  }, [sourceBytes, pages]);

  const addField = (kind: FieldKind) => {
    if (!pages.length) {
      toast.error("Upload or load a PDF first");
      return;
    }
    const field = makeField(kind, activePage);
    setFields((current) => [...current, field]);
    setSelectedId(field.id);
    if (kind === "signature") setSignatureOpen(true);
  };

  const updateField = (id: string, patch: Partial<PdfSignField>) =>
    setFields((current) =>
      current.map((field) => (field.id === id ? { ...field, ...patch } : field)),
    );

  const beginDrag = (event: PointerEvent<HTMLDivElement>, field: PdfSignField) => {
    if (isClientMode || (event.target as HTMLElement).closest("input,button")) return;
    const host = pageRefs.current[field.page];
    if (!host) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      id: field.id,
      pointerX: event.clientX,
      pointerY: event.clientY,
      startX: field.x,
      startY: field.y,
      rect: host.getBoundingClientRect(),
    };
    setSelectedId(field.id);
  };
  const moveDrag = (event: PointerEvent<HTMLDivElement>) => {
    const resize = resizeRef.current;
    if (resize && !isClientMode) {
      updateField(resize.id, {
        width: Math.max(0.05, Math.min(1 - (fields.find((field) => field.id === resize.id)?.x ?? 0.05), resize.width + (event.clientX - resize.pointerX) / resize.rect.width)),
        height: Math.max(0.02, Math.min(1 - (fields.find((field) => field.id === resize.id)?.y ?? 0.05), resize.height + (event.clientY - resize.pointerY) / resize.rect.height)),
      });
      return;
    }
    const draw = drawStartRef.current;
    if (draw && drawFieldMode && !isClientMode) {
      const x = Math.max(0, Math.min(1, (event.clientX - draw.rect.left) / draw.rect.width));
      const y = Math.max(0, Math.min(1, (event.clientY - draw.rect.top) / draw.rect.height));
      setDrawDraft({ x: Math.min(draw.x, x), y: Math.min(draw.y, y), width: Math.abs(x - draw.x), height: Math.abs(y - draw.y) });
      return;
    }
    const drag = dragRef.current;
    if (!drag || isClientMode) return;
    updateField(drag.id, {
      x: Math.max(
        0,
        Math.min(
          1 - (fields.find((f) => f.id === drag.id)?.width ?? 0.2),
          drag.startX + (event.clientX - drag.pointerX) / drag.rect.width,
        ),
      ),
      y: Math.max(
        0,
        Math.min(
          1 - (fields.find((f) => f.id === drag.id)?.height ?? 0.05),
          drag.startY + (event.clientY - drag.pointerY) / drag.rect.height,
        ),
      ),
    });
  };

  const beginDrawField = (event: PointerEvent<HTMLDivElement>, page: number) => {
    if (!drawFieldMode || isClientMode || (event.target as HTMLElement).closest("[data-pdf-field]")) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
    event.currentTarget.setPointerCapture(event.pointerId);
    drawStartRef.current = { page, x, y, rect };
    setDrawDraft({ x, y, width: 0, height: 0 });
  };

  const finishDrawField = () => {
    const start = drawStartRef.current;
    const draft = drawDraft;
    drawStartRef.current = null;
    setDrawDraft(null);
    if (!start || !draft) return;
    if (draft.width < 0.015 || draft.height < 0.012) {
      setDrawFieldMode(false);
      return;
    }
    const field: PdfSignField = {
      ...makeField("text", start.page),
      x: draft.x,
      y: draft.y,
      width: Math.min(0.9, draft.width),
      height: Math.min(0.3, draft.height),
    };
    setFields((current) => [...current, field]);
    setSelectedId(field.id);
    setActivePage(start.page);
    setDrawFieldMode(false);
  };

  const beginResize = (event: PointerEvent<HTMLButtonElement>, field: PdfSignField) => {
    if (isClientMode) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const rect = pageRefs.current[field.page]?.getBoundingClientRect();
    if (!rect) return;
    resizeRef.current = { id: field.id, pointerX: event.clientX, pointerY: event.clientY, width: field.width, height: field.height, rect };
    setSelectedId(field.id);
  };

  const saveSignature = () => {
    const field = fields.find((item) => item.id === selectedId && item.kind === "signature");
    if (!field) {
      toast.error("Select a signature field first");
      return;
    }
    let data = "";
    if (signatureMode === "draw") {
      if (!signatureRef.current || signatureRef.current.isEmpty()) {
        toast.error("Draw your signature first");
        return;
      }
      data = signatureRef.current.getTrimmedCanvas().toDataURL("image/png");
    } else {
      if (!typedSignature.trim()) {
        toast.error("Enter the signer name first");
        return;
      }
      const canvas = document.createElement("canvas");
      canvas.width = 900;
      canvas.height = 220;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#111827";
      ctx.font = "italic 92px cursive";
      ctx.textBaseline = "middle";
      ctx.fillText(typedSignature.trim(), 12, 110);
      data = canvas.toDataURL("image/png");
    }
    updateField(field.id, {
      imageData: data,
      value: signatureMode === "type" ? typedSignature.trim() : "Signed",
    });
    setSignatureOpen(false);
    toast.success("Signature added to the document");
  };

  const exportPdf = async () => {
    if (!sourceBytes || !leadId) {
      toast.error("A source PDF and linked customer lead are required");
      return;
    }
    if (!fields.length) {
      toast.error("Add at least one signing field");
      return;
    }
    const incomplete = fields.find(
      (field) =>
        (field.kind === "signature" && !field.imageData) ||
        (field.kind !== "signature" && field.kind !== "erase" && !field.value.trim()),
    );
    if (incomplete) {
      setSelectedId(incomplete.id);
      toast.error(`Complete the ${fieldLabel[incomplete.kind]} field before saving`);
      return;
    }
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
        if (field.kind === "erase") {
          page.drawRectangle({ x, y, width, height, color: rgb(1, 1, 1), borderColor: rgb(1, 1, 1) });
        } else if (field.kind === "signature" && field.imageData) {
          const png = await pdf.embedPng(field.imageData);
          const scale = Math.min(width / png.width, height / png.height);
          page.drawImage(png, {
            x,
            y: y + (height - png.height * scale) / 2,
            width: png.width * scale,
            height: png.height * scale,
          });
        } else {
          page.drawText(field.value, {
            x: x + 3,
            y: y + Math.max(2, (height - field.fontSize) / 2),
            size: field.fontSize,
            font: field.kind === "signature" ? font : await pdf.embedFont(StandardFonts.Helvetica),
            color: rgb(0.05, 0.08, 0.13),
            maxWidth: Math.max(20, width - 6),
          });
        }
      }
      const bytes = await pdf.save();
      const safeAddress =
        propertyAddress
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "")
          .slice(0, 50) || "property";
      const path = `${leadId}/${reportId}/${Date.now()}-${safeAddress}-signed.pdf`;
      const outputBuffer = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(outputBuffer).set(bytes);
      const blob = new Blob([outputBuffer], { type: "application/pdf" });
      const { error } = await supabase.storage
        .from("signed-contracts")
        .upload(path, blob, { contentType: "application/pdf", upsert: false });
      if (error) throw error;
      setSavedAttachments((current) => [...current, { path, filename: `${safeAddress}-signed.pdf` }]);
      const downloadUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = downloadUrl;
      anchor.download = `${safeAddress}-signed.pdf`;
      anchor.click();
      URL.revokeObjectURL(downloadUrl);
      onSaved?.(path);
      toast.success("Signed PDF flattened, downloaded, and saved to the customer record");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save signed PDF");
    } finally {
      setSaving(false);
    }
  };

  const saveAsTemplate = async () => {
    if (!sourceBytes) {
      toast.error("Load a PDF before saving a template");
      return;
    }
    const name = templateName.trim();
    if (name.length < 2) {
      toast.error("Enter a template name");
      return;
    }
    setTemplateBusy(true);
    try {
      const { data: userResult, error: userError } = await supabase.auth.getUser();
      if (userError || !userResult.user) throw new Error("Sign in again to save a template");
      const id = crypto.randomUUID();
      const path = `pdf-templates/${id}/${Date.now()}-${sourceFileName.replace(/[^a-zA-Z0-9._-]/g, "-")}`;
      const { error: uploadError } = await supabase.storage.from("roofing-proposals").upload(path, new Blob([Uint8Array.from(sourceBytes)], { type: "application/pdf" }), { contentType: "application/pdf" });
      if (uploadError) throw uploadError;
      const templateFields = fields.map((field) => ({ ...field, id: crypto.randomUUID(), value: "", imageData: undefined }));
      const { error: insertError } = await supabase.from("pdf_sign_templates").insert({ id, name, file_path: path, fields: templateFields as unknown as import("@/integrations/supabase/types").Json, created_by: userResult.user.id });
      if (insertError) {
        await supabase.storage.from("roofing-proposals").remove([path]);
        throw insertError;
      }
      setTemplates((current) => [{ id, name, file_path: path, fields: templateFields }, ...current]);
      setTemplateName("");
      toast.success("PDF template saved");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save template");
    } finally {
      setTemplateBusy(false);
    }
  };

  const loadTemplate = async (id: string) => {
    const template = templates.find((item) => item.id === id);
    if (!template) return;
    setTemplateBusy(true);
    try {
      const { data, error } = await supabase.storage.from("roofing-proposals").download(template.file_path);
      if (error || !data) throw error ?? new Error("Template PDF not found");
      const fieldsForUse = template.fields.map((field) => ({ ...field, id: crypto.randomUUID(), value: field.kind === "date" ? today() : "", imageData: undefined }));
      await loadPdf(new Uint8Array(await data.arrayBuffer()), template.name + ".pdf", fieldsForUse);
      toast.success(`Loaded template: ${template.name}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load template");
    } finally {
      setTemplateBusy(false);
    }
  };

  const sendEmail = async () => {
    if (!leadId || !reportId || !emailTo.trim()) {
      toast.error("Enter the customer's email address");
      return;
    }
    if (!savedAttachments.length && !emailFiles.length && !includeCurrentPdf) {
      toast.error("Add at least one PDF attachment");
      return;
    }
    const selectedBytes = emailFiles.reduce((total, file) => total + file.size, includeCurrentPdf && sourceBytes ? sourceBytes.byteLength : 0);
    if (selectedBytes > 20 * 1024 * 1024) {
      toast.error("All PDF attachments together must be 20 MB or less");
      return;
    }
    setEmailBusy(true);
    const uploadedPaths: string[] = [];
    try {
      const uploaded = [...savedAttachments];
      if (includeCurrentPdf && sourceBytes) {
        const safeName = sourceFileName.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 100) || "roof-report.pdf";
        const path = `${leadId}/${reportId}/${Date.now()}-${crypto.randomUUID()}-${safeName}`;
        const blob = new Blob([Uint8Array.from(sourceBytes)], { type: "application/pdf" });
        const { error } = await supabase.storage.from("signed-contracts").upload(path, blob, { contentType: "application/pdf", upsert: false });
        if (error) throw error;
        uploadedPaths.push(path);
        uploaded.push({ path, filename: safeName });
      }
      for (const file of emailFiles) {
        if (file.type !== "application/pdf" || file.size > 20 * 1024 * 1024) throw new Error(`${file.name} must be a PDF under 20 MB`);
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 100);
        const path = `${leadId}/${reportId}/${Date.now()}-${crypto.randomUUID()}-${safeName}`;
        const { error } = await supabase.storage.from("signed-contracts").upload(path, file, { contentType: "application/pdf", upsert: false });
        if (error) throw error;
        uploadedPaths.push(path);
        uploaded.push({ path, filename: safeName });
      }
      const fullMessage = [emailMessage.trim(), companySignature.trim()].filter(Boolean).join("\n\n");
      const result = await emailRoofReportPdfs({ data: { leadId, reportId, to: emailTo.trim(), subject: emailSubject.trim(), message: fullMessage, attachments: uploaded } });
      if (!result.sent) throw new Error("Email was not sent");
      setSavedAttachments(uploaded);
      setEmailFiles([]);
      setEmailOpen(false);
      toast.success(`Email sent with ${result.attachmentCount} PDF file(s)`);
    } catch (error) {
      if (uploadedPaths.length) await supabase.storage.from("signed-contracts").remove(uploadedPaths);
      toast.error(error instanceof Error ? error.message : "Could not send email");
    } finally {
      setEmailBusy(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    if (!emailOpen || !leadId || emailTo.trim()) return;
    void supabase.from("leads").select("email").eq("id", leadId).maybeSingle().then(({ data }) => {
      if (!cancelled && data?.email) setEmailTo(data.email);
    });
    return () => { cancelled = true; };
  }, [emailOpen, leadId, emailTo]);

  useEffect(() => {
    let cancelled = false;
    void supabase.from("pdf_sign_templates").select("id,name,file_path,fields").order("updated_at", { ascending: false }).then(({ data, error }) => {
      if (!cancelled && !error && data) setTemplates(data.map((row) => ({ ...row, fields: Array.isArray(row.fields) ? row.fields as unknown as PdfSignField[] : [] })));
    });
    return () => { cancelled = true; };
  }, []);

  const uploadFile = async (file?: File) => {
    if (!file) return;
    if (file.type !== "application/pdf" || file.size > 30 * 1024 * 1024) {
      toast.error("Choose a PDF file smaller than 30 MB");
      return;
    }
    await loadPdf(new Uint8Array(await file.arrayBuffer()), file.name);
  };

  const fieldTools: { kind: FieldKind; label: string; icon: typeof PenLine }[] = [
    { kind: "signature", label: "Signature", icon: PenLine },
    { kind: "name", label: "Full name", icon: Type },
    { kind: "date", label: "Date signed", icon: CalendarDays },
    { kind: "initials", label: "Initials", icon: Type },
    { kind: "text", label: "Add / replace text", icon: Type },
    { kind: "erase", label: "Whiteout / erase", icon: Trash2 },
  ];
  const activePageFields = useMemo(
    () => fields.filter((field) => field.page === activePage),
    [fields, activePage],
  );

  return (
    <section className="flex min-h-[70vh] flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-semibold">PDF Fill & Sign</h3>
          <p className="text-xs text-muted-foreground">
            {propertyAddress} · Free local PDF editing
          </p>
        </div>
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted">
          <Upload className="size-4" /> Upload PDF
          <input
            className="sr-only"
            type="file"
            accept="application/pdf"
            onChange={(e) => {
              void uploadFile(e.target.files?.[0]);
              e.currentTarget.value = "";
            }}
          />
        </label>
      </div>
      <div className="sticky top-0 z-30 flex flex-col gap-2 rounded-lg border bg-background/95 p-2 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-background/85">
      <div className="flex flex-wrap items-center gap-2">
        {fieldTools.map(({ kind, label, icon: Icon }) => (
          <Button
            key={kind}
            type="button"
            size="sm"
            variant="outline"
            disabled={!sourceBytes || isClientMode}
            onClick={() => addField(kind)}
          >
            <Icon className="mr-1 size-4" />
            {label}
          </Button>
        ))}
        {isClientMode && (
          <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
            <Lock className="size-3" /> Field positions locked
          </span>
        )}
        <Button
          className="ml-auto"
          size="sm"
          onClick={() => void exportPdf()}
          disabled={!sourceBytes || saving || loading || !leadId}
        >
          <Check className="mr-1 size-4" />
          {saving ? "Saving…" : "Save & Download Signed PDF"}
        </Button>
        <Button size="sm" variant={drawFieldMode ? "default" : "outline"} disabled={!sourceBytes || isClientMode} onClick={() => setDrawFieldMode((value) => !value)}>
          <Plus className="mr-1 size-4" /> {drawFieldMode ? "Cancel drawing" : "Draw field area"}
        </Button>
        <Button size="sm" variant="outline" disabled={!sourceBytes || templateBusy} onClick={() => void saveAsTemplate()}>
          <Save className="mr-1 size-4" /> Save template
        </Button>
        <Button size="sm" variant="outline" disabled={!leadId || !reportId} onClick={() => setEmailOpen(true)}>
          <Mail className="mr-1 size-4" /> Email PDFs
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Input className="w-44" placeholder="New template name" value={templateName} onChange={(event) => setTemplateName(event.target.value)} />
        <select aria-label="Load saved PDF template" className="h-9 max-w-64 rounded-md border bg-background px-3 text-sm" value="" onChange={(event) => { if (event.target.value) void loadTemplate(event.target.value); }}>
          <option value="">Load a saved template…</option>
          {templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
        </select>
        <span className="text-xs text-muted-foreground">Templates keep your PDF and field positions for reuse.</span>
      </div>
      {selected && !isClientMode && (
        <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-muted/30 p-3">
          <div className="min-w-40 flex-1">
            <label className="mb-1 block text-xs text-muted-foreground">
              {fieldLabel[selected.kind]}
            </label>
            <Input
              value={selected.value}
              placeholder={
                selected.kind === "signature"
                  ? "Add signature using the signature pad"
                  : "Enter field value"
              }
              disabled={selected.kind === "signature" || selected.kind === "erase"}
              onChange={(e) => updateField(selected.id, { value: e.target.value })}
            />
          </div>
          <div className="w-24">
            <label className="mb-1 block text-xs text-muted-foreground">Font size</label>
            <Input
              type="number"
              min={6}
              max={48}
              value={selected.fontSize}
              onChange={(e) =>
                updateField(selected.id, {
                  fontSize: Math.max(6, Math.min(48, Number(e.target.value) || 12)),
                })
              }
            />
          </div>
          <div className="w-24">
            <label className="mb-1 block text-xs text-muted-foreground">Width %</label>
            <Input
              type="number"
              min={5}
              max={90}
              value={Math.round(selected.width * 100)}
              onChange={(e) =>
                updateField(selected.id, {
                  width: Math.max(0.05, Math.min(0.9, Number(e.target.value) / 100 || 0.2)),
                })
              }
            />
          </div>
          <div className="w-24">
            <label className="mb-1 block text-xs text-muted-foreground">Height %</label>
            <Input
              type="number"
              min={2}
              max={30}
              value={Math.round(selected.height * 100)}
              onChange={(e) =>
                updateField(selected.id, {
                  height: Math.max(0.02, Math.min(0.3, Number(e.target.value) / 100 || 0.05)),
                })
              }
            />
          </div>
          {selected.kind === "erase" && <span className="pb-2 text-xs text-muted-foreground">This area will be covered with white when exported. Place replacement text over it afterward.</span>}
          {selected.kind === "signature" && (
            <Button type="button" variant="outline" onClick={() => setSignatureOpen(true)}>
              <PenLine className="mr-1 size-4" />
              {selected.imageData ? "Edit signature" : "Add signature"}
            </Button>
          )}
          <Button
            type="button"
            variant="destructive"
            size="icon"
            aria-label="Delete selected field"
            onClick={() => {
              setFields((all) => all.filter((f) => f.id !== selected.id));
              setSelectedId(null);
            }}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      )}
      </div>
      {!leadId && (
        <p
          role="alert"
          className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm"
        >
          This roof report is not linked to a customer lead. Link the customer before saving a
          signed contract.
        </p>
      )}
      {loading && <p className="p-4 text-sm text-muted-foreground">Loading PDF pages…</p>}
      {!sourceBytes && !loading && (
        <div className="rounded-lg border border-dashed p-12 text-center text-sm text-muted-foreground">
          <FilePlus2 className="mx-auto mb-2 size-8" />
          Upload a PDF to start editing. Existing fillable text and signature fields are detected automatically; for a flat or scanned PDF, add whiteout and text areas manually.
        </div>
      )}
      {drawFieldMode && <p className="text-xs text-blue-700">Click and drag on the PDF to create a text area. For replacing existing content, add a Whiteout / erase area first, then add replacement text above it. Select any item to move, resize, edit, or delete it.</p>}
      {sourceBytes && <p className="text-xs text-muted-foreground">PDF editor: select an item to move or resize it. Use Whiteout / erase to cover old wording, then Add / replace text to write the corrected information. Export applies the edits to a new PDF; your uploaded original stays unchanged.</p>}
      {sourceBytes && (
        <div className="h-[min(68dvh,760px)] min-h-[320px] overflow-y-auto overscroll-contain rounded-lg bg-muted/60 p-3">
          <div className="mx-auto flex max-w-5xl flex-col items-center gap-5">
            {pages.map((page, index) => (
              <div key={index} ref={(el) => { pageScrollRefs.current[index] = el; }} className={cn("w-full rounded-lg p-1 transition-shadow", activePage === index ? "ring-2 ring-primary" : "")}>
                <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
                  <span>
                    Page {index + 1} of {pages.length}
                  </span>
                  <Button
                    size="sm"
                    variant={activePage === index ? "secondary" : "ghost"}
                    onClick={() => {
                      setActivePage(index);
                      pageScrollRefs.current[index]?.scrollIntoView({ behavior: "smooth", block: "center" });
                    }}
                  >
                    Edit this page
                  </Button>
                </div>
                <div
                  ref={(el) => {
                    pageRefs.current[index] = el;
                  }}
                  className="relative mx-auto w-full overflow-hidden bg-white shadow-md"
                  style={{ aspectRatio: `${page.width} / ${page.height}`, maxWidth: "850px" }}
                >
                  <canvas
                    ref={(el) => {
                      canvasRefs.current[index] = el;
                    }}
                    className="block h-auto w-full"
                  />
                  <div
                    className={cn("absolute inset-0 touch-none", drawFieldMode ? "cursor-crosshair" : "")}
                    onPointerDown={(event) => beginDrawField(event, index)}
                    onPointerMove={moveDrag}
                    onPointerUp={() => {
                      dragRef.current = null;
                      resizeRef.current = null;
                      finishDrawField();
                    }}
                    onPointerCancel={() => {
                      dragRef.current = null;
                      resizeRef.current = null;
                      drawStartRef.current = null;
                      setDrawDraft(null);
                    }}
                  >
                    {fields
                      .filter((field) => field.page === index)
                      .map((field) => (
                        <div
                          key={field.id}
                          role="button"
                          tabIndex={0}
                          data-pdf-field="true"
                          aria-label={`${fieldLabel[field.kind]} field`}
                          onClick={() => {
                            setSelectedId(field.id);
                            if (field.kind === "signature" && !field.imageData)
                              setSignatureOpen(true);
                            else if (isClientMode && field.kind === "date")
                              updateField(field.id, { value: today() });
                            else if (isClientMode) setClientFieldOpen(true);
                          }}
                          onPointerDown={(event) => beginDrag(event, field)}
                          className={`absolute flex cursor-move items-center border-2 px-1 ${field.kind === "erase" ? "border-dashed border-amber-500 bg-white" : selectedId === field.id ? "border-blue-600 bg-blue-100/60" : "border-blue-400/70 bg-blue-50/40"}`}
                          style={{
                            left: `${field.x * 100}%`,
                            top: `${field.y * 100}%`,
                            width: `${field.width * 100}%`,
                            height: `${field.height * 100}%`,
                            fontSize: `${field.fontSize}px`,
                          }}
                        >
                          {field.imageData ? (
                            <img
                              src={field.imageData}
                              alt="Signature preview"
                              className="pointer-events-none h-full max-w-full object-contain"
                            />
                          ) : (
                            <span className="max-w-full truncate overflow-hidden text-blue-900">
                              {field.kind === "erase" ? "Whiteout area" : field.value || fieldLabel[field.kind]}
                            </span>
                          )}
                          {selectedId === field.id && !isClientMode && (
                            <button
                              type="button"
                              aria-label="Resize field"
                              title="Drag to resize"
                              onPointerDown={(event) => beginResize(event, field)}
                              onPointerMove={moveDrag}
                              onPointerUp={() => { resizeRef.current = null; }}
                              className="absolute -bottom-0.5 -right-0.5 z-20 size-3 cursor-nwse-resize rounded-sm border border-white bg-blue-700 shadow"
                            />
                          )}
                        </div>
                      ))}
                    {drawDraft && drawStartRef.current?.page === index && (
                      <div className="pointer-events-none absolute border-2 border-dashed border-blue-600 bg-blue-200/40" style={{ left: `${drawDraft.x * 100}%`, top: `${drawDraft.y * 100}%`, width: `${drawDraft.width * 100}%`, height: `${drawDraft.height * 100}%` }} />
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      <Dialog open={emailOpen} onOpenChange={setEmailOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Email multiple PDF files</DialogTitle>
            <DialogDescription>Send the signed document and any additional PDFs to the customer. Attachments are sent privately from the CRM server.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <label className="grid gap-1 text-sm">To<Input type="email" value={emailTo} onChange={(event) => setEmailTo(event.target.value)} placeholder="customer@example.com" /></label>
            <label className="grid gap-1 text-sm">Subject<Input value={emailSubject} onChange={(event) => setEmailSubject(event.target.value)} /></label>
            <label className="grid gap-1 text-sm">Compose message<textarea className="min-h-28 rounded-md border bg-background p-3 text-sm" value={emailMessage} onChange={(event) => setEmailMessage(event.target.value)} placeholder="Write your message to the customer…" /></label>
            <label className="grid gap-1 text-sm">Company email signature<textarea className="min-h-24 rounded-md border bg-background p-3 text-sm" value={companySignature} onChange={(event) => setCompanySignature(event.target.value)} placeholder="Your name, company, phone, website…" /></label>
            {sourceBytes && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={includeCurrentPdf} onChange={(event) => setIncludeCurrentPdf(event.target.checked)} /> Attach current PDF ({sourceFileName})</label>}
            <label className="grid gap-1 text-sm">Add more PDF files<input type="file" accept="application/pdf,.pdf" multiple onChange={(event) => { const incoming = Array.from(event.target.files ?? []); setEmailFiles((current) => [...current, ...incoming.filter((file) => !current.some((item) => item.name === file.name && item.size === file.size && item.lastModified === file.lastModified))]); event.target.value = ""; }} /></label>
            {emailFiles.length > 0 && <ul className="space-y-1 text-xs">{emailFiles.map((file, index) => <li key={`${file.name}-${file.size}-${file.lastModified}`} className="flex items-center justify-between gap-2 rounded border p-2"><span className="truncate">{file.name} · {(file.size / 1024 / 1024).toFixed(1)} MB</span><Button type="button" size="sm" variant="ghost" onClick={() => setEmailFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))}>Remove</Button></li>)}</ul>}
            <p className="text-xs text-muted-foreground">{savedAttachments.length + emailFiles.length + (includeCurrentPdf && sourceBytes ? 1 : 0)} PDF attachment(s) selected. Combined limit: 20 MB.</p>
            <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setEmailOpen(false)}>Cancel</Button><Button onClick={() => void sendEmail()} disabled={emailBusy || !emailTo.trim()}>{emailBusy ? "Sending…" : <><Send className="mr-1 size-4" /> Send email</>}</Button></div>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={clientFieldOpen} onOpenChange={setClientFieldOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{selected ? fieldLabel[selected.kind] : "Complete field"}</DialogTitle>
            <DialogDescription>Enter the information requested on the contract.</DialogDescription>
          </DialogHeader>
          {selected && (
            <Input
              autoFocus
              value={selected.value}
              onChange={(event) => updateField(selected.id, { value: event.target.value })}
              placeholder={selected ? fieldLabel[selected.kind] : "Enter text"}
            />
          )}
          <div className="flex justify-end">
            <Button onClick={() => setClientFieldOpen(false)}>Apply</Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={signatureOpen} onOpenChange={setSignatureOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Add signature</DialogTitle>
            <DialogDescription>
              Draw your signature or type your name in a cursive style. It will be embedded into the
              exported PDF.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2">
            <Button
              variant={signatureMode === "draw" ? "default" : "outline"}
              onClick={() => setSignatureMode("draw")}
            >
              Draw
            </Button>
            <Button
              variant={signatureMode === "type" ? "default" : "outline"}
              onClick={() => setSignatureMode("type")}
            >
              Type to sign
            </Button>
          </div>
          {signatureMode === "draw" ? (
            <div className="rounded-md border bg-white">
              <SignatureCanvas
                ref={signatureRef}
                penColor="#111827"
                canvasProps={{ width: 700, height: 220, className: "h-44 w-full touch-none" }}
              />
            </div>
          ) : (
            <Input
              value={typedSignature}
              onChange={(e) => setTypedSignature(e.target.value)}
              placeholder="Type full legal name"
              className="h-16 text-2xl italic"
              style={{ fontFamily: "cursive" }}
            />
          )}
          <div className="flex justify-between">
            <Button
              variant="outline"
              onClick={() => {
                signatureRef.current?.clear();
                setTypedSignature("");
              }}
            >
              Clear
            </Button>
            <Button onClick={saveSignature}>
              <Check className="mr-1 size-4" />
              Apply signature
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}

export default PdfContractSigner;
