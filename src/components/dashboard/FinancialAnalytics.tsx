import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, FileText } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { actualProfit, projectInvoices } from "@/lib/advanced-estimate";
import { dashboardLedger } from "@/lib/crm-foundation";
import { money } from "@/lib/crm-schema";
import { getStripeEnvironment } from "@/lib/stripe";
import { expensesQuery, invoiceProjectLinksQuery } from "./cost-data";
import { invoicesQuery, paymentsQuery, jobsQuery } from "./operations-data";
import { Field, Choice, SectionHeading } from "./CrmControls";
import { InvoiceAllocations } from "./InvoiceAllocations";
export function FinancialAnalytics() {
  const expenses = useQuery(expensesQuery),
    invoices = useQuery(invoicesQuery),
    payments = useQuery(paymentsQuery),
    jobs = useQuery(jobsQuery),
    links = useQuery(invoiceProjectLinksQuery);
  const [from, setFrom] = useState(`${new Date().getFullYear()}-01-01`),
    [to, setTo] = useState(new Date().toISOString().slice(0, 10)),
    [project, setProject] = useState("all");
  const filteredInvoices = projectInvoices(invoices.data ?? [], links.data ?? [], project);
  const start = Date.parse(`${from}T00:00:00`),
    end = Date.parse(`${to}T23:59:59.999`);
  let env = "sandbox";
  let paymentSetupMissing = false;
  try {
    env = getStripeEnvironment();
  } catch {
    // Database defaults existing financial records to sandbox when payment setup is absent.
    paymentSetupMissing = true;
  }
  let ledger: ReturnType<typeof dashboardLedger>;
  let ledgerError = false;
  try {
    ledger = dashboardLedger(filteredInvoices, payments.data ?? [], env, start, end);
  } catch {
    // A malformed/stale query result must render an error state, never crash the CRM route.
    ledgerError = true;
    ledger = { collected: 0, sales: 0, outstanding: 0, received: [] };
  }
  const costs = (expenses.data ?? []).filter(
    (e) =>
      (project === "all" || e.job_id === project) && e.incurred_at >= from && e.incurred_at <= to,
  );
  const profit = actualProfit(ledger.collected, costs);
  // The financial ledger depends on invoices, payments, and expenses only.
  // Job names and invoice allocations are supporting data and must not hide the report.
  const failed =
    ledgerError ||
    !!(expenses.error || invoices.error || payments.error) ||
    (project !== "all" && !!links.error) ||
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start > end;
  const loading = expenses.isPending || payments.isPending || invoices.isPending;
  const sourceErrors = [
    expenses.error && `Expenses: ${expenses.error.message}`,
    invoices.error && `Invoices: ${invoices.error.message}`,
    payments.error && `Payments: ${payments.error.message}`,
    jobs.error && `Project list: ${jobs.error.message}`,
    links.error && `Project allocations: ${links.error.message}`,
    ledgerError && "Financial records contain unexpected or invalid values.",
    start > end && "The start date must be on or before the end date.",
  ].filter(Boolean);
  const rows = [
    ["Payments received", ledger.collected],
    ["Issued invoice sales", ledger.sales],
    ["Outstanding invoices", ledger.outstanding],
    ["Direct expenses", profit.direct],
    ["Business overhead", profit.overhead],
    ["Gross cash profit", profit.gross],
    ["Net cash profit", profit.net],
  ] as const;
  async function excel() {
    try {
      const { Workbook } = await import("exceljs");
      const workbook = new Workbook(),
        summary = workbook.addWorksheet("Recorded finances");
      summary.addRow(["Roofer Masters", from, to, env]);
      summary.addRow(["Metric", "USD"]);
      rows.forEach(([label, cents]) => summary.addRow([label, cents / 100]));
      summary.addRow([
        "Net cash margin",
        profit.margin === null ? "Not available" : `${profit.margin.toFixed(2)}%`,
      ]);
      const expense = workbook.addWorksheet("Recorded expenses");
      expense.addRow(["Date", "Description", "Category", "Project", "USD"]);
      costs.forEach((e) =>
        expense.addRow([
          e.incurred_at,
          e.description,
          e.category,
          jobs.data?.find((j) => j.id === e.job_id)?.title ?? "Business",
          e.amount_cents / 100,
        ]),
      );
      const payment = workbook.addWorksheet("Recorded payments");
      payment.addRow(["Received", "Invoice", "Method", "USD"]);
      ledger.received.forEach((p) => {
        const full = payments.data?.find(
          (x) => x.invoice_id === p.invoice_id && x.received_at === p.received_at,
        );
        payment.addRow([p.received_at, p.invoice_id, full?.method ?? "", p.amount_cents / 100]);
      });
      const bytes = await workbook.xlsx.writeBuffer();
      const url = URL.createObjectURL(
        new Blob([bytes], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = "roofer-masters-financials.xlsx";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      toast.error("Excel export failed");
    }
  }
  async function pdf() {
    try {
      const { PDFDocument, StandardFonts } = await import("pdf-lib");
      const doc = await PDFDocument.create(),
        font = await doc.embedFont(StandardFonts.Helvetica);
      const page = doc.addPage([612, 792]);
      let y = 740;
      for (const line of [
        "ROOFER MASTERS — RECORDED FINANCES",
        `${from} to ${to} | ${env}`,
        ...rows.map(([label, cents]) => `${label}: ${money(cents)}`),
        `Net cash margin: ${profit.margin === null ? "Not available" : `${profit.margin.toFixed(2)}%`}`,
        "Cash basis; not accrual accounting. Unrecorded costs are excluded.",
      ]) {
        page.drawText(line.replace(/[^\x20-\x7e]/g, " "), { x: 40, y, size: 12, font });
        y -= 30;
      }
      const { downloadPdf } = await import("./proposal-data");
      downloadPdf(await doc.save(), "Roofer Masters financials");
    } catch {
      toast.error("PDF export failed");
    }
  }
  return (
    <div>
      <SectionHeading
        title="Recorded financial analytics"
        action={
          <div className="flex gap-2">
            <Button variant="outline" disabled={failed || loading} onClick={() => void pdf()}>
              <FileText /> PDF
            </Button>
            <Button variant="outline" disabled={failed || loading} onClick={() => void excel()}>
              <Download /> Excel
            </Button>
          </div>
        }
      />
      <div className="mb-8 grid gap-4 sm:grid-cols-3">
        <Field label="From">
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="To">
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
        <Choice
          label="Project"
          value={project}
          onChange={setProject}
          options={[
            { value: "all", label: "All projects" },
            ...(jobs.data ?? []).map((j) => ({ value: j.id, label: j.title })),
          ]}
        />
      </div>
      <p className="mb-5 text-xs font-semibold uppercase text-muted-foreground">
        {env === "sandbox"
          ? "Sandbox invoices and payments — expenses are reported independently"
          : env === "unavailable"
            ? "Payment environment unavailable — totals cannot be verified"
            : "Sandbox invoices and payments — expenses are reported independently"}{" "}
        · Cash basis
      </p>
      {jobs.error && !failed && (
        <p className="mb-3 text-sm text-muted-foreground">
          Project names could not be loaded. Financial totals are still available for all projects.
        </p>
      )}
      {links.error && project === "all" && !failed && (
        <p className="mb-3 text-sm text-muted-foreground">
          Project allocations could not be loaded. Overall financial totals are still available.
        </p>
      )}
      {paymentSetupMissing && !failed && (
        <p className="mb-4 text-sm text-muted-foreground">
          Online payments are not configured. Invoice and payment totals use the sandbox environment; recorded business expenses are included independently.
        </p>
      )}
      {failed ? (
        <p role="alert" className="text-destructive">
          {sourceErrors.length
            ? sourceErrors.join(" · ")
            : "Financial records or date range unavailable. Do not rely on these totals."}
        </p>
      ) : loading ? (
        <p>Loading recorded transactions…</p>
      ) : (
        <>
          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
            {rows.map(([label, cents]) => (
              <div key={label} className="border-l-2 border-primary py-2 pl-4">
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="mt-2 break-words text-2xl font-bold">{money(cents)}</p>
              </div>
            ))}
            <div className="border-l-2 border-primary py-2 pl-4">
              <p className="text-xs text-muted-foreground">Net cash margin</p>
              <p className="mt-2 text-2xl font-bold">
                {profit.margin === null ? "Not available" : `${profit.margin.toFixed(1)}%`}
              </p>
            </div>
          </div>
          <p className="mt-6 border-t border-border pt-4 text-sm text-muted-foreground">
            {costs.length
              ? `${costs.length} recorded expenses. Unrecorded costs are not included.`
              : "No expenses recorded in this selection; profitability is incomplete."}
          </p>
          <section className="mt-8">
            <h3 className="mb-4 text-lg font-bold">Expense categories</h3>
            {Array.from(new Set(costs.map((e) => e.category))).map((category) => (
              <div
                key={category}
                className="flex justify-between border-b border-border py-3 text-sm"
              >
                <span className="capitalize">{category}</span>
                <span className="font-semibold">
                  {money(
                    costs
                      .filter((e) => e.category === category)
                      .reduce((s, e) => s + e.amount_cents, 0),
                  )}
                </span>
              </div>
            ))}
          </section>
          <InvoiceAllocations />
        </>
      )}
    </div>
  );
}
