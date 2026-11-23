import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { money } from "@/lib/crm-schema";
import { proposalMetrics } from "@/lib/crm-reporting";
import { invoicesQuery, allSharesQuery, paymentsQuery } from "./operations-data";
import { proposalsQuery } from "./proposal-data";
import { SectionHeading, Choice } from "./CrmControls";
import type { Lead } from "./data";
export function SalesReport({ leads }: { leads: Lead[] }) {
  const [period, setPeriod] = useState("90");
  const proposals = useQuery(proposalsQuery);
  const invoices = useQuery(invoicesQuery);
  const shares = useQuery(allSharesQuery);
  const payments = useQuery(paymentsQuery);
  const cutoff = period === "all" ? 0 : Date.now() - Number(period) * 864e5;
  const rows = leads.filter((l) => Date.parse(l.created_at) >= cutoff);
  const props = (proposals.data ?? []).filter((p) => Date.parse(p.created_at) >= cutoff);
  const invs = (invoices.data ?? []).filter(
    (i) => i.status === "issued" && Date.parse(i.created_at) >= cutoff,
  );
  const paid = (payments.data ?? []).filter((p) => Date.parse(p.received_at) >= cutoff);
  const metrics = proposalMetrics(props, shares.data ?? []);
  const collected = paid.reduce((n, p) => n + p.amount_cents, 0);
  const outstanding = invs.reduce((n, i) => n + i.total_cents - i.paid_cents, 0);
  const sourceCounts = Object.entries(
    rows.reduce<Record<string, number>>((acc, l) => {
      acc[l.source] = (acc[l.source] ?? 0) + 1;
      return acc;
    }, {}),
  );
  const serviceCounts = Object.entries(
    rows.reduce<Record<string, number>>((acc, l) => {
      const service = l.service || "Unspecified";
      acc[service] = (acc[service] ?? 0) + 1;
      return acc;
    }, {}),
  ).sort((a, b) => b[1] - a[1]);
  const serviceSales = serviceCounts.map(([service, count]) => {
    const ids = new Set(
      rows.filter((l) => (l.service || "Unspecified") === service).map((l) => l.id),
    );
    return {
      service,
      count,
      won: rows.filter((l) => ids.has(l.id) && l.status === "won").length,
      revenue: paid
        .filter((p) => {
          const invoice = invoices.data?.find((i) => i.id === p.invoice_id);
          return !!invoice?.lead_id && ids.has(invoice.lead_id);
        })
        .reduce((n, p) => n + p.amount_cents, 0),
    };
  });
  function exportCsv() {
    const csv = [
      ["Service", "Leads", "Won", "Collected USD"],
      ...serviceSales.map((s) => [s.service, s.count, s.won, (s.revenue / 100).toFixed(2)]),
    ]
      .map((row) => row.map((v) => `"${String(v).replaceAll('"', '""')}"`).join(","))
      .join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "roofer-masters-sales.csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <div>
      <SectionHeading
        title="Sales overview"
        action={
          <Button variant="outline" onClick={exportCsv}>
            <Download /> Export report
          </Button>
        }
      />
      <div className="mb-6 max-w-xs">
        <Choice
          label="Reporting period"
          value={period}
          onChange={setPeriod}
          options={[
            { value: "30", label: "Last 30 days" },
            { value: "90", label: "Last 90 days" },
            { value: "all", label: "All time" },
          ]}
        />
      </div>
      {(proposals.error || invoices.error || shares.error || payments.error) && (
        <p className="mb-5 text-destructive">
          Some sales records could not load. Refresh before relying on these totals.
        </p>
      )}
      <div className="grid grid-cols-2 gap-5 lg:grid-cols-4">
        {[
          ["Leads", String(rows.length)],
          ["Proposal acceptance", `${metrics.acceptance}%`],
          ["Collected", money(collected)],
          ["Open proposal value", money(metrics.expectedCents)],
        ].map(([label, value]) => (
          <div key={label} className="border-l-2 border-primary py-2 pl-4">
            <p className="text-xs uppercase text-muted-foreground">{label}</p>
            <p className="mt-2 break-words text-2xl font-bold text-foreground">{value}</p>
          </div>
        ))}
      </div>
      <div className="mt-5 flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground">
        <span>
          {metrics.accepted} accepted / {metrics.sent} shared proposals
        </span>
        <span>Outstanding invoices: {money(outstanding)}</span>
        <span>Won leads: {rows.filter((l) => l.status === "won").length}</span>
      </div>
      <div className="mt-10 grid gap-8 md:grid-cols-2">
        <section className="border-t border-border pt-5">
          <h3 className="mb-5 text-lg font-bold">Lead sources</h3>
          {sourceCounts.map(([source, count]) => (
            <div key={source} className="mb-5">
              <div className="mb-2 flex justify-between text-sm">
                <span className="capitalize">{source.replaceAll("_", " ")}</span>
                <span>{count}</span>
              </div>
              <Progress value={rows.length ? (count / rows.length) * 100 : 0} className="h-2" />
            </div>
          ))}
          {!sourceCounts.length && (
            <p className="text-sm text-muted-foreground">No leads in this period.</p>
          )}
        </section>
        <section className="border-t border-border pt-5">
          <h3 className="mb-5 flex items-center gap-2 text-lg font-bold">
            <TrendingUp className="size-5 text-primary" /> Roofing services
          </h3>
          {serviceSales.map((s) => (
            <div
              key={s.service}
              className="mb-4 flex flex-wrap justify-between gap-3 border-b border-border pb-4"
            >
              <div>
                <p className="text-sm font-semibold">{s.service}</p>
                <p className="text-xs text-muted-foreground">
                  {s.count} leads · {s.won} won
                </p>
              </div>
              <p className="text-sm font-bold">{money(s.revenue)}</p>
            </div>
          ))}
          {!serviceSales.length && (
            <p className="text-sm text-muted-foreground">No service activity in this period.</p>
          )}
        </section>
      </div>
    </div>
  );
}
