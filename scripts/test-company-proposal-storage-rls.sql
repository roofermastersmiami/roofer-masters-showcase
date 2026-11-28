-- Dedicated two-company integration test for migration 0060 proposal storage.
-- Run only in a disposable PostgreSQL database.
\set ON_ERROR_STOP on
\ir test-secondary-operational-company-ownership.sql

DO $role_setup$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
  END IF;
END $role_setup$;
CREATE SCHEMA storage;
CREATE TABLE storage.buckets (
  id text PRIMARY KEY, name text NOT NULL, public boolean NOT NULL DEFAULT false
);
CREATE TABLE storage.objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id text NOT NULL REFERENCES storage.buckets(id),
  name text NOT NULL,
  owner_id uuid,
  UNIQUE(bucket_id,name)
);
INSERT INTO storage.buckets(id,name,public) VALUES ('roofing-proposals','roofing-proposals',false);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
CREATE FUNCTION public.is_crm_company_member(target_company uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public.crm_company_memberships m
    WHERE m.company_id=target_company AND m.user_id=auth.uid())
$$;
GRANT USAGE ON SCHEMA public,auth,storage TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON storage.objects TO authenticated;
GRANT SELECT ON storage.buckets TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_crm_company_member(uuid) TO authenticated;
GRANT SELECT ON public.proposals, public.crm_company_memberships TO authenticated;
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage.objects FORCE ROW LEVEL SECURITY;

-- Add Company B and its members. Company A owner already exists in fixture.
INSERT INTO auth.users VALUES ('00000000-0000-0000-0000-000000000003');
INSERT INTO crm_company_memberships(company_id,user_id,role) VALUES
 ('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000002','owner'),
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000003','crew');
INSERT INTO proposals(id,company_id) VALUES
 ('70000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000002');

\ir ../drizzle/migrations/0061_company_scoped_proposal_storage.sql

-- Seed both objects as database owner.
INSERT INTO storage.objects(bucket_id,name) VALUES
 ('roofing-proposals','70000000-0000-0000-0000-000000000001/a.pdf'),
 ('roofing-proposals','70000000-0000-0000-0000-000000000003/b.pdf'),
 ('roofing-proposals','expense-legacy/receipt.pdf'),
 ('roofing-proposals','roof-report/60000000-0000-0000-0000-000000000001/report.pdf');

-- Company A owner reads only its own proposal; can upload and delete there.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
DO $$ BEGIN
  IF (SELECT count(*) FROM storage.objects WHERE bucket_id='roofing-proposals') <> 1
    THEN RAISE EXCEPTION 'Company A owner read cross-company or excluded objects'; END IF;
END $$;
INSERT INTO storage.objects(bucket_id,name) VALUES
 ('roofing-proposals','70000000-0000-0000-0000-000000000001/owner-upload.pdf');
DO $$ BEGIN
  BEGIN
    INSERT INTO storage.objects(bucket_id,name) VALUES
      ('roofing-proposals','70000000-0000-0000-0000-000000000003/forged.pdf');
    RAISE EXCEPTION 'Cross-company proposal upload unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO storage.objects(bucket_id,name) VALUES
      ('roofing-proposals','79999999-0000-0000-0000-000000000099/orphan.pdf');
    RAISE EXCEPTION 'Orphan proposal upload unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
DELETE FROM storage.objects WHERE name='70000000-0000-0000-0000-000000000001/owner-upload.pdf';
RESET ROLE;

-- Company B owner sees only B's proposal and cannot mutate A's object.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false);
DO $$ BEGIN
  IF (SELECT count(*) FROM storage.objects WHERE bucket_id='roofing-proposals') <> 1
    THEN RAISE EXCEPTION 'Company B owner read cross-company proposal'; END IF;
  DELETE FROM storage.objects WHERE name='70000000-0000-0000-0000-000000000001/a.pdf';
END $$;
RESET ROLE;

-- Company A crew can read its proposal but cannot upload or delete.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',false);
DO $$ BEGIN
  IF (SELECT count(*) FROM storage.objects WHERE bucket_id='roofing-proposals') <> 1
    THEN RAISE EXCEPTION 'Company A crew could not read its proposal'; END IF;
  BEGIN
    INSERT INTO storage.objects(bucket_id,name) VALUES
      ('roofing-proposals','70000000-0000-0000-0000-000000000001/crew-upload.pdf');
    RAISE EXCEPTION 'Crew unexpectedly uploaded proposal PDF';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  DELETE FROM storage.objects WHERE name='70000000-0000-0000-0000-000000000001/a.pdf';
END $$;
RESET ROLE;

-- Confirm all protected/excluded seed objects remain intact.
DO $$ BEGIN
  IF (SELECT count(*) FROM storage.objects WHERE bucket_id='roofing-proposals') <> 4
    THEN RAISE EXCEPTION 'Storage rows unexpectedly changed or disappeared'; END IF;
END $$;
\echo 'PASS: proposal storage tenant isolation, role restrictions, and legacy path denial'
