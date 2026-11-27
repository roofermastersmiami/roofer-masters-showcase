-- tenant-audit: reviewed — SECURITY DEFINER RPCs bind invoice/payment writes to the locked invoice company; authenticated accounting membership is checked for manual actions, and settlement is service_role-only after trusted webhook verification. Grants explicitly exclude browser roles from settlement.
-- Enforce company authorization inside accounting RPCs, not only in app handlers.
-- Payment settlement remains a trusted server/webhook operation and is not callable
-- by browser roles. Company ownership is inherited from the locked invoice row.

CREATE OR REPLACE FUNCTION public.set_invoice_status(
  p_invoice_id uuid, p_status text
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  inv public.crm_invoices%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO inv FROM public.crm_invoices
  WHERE id = p_invoice_id FOR UPDATE;
  IF inv.id IS NULL OR inv.company_id IS NULL OR p_status NOT IN ('issued','void') THEN
    RAISE EXCEPTION 'Invoice unavailable';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.crm_company_memberships m
    WHERE m.user_id = auth.uid()
      AND m.company_id = inv.company_id
      AND m.role IN ('owner','admin','accounting')
  ) THEN RAISE EXCEPTION 'Accounting access required for this company'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.invoice_checkouts c
    WHERE c.invoice_id = inv.id AND c.company_id = inv.company_id AND c.status = 'pending'
  ) THEN RAISE EXCEPTION 'Cancel pending checkout first'; END IF;
  IF p_status = 'issued' AND inv.status <> 'draft' THEN
    RAISE EXCEPTION 'Only draft invoices can be issued';
  END IF;
  IF p_status = 'void' AND (inv.paid_cents <> 0 OR inv.status = 'void') THEN
    RAISE EXCEPTION 'Paid or void invoices cannot be withdrawn';
  END IF;
  UPDATE public.crm_invoices SET status = p_status
  WHERE id = inv.id AND company_id = inv.company_id;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_invoice_payment(
  p_invoice_id uuid, p_amount_cents bigint, p_method text,
  p_reference text, p_received_at timestamptz
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  inv public.crm_invoices%ROWTYPE;
  payment_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF p_method NOT IN ('cash','check','bank_transfer','card_external')
     OR p_amount_cents IS NULL OR p_amount_cents <= 0 OR p_received_at IS NULL THEN
    RAISE EXCEPTION 'Invalid payment';
  END IF;
  SELECT * INTO inv FROM public.crm_invoices
  WHERE id = p_invoice_id FOR UPDATE;
  IF inv.id IS NULL OR inv.company_id IS NULL OR inv.status <> 'issued' THEN
    RAISE EXCEPTION 'Issue the invoice before recording a payment';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.crm_company_memberships m
    WHERE m.user_id = auth.uid()
      AND m.company_id = inv.company_id
      AND m.role IN ('owner','admin','accounting')
  ) THEN RAISE EXCEPTION 'Accounting access required for this company'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.invoice_checkouts c
    WHERE c.invoice_id = inv.id AND c.company_id = inv.company_id AND c.status = 'pending'
  ) THEN RAISE EXCEPTION 'An online payment is pending; wait for completion or cancel checkout first'; END IF;
  IF p_amount_cents > inv.total_cents - inv.paid_cents THEN
    RAISE EXCEPTION 'Payment exceeds outstanding balance';
  END IF;
  INSERT INTO public.invoice_payments(
    company_id, invoice_id, amount_cents, method, reference, received_at, environment
  ) VALUES (
    inv.company_id, inv.id, p_amount_cents, p_method, left(p_reference,200),
    p_received_at, inv.environment
  ) RETURNING id INTO payment_id;
  UPDATE public.crm_invoices SET paid_cents = paid_cents + p_amount_cents
  WHERE id = inv.id AND company_id = inv.company_id;
  RETURN payment_id;
END;
$$;

-- This function is invoked only after the payment provider's webhook signature
-- has been verified by the trusted server. It must never be browser-callable.
CREATE OR REPLACE FUNCTION public.settle_invoice_checkout(
  p_session_id text, p_environment text, p_amount_cents bigint
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  checkout public.invoice_checkouts%ROWTYPE;
  inv public.crm_invoices%ROWTYPE;
BEGIN
  IF coalesce(auth.role(),'') <> 'service_role' THEN
    RAISE EXCEPTION 'Trusted payment service required';
  END IF;
  SELECT * INTO checkout FROM public.invoice_checkouts
  WHERE session_id = p_session_id AND environment = p_environment
  FOR UPDATE;
  IF checkout.id IS NULL OR checkout.company_id IS NULL THEN
    RAISE EXCEPTION 'Checkout not found';
  END IF;
  SELECT * INTO inv FROM public.crm_invoices
  WHERE id = checkout.invoice_id AND company_id = checkout.company_id
  FOR UPDATE;
  IF inv.id IS NULL OR inv.company_id IS DISTINCT FROM checkout.company_id THEN
    RAISE EXCEPTION 'Checkout invoice company mismatch';
  END IF;
  IF checkout.status = 'paid' THEN RETURN true; END IF;
  IF inv.status <> 'issued' OR inv.environment <> p_environment
     OR checkout.amount_cents <> p_amount_cents OR p_amount_cents <= 0 THEN
    RAISE EXCEPTION 'Payment mismatch';
  END IF;
  IF p_amount_cents > inv.total_cents - inv.paid_cents THEN
    RAISE EXCEPTION 'Payment exceeds balance; review required';
  END IF;
  INSERT INTO public.invoice_payments(
    company_id, invoice_id, amount_cents, method, reference, provider_event_id, environment
  ) VALUES (
    inv.company_id, inv.id, p_amount_cents, 'stripe', p_session_id, p_session_id, p_environment
  );
  UPDATE public.crm_invoices SET paid_cents = paid_cents + p_amount_cents
  WHERE id = inv.id AND company_id = inv.company_id;
  UPDATE public.invoice_checkouts SET status = 'paid'
  WHERE id = checkout.id AND company_id = inv.company_id;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.set_invoice_status(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_invoice_status(uuid,text) TO authenticated;
REVOKE ALL ON FUNCTION public.record_invoice_payment(uuid,bigint,text,text,timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_invoice_payment(uuid,bigint,text,text,timestamptz) TO authenticated;
REVOKE ALL ON FUNCTION public.settle_invoice_checkout(text,text,bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_invoice_checkout(text,text,bigint) TO service_role;

COMMENT ON FUNCTION public.set_invoice_status(uuid,text) IS
  'Changes invoice status only for owner/admin/accounting members of the invoice company.';
COMMENT ON FUNCTION public.record_invoice_payment(uuid,bigint,text,text,timestamptz) IS
  'Records a manual payment only for accounting members of the invoice company; payment inherits invoice company.';
COMMENT ON FUNCTION public.settle_invoice_checkout(text,text,bigint) IS
  'Trusted webhook-only settlement; checkout and invoice company must match; payment inherits invoice company.';
