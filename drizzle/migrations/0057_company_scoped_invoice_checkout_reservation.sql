-- tenant-audit: reviewed — security-definer checkout reservation locks the capability-token invoice, derives company_id only from that row, and is executable only by service_role; no caller-supplied tenant identifier is accepted.
-- Ensure public invoice checkout reservations inherit tenant ownership from the locked invoice.
-- The capability-token flow remains public through its server-only service_role boundary.
CREATE OR REPLACE FUNCTION public.reserve_invoice_checkout(
  p_token uuid, p_environment text, p_kind text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  inv public.crm_invoices%ROWTYPE;
  charge bigint;
  checkout_id uuid;
BEGIN
  SELECT * INTO inv FROM public.crm_invoices
  WHERE token = p_token AND status = 'issued'
    AND environment = p_environment AND expires_at > now()
  FOR UPDATE;
  IF inv.id IS NULL OR inv.company_id IS NULL OR p_kind NOT IN ('deposit','balance') THEN
    RAISE EXCEPTION 'Invoice unavailable';
  END IF;
  IF p_kind = 'deposit' THEN
    charge := greatest(0, least(inv.deposit_cents - inv.paid_cents, inv.total_cents - inv.paid_cents));
  ELSE
    charge := inv.total_cents - inv.paid_cents;
  END IF;
  IF charge < 50 THEN RAISE EXCEPTION 'There is no payable balance of at least $0.50'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.invoice_checkouts
    WHERE invoice_id = inv.id AND company_id = inv.company_id AND status = 'pending'
  ) THEN RAISE EXCEPTION 'An online payment is already pending'; END IF;
  INSERT INTO public.invoice_checkouts(company_id, invoice_id, environment, amount_cents)
  VALUES (inv.company_id, inv.id, p_environment, charge)
  RETURNING id INTO checkout_id;
  RETURN jsonb_build_object('id', checkout_id, 'amount', charge);
END;
$$;
REVOKE ALL ON FUNCTION public.reserve_invoice_checkout(uuid,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_invoice_checkout(uuid,text,text) TO service_role;
COMMENT ON FUNCTION public.reserve_invoice_checkout(uuid,text,text) IS
  'Reserves public invoice checkout by capability token; checkout inherits company_id from locked invoice.';
