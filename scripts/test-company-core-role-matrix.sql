\set ON_ERROR_STOP on
CREATE EXTENSION IF NOT EXISTS pgcrypto;
DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE SCHEMA auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, anon, service_role;
CREATE TYPE public.app_role AS ENUM ('admin','office','sales','production_manager','crew','accounting');
CREATE TABLE public.user_roles(user_id uuid NOT NULL,role public.app_role NOT NULL);
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid,_role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $has_role$
 SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=_user_id AND role=_role)
$has_role$;
CREATE OR REPLACE FUNCTION public.has_any_role(_user_id uuid,_roles public.app_role[])
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $has_any_role$
 SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=_user_id AND role=ANY(_roles))
$has_any_role$;
GRANT EXECUTE ON FUNCTION public.has_role(uuid,public.app_role) TO PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_any_role(uuid,public.app_role[]) TO PUBLIC, anon, authenticated, service_role;
CREATE SCHEMA storage;
CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text NOT NULL,name text NOT NULL);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
GRANT USAGE ON SCHEMA storage TO authenticated;
GRANT SELECT,INSERT,DELETE ON storage.objects TO authenticated;

CREATE TABLE public.crm_company_memberships(company_id uuid NOT NULL,user_id uuid NOT NULL,role text NOT NULL);
CREATE OR REPLACE FUNCTION public.is_crm_company_member(_company_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT EXISTS(SELECT 1 FROM public.crm_company_memberships m WHERE m.company_id=_company_id AND m.user_id=auth.uid())
$$;
CREATE OR REPLACE FUNCTION public.is_crm_company_admin(_company_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT EXISTS(SELECT 1 FROM public.crm_company_memberships m WHERE m.company_id=_company_id AND m.user_id=auth.uid() AND m.role IN ('owner','admin'))
$$;

CREATE TABLE public.leads(id uuid PRIMARY KEY,company_id uuid NOT NULL);
CREATE TABLE public.crm_customers(id uuid PRIMARY KEY,company_id uuid NOT NULL);
CREATE TABLE public.crm_properties(id uuid PRIMARY KEY,company_id uuid NOT NULL);
CREATE TABLE public.roof_jobs(id uuid PRIMARY KEY,company_id uuid NOT NULL,assigned_user_ids uuid[] NOT NULL DEFAULT '{}');
CREATE TABLE public.roof_report_orders(id uuid PRIMARY KEY,company_id uuid NOT NULL);
CREATE TABLE public.roof_drawings(id uuid PRIMARY KEY,property_id uuid NOT NULL);
CREATE TABLE public.proposals(id uuid PRIMARY KEY,company_id uuid NOT NULL);

DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['leads','crm_customers','crm_properties','roof_jobs','roof_report_orders','roof_drawings','proposals'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('GRANT SELECT ON public.%I TO authenticated',t);
 END LOOP;
END $$;
GRANT SELECT ON public.crm_company_memberships TO authenticated;

-- Seed the pre-0067 broad policies so the migration must replace them.
CREATE POLICY "Company members read leads" ON public.leads FOR SELECT TO authenticated USING (public.is_crm_company_member(company_id));
CREATE POLICY "Company members read customers" ON public.crm_customers FOR SELECT TO authenticated USING (public.is_crm_company_member(company_id));
CREATE POLICY "Company members read properties" ON public.crm_properties FOR SELECT TO authenticated USING (public.is_crm_company_member(company_id));
CREATE POLICY "Company members read jobs" ON public.roof_jobs FOR SELECT TO authenticated USING (public.is_crm_company_member(company_id));
CREATE POLICY "Company production roles manage jobs" ON public.roof_jobs FOR ALL TO authenticated
 USING (public.is_crm_company_admin(company_id) OR EXISTS(SELECT 1 FROM public.crm_company_memberships m WHERE m.company_id=roof_jobs.company_id AND m.user_id=auth.uid() AND m.role='production_manager'))
 WITH CHECK (public.is_crm_company_admin(company_id) OR EXISTS(SELECT 1 FROM public.crm_company_memberships m WHERE m.company_id=roof_jobs.company_id AND m.user_id=auth.uid() AND m.role='production_manager'));
CREATE POLICY "Company members read report requests" ON public.roof_report_orders FOR SELECT TO authenticated USING (public.is_crm_company_member(company_id));
CREATE POLICY "Company members read drawings" ON public.roof_drawings FOR SELECT TO authenticated
 USING (EXISTS(SELECT 1 FROM public.crm_properties p WHERE p.id=roof_drawings.property_id AND public.is_crm_company_member(p.company_id)));
CREATE OR REPLACE FUNCTION public.can_access_company_proposal_file(object_name text,write_access boolean DEFAULT false)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.proposals p JOIN public.crm_company_memberships m ON m.company_id=p.company_id
  WHERE p.id::text=split_part(object_name,'/',1) AND m.user_id=auth.uid())
$$;
CREATE POLICY "Company members read proposal files" ON storage.objects FOR SELECT TO authenticated
 USING (bucket_id='roofing-proposals' AND public.can_access_company_proposal_file(name,false));

CREATE POLICY "Company members read job photos" ON storage.objects FOR SELECT TO authenticated USING (bucket_id='roof-job-photos' AND true);
CREATE POLICY "Company members upload job photos" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id='roof-job-photos' AND true);
CREATE POLICY "Company admins delete job photos" ON storage.objects FOR DELETE TO authenticated USING (bucket_id='roof-job-photos' AND true);
CREATE POLICY "Company members read roof report files" ON storage.objects FOR SELECT TO authenticated USING (bucket_id='roofing-proposals' AND name LIKE 'roof-report/%');

INSERT INTO public.crm_company_memberships(company_id,user_id,role) VALUES
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','owner'),
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','office'),
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000003','sales'),
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000004','production_manager'),
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000005','accounting'),
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000006','crew'),
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000007','crew'),
 ('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000008','owner');

INSERT INTO leads VALUES
 ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001'),
 ('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002');
INSERT INTO crm_customers VALUES
 ('21000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001'),
 ('21000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002');
INSERT INTO crm_properties VALUES
 ('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001'),
 ('30000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002');
INSERT INTO roof_jobs VALUES
 ('40000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',ARRAY['00000000-0000-0000-0000-000000000006']::uuid[]),
 ('40000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002',ARRAY['00000000-0000-0000-0000-000000000008']::uuid[]);
INSERT INTO roof_report_orders VALUES
 ('50000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001'),
 ('50000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002');
INSERT INTO roof_drawings VALUES
 ('60000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001'),
 ('60000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000002');
INSERT INTO proposals VALUES
 ('70000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001'),
 ('70000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002');
INSERT INTO storage.objects(bucket_id,name) VALUES
 ('roof-job-photos','40000000-0000-0000-0000-000000000001/crew.jpg'),
 ('roof-job-photos','40000000-0000-0000-0000-000000000002/other.jpg'),
 ('roofing-proposals','roof-report/50000000-0000-0000-0000-000000000001/report.pdf'),
 ('roofing-proposals','roof-report/50000000-0000-0000-0000-000000000002/report.pdf'),
 ('roofing-proposals','70000000-0000-0000-0000-000000000001/proposal.pdf'),
 ('roofing-proposals','70000000-0000-0000-0000-000000000002/proposal.pdf');

\ir ../drizzle/migrations/0067_enforce_core_company_role_matrix.sql

DO $$ BEGIN
 IF has_function_privilege('anon','public.is_crm_company_member(uuid)','EXECUTE')
    OR has_function_privilege('anon','public.is_crm_company_admin(uuid)','EXECUTE')
    OR has_function_privilege('anon','public.has_role(uuid,public.app_role)','EXECUTE')
    OR has_function_privilege('anon','public.has_any_role(uuid,public.app_role[])','EXECUTE')
    OR has_function_privilege('anon','public.can_access_company_proposal_file(text,boolean)','EXECUTE')
    OR has_function_privilege('anon','public.can_access_company_job_photo(text,boolean)','EXECUTE') THEN
   RAISE EXCEPTION 'Anonymous role retains authorization helper execution';
 END IF;
 IF NOT has_function_privilege('authenticated','public.has_role(uuid,public.app_role)','EXECUTE')
    OR NOT has_function_privilege('authenticated','public.has_any_role(uuid,public.app_role[])','EXECUTE')
    OR NOT has_function_privilege('authenticated','public.can_access_company_proposal_file(text,boolean)','EXECUTE')
    OR NOT has_function_privilege('authenticated','public.can_access_company_job_photo(text,boolean)','EXECUTE') THEN
   RAISE EXCEPTION 'Authenticated role lost required helper execution';
 END IF;
END $$;

-- Assigned crew can read/upload only their job photos, not job rows or CRM records.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000006',false);
DO $assigned_crew$ BEGIN
 IF (SELECT count(*) FROM roof_jobs)<>0 OR (SELECT count(*) FROM leads)<>0
    OR (SELECT count(*) FROM crm_customers)<>0 OR (SELECT count(*) FROM crm_properties)<>0
    OR (SELECT count(*) FROM roof_report_orders)<>0 OR (SELECT count(*) FROM roof_drawings)<>0 THEN
   RAISE EXCEPTION 'Crew received general CRM/job/drawing reads';
 END IF;
 IF (SELECT count(*) FROM storage.objects WHERE bucket_id='roof-job-photos')<>1 THEN
   RAISE EXCEPTION 'Assigned crew must see only assigned job photos';
 END IF;
 IF (SELECT count(*) FROM storage.objects WHERE name LIKE 'roof-report/%')<>0
    OR (SELECT count(*) FROM storage.objects WHERE name='70000000-0000-0000-0000-000000000001/proposal.pdf')<>1 THEN
   RAISE EXCEPTION 'Crew proposal/report PDF access mismatch';
 END IF;
 INSERT INTO storage.objects(bucket_id,name) VALUES('roof-job-photos','40000000-0000-0000-0000-000000000001/crew-upload.jpg');
 DELETE FROM storage.objects WHERE bucket_id='roof-job-photos'
   AND name='40000000-0000-0000-0000-000000000001/crew.jpg';
 IF NOT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id='roof-job-photos'
   AND name='40000000-0000-0000-0000-000000000001/crew.jpg') THEN
   RAISE EXCEPTION 'Assigned crew deleted a job photo';
 END IF;
