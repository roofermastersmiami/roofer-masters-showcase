CREATE FUNCTION public.reserve_invoice_checkout(p_token uuid,p_environment text,p_kind text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE inv public.crm_invoices; charge bigint; checkout_id uuid;
BEGIN
 SELECT * INTO inv FROM public.crm_invoices WHERE token=p_token AND status='issued' AND environment=p_environment AND expires_at>now() FOR UPDATE;
 IF inv.id IS NULL OR p_kind NOT IN ('deposit','balance') THEN RAISE EXCEPTION 'Invoice unavailable'; END IF;
 IF p_kind='deposit' THEN charge := greatest(0,least(inv.deposit_cents-inv.paid_cents,inv.total_cents-inv.paid_cents)); ELSE charge := inv.total_cents-inv.paid_cents; END IF;
 IF charge<50 THEN RAISE EXCEPTION 'There is no payable balance of at least $0.50'; END IF;
 IF EXISTS(SELECT 1 FROM public.invoice_checkouts WHERE invoice_id=inv.id AND status='pending') THEN RAISE EXCEPTION 'An online payment is already pending'; END IF;
 INSERT INTO public.invoice_checkouts(invoice_id,environment,amount_cents) VALUES(inv.id,p_environment,charge) RETURNING id INTO checkout_id;
 RETURN jsonb_build_object('id',checkout_id,'amount',charge);
END; $$;
REVOKE ALL ON FUNCTION public.reserve_invoice_checkout(uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_invoice_checkout(uuid,text,text) TO service_role;