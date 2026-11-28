import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { invoiceProjectLinksQuery } from "./cost-data";
import { invoicesQuery, jobsQuery } from "./operations-data";
import { Choice } from "./CrmControls";
export function InvoiceAllocations() {
  const invoices = useQuery(invoicesQuery),
    jobs = useQuery(jobsQuery),
    links = useQuery(invoiceProjectLinksQuery),
    qc = useQueryClient();
  return (
    <section className="mt-8 border-t border-border pt-6">
      <h3 className="mb-4 text-lg font-bold">Invoice project allocation</h3>
      {(invoices.data ?? [])
        .filter((i) => i.status === "issued")
        .map((i) => (
          <div
            key={i.id}
            className="grid items-center gap-3 border-b border-border py-4 sm:grid-cols-2"
          >
            <div>
              <p className="font-semibold">
                #{i.number} · {i.title}
              </p>
              <p className="text-xs text-muted-foreground">{i.customer_name}</p>
            </div>
            <Choice
              label="Project allocation"
              value={links.data?.find((l) => l.invoice_id === i.id)?.job_id ?? "none"}
              onChange={async (v) => {
                if (!i.company_id) {
                  toast.error("Invoice is missing verified company ownership");
                  return;
                }
                const selectedJob = jobs.data?.find((job) => job.id === v);
                if (v !== "none" && selectedJob?.company_id !== i.company_id) {
                  toast.error("Invoice and project must belong to the same company");
                  return;
                }
                const result =
                  v === "none"
                    ? await supabase
                        .from("invoice_project_links")
                        .delete()
                        .eq("invoice_id", i.id)
                        .eq("company_id", i.company_id)
                    : await supabase
                        .from("invoice_project_links")
                        .upsert({ invoice_id: i.id, job_id: v, company_id: i.company_id });
                if (result.error)
                  toast.error("Invoice and project must have the same customer and property");
                else await qc.invalidateQueries({ queryKey: ["invoice-project-links"] });
              }}
              options={[
                { value: "none", label: "Unallocated invoice" },
                ...(jobs.data ?? [])
                  .filter(
                    (j) =>
                      j.company_id === i.company_id &&
                      j.lead_id &&
                      j.lead_id === i.lead_id &&
                      (!j.property_id || !i.property_id || j.property_id === i.property_id),
                  )
                  .map((j) => ({ value: j.id, label: j.title })),
              ]}
            />
          </div>
        ))}
      {!invoices.data?.some((i) => i.status === "issued") && (
        <p className="text-sm text-muted-foreground">No issued invoices to allocate.</p>
      )}
    </section>
  );
}
