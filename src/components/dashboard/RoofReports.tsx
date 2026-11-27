import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  Download,
  Eye,
  FileText,
  MapPin,
  PenLine,
  Search,
  ZoomIn,
  ZoomOut,
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
import { DeleteRoofReportButton } from "./DeleteRoofReport";
import { EditSketchButton } from "./EditSketchButton";
import { customersQuery } from "./foundation-data";
import { drawingsQuery } from "./roof-data";
import { roofOrdersQuery, type RoofOrder } from "./roof-orders-data";
import { downloadPdf } from "./proposal-data";
import { Empty, SectionHeading } from "./CrmControls";
import { PdfContractSigner } from "@/components/PdfContractSigner";

export function RoofReports({
  onOpenMeasurement,
}: {
  onOpenMeasurement: (reportId: string) => void;
}) {
  const customers = useQuery(customersQuery);
  const orders = useQuery(roofOrdersQuery);
  const drawings = useQuery(drawingsQuery);
  const [search, setSearch] = useState("");
  const [swipedReportId, setSwipedReportId] = useState<string | null>(null);
  const [viewingReport, setViewingReport] = useState<RoofOrder | null>(null);
  const [signingReport, setSigningReport] = useState<RoofOrder | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [zoom, setZoom] = useState(1);
  useEffect(
    () => () => {
      if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    },
    [pdfUrl],
  );
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

  async function viewReport(row: RoofOrder) {
    if (!row.file_path) return;
    setViewingReport(row);
    setPdfLoading(true);
    setZoom(1);
    try {
      const { data, error } = await supabase.storage
        .from("roofing-proposals")
        .download(row.file_path);
      if (error || !data) throw error ?? new Error("PDF file not found");
      const nextUrl = URL.createObjectURL(new Blob([data], { type: "application/pdf" }));
      setPdfUrl((previous) => {
        if (previous) URL.revokeObjectURL(previous);
        return nextUrl;
      });
    } catch (error) {
      setViewingReport(null);
      toast.error(error instanceof Error ? error.message : "Could not open roof report PDF");
    } finally {
      setPdfLoading(false);
    }
  }

  const query = search.trim().toLocaleLowerCase();
  const rows = (orders.data ?? []).filter((row) => {
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
          Roof reports, measurement PDFs, and customer contract signing · Use a card's Delete button
          to remove a report
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
            const savedDrawing =
              drawings.data?.find((drawing) => drawing.id === row.drawing_id) ?? null;
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
                  <DeleteRoofReportButton
                    reportId={row.id}
                    address={row.address}
                    iconOnly
                    onDeleted={() => setSwipedReportId(null)}
                  />
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
                      <>
                        <Button variant="outline" onClick={() => void viewReport(row)}>
                          <Eye /> View PDF
                        </Button>
                        <Button onClick={() => void downloadReport(row)}>
                          <Download /> Download PDF
                        </Button>
                      </>
                    )}
                    <Button variant="outline" onClick={() => onOpenMeasurement(row.id)}>
                      {row.file_path ? "Open measurements" : "Continue measurements"} <ArrowRight />
                    </Button>
                    <EditSketchButton report={row} drawingRow={savedDrawing} />
                    <Button onClick={() => setSigningReport(row)}>
                      <PenLine /> Fill &amp; Sign
                    </Button>
                    <DeleteRoofReportButton reportId={row.id} address={row.address} />
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
        open={!!viewingReport}
        onOpenChange={(open) => {
          if (!open) {
            setViewingReport(null);
            setPdfUrl((previous) => {
              if (previous) URL.revokeObjectURL(previous);
              return null;
            });
            setZoom(1);
          }
        }}
      >
        <DialogContent className="flex h-[92vh] w-[96vw] max-w-6xl flex-col gap-3">
          <DialogHeader>
            <DialogTitle className="break-words">
              {viewingReport?.title || "Roof measurement report"}
            </DialogTitle>
            <DialogDescription>{viewingReport?.address}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-3">
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label="Zoom out"
                disabled={zoom <= 0.5}
                onClick={() => setZoom((value) => Math.max(0.5, Number((value - 0.25).toFixed(2))))}
              >
                <ZoomOut />
              </Button>
              <span className="min-w-14 text-center text-sm tabular-nums">
                {Math.round(zoom * 100)}%
              </span>
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label="Zoom in"
                disabled={zoom >= 2.5}
                onClick={() => setZoom((value) => Math.min(2.5, Number((value + 0.25).toFixed(2))))}
              >
                <ZoomIn />
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setZoom(1)}>
                Fit width
              </Button>
            </div>
            {viewingReport && (
              <Button type="button" onClick={() => void downloadReport(viewingReport)}>
                <Download /> Download PDF
              </Button>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-auto rounded-md bg-muted/50">
            {pdfLoading ? (
              <p className="p-6 text-sm text-muted-foreground">Loading PDF…</p>
            ) : pdfUrl ? (
              <div
                className="mx-auto"
                style={{
                  width: `${100 * zoom}%`,
                  height: `${100 * zoom}%`,
                  minHeight: `${70 * zoom}vh`,
                }}
              >
                <iframe
                  title="Roof measurement PDF preview"
                  src={pdfUrl}
                  className="h-full w-full border-0"
                />
              </div>
            ) : (
              <p className="p-6 text-sm text-muted-foreground">PDF preview is unavailable.</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!signingReport}
        onOpenChange={(open) => {
          if (!open) setSigningReport(null);
        }}
      >
        <DialogContent className="flex h-[94vh] w-[98vw] max-w-7xl flex-col gap-3 overflow-hidden">
          <DialogHeader>
            <DialogTitle>Fill &amp; Sign Contract</DialogTitle>
            <DialogDescription>
              Add signatures and contract fields to a PDF for{" "}
              {signingReport?.address ?? "this property"}.
            </DialogDescription>
          </DialogHeader>
          {signingReport && (
            <div className="min-h-0 flex-1 overflow-y-auto">
              <PdfContractSigner
                reportId={signingReport.id}
                leadId={
                  customers.data?.find((customer) => customer.id === signingReport.customer_id)
                    ?.source_lead_id ?? null
                }
                propertyAddress={signingReport.address}
                sourcePdfPath={signingReport.file_path}
                sourceBucket="roofing-proposals"
                onSaved={() => setSigningReport(null)}
              />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
