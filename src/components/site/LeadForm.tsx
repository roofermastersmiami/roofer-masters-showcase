import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useLocation } from "@tanstack/react-router";
import { CheckCircle2, Loader2, Phone, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { submitLead } from "@/lib/leads.functions";
import { leadFormSchema, type LeadSource } from "@/lib/lead-schema";
import { BUSINESS, SERVICE_OPTIONS } from "@/lib/site";
import { cn } from "@/lib/utils";

type Errors = Partial<Record<"name" | "phone" | "email" | "service" | "message", string>>;

export function LeadForm({
  source,
  title,
  subtitle,
  submitLabel,
  defaultService,
  compact = false,
  className,
}: {
  source: Exclude<LeadSource, "chat">;
  title?: string;
  subtitle?: string;
  submitLabel?: string;
  defaultService?: string;
  compact?: boolean;
  className?: string;
}) {
  const submit = useServerFn(submitLead);
  const location = useLocation();
  const [values, setValues] = useState({
    name: "",
    phone: "",
    email: "",
    service: defaultService ?? "",
    message: "",
    company: "",
  });
  const [errors, setErrors] = useState<Errors>({});
  const [status, setStatus] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [serverError, setServerError] = useState("");

  const set = (k: keyof typeof values) => (v: string) => {
    setValues((s) => ({ ...s, [k]: v }));
    setErrors((e) => ({ ...e, [k]: undefined }));
  };

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = leadFormSchema.safeParse({ ...values, source, page: location.pathname });
    if (!parsed.success) {
      const errs: Errors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as keyof Errors;
        if (!errs[key]) errs[key] = issue.message;
      }
      setErrors(errs);
      return;
    }
    setStatus("sending");
    setServerError("");
    try {
      await submit({ data: parsed.data });
      setStatus("done");
    } catch (err) {
      setStatus("error");
      setServerError(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  if (status === "done") {
    return (
      <div className={cn("rounded-2xl border border-border bg-card p-8 text-center shadow-elegant", className)}>
        <CheckCircle2 className="mx-auto size-14 text-success" />
        <h3 className="mt-4 text-2xl font-black text-foreground">Thank you, {values.name.split(" ")[0]}!</h3>
        <p className="mt-2 text-muted-foreground">
          We received your request and a member of our team will reach out soon. Need us right
          now?
        </p>
        <Button asChild variant="call" size="tap" className="mt-6">
          <a href={BUSINESS.phoneHref}>
            <Phone /> Call {BUSINESS.phoneDisplay}
          </a>
        </Button>
      </div>
    );
  }

  const field = "h-12 rounded-xl bg-background text-base";
  return (
    <form
      onSubmit={onSubmit}
      noValidate
      className={cn("rounded-2xl border border-border bg-card p-5 shadow-elegant sm:p-7", className)}
    >
      {title && <h3 className="text-2xl font-black text-foreground">{title}</h3>}
      {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}

      <div className={cn("mt-5 grid gap-4", !compact && "sm:grid-cols-2")}>
        <FieldWrap id={`${source}-name`} label="Full name" error={errors.name}>
          <Input id={`${source}-name`} autoComplete="name" value={values.name} onChange={(e) => set("name")(e.target.value)} className={field} placeholder="Your name" aria-invalid={!!errors.name} />
        </FieldWrap>
        <FieldWrap id={`${source}-phone`} label="Phone" error={errors.phone}>
          <Input id={`${source}-phone`} type="tel" inputMode="tel" autoComplete="tel" value={values.phone} onChange={(e) => set("phone")(e.target.value)} className={field} placeholder="(305) 555-0123" aria-invalid={!!errors.phone} />
        </FieldWrap>
        <FieldWrap id={`${source}-email`} label="Email (optional)" error={errors.email}>
          <Input id={`${source}-email`} type="email" inputMode="email" autoComplete="email" value={values.email} onChange={(e) => set("email")(e.target.value)} className={field} placeholder="you@email.com" aria-invalid={!!errors.email} />
        </FieldWrap>
        <FieldWrap id={`${source}-service`} label="Service needed" error={errors.service}>
          <Select value={values.service} onValueChange={set("service")}>
            <SelectTrigger id={`${source}-service`} className={cn(field, "w-full")}>
              <SelectValue placeholder="Choose a service" />
            </SelectTrigger>
            <SelectContent>
              {SERVICE_OPTIONS.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FieldWrap>
        <FieldWrap id={`${source}-message`} label="Message" error={errors.message} className={!compact ? "sm:col-span-2" : ""}>
          <Textarea id={`${source}-message`} value={values.message} onChange={(e) => set("message")(e.target.value)} rows={compact ? 3 : 4} className="rounded-xl bg-background text-base" placeholder="Tell us about your roof, leak or project…" />
        </FieldWrap>
      </div>

      {/* Honeypot */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>
          Company
          <input tabIndex={-1} autoComplete="off" value={values.company} onChange={(e) => set("company")(e.target.value)} />
        </label>
      </div>

      {status === "error" && (
        <p role="alert" className="mt-4 rounded-lg bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive">
          {serverError}
        </p>
      )}

      <Button type="submit" variant="hero" size="tap" className="mt-5" disabled={status === "sending"}>
        {status === "sending" ? <Loader2 className="animate-spin" /> : <Send />}
        {submitLabel ?? "Request a Call Back"}
      </Button>
      <p className="mt-3 text-center text-xs text-muted-foreground">
        Prefer to talk now? Call <a href={BUSINESS.phoneHref} className="font-bold text-primary">{BUSINESS.phoneDisplay}</a> · Hablamos español
      </p>
    </form>
  );
}

function FieldWrap({
  id,
  label,
  error,
  children,
  className,
}: {
  id: string;
  label: string;
  error?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("grid gap-1.5", className)}>
      <Label htmlFor={id} className="text-sm font-semibold text-foreground">
        {label}
      </Label>
      {children}
      {error && <p className="text-xs font-medium text-destructive">{error}</p>}
    </div>
  );
}
