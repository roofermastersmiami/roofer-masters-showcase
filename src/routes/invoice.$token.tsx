import { createFileRoute, ClientOnly } from "@tanstack/react-router";
import { queryOptions, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { EmbeddedCheckout, EmbeddedCheckoutProvider } from "@stripe/react-stripe-js";
import { z } from "zod";
import { Download, CreditCard, BadgeCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/site/Logo";
import { PaymentTestModeBanner } from "@/components/PaymentTestModeBanner";
import { getSharedInvoice } from "@/lib/invoices.functions";
import { createInvoiceCheckout, confirmInvoiceCheckout } from "@/lib/invoice-payments.functions";
import { getStripe, getStripeEnvironment } from "@/lib/stripe";
import { money, itemSchema, paymentAmount } from "@/lib/crm-schema";
import { pageMeta } from "@/lib/seo";
import { downloadPdf } from "@/components/dashboard/proposal-data";

const invoiceQuery = (token: string) => queryOptions({ queryKey: ["shared-invoice",token], queryFn: () => getSharedInvoice({data:{token}}) });
export const Route=createFileRoute("/invoice/$token")({
  validateSearch:(search:Record<string,unknown>) => ({ session_id: typeof search['session_id']==="string" && /^cs_[a-zA-Z0-9_]+$/.test(search['session_id']) ? search['session_id'] : "" }),
  head:()=>({meta:[...pageMeta("Your Roofing Invoice | Roofer Masters","View your private roofing invoice and pay a deposit or balance securely."),{name:"robots",content:"noindex,nofollow"}]}),
  loader:({params,context})=>context.queryClient.ensureQueryData(invoiceQuery(params.token)), component:SharedInvoice,
});
function SharedInvoice(){
  const {token}=Route.useParams(); const {session_id}=Route.useSearch();const {data:invoice}=useSuspenseQuery(invoiceQuery(token));const qc=useQueryClient();const confirm=useServerFn(confirmInvoiceCheckout);const [kind,setKind]=useState<"deposit"|"balance"|null>(null); const [checking,setChecking]=useState(false);const [paymentMessage,setPaymentMessage]=useState("");
  useEffect(()=>{if(!session_id)return;let mounted=true;setChecking(true);void (async()=>{try{const result=await confirm({data:{token,session_id,environment:getStripeEnvironment()}});if(mounted){setPaymentMessage("error" in result ? result.error : result.paid ? "Payment confirmed. Thank you!" : "Payment is processing; your balance will update after confirmation.");await qc.invalidateQueries({queryKey:["shared-invoice",token]});}}catch(e){if(mounted)setPaymentMessage(e instanceof Error ? e.message : "Could not confirm payment");}finally{if(mounted)setChecking(false);}})();return()=>{mounted=false;};},[token,session_id,confirm,qc]);
  if(!invoice)return <main className="mx-auto max-w-lg px-6 py-20 text-center"><Logo className="mx-auto h-20"/><h1 className="mt-8 text-2xl font-bold text-foreground">Invoice unavailable</h1><p className="mt-3 text-muted-foreground">This link may be expired or the invoice was withdrawn. Call 305-942-3093.</p></main>;
  const items=z.array(itemSchema).parse(invoice.items);const balance=invoice.total_cents-invoice.paid_cents;const deposit=paymentAmount(invoice,"deposit");
  const canPay=import.meta.env['VITE_PAYMENTS_CLIENT_TOKEN']?.startsWith(invoice.environment==="sandbox" ? "pk_test_" : "pk_live_");
  return <><PaymentTestModeBanner/><main className="mx-auto max-w-3xl px-5 py-10 sm:py-16"><header className="flex flex-wrap justify-between gap-5 border-b border-border pb-8"><Logo className="h-20"/><div className="text-right"><p className="text-sm font-bold uppercase text-primary">Invoice RM-{invoice.number}</p><p className="text-sm text-muted-foreground">Due {invoice.due_date}</p></div></header><h1 className="mt-8 text-3xl font-bold text-foreground">{invoice.title}</h1><p className="mt-2 text-muted-foreground">Prepared for {invoice.customer_name}</p>
    {checking && <p className="mt-5 text-primary">Confirming payment…</p>}{paymentMessage && <p role="status" className="mt-5 border-l-2 border-primary bg-accent p-4 text-accent-foreground">{paymentMessage}</p>}
    <div className="mt-8 divide-y divide-border border-y border-border">{items.map((i,n)=><div key={n} className="flex gap-5 py-4"><div className="min-w-0 flex-1"><p className="break-words font-semibold text-foreground">{i.description}</p><p className="text-sm text-muted-foreground">{i.quantity} × {money(i.unit_cents)}</p></div><span className="text-foreground">{money(Math.round(i.quantity*i.unit_cents))}</span></div>)}</div>
    <dl className="ml-auto mt-6 grid max-w-sm grid-cols-2 gap-3 text-sm"><dt>Subtotal</dt><dd className="text-right">{money(invoice.subtotal_cents)}</dd><dt>Included tax</dt><dd className="text-right">{money(invoice.tax_cents)}</dd><dt>Invoice total</dt><dd className="text-right font-bold">{money(invoice.total_cents)}</dd><dt>Payments recorded</dt><dd className="text-right">{money(invoice.paid_cents)}</dd><dt className="font-bold">Balance due</dt><dd className="text-right text-xl font-bold text-primary">{money(balance)}</dd></dl>
    {invoice.notes && <p className="mt-8 whitespace-pre-wrap text-sm text-muted-foreground">{invoice.notes}</p>}<div className="mt-8 flex flex-wrap gap-3"><Button variant="outline" onClick={async()=>{try{const {generateInvoicePdf}=await import("@/lib/invoice-pdf");downloadPdf(await generateInvoicePdf(invoice),`Invoice RM-${invoice.number}`);}catch{toast.error("Could not download invoice");}}}><Download/> Download invoice</Button>{balance===0 ? <p className="flex items-center gap-2 font-semibold text-primary"><BadgeCheck/> Paid in full</p> : canPay ? <>{deposit>=50 && <Button onClick={()=>setKind("deposit")} disabled={checking}><CreditCard/> Pay deposit {money(deposit)}</Button>}<Button onClick={()=>setKind("balance")} disabled={checking}><CreditCard/> Pay balance {money(balance)}</Button></> : <p className="text-sm text-muted-foreground">Online payment is not yet available. Call 305-942-3093 to arrange payment.</p>}</div>
    {kind && <section className="mt-10 border-t border-border pt-6"><div className="mb-5 flex items-center justify-between"><h2 className="text-xl font-bold">Secure payment</h2><Button variant="ghost" onClick={()=>setKind(null)}>Close</Button></div><ClientOnly><InvoiceCheckout key={kind} token={token} kind={kind}/></ClientOnly></section>}
    <footer className="mt-12 border-t border-border pt-6 text-sm text-muted-foreground"><a href="tel:3059423093" className="font-semibold text-primary">305-942-3093</a> · roofermasters@gmail.com</footer>
  </main></>;
}
function InvoiceCheckout({token,kind}:{token:string;kind:"deposit"|"balance"}){
  const create=useServerFn(createInvoiceCheckout);const [error,setError]=useState("");
  const fetchClientSecret=async()=>{try{const result=await create({data:{token,kind,environment:getStripeEnvironment()}});if("error" in result)throw new Error(result.error);if(!result.clientSecret)throw new Error("Payment checkout unavailable");return result.clientSecret;}catch(e){const message=e instanceof Error ? e.message : "Could not load payment";setError(message);throw e;}};
  if(error)return <p role="alert" className="text-sm text-destructive">{error.includes("head office address") ? "Online payment is not ready yet. The business needs to complete its payment account address setup. Call 305-942-3093 to arrange payment." : error}</p>;
  return <EmbeddedCheckoutProvider stripe={getStripe()} options={{fetchClientSecret}}><EmbeddedCheckout/></EmbeddedCheckoutProvider>;
}