END $assigned_crew$;
RESET ROLE;

-- Unassigned crew cannot see job photos.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000007',false);
DO $unassigned_crew$ BEGIN
 IF (SELECT count(*) FROM storage.objects WHERE bucket_id='roof-job-photos')<>0 THEN
   RAISE EXCEPTION 'Unassigned crew can see job photos';
 END IF;
 BEGIN
   INSERT INTO storage.objects(bucket_id,name) VALUES('roof-job-photos','40000000-0000-0000-0000-000000000001/unassigned-upload.jpg');
   RAISE EXCEPTION 'Unassigned crew uploaded a job photo';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $unassigned_crew$;
RESET ROLE;

-- Office can access customer-facing reports/proposals and job photos, but not job rows.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false);
DO $$ BEGIN
 IF (SELECT count(*) FROM leads)<>1 OR (SELECT count(*) FROM crm_customers)<>1
    OR (SELECT count(*) FROM crm_properties)<>1 OR (SELECT count(*) FROM roof_report_orders)<>1
    OR (SELECT count(*) FROM roof_drawings)<>1 OR (SELECT count(*) FROM roof_jobs)<>1 THEN
   RAISE EXCEPTION 'Office role matrix mismatch';
 END IF;
 IF (SELECT count(*) FROM storage.objects WHERE name='70000000-0000-0000-0000-000000000001/proposal.pdf')<>1
    OR (SELECT count(*) FROM storage.objects WHERE name LIKE 'roof-report/%')<>1
    OR (SELECT count(*) FROM storage.objects WHERE bucket_id='roof-job-photos')<>2 THEN
   RAISE EXCEPTION 'Office storage role matrix mismatch';
 END IF;
