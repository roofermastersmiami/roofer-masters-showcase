import type { ReactNode } from "react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Lead } from "./data";
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid min-w-0 gap-1.5 text-sm font-semibold text-foreground">
      {label}
      {children}
    </label>
  );
}
export function NumberField({
  label,
  value,
  onChange,
  max,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  max?: number;
}) {
  return (
    <Field label={label}>
      <Input
        type="number"
        aria-label={label}
        min={0}
        max={max}
        step="0.01"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </Field>
  );
}
export function Choice({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <Field label={label}>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger aria-label={label} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}
export function CustomerSelect({
  leads,
  value,
  onChange,
  optional = false,
}: {
  leads: Lead[];
  value: string;
  onChange: (v: string) => void;
  optional?: boolean;
}) {
  return (
    <Choice
      label="Customer"
      value={value || "none"}
      onChange={(v) => onChange(v === "none" ? "" : v)}
      options={[
        { value: "none", label: optional ? "No customer" : "Choose customer" },
        ...leads.map((l) => ({
          value: l.id,
          label: `${l.name}${l.address ? ` · ${l.address}` : ""}`,
        })),
      ]}
    />
  );
}
export function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="border-y border-border py-12 text-center text-sm text-muted-foreground">
      {children}
    </p>
  );
}
export function SectionHeading({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-2xl font-bold text-foreground">{title}</h2>
      {action}
    </div>
  );
}
