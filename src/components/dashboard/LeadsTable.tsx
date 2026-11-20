import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LEAD_SOURCES, LEAD_SOURCE_LABELS, LEAD_STATUSES, LEAD_STATUS_LABELS } from "@/lib/lead-schema";
import { formatWhen, type Lead } from "./data";
import { SourceBadge, StatusBadge } from "./StatusBadge";

export function LeadsTable({ leads, onOpen }: { leads: Lead[]; onOpen: (l: Lead) => void }) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [source, setSource] = useState("all");

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return leads.filter(
      (l) =>
        (status === "all" || l.status === status) &&
        (source === "all" || l.source === source) &&
        (!term || [l.name, l.phone, l.email, l.service, l.message].some((v) => v?.toLowerCase().includes(term))),
    );
  }, [leads, q, status, source]);

  return (
    <div>
      <div className="grid gap-2 sm:grid-cols-[1fr_180px_200px]">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, phone, email…" className="h-11 pl-9" />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All stages</SelectItem>
            {LEAD_STATUSES.map((s) => <SelectItem key={s} value={s}>{LEAD_STATUS_LABELS[s]}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={source} onValueChange={setSource}>
          <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All form types</SelectItem>
            {LEAD_SOURCES.map((s) => <SelectItem key={s} value={s}>{LEAD_SOURCE_LABELS[s]}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="mt-4 overflow-hidden rounded-2xl border border-border bg-card shadow-card">
        {filtered.length === 0 ? (
          <p className="p-10 text-center text-sm text-muted-foreground">No submissions match.</p>
        ) : (
          <ul className="divide-y divide-border">
            {filtered.map((l) => (
              <li key={l.id}>
                <button type="button" onClick={() => onOpen(l)} className="grid w-full gap-1 px-4 py-3 text-left transition hover:bg-muted/60 sm:grid-cols-[1.3fr_1fr_1fr_auto] sm:items-center sm:gap-4">
                  <span>
                    <span className="block font-bold text-foreground">{l.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">{l.message || l.service || "—"}</span>
                  </span>
                  <span className="text-sm text-foreground">{l.phone || l.email || "—"}</span>
                  <span className="flex flex-wrap gap-1.5"><StatusBadge status={l.status} /><SourceBadge source={l.source} /></span>
                  <span className="text-xs text-muted-foreground">{formatWhen(l.created_at)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