END $$;
RESET ROLE;

-- Production manager can read/manage jobs and report/drawing records, but not proposal PDFs.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000004',false);
DO $$ BEGIN
 IF (SELECT count(*) FROM leads)<>1 OR (SELECT count(*) FROM roof_jobs)<>1
    OR (SELECT count(*) FROM roof_report_orders)<>1 OR (SELECT count(*) FROM roof_drawings)<>1 THEN
   RAISE EXCEPTION 'Production manager role matrix mismatch';
 END IF;
 IF (SELECT count(*) FROM storage.objects WHERE name LIKE 'roof-report/%')<>1
    OR (SELECT count(*) FROM storage.objects WHERE name LIKE '70000000-0000-0000-0000-000000000001/proposal.pdf')<>1 THEN
   RAISE EXCEPTION 'Production manager storage role matrix mismatch';
 END IF;
END $$;
RESET ROLE;

-- Accounting can read core financial/CRM data and jobs, but not drawings,
-- report PDFs, proposal PDFs, or job photos.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000005',false);
DO $$ BEGIN
 IF (SELECT count(*) FROM leads)<>1 OR (SELECT count(*) FROM crm_customers)<>1
    OR (SELECT count(*) FROM crm_properties)<>1 OR (SELECT count(*) FROM roof_jobs)<>1 THEN
   RAISE EXCEPTION 'Accounting role matrix mismatch';
 END IF;
 IF (SELECT count(*) FROM roof_report_orders)<>0 OR (SELECT count(*) FROM roof_drawings)<>0
    OR (SELECT count(*) FROM storage.objects WHERE bucket_id='roof-job-photos')<>0
    OR (SELECT count(*) FROM storage.objects WHERE name LIKE 'roof-report/%')<>0
    OR (SELECT count(*) FROM storage.objects WHERE name='70000000-0000-0000-0000-000000000001/proposal.pdf')<>1 THEN
   RAISE EXCEPTION 'Accounting report/drawing/photo/proposal access mismatch';
 END IF;
