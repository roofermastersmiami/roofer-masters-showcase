import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Download, FileText, MapPin, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
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
  const [search, setSearch] = useState("");

  async function downloadReport(row: RoofOrder) {
    if (!row.file_path) return;
    try {
      const { data, error } = await supabase.storage.from("roofing-proposals").download(row.file_path);
      if (error || !data) throw error ?? new Error("PDF file not found");
      downloadPdf(new Uint8Array(await data.arrayBuffer()), row.title || "Roof measurement report");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not download roof report PDF");
    }
  }

  const query = search.trim().toLocaleLowerCase();
  const rows = (orders.data ?? []).filter((row) => {
    const customerName = customers.data?.find((customer) => customer.id === row.customer_id)?.name ?? "";
    return `${customerName} ${row.address} ${row.title}`.toLocaleLowerCase().includes(query);
  });

  return (
    <div>
      <SectionHeading title="Roof reports" />
      <div className="mb-6 flex flex-wrap items-center gap-4">
        <div className="relative w-full max-w-xl">
          <Search className="absolute left-3 top-3 size-4 text-muted-foreground" />
          <Input aria-label="Search roof reports by customer name or property address"
            placeholder="Search by customer name or property address…"
            className="pl-9" value={search} onChange={(event) => setSearch(event.target.value)} />
        </div>
        <p className="text-sm text-muted-foreground">Completed measurement PDFs · Roofer Masters</p>
      </div>
      {orders.error && <p role="alert" className="text-destructive">Roof reports could not load.</p>}
      {orders.isPending ? <p>Loading roof reports…</p> : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((row) => {
            const customerName = customers.data?.find((customer) => customer.id === row.customer_id)?.name ?? "Customer property";
            return (
              <article key={row.id} className="flex min-w-0 flex-col rounded-lg border border-border bg-card p-5">
                <div className="flex items-center gap-2 text-primary">
                  {row.file_path ? <FileText className="size-5" /> : <MapPin className="size-5" />}
                  <span className="text-xs font-semibold uppercase tracking-wide">
                    {row.file_path ? "Measurement PDF" : "Measurement in progress"}
                  </span>
                </div>
                <h2 className="mt-3 break-words font-bold">{customerName}</h2>
                <p className="mt-1 break-words text-sm text-muted-foreground">{row.address}</p>
                <p className="mt-3 text-xs text-muted-foreground">
                  {row.file_path ? "PDF generated from the saved roof measurement drawing" :
                    row.drawing_id ? "Drawing saved · PDF not generated yet" : "Awaiting roof measurements"}
                  {" · "}{new Date(row.created_at).toLocaleDateString()}
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
            );
          })}
        </div>
      )}
      {!orders.isPending && !orders.error && !rows.length && (
        <Empty>{query ? "No roof reports match that customer name or address." : "No roof measurement reports yet. Create one in Roof measurements."}</Empty>
      )}
    </div>
  );
}
