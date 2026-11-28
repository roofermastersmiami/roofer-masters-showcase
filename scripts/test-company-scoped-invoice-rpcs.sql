\set ON_ERROR_STOP on
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'authenticated')
$$;

CREATE TABLE crm_company_memberships(user_id uuid, company_id uuid, role text);
CREATE TABLE crm_invoices(
  id uuid PRIMARY KEY, company_id uuid NOT NULL, status text NOT NULL,
  paid_cents bigint NOT NULL DEFAULT 0, total_cents bigint NOT NULL,
  deposit_cents bigint NOT NULL DEFAULT 0, token uuid UNIQUE, expires_at timestamptz DEFAULT now() + interval '1 day',
  environment text NOT NULL
);
CREATE TABLE invoice_checkouts(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL, invoice_id uuid NOT NULL,
  session_id text, environment text NOT NULL, amount_cents bigint NOT NULL,
  status text NOT NULL DEFAULT 'pending'
);
CREATE TABLE invoice_payments(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL,
  invoice_id uuid NOT NULL, amount_cents bigint NOT NULL, method text NOT NULL,
  reference text, provider_event_id text, received_at timestamptz, environment text NOT NULL
);

INSERT INTO crm_company_memberships VALUES
('00000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','owner'),
('00000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','accounting');
INSERT INTO crm_invoices(id,company_id,status,paid_cents,total_cents,environment) VALUES
('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','draft',0,10000,'test'),
('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','issued',0,10000,'test');
INSERT INTO crm_invoices(id,company_id,status,paid_cents,total_cents,deposit_cents,token,expires_at,environment) VALUES
('20000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','issued',0,10000,2500,'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',now()+interval '1 day','test');
INSERT INTO invoice_checkouts VALUES
('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002','cs_test_1','test',5000,'pending');

\ir ../drizzle/migrations/0057_company_scoped_invoice_payment_rpcs.sql
\ir ../drizzle/migrations/0058_company_scoped_invoice_checkout_reservation.sql

-- Same-company accounting can issue an invoice.
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
DO $$ BEGIN
  IF NOT public.set_invoice_status('20000000-0000-0000-0000-000000000001','issued') THEN
    RAISE EXCEPTION 'Same-company issue did not return true';
  END IF;
END $$;

-- A different company's accounting member cannot issue the first company's invoice.
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false);
DO $$ BEGIN
  BEGIN
    PERFORM public.set_invoice_status('20000000-0000-0000-0000-000000000001','void');
    RAISE EXCEPTION 'Cross-company invoice status change was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'Cross-company invoice status change was accepted' THEN RAISE; END IF;
  END;
END $$;

-- Same-company manual payment is recorded and inherits company from invoice.
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
DO $$
DECLARE payment_uuid uuid;
BEGIN
  payment_uuid := public.record_invoice_payment(
    '20000000-0000-0000-0000-000000000001',2500,'check','CHK-1',now()
  );
  IF NOT EXISTS(SELECT 1 FROM invoice_payments
    WHERE id=payment_uuid AND company_id='10000000-0000-0000-0000-000000000001'
      AND invoice_id='20000000-0000-0000-0000-000000000001') THEN
    RAISE EXCEPTION 'Payment did not inherit invoice company';
  END IF;
END $$;

-- A company A owner cannot record payment against company B invoice.
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
DO $$ BEGIN
  BEGIN
    PERFORM public.record_invoice_payment(
      '20000000-0000-0000-0000-000000000002',1000,'cash','X',now()
    );
    RAISE EXCEPTION 'Cross-company payment was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'Cross-company payment was accepted' THEN RAISE; END IF;
  END;
END $$;

-- Authenticated users cannot settle a provider checkout directly.
DO $$ BEGIN
  BEGIN
    PERFORM public.settle_invoice_checkout('cs_test_1','test',5000);
    RAISE EXCEPTION 'Authenticated checkout settlement was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'Authenticated checkout settlement was accepted' THEN RAISE; END IF;
  END;
END $$;

-- Trusted service reserves checkout using the invoice token and inherits invoice company.
SELECT set_config('request.jwt.claim.role','service_role',false);
DO $$
DECLARE reservation jsonb; reservation_id uuid;
BEGIN
  reservation := public.reserve_invoice_checkout('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','test','deposit');
  reservation_id := (reservation->>'id')::uuid;
  IF NOT EXISTS (SELECT 1 FROM invoice_checkouts WHERE id=reservation_id
    AND invoice_id='20000000-0000-0000-0000-000000000003'
    AND company_id='10000000-0000-0000-0000-000000000001'
    AND amount_cents=2500 AND status='pending') THEN
    RAISE EXCEPTION 'Checkout reservation did not inherit invoice company';
  END IF;
END $$;

-- Trusted payment service can settle, and the payment inherits checkout/invoice company.
SELECT set_config('request.jwt.claim.role','service_role',false);
DO $$
BEGIN
  IF NOT public.settle_invoice_checkout('cs_test_1','test',5000) THEN
    RAISE EXCEPTION 'Trusted checkout settlement failed';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM invoice_payments
    WHERE invoice_id='20000000-0000-0000-0000-000000000002'
      AND company_id='10000000-0000-0000-0000-000000000002'
      AND provider_event_id='cs_test_1') THEN
    RAISE EXCEPTION 'Settlement payment company does not match invoice';
  END IF;
  IF (SELECT paid_cents FROM crm_invoices WHERE id='20000000-0000-0000-0000-000000000002') <> 5000 THEN
    RAISE EXCEPTION 'Invoice paid balance was not updated';
  END IF;
  IF NOT public.settle_invoice_checkout('cs_test_1','test',5000) THEN
    RAISE EXCEPTION 'Repeated settlement was not idempotent';
  END IF;
  IF (SELECT count(*) FROM invoice_payments WHERE provider_event_id='cs_test_1') <> 1 THEN
    RAISE EXCEPTION 'Repeated settlement duplicated payment';
  END IF;
END $$;

\echo 'Company-scoped invoice RPC integration tests passed.'