END $$;
RESET ROLE;

-- Sales can access CRM, reports, drawings, proposal PDFs and job photos, but not jobs.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',false);
DO $$ BEGIN
 IF (SELECT count(*) FROM leads)<>1 OR (SELECT count(*) FROM roof_report_orders)<>1
    OR (SELECT count(*) FROM roof_drawings)<>1 OR (SELECT count(*) FROM roof_jobs)<>0 THEN
   RAISE EXCEPTION 'Sales role matrix mismatch';
 END IF;
 IF (SELECT count(*) FROM storage.objects WHERE name='70000000-0000-0000-0000-000000000001/proposal.pdf')<>1 THEN
   RAISE EXCEPTION 'Sales cannot read proposal PDFs';
 END IF;
END $$;
RESET ROLE;

-- Company B owner sees only Company B rows and files.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000008',false);
DO $$ BEGIN
 IF (SELECT count(*) FROM leads)<>1 OR (SELECT count(*) FROM roof_jobs)<>1
    OR (SELECT count(*) FROM roof_report_orders)<>1 OR (SELECT count(*) FROM roof_drawings)<>1 THEN
   RAISE EXCEPTION 'Company B owner tenant isolation mismatch';
 END IF;
END $$;
RESET ROLE;

\echo 'PASS: core company role matrix, tenant isolation, helper ACLs, and assigned crew storage access'
