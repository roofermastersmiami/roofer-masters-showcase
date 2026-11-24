import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowRight, Download, FileText, MapPin, Search, Trash2 } from "lucide-react";
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
import { deleteRoofOrder } from "@/lib/roof-orders.functions";
import { customersQuery } from "./foundation-data";
import { roofOrdersQuery, type RoofOrder } from "./roof-orders-data";
import { downloadPdf } from "./proposal-data";
import { Empty, SectionHeading } from "./CrmControls";

export function RoofReports({
  onOpenMeasurement,
}: {
  onOpenMeasurement: (reportId: string) => void;
}) {
  const customers = useQuery(customersQuery);
  const orders = useQuery(roofOrdersQuery);
  const qc = useQueryClient();
  const remove = useServerFn(deleteRoofOrder);
  const [search, setSearch] = useState("");
  const [swipedReportId, setSwipedReportId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{ id: string; address: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const touchStartX = useRef<number | null>(null);

  async function downloadReport(row: RoofOrder) {
    if (!row.file_path) return;
    try {
      const { data, error } = await supabase.storage
        .from("roofing-proposals")
        .download(row.file_path);
      if (error || !data) throw error ?? new Error("PDF file not found");
      downloadPdf(new Uint8Array(await data.arrayBuffer()), row.title || "Roof measurement report");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not download roof report PDF");
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await remove({ data: { id: pendingDelete.id } });
      await qc.invalidateQueries({ queryKey: ["roof-report-orders"] });
      setSwipedReportId(null);
      setPendingDelete(null);
      toast.success(
        "Roof report deleted. Saved drawing revisions and customer property were kept.",
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not delete roof report");
    } finally {
      setDeleting(false);
    }
  }

  const query = search.trim().toLocaleLowerCase();
  const rows = (orders.data ?? []).filter((row) => {
    if (!row.file_path) return false;
    const customerName =
      customers.data?.find((customer) => customer.id === row.customer_id)?.name ?? "";
    return `${customerName} ${row.address} ${row.title}`.toLocaleLowerCase().includes(query);
  });

  return (
    <div>
      <SectionHeading title="Roof reports" />
      <div className="mb-6 flex flex-wrap items-center gap-4">
        <div className="relative w-full max-w-xl">
          <Search className="absolute left-3 top-3 size-4 text-muted-foreground" />
          <Input
            aria-label="Search roof reports by customer name or property address"
            placeholder="Search by customer name or property address…"
            className="pl-9"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <p className="text-sm text-muted-foreground">
          Completed measurement PDFs · Roofer Masters · Swipe left to delete
        </p>
      </div>
      {orders.error && (
        <p role="alert" className="text-destructive">
          Roof reports could not load.
        </p>
      )}
      {orders.isPending ? (
        <p>Loading roof reports…</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((row) => {
            const customerName =
              customers.data?.find((customer) => customer.id === row.customer_id)?.name ??
              "Customer property";
            return (
              <div
                key={row.id}
                className="relative min-w-0 overflow-hidden rounded-lg border border-border bg-destructive/10"
                onTouchStart={(event) => {
                  touchStartX.current = event.touches[0]?.clientX ?? null;
                }}
                onTouchEnd={(event) => {
                  const start = touchStartX.current;
                  touchStartX.current = null;
                  if (start === null) return;
                  const end = event.changedTouches[0]?.clientX;
                  if (end === undefined) return;
                  const delta = end - start;
                  if (delta < -55) setSwipedReportId(row.id);
                  else if (delta > 55) setSwipedReportId(null);
                }}
                onTouchCancel={() => {
                  touchStartX.current = null;
                }}
              >
                <div className="absolute inset-y-0 right-0 flex w-24 items-center justify-center">
                  <Button
                    variant="destructive"
                    size="icon"
                    aria-label={`Delete roof report for ${row.address}`}
                    title="Delete roof report"
                    onClick={() => setPendingDelete({ id: row.id, address: row.address })}
                  >
                    <Trash2 />
                  </Button>
                </div>
                <article
                  className="relative flex min-w-0 flex-col rounded-lg border border-border bg-card p-5 transition-transform duration-200 ease-out"
                  style={{
                    transform: swipedReportId === row.id ? "translateX(-6rem)" : "translateX(0)",
                  }}
                >
                  <div className="flex items-center gap-2 text-primary">
                    {row.file_path ? (
                      <FileText className="size-5" />
                    ) : (
                      <MapPin className="size-5" />
                    )}
                    <span className="text-xs font-semibold uppercase tracking-wide">
                      {row.file_path ? "Measurement PDF" : "Measurement in progress"}
                    </span>
                  </div>
                  <h2 className="mt-3 break-words font-bold">{customerName}</h2>
                  <p className="mt-1 break-words text-sm text-muted-foreground">{row.address}</p>
                  <p className="mt-3 text-xs text-muted-foreground">
                    {row.file_path
                      ? "PDF generated from the saved roof measurement drawing"
                      : row.drawing_id
                        ? "Drawing saved · PDF not generated yet"
                        : "Awaiting roof measurements"}
                    {" · "}
                    {new Date(row.created_at).toLocaleDateString()}
                  </p>
                  <div className="mt-auto flex flex-wrap gap-2 pt-5">
                    {row.file_path && (
                      <Button onClick={() => void downloadReport(row)}>
                        <Download /> Download PDF
                      </Button>
                    )}
                    <Button variant="outline" onClick={() => onOpenMeasurement(row.id)}>
                      {row.file_path ? "Open measurements" : "Continue measurements"} <ArrowRight />
                    </Button>
                  </div>
                </article>
              </div>
            );
          })}
        </div>
      )}
      {!orders.isPending && !orders.error && !rows.length && (
        <Empty>
          {query
            ? "No roof reports match that customer name or address."
            : "No roof measurement reports yet. Create one in Roof measurements."}
        </Empty>
      )}
      <Dialog
        open={!!pendingDelete}
        onOpenChange={(open) => {
          if (!open && !deleting) setPendingDelete(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this roof report?</DialogTitle>
            <DialogDescription>
              This permanently removes the report for {pendingDelete?.address ?? "this property"}.
              The customer and property record, saved roof drawing revisions, and linked estimate
              records are kept. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button variant="outline" disabled={deleting} onClick={() => setPendingDelete(null)}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={deleting} onClick={() => void confirmDelete()}>
              <Trash2 /> {deleting ? "Deleting…" : "Delete report"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
