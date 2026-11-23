import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Plus,
  Receipt,
  Download,
  Copy,
  Mail,
  Ban,
  CreditCard,
  X,
  Link2,
  Search,
} from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { PaymentTestModeBanner } from "@/components/PaymentTestModeBanner";
import { createInvoice, changeInvoiceStatus } from "@/lib/invoices.functions";
import { cancelInvoiceCheckout } from "@/lib/invoice-payments.functions";
import { getStripeEnvironment } from "@/lib/stripe";
import {
  money,
  invoiceTotals,
  dollarsToCents,
  invoiceState,
  itemSchema,
  type InvoiceItem,
} from "@/lib/crm-schema";
import { invoicesQuery, paymentsQuery, type Invoice } from "./operations-data";
import { proposalsQuery } from "./proposal-data";
import { downloadPdf } from "./proposal-data";
import { CustomerSelect, Field, NumberField, Choice, Empty, SectionHeading } from "./CrmControls";
import type { Lead } from "./data";

export function Invoices({ leads }: { leads: Lead[] }) {
  const invoices = useQuery(invoicesQuery);
  const [create, setCreate] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const rows = invoices.data ?? [];
  const invoice = rows.find((i) => i.id === selected);
  const visible = rows.filter(
    (i) =>
      (filter === "all" || invoiceState(i) === filter) &&
      `${i.number} ${i.title} ${i.customer_name}`.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <div className="space-y-5">
      <PaymentTestModeBanner />
      <SectionHeading
        title="Invoices & payments"
        action={
          <Button onClick={() => setCreate(true)}>
            <Plus /> New invoice
          </Button>
        }
      />
      <div className="grid gap-4 sm:grid-cols-3">
        {[
          [
            "Invoiced",
            rows.filter((i) => i.status === "issued").reduce((n, i) => n + i.total_cents, 0),
          ],
          ["Collected", rows.reduce((n, i) => n + i.paid_cents, 0)],
          [
            "Outstanding",
            rows
              .filter((i) => i.status === "issued")
              .reduce((n, i) => n + i.total_cents - i.paid_cents, 0),
          ],
        ].map(([label, amount]) => (
          <div key={String(label)} className="border-l-2 border-primary px-4 py-2">
            <p className="text-xs uppercase text-muted-foreground">{label}</p>
            <p className="text-2xl font-bold text-foreground">{money(Number(amount))}</p>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-3">
        <div className="relative min-w-0 flex-1">
          <Search className="absolute left-3 top-3 size-4 text-muted-foreground" />
          <Input
            aria-label="Search invoices"
            className="pl-9"
            placeholder="Search invoices or customers"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Choice
          label="Invoice status"
          value={filter}
          onChange={setFilter}
          options={["all", "draft", "unpaid", "partial", "overdue", "paid", "void"].map((s) => ({
            value: s,
            label: s[0]?.toUpperCase() + s.slice(1),
          }))}
        />
      </div>
      {invoices.error && <p className="text-destructive">Could not load invoices.</p>}
      {invoices.isLoading ? (
        <p>Loading invoices…</p>
      ) : !visible.length ? (
        <Empty>No invoices found.</Empty>
      ) : (
        <div className="divide-y divide-border border-y border-border">
          {visible.map((i) => (
            <div key={i.id} className="flex flex-wrap items-center gap-4 py-4">
              <Receipt className="size-5 text-primary" />
              <div className="min-w-0 flex-1">
                <p className="break-words font-semibold text-foreground">
                  RM-{i.number} · {i.customer_name}
                </p>
                <p className="text-sm text-muted-foreground">
                  {i.title} · Due {i.due_date} · {i.environment === "sandbox" ? "Test" : "Live"}
                </p>
              </div>
              <div className="text-right">
                <p className="font-bold text-foreground">{money(i.total_cents - i.paid_cents)}</p>
                <p
                  className={`text-xs capitalize ${invoiceState(i) === "overdue" ? "text-destructive" : "text-muted-foreground"}`}
                >
                  {invoiceState(i)}
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={() => setSelected(i.id)}>
                Open
              </Button>
            </div>
          ))}
        </div>
      )}
      {create && (
        <InvoiceComposer
          leads={leads}
          onClose={() => setCreate(false)}
          onSaved={(id) => {
            setCreate(false);
            setSelected(id);
          }}
        />
      )}
      {invoice && <InvoiceDetail invoice={invoice} onClose={() => setSelected(null)} />}
    </div>
  );
}

function InvoiceComposer({
  leads,
  onClose,
  onSaved,
}: {
  leads: Lead[];
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const save = useServerFn(createInvoice);
  const qc = useQueryClient();
  const proposals = useQuery(proposalsQuery);
  const [customer, setCustomer] = useState("");
  const [proposal, setProposal] = useState("");
  const [title, setTitle] = useState("Roofing invoice");
  const [items, setItems] = useState<InvoiceItem[]>([
    { description: "Roofing work", quantity: 1, unit_cents: 0 },
  ]);
  const [tax, setTax] = useState(0);
  const [deposit, setDeposit] = useState(0);
  const [due, setDue] = useState(new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const totals = invoiceTotals(items, tax);
  function chooseProposal(id: string) {
    setProposal(id === "none" ? "" : id);
    const p = proposals.data?.find((p) => p.id === id);
    if (p) {
      setTitle(p.title);
      setItems([{ description: p.title, quantity: 1, unit_cents: dollarsToCents(p.amount ?? 0) }]);
    }
  }
  async function submit() {
    setBusy(true);
    try {
      const result = await save({
        data: {
          lead_id: customer,
          proposal_id: proposal || null,
          title,
          items,
          tax_percent: tax,
          deposit_percent: deposit,
          due_date: due,
          notes,
          environment: getStripeEnvironment(),
        },
      });
      await qc.invalidateQueries({ queryKey: ["crm-invoices"] });
      toast.success("Invoice saved as draft");
      onSaved(result.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save invoice");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>New invoice</DialogTitle>
          <DialogDescription>Roofer Masters</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <CustomerSelect
              leads={leads}
              value={customer}
              onChange={(v) => {
                setCustomer(v);
                setProposal("");
              }}
            />
            <Choice
              label="From proposal"
              value={proposal || "none"}
              onChange={chooseProposal}
              options={[
                { value: "none", label: "Custom invoice" },
                ...(proposals.data ?? [])
                  .filter((p) => !p.is_template && p.lead_id === customer)
                  .map((p) => ({ value: p.id, label: p.title })),
              ]}
            />
          </div>
          <Field label="Invoice title">
            <Input required value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <div className="space-y-3">
            {items.map((item, index) => (
              <div
                key={index}
                className="grid grid-cols-[1fr_auto] gap-2 border-b border-border pb-3"
              >
                <div className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr]">
                  <Field label="Description">
                    <Input
                      required
                      aria-label={`Item ${index + 1} description`}
                      value={item.description}
                      onChange={(e) =>
                        setItems(
                          items.map((it, i) =>
                            i === index ? { ...it, description: e.target.value } : it,
                          ),
                        )
                      }
                    />
                  </Field>
                  <NumberField
                    label={`Item ${index + 1} quantity`}
                    value={item.quantity}
                    onChange={(v) =>
                      setItems(items.map((it, i) => (i === index ? { ...it, quantity: v } : it)))
                    }
                  />
                  <NumberField
                    label={`Item ${index + 1} price ($)`}
                    value={item.unit_cents / 100}
                    onChange={(v) =>
                      setItems(
                        items.map((it, i) =>
                          i === index ? { ...it, unit_cents: dollarsToCents(v) } : it,
                        ),
                      )
                    }
                  />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="self-end"
                  aria-label="Remove item"
                  title="Remove item"
                  disabled={items.length === 1}
                  onClick={() => setItems(items.filter((_, i) => i !== index))}
                >
                  <X />
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setItems([...items, { description: "", quantity: 1, unit_cents: 0 }])}
            >
              <Plus /> Add item
            </Button>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <NumberField label="Included tax (%)" value={tax} max={100} onChange={setTax} />
            <NumberField label="Deposit (%)" value={deposit} max={100} onChange={setDeposit} />
            <Field label="Due date">
              <Input
                required
                aria-label="Due date"
                type="date"
                value={due}
                onChange={(e) => setDue(e.target.value)}
              />
            </Field>
          </div>
          <Field label="Notes / payment terms">
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          <div className="flex flex-wrap justify-between gap-3 border-t border-border pt-4">
            <div>
              <p className="text-sm text-muted-foreground">
                Subtotal {money(totals.subtotal)} · Tax {money(totals.tax)}
              </p>
              <p className="text-xl font-bold text-foreground">Total {money(totals.total)}</p>
              <p className="text-sm text-muted-foreground">
                Deposit {money(Math.round((totals.total * deposit) / 100))}
              </p>
            </div>
            <Button type="submit" disabled={busy || !customer}>
              <Receipt /> {busy ? "Saving…" : "Save draft"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function InvoiceDetail({ invoice, onClose }: { invoice: Invoice; onClose: () => void }) {
  const qc = useQueryClient();
  const change = useServerFn(changeInvoiceStatus);
  const cancel = useServerFn(cancelInvoiceCheckout);
  const payments = useQuery(paymentsQuery);
  const [busy, setBusy] = useState(false);
  const [record, setRecord] = useState(false);
  const [amount, setAmount] = useState((invoice.total_cents - invoice.paid_cents) / 100);
  const [method, setMethod] = useState("check");
  const [reference, setReference] = useState("");
  const [received, setReceived] = useState(new Date().toISOString().slice(0, 10));
  const rows = z.array(itemSchema).safeParse(invoice.items);
  const url = `${window.location.origin}/invoice/${invoice.token}`;
  async function action(fn: () => Promise<unknown>, message: string) {
    setBusy(true);
    try {
      await fn();
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["crm-invoices"] }),
        qc.invalidateQueries({ queryKey: ["invoice-payments"] }),
      ]);
      toast.success(message);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }
  async function recordPayment() {
    const { error } = await supabase.rpc("record_invoice_payment", {
      p_invoice_id: invoice.id,
      p_amount_cents: dollarsToCents(amount),
      p_method: method,
      p_reference: reference,
      p_received_at: new Date(`${received}T12:00:00`).toISOString(),
    });
    if (error) throw new Error(error.message);
    setRecord(false);
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Invoice RM-{invoice.number}</DialogTitle>
          <DialogDescription>
            {invoice.customer_name} · {invoice.title}
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold capitalize text-primary">
            {invoiceState(invoice)} · {invoice.environment === "sandbox" ? "Test" : "Live"}
          </span>
          <span className="text-sm text-muted-foreground">Due {invoice.due_date}</span>
        </div>
        <div className="divide-y divide-border">
          {rows.success &&
            rows.data.map((i, n) => (
              <div key={n} className="flex gap-4 py-3 text-sm">
                <span className="min-w-0 flex-1 break-words">
                  {i.description} <span className="text-muted-foreground">× {i.quantity}</span>
                </span>
                <span>{money(Math.round(i.quantity * i.unit_cents))}</span>
              </div>
            ))}
        </div>
        <div className="grid grid-cols-2 gap-3 border-y border-border py-4">
          <span>Total</span>
          <span className="text-right font-bold">{money(invoice.total_cents)}</span>
          <span>Deposit requested</span>
          <span className="text-right">{money(invoice.deposit_cents)}</span>
          <span>Payments recorded</span>
          <span className="text-right">{money(invoice.paid_cents)}</span>
          <span className="font-bold">Balance due</span>
          <span className="text-right text-xl font-bold text-primary">
            {money(invoice.total_cents - invoice.paid_cents)}
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={busy}
            onClick={() =>
              void action(async () => {
                const { generateInvoicePdf } = await import("@/lib/invoice-pdf");
                downloadPdf(
                  await generateInvoicePdf(invoice, invoice.customer_address),
                  `Invoice RM-${invoice.number}`,
                );
              }, "Invoice downloaded")
            }
          >
            <Download /> PDF
          </Button>
          {invoice.status === "draft" && (
            <Button
              disabled={busy}
              onClick={() =>
                void action(
                  () => change({ data: { id: invoice.id, status: "issued" } }),
                  "Invoice issued — customer link is ready",
                )
              }
            >
              <Link2 /> Issue invoice
            </Button>
          )}
          {invoice.status === "issued" && (
            <>
              <Button
                variant="outline"
                onClick={() =>
                  void action(() => navigator.clipboard.writeText(url), "Invoice link copied")
                }
              >
                <Copy /> Copy link
              </Button>
              <Button variant="outline" asChild>
                <a href={url} target="_blank" rel="noreferrer">
                  View invoice
                </a>
              </Button>
              <Button variant="outline" asChild>
                <a
                  href={`mailto:${invoice.customer_email}?subject=${encodeURIComponent(`Invoice RM-${invoice.number} | Roofer Masters`)}&body=${encodeURIComponent(`Hello ${invoice.customer_name},\n\nYour roofing invoice is ready:\n${url}\n\nRoofer Masters · 305-942-3093`)}`}
                >
                  <Mail /> Email draft
                </a>
              </Button>
              <Button variant="outline" asChild>
                <a
                  target="_blank"
                  rel="noreferrer"
                  href={`https://wa.me/?text=${encodeURIComponent(`Your Roofer Masters invoice: ${url}`)}`}
                >
                  WhatsApp
                </a>
              </Button>
              {invoice.paid_cents < invoice.total_cents && (
                <Button disabled={busy} onClick={() => setRecord(!record)}>
                  <CreditCard /> Record payment
                </Button>
              )}
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() =>
                  void action(async () => {
                    const result = await cancel({ data: { invoice_id: invoice.id } });
                    if ("error" in result) throw new Error(result.error);
                  }, "Pending checkout cleared")
                }
              >
                <X /> Cancel pending checkout
              </Button>
            </>
          )}
          {invoice.status !== "void" && invoice.paid_cents === 0 && (
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => {
                if (confirm("Void this invoice? Its customer link will stop working."))
                  void action(
                    () => change({ data: { id: invoice.id, status: "void" } }),
                    "Invoice voided",
                  );
              }}
            >
              <Ban /> Void
            </Button>
          )}
        </div>
        {record && (
          <form
            className="grid gap-4 border-t border-border pt-4"
            onSubmit={(e) => {
              e.preventDefault();
              void action(recordPayment, "Payment recorded");
            }}
          >
            <NumberField
              label="Payment amount ($)"
              value={amount}
              max={(invoice.total_cents - invoice.paid_cents) / 100}
              onChange={setAmount}
            />
            <Choice
              label="Payment method"
              value={method}
              onChange={setMethod}
              options={[
                { value: "check", label: "Check" },
                { value: "cash", label: "Cash" },
                { value: "bank_transfer", label: "Bank transfer / Zelle" },
                { value: "card_external", label: "Card collected elsewhere" },
              ]}
            />
            <Field label="Reference">
              <Input value={reference} onChange={(e) => setReference(e.target.value)} />
            </Field>
            <Field label="Received date">
              <Input
                aria-label="Received date"
                required
                type="date"
                value={received}
                onChange={(e) => setReceived(e.target.value)}
              />
            </Field>
            <Button type="submit" disabled={busy}>
              Save payment
            </Button>
          </form>
        )}
        <h3 className="font-semibold text-foreground">Payment history</h3>
        {(payments.data ?? [])
          .filter((p) => p.invoice_id === invoice.id)
          .map((p) => (
            <div
              key={p.id}
              className="flex flex-wrap justify-between gap-2 border-b border-border pb-2 text-sm"
            >
              <span>
                {p.method.replaceAll("_", " ")} · {new Date(p.received_at).toLocaleDateString()}
                <br />
                <span className="break-all text-xs text-muted-foreground">{p.reference}</span>
              </span>
              <span className="font-bold">{money(p.amount_cents)}</span>
            </div>
          ))}
        {!payments.data?.some((p) => p.invoice_id === invoice.id) && (
          <p className="text-sm text-muted-foreground">No payments recorded.</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
