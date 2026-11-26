-- PostgreSQL integration test for migration 0048.
-- Run with: psql -v ON_ERROR_STOP=1 -f scripts/test-company-permit-records-rls.sql
\set ON_ERROR_STOP on

DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

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

CREATE TABLE public.crm_companies (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.crm_company_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.crm_companies(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner','admin','office','sales','production_manager','crew','accounting')),
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

CREATE TABLE public.leads (
 id uuid PRIMARY KEY,
 company_id uuid NOT NULL,
 UNIQUE(id,company_id)
);
CREATE TABLE public.crm_properties (
 id uuid PRIMARY KEY,
 company_id uuid NOT NULL,
 UNIQUE(id,company_id)
);
CREATE TABLE public.roof_jobs (
 id uuid PRIMARY KEY,
 lead_id uuid,
 property_id uuid,
 created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO auth.users(id) VALUES
 ('00000000-0000-0000-0000-000000000001'),
 ('00000000-0000-0000-0000-000000000002'),
 ('00000000-0000-0000-0000-000000000003'),
 ('00000000-0000-0000-0000-000000000004');
INSERT INTO public.crm_companies(id,name,slug,created_by) VALUES
 ('10000000-0000-0000-0000-000000000001','Company A','company-a','00000000-0000-0000-0000-000000000001'),
 ('10000000-0000-0000-0000-000000000002','Company B','company-b','00000000-0000-0000-0000-000000000002');
INSERT INTO public.crm_company_memberships(company_id,user_id,role) VALUES
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','owner'),
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000003','office'),
 ('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000002','owner');
INSERT INTO public.leads(id,company_id) VALUES
 ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001'),
 ('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002');
INSERT INTO public.crm_properties(id,company_id) VALUES
 ('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001'),
 ('30000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002');
INSERT INTO public.roof_jobs(id,lead_id,property_id) VALUES
 ('40000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001'),
 ('40000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000002');

-- Migration 0047 requires exactly one company; run its ownership DDL against a
-- one-company fixture first, then add Company B to test two-company RLS.
DELETE FROM public.crm_company_memberships WHERE company_id='10000000-0000-0000-0000-000000000002';
DELETE FROM public.crm_companies WHERE id='10000000-0000-0000-0000-000000000002';
DELETE FROM public.leads WHERE company_id='10000000-0000-0000-0000-000000000002';
DELETE FROM public.crm_properties WHERE company_id='10000000-0000-0000-0000-000000000002';
DELETE FROM public.roof_jobs WHERE id='40000000-0000-0000-0000-000000000002';

\ir ../drizzle/migrations/0047_company_owned_roof_jobs.sql
\ir ../drizzle/migrations/0048_company_permit_applications_and_inspections.sql

-- Add a second company after 0047's one-company legacy backfill.
INSERT INTO public.crm_companies(id,name,slug,created_by) VALUES
 ('10000000-0000-0000-0000-000000000002','Company B','company-b','00000000-0000-0000-0000-000000000002');
INSERT INTO public.crm_company_memberships(company_id,user_id,role) VALUES
 ('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000002','owner');
INSERT INTO public.leads(id,company_id) VALUES
 ('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002');
INSERT INTO public.crm_properties(id,company_id) VALUES
 ('30000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002');
INSERT INTO public.roof_jobs(id,lead_id,property_id,company_id) VALUES
 ('40000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002');

INSERT INTO public.roof_permit_applications(
 id,company_id,roof_job_id,jurisdiction_name,permit_type,application_status,created_by
) VALUES (
 '50000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',
 '40000000-0000-0000-0000-000000000001','City of Miramar','Roof replacement','draft',
 '00000000-0000-0000-0000-000000000001'
),(
 '50000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002',
 '40000000-0000-0000-0000-000000000002','City of Miami','Roof replacement','draft',
 '00000000-0000-0000-0000-000000000002'
);

INSERT INTO public.roof_permit_inspections(
 id,company_id,application_id,inspection_type,scheduling_status
) VALUES (
 '60000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',
 '50000000-0000-0000-0000-000000000001','Dry-in','requested'
);

DO $$ BEGIN
 IF NOT (SELECT relforcerowsecurity FROM pg_class WHERE oid='public.roof_permit_applications'::regclass) THEN
   RAISE EXCEPTION 'Permit applications FORCE RLS missing';
 END IF;
 IF NOT (SELECT relforcerowsecurity FROM pg_class WHERE oid='public.roof_permit_inspections'::regclass) THEN
   RAISE EXCEPTION 'Permit inspections FORCE RLS missing';
 END IF;
 IF has_table_privilege('anon','public.roof_permit_applications','SELECT') THEN
   RAISE EXCEPTION 'anon unexpectedly has permit SELECT';
 END IF;
END $$;

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',false);
DO $$ BEGIN
 IF (SELECT count(*) FROM public.roof_permit_applications) <> 1 THEN
   RAISE EXCEPTION 'Company A member must see only Company A permit applications';
 END IF;
 IF (SELECT count(*) FROM public.roof_permit_inspections) <> 1 THEN
   RAISE EXCEPTION 'Company A member must see only Company A inspections';
 END IF;
 BEGIN
   INSERT INTO public.roof_permit_applications(company_id,roof_job_id,jurisdiction_name,permit_type)
   VALUES ('10000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000002','City of Miami','Roof');
   RAISE EXCEPTION 'Non-admin member unexpectedly created permit';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $$;
RESET ROLE;

-- A signed-in user with no company membership must see no permit records.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000004',false);
DO $$ BEGIN
  IF (SELECT count(*) FROM public.roof_permit_applications) <> 0 THEN
    RAISE EXCEPTION 'Nonmember unexpectedly read permit applications';
  END IF;
  IF (SELECT count(*) FROM public.roof_permit_inspections) <> 0 THEN
    RAISE EXCEPTION 'Nonmember unexpectedly read permit inspections';
  END IF;
END $$;
RESET ROLE;

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
DO $$ BEGIN
 IF (SELECT count(*) FROM public.roof_permit_applications) <> 1 THEN
   RAISE EXCEPTION 'Company A owner must not see Company B permit';
 END IF;
 BEGIN
   INSERT INTO public.roof_permit_applications(company_id,roof_job_id,jurisdiction_name,permit_type)
   VALUES ('10000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000002','City of Miami','Roof');
   RAISE EXCEPTION 'Company A owner unexpectedly forged Company B permit';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 BEGIN
   INSERT INTO public.roof_permit_applications(company_id,roof_job_id,jurisdiction_name,permit_type)
   VALUES ('10000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000002','City of Miramar','Roof');
   RAISE EXCEPTION 'Cross-company job relationship unexpectedly accepted';
 EXCEPTION WHEN foreign_key_violation THEN NULL;
 END;
END $$;
RESET ROLE;


-- Non-admin company members must not update or delete permit records.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',false);
DO $$ BEGIN
  UPDATE public.roof_permit_applications
    SET notes='unauthorized edit'
    WHERE id='50000000-0000-0000-0000-000000000001';
  IF EXISTS (SELECT 1 FROM public.roof_permit_applications
             WHERE id='50000000-0000-0000-0000-000000000001'
               AND notes='unauthorized edit') THEN
    RAISE EXCEPTION 'Non-admin member unexpectedly updated a permit application';
  END IF;
  DELETE FROM public.roof_permit_inspections
    WHERE id='60000000-0000-0000-0000-000000000001';
  IF NOT EXISTS (SELECT 1 FROM public.roof_permit_inspections
                 WHERE id='60000000-0000-0000-0000-000000000001') THEN
    RAISE EXCEPTION 'Non-admin member unexpectedly deleted an inspection';
  END IF;
END $$;
RESET ROLE;

-- Company A admins must not create an inspection linked to Company B's application.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
DO $$ BEGIN
  BEGIN
    INSERT INTO public.roof_permit_inspections(
      company_id,application_id,inspection_type
    ) VALUES (
      '10000000-0000-0000-0000-000000000001',
      '50000000-0000-0000-0000-000000000002',
      'Cross-company test'
    );
    RAISE EXCEPTION 'Cross-company inspection/application relationship unexpectedly accepted';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO public.roof_permit_applications(
      company_id,roof_job_id,jurisdiction_name,permit_type,application_status
    ) VALUES (
      '10000000-0000-0000-0000-000000000001',
      '40000000-0000-0000-0000-000000000001',
      'City of Miramar','Roof','issued'
    );
    RAISE EXCEPTION 'Issued permit without official number/timestamps unexpectedly accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;
RESET ROLE;

\echo 'PASS: company-scoped permit application/inspection RLS and same-company job linkage'
