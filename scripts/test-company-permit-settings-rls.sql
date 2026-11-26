-- Focused PostgreSQL integration test for migration 0041.
-- Run with psql -v ON_ERROR_STOP=1 -f scripts/test-company-permit-settings-rls.sql
\set ON_ERROR_STOP on

DO $$ BEGIN
  CREATE ROLE anon NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE ROLE authenticated NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE ROLE service_role NOLOGIN BYPASSRLS;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE
AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, anon, service_role;
GRANT USAGE ON SCHEMA public TO authenticated, anon, service_role;

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

DO $$ BEGIN
  CREATE TYPE public.crm_company_role AS ENUM ('owner','admin','office','sales','production_manager','crew','accounting');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE public.crm_companies (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.crm_company_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.crm_companies(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.crm_company_role NOT NULL DEFAULT 'office',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id,user_id)
);
CREATE OR REPLACE FUNCTION public.is_crm_company_member(_company_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT auth.uid() IS NOT NULL AND EXISTS (
   SELECT 1 FROM public.crm_company_memberships m
   WHERE m.company_id=_company_id AND m.user_id=auth.uid()
 ) $$;
CREATE OR REPLACE FUNCTION public.is_crm_company_admin(_company_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT auth.uid() IS NOT NULL AND EXISTS (
   SELECT 1 FROM public.crm_company_memberships m
   WHERE m.company_id=_company_id AND m.user_id=auth.uid()
   AND m.role IN ('owner','admin')
 ) $$;
GRANT EXECUTE ON FUNCTION public.is_crm_company_member(uuid), public.is_crm_company_admin(uuid)
TO authenticated, service_role;

INSERT INTO auth.users(id) VALUES
 ('00000000-0000-0000-0000-000000000001'),
 ('00000000-0000-0000-0000-000000000002'),
 ('00000000-0000-0000-0000-000000000003');
INSERT INTO public.crm_companies(id,name,created_by) VALUES
 ('10000000-0000-0000-0000-000000000001','Company A','00000000-0000-0000-0000-000000000001'),
 ('10000000-0000-0000-0000-000000000002','Company B','00000000-0000-0000-0000-000000000002');
INSERT INTO public.crm_company_memberships(company_id,user_id,role) VALUES
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','owner'),
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000003','office'),
 ('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000002','owner');

\ir ../drizzle/migrations/0041_company_permit_qualifier_settings.sql

INSERT INTO public.crm_company_permit_settings(company_id,qualifier_name,ccc_license_number)
VALUES
 ('10000000-0000-0000-0000-000000000001','Qualifier A','CCC1234567'),
 ('10000000-0000-0000-0000-000000000002','Qualifier B','CCC7654321');

DO $$ BEGIN
 IF has_table_privilege('anon','public.crm_company_permit_settings','SELECT') THEN
   RAISE EXCEPTION 'anon unexpectedly has SELECT privilege';
 END IF;
 IF has_table_privilege('authenticated','public.crm_company_permit_settings','DELETE') THEN
   RAISE EXCEPTION 'authenticated unexpectedly has DELETE privilege';
 END IF;
 IF NOT (SELECT relforcerowsecurity FROM pg_class WHERE oid='public.crm_company_permit_settings'::regclass) THEN
   RAISE EXCEPTION 'FORCE ROW LEVEL SECURITY is not enabled';
 END IF;
END $$;

-- Company A ordinary member: can read own company's row, never Company B.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',true);
DO $$ DECLARE n integer; BEGIN
 SELECT count(*) INTO n FROM public.crm_company_permit_settings;
 IF n <> 1 THEN RAISE EXCEPTION 'member should see exactly one company row; saw %',n; END IF;
 IF EXISTS (SELECT 1 FROM public.crm_company_permit_settings WHERE ccc_license_number='CCC7654321') THEN
   RAISE EXCEPTION 'cross-company row leaked';
 END IF;
 UPDATE public.crm_company_permit_settings SET qualifier_name='Unauthorized' WHERE company_id='10000000-0000-0000-0000-000000000001';
 IF (SELECT qualifier_name FROM public.crm_company_permit_settings WHERE company_id='10000000-0000-0000-0000-000000000001') <> 'Qualifier A' THEN
   RAISE EXCEPTION 'non-admin member updated qualifier settings';
 END IF;
 BEGIN
   INSERT INTO public.crm_company_permit_settings(company_id,qualifier_name)
   VALUES ('10000000-0000-0000-0000-000000000001','Unauthorized');
   RAISE EXCEPTION 'non-admin member unexpectedly inserted settings';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $$;
RESET ROLE;

-- Company A owner: may create/update A, but cannot forge a B company_id.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
DO $$ DECLARE n integer; BEGIN
 SELECT count(*) INTO n FROM public.crm_company_permit_settings;
 IF n <> 1 THEN RAISE EXCEPTION 'Company A owner should see only A; saw %',n; END IF;
 UPDATE public.crm_company_permit_settings
 SET ccc_license_number='CCC0000123'
 WHERE company_id='10000000-0000-0000-0000-000000000001';
 IF NOT EXISTS (SELECT 1 FROM public.crm_company_permit_settings WHERE ccc_license_number='CCC0000123') THEN
   RAISE EXCEPTION 'Company A owner could not update own settings';
 END IF;
 BEGIN
   INSERT INTO public.crm_company_permit_settings(company_id,qualifier_name)
   VALUES ('10000000-0000-0000-0000-000000000002','Forged cross-tenant');
   RAISE EXCEPTION 'Company A owner forged Company B insert';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 UPDATE public.crm_company_permit_settings SET qualifier_name='Forged update'
 WHERE company_id='10000000-0000-0000-0000-000000000002';
 IF EXISTS (SELECT 1 FROM public.crm_company_permit_settings WHERE qualifier_name='Forged update') THEN
   RAISE EXCEPTION 'Company A owner updated Company B';
 END IF;
END $$;
RESET ROLE;

-- Company B owner is isolated and retains CCC license as exact text.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
DO $$ BEGIN
 IF (SELECT count(*) FROM public.crm_company_permit_settings) <> 1 THEN
   RAISE EXCEPTION 'Company B owner did not see exactly its own row';
 END IF;
 IF (SELECT ccc_license_number FROM public.crm_company_permit_settings) <> 'CCC7654321' THEN
   RAISE EXCEPTION 'CCC license string was altered';
 END IF;
END $$;
RESET ROLE;

\echo 'PASS: migration 0041 RLS isolation, write authorization, delete denial, and CCC text checks'
