import { createFileRoute } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { BadgeCheck, CalendarDays, Check, FileText, Loader2, PenLine, Phone } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Logo } from "@/components/site/Logo";
import { SignaturePad } from "@/components/dashboard/SignaturePad";
import { renderPagePreview } from "@/lib/pdf-tools-browser";
import { pdfPageCount } from "@/lib/pdf-tools";
import { completeSignatureRequest, getPublicSignatureRequest } from "@/lib/pdf-signature.functions";
import {
  FIELD_LABELS,
  missingRequiredValues,
  type SignatureField,
} from "@/lib/pdf-signature-fields";

const signQuery = (token: string) =>
  queryOptions({
    queryKey: ["public-signature-request", token],
    queryFn: () => getPublicSignatureRequest({ data: { token } }),
    staleTime: 0,
  });

export const Route = createFileRoute("/sign/$token")({
  head: () => ({
    meta: [
      { title: "Sign your document | Roofer Masters" },
      {
        name: "description",
        content: "Review and sign your document from Roofer Masters.",
      },
      { property: "og:title", content: "Sign your document | Roofer Masters" },
      {
        property: "og:description",
        content: "Review and sign your document from Roofer Masters.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex, nofollow" },
      { name: "referrer", content: "no-referrer" },
    ],
  }),
  loader: ({ params, context }) => context.queryClient.ensureQueryData(signQuery(params.token)),
  component: SignDocument,
});

type PagePreviewData = { dataUrl: string; widthPt: number; heightPt: number };

function bytesToDataUrl(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return `data:image/png;base64,${btoa(binary)}`;
}

/** Render a typed name as a script-style signature image. */
function typedSignatureDataUrl(name: string): string {
  const canvas = document.createElement("canvas");
  canvas.width = 640;
  canvas.height = 170;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not available in this browser.");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#13202b";
  ctx.textBaseline = "middle";
  let size = 76;
  const fonts = '"Brush Script MT", "Segoe Script", "Snell Roundhand", "Apple Chancery", cursive';
  ctx.font = `italic ${size}px ${fonts}`;
  while (size > 24 && ctx.measureText(name).width > canvas.width - 32) {
    size -= 4;
    ctx.font = `italic ${size}px ${fonts}`;
  }
  ctx.fillText(name, 16, canvas.height / 2 + 6);
  return canvas.toDataURL("image/png");
}

