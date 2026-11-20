CREATE FUNCTION public.set_invoice_status(p_invoice_id uuid,p_status text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE inv public.crm_invoices;
BEGIN
 IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'Owner access required'; END IF;
 SELECT * INTO inv FROM public.crm_invoices WHERE id=p_invoice_id FOR UPDATE;
 IF inv.id IS NULL OR p_status NOT IN ('issued','void') THEN RAISE EXCEPTION 'Invoice unavailable'; END IF;
 IF EXISTS(SELECT 1 FROM public.invoice_checkouts WHERE invoice_id=inv.id AND status='pending') THEN RAISE EXCEPTION 'Cancel pending checkout first'; END IF;
 IF p_status='issued' AND inv.status<>'draft' THEN RAISE EXCEPTION 'Only draft invoices can be issued'; END IF;
 IF p_status='void' AND (inv.paid_cents<>0 OR inv.status='void') THEN RAISE EXCEPTION 'Paid or void invoices cannot be withdrawn'; END IF;
 UPDATE public.crm_invoices SET status=p_status WHERE id=inv.id;
 RETURN true;
END; $$;
REVOKE ALL ON FUNCTION public.set_invoice_status(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_invoice_status(uuid,text) TO authenticated;
CREATE OR REPLACE FUNCTION public.settle_invoice_checkout(p_session_id text, p_environment text, p_amount_cents bigint) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE checkout public.invoice_checkouts; inv public.crm_invoices; target_id uuid;
BEGIN
 SELECT invoice_id INTO target_id FROM public.invoice_checkouts WHERE session_id=p_session_id AND environment=p_environment;
 IF target_id IS NULL THEN RAISE EXCEPTION 'Checkout not found'; END IF;
 SELECT * INTO inv FROM public.crm_invoices WHERE id=target_id FOR UPDATE;
 SELECT * INTO checkout FROM public.invoice_checkouts WHERE session_id=p_session_id AND environment=p_environment FOR UPDATE;
 IF checkout.status='paid' THEN RETURN true; END IF;
 IF inv.status<>'issued' OR inv.environment<>p_environment OR checkout.amount_cents<>p_amount_cents THEN RAISE EXCEPTION 'Payment mismatch'; END IF;
 IF p_amount_cents>inv.total_cents-inv.paid_cents THEN RAISE EXCEPTION 'Payment exceeds balance; review required'; END IF;
 INSERT INTO public.invoice_payments(invoice_id,amount_cents,method,reference,provider_event_id,environment) VALUES(inv.id,p_amount_cents,'stripe',p_session_id,p_session_id,p_environment);
 UPDATE public.crm_invoices SET paid_cents=paid_cents+p_amount_cents WHERE id=inv.id;
 UPDATE public.invoice_checkouts SET status='paid' WHERE id=checkout.id;
 RETURN true;
END; $$;
