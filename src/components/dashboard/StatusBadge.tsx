import { LEAD_SOURCE_LABELS, LEAD_STATUS_LABELS, type LeadSource, type LeadStatus } from "@/lib/lead-schema";
import { cn } from "@/lib/utils";

export const STATUS_STYLES: Record<LeadStatus, string> = {
  new: "bg-primary text-primary-foreground",
  contacted: "bg-accent text-accent-foreground",
  estimate_sent: "bg-warning/20 text-foreground",
  won: "bg-success/15 text-success",
  lost: "bg-muted text-muted-foreground",
};

export function StatusBadge({ status, className }: { status: LeadStatus; className?: string }) {
  return (
    <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold", STATUS_STYLES[status], className)}>
      {LEAD_STATUS_LABELS[status]}
    </span>
  );
}

export function SourceBadge({ source }: { source: LeadSource }) {
  return (
    <span className="inline-flex items-center rounded-full border border-border px-2.5 py-0.5 text-xs font-semibold text-muted-foreground">
      {LEAD_SOURCE_LABELS[source]}
    </span>
  );
}
