-- PostgreSQL 16 integration test for migration 0042.
-- Execute only in a disposable database: createdb crm_ownership_test && psql ... -f this file.
\set ON_ERROR_STOP on
DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE public.crm_companies (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.crm_company_memberships (
  company_id uuid NOT NULL REFERENCES public.crm_companies(id),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  role text NOT NULL,
  PRIMARY KEY (company_id,user_id)
);
CREATE TABLE public.leads (
  id uuid PRIMARY KEY,
  customer_id uuid
);
CREATE TABLE public.crm_customers (
  id uuid PRIMARY KEY,
  source_lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL
);
ALTER TABLE public.leads ADD CONSTRAINT leads_customer_id_fkey
  FOREIGN KEY (customer_id) REFERENCES public.crm_customers(id);
CREATE TABLE public.crm_properties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid REFERENCES public.crm_customers(id)
);
CREATE TABLE public.roof_report_orders (
  id uuid PRIMARY KEY,
  customer_id uuid REFERENCES public.crm_customers(id),
  property_id uuid REFERENCES public.crm_properties(id)
);

INSERT INTO auth.users(id) VALUES
 ('00000000-0000-0000-0000-000000000001'),
 ('00000000-0000-0000-0000-000000000002');
INSERT INTO public.crm_companies(id,name,created_by) VALUES
 ('10000000-0000-0000-0000-000000000001','Legacy Roofer Masters','00000000-0000-0000-0000-000000000001');
INSERT INTO public.crm_company_memberships(company_id,user_id,role) VALUES
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','owner');

INSERT INTO public.leads(id) VALUES
 ('20000000-0000-0000-0000-000000000001'),
 ('20000000-0000-0000-0000-000000000002');
INSERT INTO public.crm_customers(id,source_lead_id) VALUES
 ('30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001');
UPDATE public.leads SET customer_id='30000000-0000-0000-0000-000000000001'
WHERE id='20000000-0000-0000-0000-000000000001';
INSERT INTO public.crm_properties(id,customer_id) VALUES
 ('40000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001');
INSERT INTO public.roof_report_orders(id,customer_id,property_id) VALUES
 ('50000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001');

\ir ../drizzle/migrations/0042_crm_company_ownership_foundation.sql

DO $$
BEGIN
  IF (SELECT count(*) FROM public.leads WHERE company_id='10000000-0000-0000-0000-000000000001') <> 2
     OR (SELECT count(*) FROM public.crm_customers WHERE company_id='10000000-0000-0000-0000-000000000001') <> 1
     OR (SELECT count(*) FROM public.crm_properties WHERE company_id='10000000-0000-0000-0000-000000000001') <> 1
     OR (SELECT count(*) FROM public.roof_report_orders WHERE company_id='10000000-0000-0000-0000-000000000001') <> 1 THEN
    RAISE EXCEPTION 'Legacy rows were not fully assigned to the verified company';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public'
      AND table_name IN ('leads','crm_customers','crm_properties','roof_report_orders')
      AND column_name='company_id' AND is_nullable <> 'NO'
  ) THEN
    RAISE EXCEPTION 'company_id must be NOT NULL on all core records';
  END IF;
  -- Migration 0042 is only a relational-integrity foundation. RLS policy
  -- replacement is a separate coordinated release, so this migration must
  -- leave the fixture's existing RLS state untouched.
  IF EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname IN ('leads','crm_customers','crm_properties','roof_report_orders')
      AND c.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'Migration 0042 unexpectedly changed core-table RLS state';
  END IF;
END $$;

-- Migration 0043 keeps the pre-existing lead fan-out trigger compatible with
-- mandatory company ownership. Model the columns used by the production trigger.
ALTER TABLE public.leads
  ADD COLUMN name text NOT NULL DEFAULT '',
  ADD COLUMN phone text,
  ADD COLUMN email text,
  ADD COLUMN address text;
ALTER TABLE public.crm_customers
  ADD COLUMN name text NOT NULL DEFAULT '',
  ADD COLUMN phone text NOT NULL DEFAULT '',
  ADD COLUMN email text NOT NULL DEFAULT '';
ALTER TABLE public.crm_properties
  ADD COLUMN address text NOT NULL DEFAULT '';

-- Match the production crm_properties natural-key constraint from migration 0013.
ALTER TABLE public.crm_properties
  ADD CONSTRAINT crm_properties_customer_id_address_key UNIQUE (customer_id,address);

