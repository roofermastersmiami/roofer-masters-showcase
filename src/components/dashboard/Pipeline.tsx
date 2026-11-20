import { LEAD_STATUSES, LEAD_STATUS_LABELS, type LeadStatus } from "@/lib/lead-schema";
import { formatWhen, useUpdateLead, type Lead } from "./data";
import { SourceBadge, STATUS_STYLES } from "./StatusBadge";
import { cn } from "@/lib/utils";
import { useState } from "react";

export function Pipeline({ leads, onOpen }: { leads: Lead[]; onOpen: (l: Lead) => void }) {
  const update = useUpdateLead();
  const [dragOver, setDragOver] = useState<LeadStatus | null>(null);

  return (
    <div className="no-scrollbar -mx-4 flex snap-x gap-4 overflow-x-auto px-4 pb-4 lg:mx-0 lg:grid lg:grid-cols-5 lg:px-0">
      {LEAD_STATUSES.map((status) => {
        const items = leads.filter((l) => l.status === status);
        return (
          <section
            key={status}
            onDragOver={(e) => { e.preventDefault(); setDragOver(status); }}
            onDragLeave={() => setDragOver(null)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(null);
              const id = e.dataTransfer.getData("text/plain");
              if (id) update.mutate({ id, status });
            }}
            className={cn(
              "flex w-[78%] shrink-0 snap-start flex-col rounded-2xl border border-border bg-muted/50 p-3 transition sm:w-[45%] lg:w-auto",
              dragOver === status && "border-primary bg-accent",
            )}
          >
            <header className="mb-3 flex items-center justify-between px-1">
              <h3 className="flex items-center gap-2 text-sm font-extrabold text-foreground">
                <span className={cn("size-2.5 rounded-full", STATUS_STYLES[status].split(" ")[0])} />
                {LEAD_STATUS_LABELS[status]}
              </h3>
              <span className="rounded-full bg-card px-2 py-0.5 text-xs font-bold text-muted-foreground">{items.length}</span>
            </header>
            <div className="flex min-h-24 flex-col gap-2">
              {items.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData("text/plain", l.id)}
                  onClick={() => onOpen(l)}
                  className="rounded-xl border border-border bg-card p-3 text-left shadow-card transition hover:-translate-y-0.5 hover:border-primary"
                >
                  <p className="font-bold text-foreground">{l.name}</p>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">{l.service || l.message || "—"}</p>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <SourceBadge source={l.source} />
                    <span className="text-[0.7rem] text-muted-foreground">{formatWhen(l.created_at)}</span>
                  </div>
                </button>
              ))}
              {items.length === 0 && <p className="px-1 py-6 text-center text-xs text-muted-foreground">Drop leads here</p>}
            </div>
          </section>
        );
      })}
    </div>
  );
}
