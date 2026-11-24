import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, MapPin, Ruler } from "lucide-react";
import { Button } from "@/components/ui/button";
import { customersQuery } from "./foundation-data";
import { drawingsQuery } from "./roof-data";
import { roofOrdersQuery } from "./roof-orders-data";
import { RoofMeasurements } from "./RoofMeasurements";
import { Empty, SectionHeading } from "./CrmControls";

export function RoofMeasurementsTab({
  selectedReportId,
  onSelectReport,
}: {
  selectedReportId: string | null;
  onSelectReport: (reportId: string | null) => void;
}) {
  const orders = useQuery(roofOrdersQuery);
  const drawings = useQuery(drawingsQuery);
  const customers = useQuery(customersQuery);
  const [activeId, setActiveId] = useState<string | null>(selectedReportId);

  useEffect(() => {
    setActiveId(selectedReportId);
  }, [selectedReportId]);

  const report = orders.data?.find((item) => item.id === activeId);
  const drawing = report
    ? drawings.data?.find((item) => item.id === report.drawing_id) ?? null
    : null;

  if (activeId && report) {
    return (
      <div>
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Roof measurements · Linked report
            </p>
            <h1 className="mt-1 break-words text-lg font-bold">{report.address}</h1>
            <p className="text-sm text-muted-foreground">
              {customers.data?.find((customer) => customer.id === report.customer_id)?.name ?? "Customer property"}
              {" · "}{report.title}
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() => {
              setActiveId(null);
              onSelectReport(null);
            }}
          >
            <ArrowLeft /> All measurements
          </Button>
        </div>
        {drawings.isPending ? (
          <p>Loading saved roof drawing…</p>
        ) : drawings.error ? (
          <p role="alert" className="text-destructive">Saved measurements could not load. Refresh before editing.</p>
        ) : (
          <RoofMeasurements key={report.id} report={report} initialDrawing={drawing} />
        )}
      </div>
    );
  }

  if (activeId && orders.isPending) {
    return <p className="py-12 text-center text-muted-foreground">Loading linked roof report…</p>;
  }

  if (activeId && !report) {
    return (
      <div className="grid gap-4">
        <p role="alert" className="text-destructive">This roof report could not be found. Return to Roof reports and select it again.</p>
        <Button variant="outline" onClick={() => { setActiveId(null); onSelectReport(null); }}>
          <ArrowLeft /> All measurements
        </Button>
      </div>
    );
  }

  const rows = orders.data ?? [];
  return (
    <div>
      <SectionHeading title="Roof measurements" />
      <p className="mb-5 text-sm text-muted-foreground">
        Open a linked roof report to continue its 2D plan, 3D roof model, measurements, and takeoff.
      </p>
      {orders.error || drawings.error ? (
        <p role="alert" className="mb-4 text-destructive">Roof measurement records could not load.</p>
      ) : orders.isPending || drawings.isPending ? (
        <p>Loading roof measurement records…</p>
      ) : rows.length ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((row) => {
            const customer = customers.data?.find((item) => item.id === row.customer_id);
            const savedDrawing = drawings.data?.find((item) => item.id === row.drawing_id);
            return (
              <article key={row.id} className="flex min-w-0 flex-col rounded-lg border border-border bg-card p-5">
                <div className="flex items-center gap-2 text-primary">
                  <Ruler className="size-5" />
                  <span className="text-xs font-semibold uppercase tracking-wide">Measurement workspace</span>
                </div>
                <h2 className="mt-3 break-words font-bold">{row.address}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{customer?.name ?? "Customer property"}</p>
                <p className="mt-3 text-xs text-muted-foreground">
                  {savedDrawing ? "Saved drawing available" : "No drawing saved yet"}
                  {" · "}
                  {row.status === "reviewed" ? "Owner reviewed" : "Preliminary / awaiting review"}
                </p>
                <Button className="mt-5" variant="outline" onClick={() => { setActiveId(row.id); onSelectReport(row.id); }}>
                  <MapPin /> Open 2D / 3D workspace
                </Button>
              </article>
            );
          })}
        </div>
      ) : (
        <Empty>No roof reports are linked yet. Create a report in the Roof reports tab, then open it here to measure the roof.</Empty>
      )}
    </div>
  );
}
