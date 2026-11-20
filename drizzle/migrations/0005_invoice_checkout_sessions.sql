ALTER TABLE public.crm_invoices ADD COLUMN environment text NOT NULL DEFAULT 'sandbox' CHECK(environment IN ('sandbox','live'));
ALTER TABLE public.invoice_payments ADD COLUMN environment text NOT NULL DEFAULT 'sandbox' CHECK(environment IN ('sandbox','live'));
CREATE TABLE public.invoice_checkouts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), invoice_id uuid NOT NULL REFERENCES public.crm_invoices(id), environment text NOT NULL CHECK(environment IN ('sandbox','live')), amount_cents bigint NOT NULL CHECK(amount_cents >= 50), session_id text UNIQUE, status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','paid','expired','failed')), expires_at timestamptz NOT NULL DEFAULT (now() + interval '31 minutes'), created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.invoice_checkouts TO authenticated;
GRANT ALL ON public.invoice_checkouts TO service_role;
ALTER TABLE public.invoice_checkouts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owner checkout reads" ON public.invoice_checkouts FOR SELECT TO authenticated USING(public.has_role(auth.uid(),'admin'));
CREATE INDEX invoice_checkouts_invoice_idx ON public.invoice_checkouts(invoice_id);
CREATE UNIQUE INDEX invoice_checkouts_pending_idx ON public.invoice_checkouts(invoice_id) WHERE status = 'pending';
CREATE FUNCTION public.settle_invoice_checkout(p_session_id text, p_environment text, p_amount_cents bigint) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE checkout public.invoice_checkouts; inv public.crm_invoices;
BEGIN
 SELECT * INTO checkout FROM public.invoice_checkouts WHERE session_id = p_session_id AND environment = p_environment FOR UPDATE;
 IF checkout.id IS NULL THEN RAISE EXCEPTION 'Checkout not found'; END IF;
 IF checkout.status = 'paid' THEN RETURN true; END IF;
 SELECT * INTO inv FROM public.crm_invoices WHERE id = checkout.invoice_id FOR UPDATE;
 IF inv.environment <> p_environment OR checkout.amount_cents <> p_amount_cents THEN RAISE EXCEPTION 'Payment mismatch'; END IF;
 IF p_amount_cents > inv.total_cents - inv.paid_cents THEN RAISE EXCEPTION 'Payment exceeds balance; review required'; END IF;
 INSERT INTO public.invoice_payments(invoice_id,amount_cents,method,reference,provider_event_id,environment) VALUES(inv.id,p_amount_cents,'stripe',p_session_id,p_session_id,p_environment);
 UPDATE public.crm_invoices SET paid_cents = paid_cents + p_amount_cents WHERE id = inv.id;
 UPDATE public.invoice_checkouts SET status = 'paid' WHERE id = checkout.id;
 RETURN true;
END; $$;
REVOKE ALL ON FUNCTION public.settle_invoice_checkout(text,text,bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_invoice_checkout(text,text,bigint) TO service_role;
CREATE OR REPLACE FUNCTION public.record_invoice_payment(p_invoice_id uuid, p_amount_cents bigint, p_method text, p_reference text, p_received_at timestamptz) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE inv public.crm_invoices; payment_id uuid;
BEGIN
 IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Owner access required'; END IF;
 IF p_method NOT IN ('cash','check','bank_transfer','card_external') OR p_amount_cents <= 0 OR p_received_at IS NULL THEN RAISE EXCEPTION 'Invalid payment'; END IF;
 SELECT * INTO inv FROM public.crm_invoices WHERE id = p_invoice_id FOR UPDATE;
 IF inv.id IS NULL OR inv.status <> 'issued' THEN RAISE EXCEPTION 'Issue the invoice before recording a payment'; END IF;
 IF EXISTS(SELECT 1 FROM public.invoice_checkouts WHERE invoice_id=inv.id AND status='pending') THEN RAISE EXCEPTION 'An online payment is pending; wait for completion or cancel checkout first'; END IF;
 IF p_amount_cents > inv.total_cents - inv.paid_cents THEN RAISE EXCEPTION 'Payment exceeds outstanding balance'; END IF;
 INSERT INTO public.invoice_payments(invoice_id, amount_cents, method, reference, received_at,environment) VALUES(p_invoice_id,p_amount_cents,p_method,left(p_reference,200),p_received_at,inv.environment) RETURNING id INTO payment_id;
 UPDATE public.crm_invoices SET paid_cents = paid_cents + p_amount_cents WHERE id = p_invoice_id;
 RETURN payment_id;
END; $$;