function formatDateValue(isoDate: string): string {
  const parsed = new Date(`${isoDate}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return isoDate;
  return parsed.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function todayIso(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

function FieldFillControl({
  field,
  signerName,
  value,
  onChange,
}: {
  field: SignatureField;
  signerName: string;
  value: string | undefined;
  onChange: (value: string) => void;
}) {
  const [mode, setMode] = useState<"draw" | "type">("draw");
  const [typedName, setTypedName] = useState(signerName);
  const [dateIso, setDateIso] = useState(todayIso());

  useEffect(() => {
    if (field.type === "date" && !value) onChange(formatDateValue(todayIso()));
    if (field.type === "name" && !value) onChange(signerName);
    if (field.type === "initials" && !value) {
      const parts = signerName.trim().split(/\s+/);
      const initials = (
        (parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "")
      ).toUpperCase();
      if (initials) onChange(initials);
    }
    // Prefill once per field.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [field.id]);

  if (field.type === "signature") {
    return (
      <div className="grid gap-2">
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            variant={mode === "draw" ? "default" : "outline"}
            onClick={() => setMode("draw")}
          >
            Draw
          </Button>
          <Button
            type="button"
            size="sm"
            variant={mode === "type" ? "default" : "outline"}
            onClick={() => setMode("type")}
          >
            Type
          </Button>
        </div>
        {mode === "draw" ? (
          <SignaturePad onUse={(bytes) => onChange(bytesToDataUrl(bytes))} />
        ) : (
          <div className="grid gap-2">
            <Input
              value={typedName}
              onChange={(event) => setTypedName(event.target.value)}
              placeholder="Type your full name"
              maxLength={80}
            />
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={!typedName.trim()}
              onClick={() => onChange(typedSignatureDataUrl(typedName.trim()))}
            >
              <Check /> Use typed signature
            </Button>
          </div>
        )}
        {value && (
          <div className="rounded border bg-white p-2">
            <img src={value} alt="Your signature" className="max-h-20" />
            <p className="pt-1 text-xs font-medium text-primary">
              Signature ready — you can redraw or retype to change it.
            </p>
          </div>
        )}
      </div>
    );
  }
  if (field.type === "checkbox") {
    return (
      <label className="flex items-center gap-2 text-sm font-medium">
        <input
          type="checkbox"
          className="size-5"
          checked={value === "true"}
          onChange={(event) => onChange(event.target.checked ? "true" : "false")}
        />
        {field.label}
      </label>
    );
  }
  if (field.type === "date") {
    return (
      <div className="grid gap-1">
        <Input
          type="date"
          value={dateIso}
          onChange={(event) => {
            setDateIso(event.target.value);
            onChange(formatDateValue(event.target.value));
          }}
        />
        <p className="flex items-center gap-1 text-xs text-muted-foreground">
          <CalendarDays className="size-3.5" /> Will appear as {value || formatDateValue(dateIso)}
        </p>
      </div>
    );
  }
  return (
    <Input
      value={value ?? ""}
      onChange={(event) => onChange(event.target.value)}
      placeholder={field.type === "initials" ? "Your initials" : field.label}
      maxLength={field.type === "initials" ? 6 : 200}
      autoComplete={field.type === "name" ? "name" : undefined}
    />
  );
}

function SigningWorkspace({
  token,
  data,
}: {
  token: string;
  data: NonNullable<Awaited<ReturnType<typeof getPublicSignatureRequest>>>;
}) {
  const complete = useServerFn(completeSignatureRequest);
  const qc = useQueryClient();
  const [previews, setPreviews] = useState<PagePreviewData[]>([]);
  const [renderError, setRenderError] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [activeFieldId, setActiveFieldId] = useState<string | null>(data.fields[0]?.id ?? null);
  const [busy, setBusy] = useState(false);
  const pageRefs = useRef<Array<HTMLDivElement | null>>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(data.documentUrl);
        if (!response.ok) throw new Error("The document could not be downloaded.");
        const bytes = new Uint8Array(await response.arrayBuffer());
        const count = await pdfPageCount(bytes);
        const rendered: PagePreviewData[] = [];
        for (let index = 0; index < count; index++) {
          rendered.push(await renderPagePreview(bytes, index, 840));
        }
        if (!cancelled) setPreviews(rendered);
      } catch (error) {
        if (!cancelled)
          setRenderError(
            error instanceof Error
              ? `Could not load the document: ${error.message}`
              : "Could not load the document.",
          );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [data.documentUrl]);

  const orderedFields = useMemo(
    () => [...data.fields].sort((a, b) => a.page - b.page || b.y - a.y),
    [data.fields],
  );
  const missing = missingRequiredValues(data.fields, data.signerIndex, values);
  const filledRequired = data.fields.filter(
    (field) => field.required && !missing.includes(field.label),
  ).length;
  const requiredCount = data.fields.filter((field) => field.required).length;
  const activeField = data.fields.find((field) => field.id === activeFieldId) ?? null;

  const goToField = (field: SignatureField) => {
    setActiveFieldId(field.id);
    pageRefs.current[field.page]?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const isUnfilled = (field: SignatureField) => {
    const value = values[field.id];
    return field.type === "checkbox" ? value !== "true" : !value?.trim();
  };

  const goToNextField = () => {
    const next = orderedFields.find(
      (field) => field.id !== activeFieldId && field.required && isUnfilled(field),
    );
    if (next) goToField(next);
  };

  const submit = async () => {
    if (missing.length) {
      toast.error(`Please complete: ${missing.join(", ")}`);
      const first = orderedFields.find((field) => missing.includes(field.label));
      if (first) goToField(first);
      return;
    }
    setBusy(true);
    try {
      const result = await complete({ data: { token, values } });
      await qc.invalidateQueries({ queryKey: ["public-signature-request", token] });
      toast.success(
        result.requestCompleted
          ? "Document signed — thank you!"
          : "Your signature is recorded — thank you!",
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not record your signature");
    } finally {
      setBusy(false);
    }
  };

  if (data.signerCompletedAt) {
    return (
      <div className="mx-auto max-w-2xl rounded-lg border border-border bg-card p-6 text-center">
        <BadgeCheck className="mx-auto mb-3 size-10 text-primary" />
        <h1 className="text-xl font-bold">You signed this document</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Signed by {data.signerName} on {new Date(data.signerCompletedAt).toLocaleString()}.
          {data.requestCompleted
            ? " All signers have signed — the document is complete."
            : data.otherSignerPending
              ? " It will be final once the other signer signs."
              : ""}
        </p>
        <p className="mt-3 text-sm text-muted-foreground">
          Questions? Call Roofer Masters at 305-942-3093.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto grid max-w-6xl gap-4 lg:grid-cols-[1fr_340px]">
      <div className="grid gap-4">
        <div>
          <h1 className="text-2xl font-bold">{data.documentName}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Hi {data.signerName} — Roofer Masters asked you to sign this document. Tap each
            highlighted field, fill it in, and finish at the bottom.{" "}
            {requiredCount > 0 && `${filledRequired} of ${requiredCount} required fields done.`}
          </p>
        </div>
        {renderError && (
          <p
            role="alert"
            className="rounded border border-destructive/40 bg-destructive/10 p-3 text-sm"
          >
            {renderError}
          </p>
        )}
        {previews.length === 0 && !renderError && (
          <p className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="animate-spin" /> Loading your document…
          </p>
        )}
        {previews.map((preview, index) => (
          <div
            key={index}
            ref={(element) => {
              pageRefs.current[index] = element;
            }}
            className="relative mx-auto w-full max-w-[840px] bg-white shadow"
          >
            <img src={preview.dataUrl} alt={`Page ${index + 1}`} className="block w-full" />
            {data.fields
              .filter((field) => field.page === index)
              .map((field) => {
                const value = values[field.id];
                const filled =
                  field.type === "checkbox" ? value === "true" : Boolean(value?.trim());
                const active = field.id === activeFieldId;
                return (
                  <button
                    key={field.id}
                    type="button"
                    onClick={() => setActiveFieldId(field.id)}
                    className={`absolute box-border overflow-hidden rounded-sm border-2 text-left text-[12px] font-medium ${
                      filled
                        ? "border-green-600 bg-green-500/10 text-green-900"
                        : "border-amber-500 bg-amber-300/30 text-amber-900"
                    } ${active ? "ring-2 ring-primary ring-offset-1" : ""}`}
                    style={{
                      left: `${(field.x / preview.widthPt) * 100}%`,
                      top: `${((preview.heightPt - field.y - field.height) / preview.heightPt) * 100}%`,
                      width: `${(field.width / preview.widthPt) * 100}%`,
                      height: `${(field.height / preview.heightPt) * 100}%`,
                    }}
                  >
                    {field.type === "signature" && value ? (
                      <img src={value} alt="Signature" className="h-full w-full object-contain" />
                    ) : field.type === "checkbox" ? (
                      <span className="flex h-full items-center justify-center text-base">
                        {value === "true" ? "✓" : ""}
                      </span>
                    ) : value ? (
                      <span className="block truncate px-1 py-0.5">{value}</span>
                    ) : (
                      <span className="block px-1 py-0.5">
                        {FIELD_LABELS[field.type]}
                        {field.required ? " *" : ""}
                      </span>
                    )}
                  </button>
                );
              })}
          </div>
        ))}
      </div>

      <div className="lg:sticky lg:top-4 lg:self-start">
        <div className="grid gap-3 rounded-lg border border-border bg-card p-4">
          <h2 className="flex items-center gap-2 font-bold">
            <PenLine className="size-4" /> Your fields
          </h2>
          <ol className="grid gap-1.5">
            {orderedFields.map((field) => {
              const value = values[field.id];
              const filled = field.type === "checkbox" ? value === "true" : Boolean(value?.trim());
              return (
                <li key={field.id}>
                  <button
                    type="button"
                    onClick={() => goToField(field)}
                    className={`flex w-full items-center gap-2 rounded border px-2 py-1.5 text-left text-sm ${
                      field.id === activeFieldId ? "border-primary bg-primary/5" : ""
                    }`}
                  >
                    <span
                      className={`flex size-5 items-center justify-center rounded-full text-[11px] text-white ${
                        filled ? "bg-green-600" : "bg-amber-500"
                      }`}
                    >
                      {filled ? <Check className="size-3.5" /> : "!"}
                    </span>
                    {field.label} · page {field.page + 1}
                    {field.required ? "" : " (optional)"}
                  </button>
                </li>
              );
            })}
          </ol>
          {activeField && (
            <div className="grid gap-2 rounded border bg-muted/40 p-3">
              <p className="text-sm font-semibold">
                {activeField.label} — page {activeField.page + 1}
              </p>
              <FieldFillControl
                field={activeField}
                signerName={data.signerName}
                value={values[activeField.id]}
                onChange={(value) =>
                  setValues((current) => ({ ...current, [activeField.id]: value }))
                }
              />
              <Button type="button" variant="outline" size="sm" onClick={goToNextField}>
                Next field
              </Button>
            </div>
          )}
          <Button type="button" disabled={busy} onClick={() => void submit()}>
            {busy ? <Loader2 className="animate-spin" /> : <PenLine />} Finish &amp; sign
          </Button>
          <p className="text-xs text-muted-foreground">
            By signing you agree your electronic signature is the legal equivalent of your
            handwritten signature on this document.
          </p>
        </div>
      </div>
    </div>
  );
}

function SignDocument() {
  const { token } = Route.useParams();
  const { data } = useSuspenseQuery(signQuery(token));
  return (
    <div className="min-h-screen bg-muted">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-4">
          <Logo className="h-14" />
          <Button asChild variant="outline">
            <a href="tel:3059423093">
              <Phone /> 305-942-3093
            </a>
          </Button>
        </div>
      </header>
      <main className="p-4 sm:p-6">
        {data ? (
          <SigningWorkspace token={token} data={data} />
        ) : (
          <div className="py-20 text-center">
            <FileText className="mx-auto mb-4 size-10 text-muted-foreground" />
            <h1 className="text-2xl font-bold">Signing link unavailable</h1>
            <p className="mt-3 text-muted-foreground">
              This link has expired or been revoked. Call Roofer Masters at 305-942-3093 for a new
              one.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
