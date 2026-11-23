import {
  PIPELINE_STAGES,
  PIPELINE_LABELS,
  stageOf,
  type PipelineStage,
} from "@/lib/crm-foundation";
import { formatWhen, type Lead } from "./data";
import { SourceBadge } from "./StatusBadge";
import { useMoveStage } from "./foundation-data";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useState } from "react";

export function Pipeline({ leads, onOpen }: { leads: Lead[]; onOpen: (l: Lead) => void }) {
  const update = useMoveStage();
  const [dragOver, setDragOver] = useState<PipelineStage | null>(null);

  return (
    <div className="flex w-full snap-x gap-4 overflow-x-auto pb-5">
      {PIPELINE_STAGES.map((status) => {
        const items = leads.filter((l) => stageOf(l) === status);
        return (
          <section
            key={status}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(status);
            }}
            onDragLeave={() => setDragOver(null)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(null);
              const id = e.dataTransfer.getData("text/plain");
              if (id && leads.some((l) => l.id === id)) update.mutate({ id, stage: status });
            }}
            className={cn(
              "flex w-64 shrink-0 snap-start flex-col border-t-2 border-border bg-muted/40 p-3 transition",
              dragOver === status && "border-primary bg-accent",
            )}
          >
            <header className="mb-3 flex items-center justify-between px-1">
              <h3 className="flex items-center gap-2 text-sm font-extrabold text-foreground">
                {PIPELINE_LABELS[status]}
              </h3>
              <span className="rounded-full bg-card px-2 py-0.5 text-xs font-bold text-muted-foreground">
                {items.length}
              </span>
            </header>
            <div className="flex min-h-24 flex-col gap-2">
              {items.map((l) => (
                <Button
                  variant="outline"
                  key={l.id}
                  type="button"
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData("text/plain", l.id)}
                  onClick={() => onOpen(l)}
                  className="h-auto w-full flex-col items-stretch rounded-lg bg-card p-3 text-left transition hover:border-primary"
                >
                  <p className="font-bold text-foreground">{l.name}</p>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {l.service || l.message || "—"}
                  </p>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <SourceBadge source={l.source} />
                    <span className="text-[0.7rem] text-muted-foreground">
                      {formatWhen(l.created_at)}
                    </span>
                  </div>
                </Button>
              ))}
              {items.length === 0 && (
                <p className="px-1 py-6 text-center text-xs text-muted-foreground">
                  Drop leads here
                </p>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
