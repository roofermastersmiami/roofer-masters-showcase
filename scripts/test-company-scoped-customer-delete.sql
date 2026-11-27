-- Disposable PostgreSQL integration test for company-scoped customer deletion.
\set ON_ERROR_STOP on
CREATE SCHEMA IF NOT EXISTS auth;
DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END
$roles$;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
CREATE TABLE public.crm_companies(id uuid PRIMARY KEY, name text NOT NULL);
CREATE TABLE public.crm_company_memberships(company_id uuid NOT NULL REFERENCES public.crm_companies(id), user_id uuid NOT NULL, role text NOT NULL, PRIMARY KEY(company_id,user_id));
CREATE TABLE public.crm_customers(id uuid PRIMARY KEY, company_id uuid NOT NULL REFERENCES public.crm_companies(id));
CREATE TABLE public.crm_properties(id uuid PRIMARY KEY, customer_id uuid NOT NULL REFERENCES public.crm_customers(id), company_id uuid NOT NULL REFERENCES public.crm_companies(id));
CREATE TABLE public.roof_report_orders(id uuid PRIMARY KEY, customer_id uuid NOT NULL REFERENCES public.crm_customers(id), company_id uuid NOT NULL REFERENCES public.crm_companies(id));
CREATE TABLE public.leads(id uuid PRIMARY KEY, customer_id uuid, company_id uuid NOT NULL REFERENCES public.crm_companies(id));
\ir ../drizzle/migrations/0046_company_scoped_customer_delete.sql
INSERT INTO public.crm_companies VALUES
 ('10000000-0000-0000-0000-000000000001','Company One'),
 ('10000000-0000-0000-0000-000000000002','Company Two');
INSERT INTO public.crm_company_memberships VALUES
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','office'),
 ('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000002','owner'),
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000003','production_manager');
INSERT INTO public.crm_customers VALUES
 ('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001'),
 ('30000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002');
INSERT INTO public.leads VALUES
 ('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001');
INSERT INTO public.crm_properties VALUES
 ('40000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001');
INSERT INTO public.roof_report_orders VALUES
 ('50000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001');

DO $tests$
DECLARE result_id uuid;
BEGIN
  PERFORM set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
  BEGIN
    PERFORM public.delete_crm_customer('30000000-0000-0000-0000-000000000002');
    RAISE EXCEPTION 'Cross-company delete unexpectedly succeeded';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Customer unavailable' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.delete_crm_customer('30000000-0000-0000-0000-000000000001');
    RAISE EXCEPTION 'Delete with linked property unexpectedly succeeded';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'This customer has linked properties.%' THEN RAISE; END IF;
  END;
  DELETE FROM public.crm_properties WHERE id='40000000-0000-0000-0000-000000000001';
  BEGIN
    PERFORM public.delete_crm_customer('30000000-0000-0000-0000-000000000001');
    RAISE EXCEPTION 'Delete with linked roof report unexpectedly succeeded';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'This customer has roof measurement reports.%' THEN RAISE; END IF;
  END;
  DELETE FROM public.roof_report_orders WHERE id='50000000-0000-0000-0000-000000000001';
  result_id := public.delete_crm_customer('30000000-0000-0000-0000-000000000001');
  IF result_id <> '30000000-0000-0000-0000-000000000001' THEN RAISE EXCEPTION 'Wrong deleted customer ID'; END IF;
  IF EXISTS (SELECT 1 FROM public.crm_customers WHERE id=result_id) THEN RAISE EXCEPTION 'Customer row remains'; END IF;
  IF (SELECT customer_id FROM public.leads WHERE id='20000000-0000-0000-0000-000000000001') IS NOT NULL THEN RAISE EXCEPTION 'Lead link was not detached'; END IF;

  PERFORM set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',true);
  BEGIN
    PERFORM public.delete_crm_customer('30000000-0000-0000-0000-000000000002');
    RAISE EXCEPTION 'Unauthorized role unexpectedly succeeded';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Access denied' THEN RAISE; END IF;
  END;
  PERFORM set_config('request.jwt.claim.sub','',true);
  BEGIN
    PERFORM public.delete_crm_customer('30000000-0000-0000-0000-000000000002');
    RAISE EXCEPTION 'Unauthenticated delete unexpectedly succeeded';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Authentication required' THEN RAISE; END IF;
  END;
END
$tests$;
DO $privileges$
BEGIN
  IF NOT has_function_privilege('authenticated','public.delete_crm_customer(uuid)','EXECUTE') THEN RAISE EXCEPTION 'authenticated execute grant missing'; END IF;
  IF has_function_privilege('anon','public.delete_crm_customer(uuid)','EXECUTE') OR has_function_privilege('service_role','public.delete_crm_customer(uuid)','EXECUTE') THEN RAISE EXCEPTION 'unexpected anon/service_role execute grant'; END IF;
END
$privileges$;
\echo 'PASS: company-scoped customer delete, two-company isolation, role checks, and linked-record safeguards'