\ir ../drizzle/migrations/0043_company_aware_lead_customer_sync.sql
CREATE TRIGGER crm_sync_lead_customer
AFTER INSERT OR UPDATE OF name,phone,email,address ON public.leads
FOR EACH ROW EXECUTE FUNCTION public.sync_lead_customer();

INSERT INTO public.leads(id,company_id,name,phone,email,address)
VALUES (
  '20000000-0000-0000-0000-000000000009',
  '10000000-0000-0000-0000-000000000001',
  'New trigger test lead','3055550100','lead@example.com','100 Test Street'
);

DO $$
DECLARE
  lead_company uuid;
  customer_company uuid;
  property_company uuid;
  linked_customer uuid;
BEGIN
  SELECT company_id,customer_id INTO lead_company,linked_customer
  FROM public.leads WHERE id='20000000-0000-0000-0000-000000000009';
  SELECT company_id INTO customer_company
  FROM public.crm_customers WHERE id=linked_customer;
  SELECT company_id INTO property_company
  FROM public.crm_properties WHERE customer_id=linked_customer
    AND address='100 Test Street';

  IF lead_company IS DISTINCT FROM '10000000-0000-0000-0000-000000000001'
     OR customer_company IS DISTINCT FROM lead_company
     OR property_company IS DISTINCT FROM lead_company THEN
    RAISE EXCEPTION 'Lead trigger failed to propagate company ownership to customer/property';
  END IF;
END $$;

-- Same-company composite FK rejects a customer from another tenant.
INSERT INTO public.crm_companies(id,name,created_by) VALUES
 ('10000000-0000-0000-0000-000000000002','Second Company','00000000-0000-0000-0000-000000000002');
INSERT INTO public.crm_customers(id,company_id) VALUES
 ('30000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002');
INSERT INTO public.leads(id,company_id) VALUES
 ('20000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000002');
INSERT INTO public.crm_properties(id,customer_id,company_id) VALUES
 ('40000000-0000-0000-0000-000000000003',
  '30000000-0000-0000-0000-000000000002',
  '10000000-0000-0000-0000-000000000002');
DO $$
BEGIN
  BEGIN
    INSERT INTO public.crm_properties(id,customer_id,company_id,address)
    VALUES ('40000000-0000-0000-0000-000000000002',
            '30000000-0000-0000-0000-000000000002',
            '10000000-0000-0000-0000-000000000001',
            'Cross-company link rejection');
    RAISE EXCEPTION 'Cross-company customer/property link unexpectedly succeeded';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.leads(id,customer_id,company_id)
    VALUES ('20000000-0000-0000-0000-000000000004',
            '30000000-0000-0000-0000-000000000002',
            '10000000-0000-0000-0000-000000000001');
    RAISE EXCEPTION 'Cross-company lead/customer link unexpectedly succeeded';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.crm_customers(id,source_lead_id,company_id)
    VALUES ('30000000-0000-0000-0000-000000000003',
            '20000000-0000-0000-0000-000000000003',
            '10000000-0000-0000-0000-000000000001');
    RAISE EXCEPTION 'Cross-company customer/source-lead link unexpectedly succeeded';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.roof_report_orders(id,customer_id,property_id,company_id)
    VALUES ('50000000-0000-0000-0000-000000000002',
            '30000000-0000-0000-0000-000000000001',
            '40000000-0000-0000-0000-000000000003',
            '10000000-0000-0000-0000-000000000001');
    RAISE EXCEPTION 'Cross-company roof report/property link unexpectedly succeeded';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
END $$;

-- Preserve the original source-lead deletion behavior: only source_lead_id is nulled.
DELETE FROM public.leads WHERE id='20000000-0000-0000-0000-000000000001';
DO $$
BEGIN
  IF (SELECT source_lead_id FROM public.crm_customers
      WHERE id='30000000-0000-0000-0000-000000000001') IS NOT NULL THEN
    RAISE EXCEPTION 'Deleting source lead did not null source_lead_id';
  END IF;
  IF (SELECT company_id FROM public.crm_customers
      WHERE id='30000000-0000-0000-0000-000000000001') <> '10000000-0000-0000-0000-000000000001' THEN
    RAISE EXCEPTION 'Source lead deletion altered customer ownership';
  END IF;
END $$;

\echo 'PASS: migration 0042 backfill, NOT NULL ownership, cross-company FK rejection, and source-lead delete semantics'
