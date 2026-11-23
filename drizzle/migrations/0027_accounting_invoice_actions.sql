-- Keep invoice actions consistent with the accounting role used by the CRM.
-- The original RPCs were admin-only, which blocked accounting users from issuing,
-- voiding, or recording payments even though the invoice UI exposes those actions.
CREATE OR REPLACE FUNCTION public.set_invoice_status(p_invoice_id uuid,p_status text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE inv public.crm_invoices;
BEGIN
 IF NOT public.has_any_role(auth.uid(), ARRAY['admin','accounting']::public.app_role[]) THEN RAISE EXCEPTION 'Accounting access required'; END IF;
 SELECT * INTO inv FROM public.crm_invoices WHERE id=p_invoice_id FOR UPDATE;
 IF inv.id IS NULL OR p_status NOT IN ('issued','void') THEN RAISE EXCEPTION 'Invoice unavailable'; END IF;
 IF EXISTS(SELECT 1 FROM public.invoice_checkouts WHERE invoice_id=inv.id AND status='pending') THEN RAISE EXCEPTION 'Cancel pending checkout first'; END IF;
 IF p_status='issued' AND inv.status<>'draft' THEN RAISE EXCEPTION 'Only draft invoices can be issued'; END IF;
 IF p_status='void' AND (inv.paid_cents<>0 OR inv.status='void') THEN RAISE EXCEPTION 'Paid or void invoices cannot be withdrawn'; END IF;
 UPDATE public.crm_invoices SET status=p_status WHERE id=inv.id;
 RETURN true;
END; $$;

CREATE OR REPLACE FUNCTION public.record_invoice_payment(p_invoice_id uuid, p_amount_cents bigint, p_method text, p_reference text, p_received_at timestamptz) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE inv public.crm_invoices; payment_id uuid;
BEGIN
 IF NOT public.has_any_role(auth.uid(), ARRAY['admin','accounting']::public.app_role[]) THEN RAISE EXCEPTION 'Accounting access required'; END IF;
 IF p_method NOT IN ('cash','check','bank_transfer','card_external') OR p_amount_cents <= 0 OR p_received_at IS NULL THEN RAISE EXCEPTION 'Invalid payment'; END IF;
 SELECT * INTO inv FROM public.crm_invoices WHERE id = p_invoice_id FOR UPDATE;
 IF inv.id IS NULL OR inv.status <> 'issued' THEN RAISE EXCEPTION 'Issue the invoice before recording a payment'; END IF;
 IF p_amount_cents > inv.total_cents - inv.paid_cents THEN RAISE EXCEPTION 'Payment exceeds outstanding balance'; END IF;
 INSERT INTO public.invoice_payments(invoice_id, amount_cents, method, reference, received_at) VALUES(p_invoice_id,p_amount_cents,p_method,left(p_reference,200),p_received_at) RETURNING id INTO payment_id;
 UPDATE public.crm_invoices SET paid_cents = paid_cents + p_amount_cents WHERE id = p_invoice_id;
 RETURN payment_id;
END; $$;

REVOKE ALL ON FUNCTION public.set_invoice_status(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_invoice_status(uuid,text) TO authenticated;
REVOKE ALL ON FUNCTION public.record_invoice_payment(uuid,bigint,text,text,timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_invoice_payment(uuid,bigint,text,text,timestamptz) TO authenticated;
