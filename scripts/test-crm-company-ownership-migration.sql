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


-- Exercise migration 0044's SECURITY DEFINER RPC with authenticated identities.
DO $roles$
BEGIN
  CREATE ROLE anon NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL;
END
$roles$;
DO $roles$
BEGIN
  CREATE ROLE authenticated NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL;
END
$roles$;
DO $roles$
BEGIN
  CREATE ROLE service_role NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL;
END
$roles$;

ALTER TABLE public.crm_customers
  ADD COLUMN billing_address text NOT NULL DEFAULT '',
  ADD COLUMN customer_type text NOT NULL DEFAULT 'residential',
  ADD COLUMN notes text NOT NULL DEFAULT '';

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql STABLE
AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
GRANT USAGE ON SCHEMA auth TO authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
-- Supabase grants public-schema usage by default; recreate that default in this isolated fixture.
GRANT USAGE ON SCHEMA public TO authenticated;

ALTER TABLE public.leads ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.leads ADD COLUMN source text, ADD COLUMN page text;

INSERT INTO public.crm_company_memberships(company_id,user_id,role) VALUES
 ('10000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000002','crew');

\ir ../drizzle/migrations/0044_company_scoped_customer_save.sql

-- Company A can create a customer; migration 0043's trigger creates the paired row.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
SELECT public.save_crm_customer(
  '{"name":"Company A customer","phone":"3055550101","email":"a@example.com","customer_type":"residential"}'::jsonb
);
DO $$
DECLARE
  created_customer uuid;
BEGIN
  SELECT id INTO created_customer FROM public.crm_customers
  WHERE name='Company A customer'
    AND company_id='10000000-0000-0000-0000-000000000001';
  IF created_customer IS NULL THEN
    RAISE EXCEPTION 'Company A customer was not created under the actor company';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.leads
    WHERE customer_id=created_customer
      AND company_id='10000000-0000-0000-0000-000000000001') THEN
    RAISE EXCEPTION 'Customer source lead was not linked within Company A';
  END IF;
END $$;

-- A user cannot update a customer owned by another company.
DO $$
BEGIN
  BEGIN
    PERFORM public.save_crm_customer(jsonb_build_object(
      'id','30000000-0000-0000-0000-000000000002',
      'name','Cross tenant attempt','customer_type','residential'
    ));
    RAISE EXCEPTION 'Cross-company customer update unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'Cross-company customer update unexpectedly succeeded' THEN RAISE; END IF;
    IF SQLERRM <> 'Customer unavailable' THEN RAISE; END IF;
  END;
END $$;

-- A second membership fails closed, even if one membership is otherwise privileged.
RESET ROLE;
INSERT INTO public.crm_company_memberships(company_id,user_id,role) VALUES
 ('10000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000001','owner');
SET ROLE authenticated;
DO $$
BEGIN
  BEGIN
    PERFORM public.save_crm_customer(
      '{"name":"Multiple membership attempt","customer_type":"residential"}'::jsonb
    );
    RAISE EXCEPTION 'Multiple memberships unexpectedly authorized';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'Multiple memberships unexpectedly authorized' THEN RAISE; END IF;
    IF SQLERRM <> 'A single company membership is required' THEN RAISE; END IF;
  END;
END $$;

-- A non-CRM crew role cannot use the customer save RPC.
RESET ROLE;
DELETE FROM public.crm_company_memberships
WHERE company_id='10000000-0000-0000-0000-000000000002'
  AND user_id='00000000-0000-0000-0000-000000000001';
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false);
DO $$
BEGIN
  BEGIN
    PERFORM public.save_crm_customer(
      '{"name":"Crew role attempt","customer_type":"residential"}'::jsonb
    );
    RAISE EXCEPTION 'Crew role unexpectedly authorized';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'Crew role unexpectedly authorized' THEN RAISE; END IF;
    IF SQLERRM <> 'Access denied' THEN RAISE; END IF;
  END;
END $$;
RESET ROLE;

-- Anonymous/no-auth execution is denied before any data access.
SELECT set_config('request.jwt.claim.sub','',false);
DO $$
BEGIN
  BEGIN
    PERFORM public.save_crm_customer(
      '{"name":"Anonymous attempt","customer_type":"residential"}'::jsonb
    );
    RAISE EXCEPTION 'Unauthenticated save unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'Unauthenticated save unexpectedly succeeded' THEN RAISE; END IF;
    IF SQLERRM <> 'Authentication required' THEN RAISE; END IF;
  END;
END $$;

\echo 'PASS: migration 0044 authenticated company-scoped customer save, cross-company rejection, multiple-membership denial, role denial, and unauthenticated denial'

DO $$
BEGIN
  IF has_function_privilege('anon','public.save_crm_customer(jsonb)','EXECUTE')
     OR has_function_privilege('service_role','public.save_crm_customer(jsonb)','EXECUTE') THEN
    RAISE EXCEPTION 'Anonymous or service_role unexpectedly has customer-save RPC execution';
  END IF;
  IF NOT has_function_privilege('authenticated','public.save_crm_customer(jsonb)','EXECUTE') THEN
    RAISE EXCEPTION 'Authenticated role is missing customer-save RPC execution';
  END IF;
END $$;
