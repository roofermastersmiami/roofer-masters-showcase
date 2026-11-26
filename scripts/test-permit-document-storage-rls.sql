-- Integration test for migration 0049 permit-document Storage RLS.
-- Run in a disposable PostgreSQL database with the preceding permit migrations.
-- This provides a minimal Supabase Storage schema/function fixture; it does not
-- replace a live Supabase integration test of signed URLs or bucket behavior.
\set ON_ERROR_STOP on

\ir test-company-permit-records-rls.sql

CREATE SCHEMA IF NOT EXISTS storage;
CREATE TABLE storage.buckets (
  id text PRIMARY KEY,
  name text NOT NULL,
  public boolean NOT NULL DEFAULT false,
  file_size_limit bigint,
  allowed_mime_types text[]
);
CREATE TABLE storage.objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id text NOT NULL REFERENCES storage.buckets(id),
  name text NOT NULL,
  owner_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(bucket_id, name)
);
CREATE OR REPLACE FUNCTION storage.foldername(object_name text)
RETURNS text[] LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT CASE
    WHEN array_length(parts, 1) > 1 THEN parts[1:array_length(parts, 1) - 1]
    ELSE ARRAY[]::text[]
  END
  FROM (SELECT string_to_array(object_name, '/') AS parts) AS parsed
$$;
GRANT USAGE ON SCHEMA storage TO authenticated, anon, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.buckets TO authenticated, service_role;
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage.objects FORCE ROW LEVEL SECURITY;
GRANT USAGE ON SCHEMA public TO authenticated;

\ir ../drizzle/migrations/0049_company_scoped_permit_document_storage.sql

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM storage.buckets
    WHERE id='permit-documents' AND public=false
      AND file_size_limit=26214400
      AND allowed_mime_types=ARRAY['application/pdf','image/jpeg','image/png']
  ) THEN
    RAISE EXCEPTION 'Private permit bucket configuration is incorrect';
  END IF;
END $$;

-- Seed an object for each company as the database owner (bypasses RLS).
INSERT INTO storage.objects(bucket_id,name,owner_id) VALUES
 ('permit-documents',
  '10000000-0000-0000-0000-000000000001/50000000-0000-0000-0000-000000000001/a.pdf',
  '00000000-0000-0000-0000-000000000001'),
 ('permit-documents',
  '10000000-0000-0000-0000-000000000002/50000000-0000-0000-0000-000000000002/b.pdf',
  '00000000-0000-0000-0000-000000000002');

-- Company A office member can read A but cannot read B or upload.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',false);
DO $$ BEGIN
  IF (SELECT count(*) FROM storage.objects WHERE bucket_id='permit-documents') <> 1 THEN
    RAISE EXCEPTION 'Company A member must only read Company A permit documents';
  END IF;
  BEGIN
    INSERT INTO storage.objects(bucket_id,name) VALUES (
      'permit-documents',
      '10000000-0000-0000-0000-000000000001/50000000-0000-0000-0000-000000000001/office.pdf'
    );
    RAISE EXCEPTION 'Non-admin unexpectedly uploaded a permit document';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;

-- Assert the exact authorization predicate independently before exercising RLS.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
DO $$ BEGIN
  IF public.can_manage_permit_document(
    '10000000-0000-0000-0000-000000000002/50000000-0000-0000-0000-000000000002/b.pdf'
  ) THEN
    RAISE EXCEPTION 'Authorization helper incorrectly grants Company A access to Company B file';
  END IF;
END $;
RESET ROLE;

-- Company A owner cannot read, update, or delete Company B files.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
DO $$ BEGIN
  IF (SELECT count(*) FROM storage.objects WHERE bucket_id='permit-documents') <> 1 THEN
    RAISE EXCEPTION 'Company A owner unexpectedly read Company B permit documents';
  END IF;
  UPDATE storage.objects SET name='forged.pdf'
   WHERE bucket_id='permit-documents'
     AND name='10000000-0000-0000-0000-000000000002/50000000-0000-0000-0000-000000000002/b.pdf';
  IF EXISTS (SELECT 1 FROM storage.objects WHERE name='forged.pdf') THEN
    RAISE EXCEPTION 'Company A owner unexpectedly updated Company B file';
  END IF;
  DELETE FROM storage.objects
   WHERE bucket_id='permit-documents'
     AND name='10000000-0000-0000-0000-000000000002/50000000-0000-0000-0000-000000000002/b.pdf';
  IF NOT EXISTS (SELECT 1 FROM storage.objects WHERE name LIKE '%/b.pdf') THEN
    RAISE EXCEPTION 'Company A owner unexpectedly deleted Company B file';
  END IF;
END $$;
RESET ROLE;

-- Company A office member cannot update or delete even Company A's own file.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',false);
DO $$ BEGIN
  UPDATE storage.objects SET name=
   '10000000-0000-0000-0000-000000000001/50000000-0000-0000-0000-000000000001/office-renamed.pdf'
   WHERE bucket_id='permit-documents'
   AND name LIKE '%/a.pdf';
  IF EXISTS (SELECT 1 FROM storage.objects WHERE name LIKE '%/office-renamed.pdf') THEN
    RAISE EXCEPTION 'Non-admin member unexpectedly updated own permit document';
  END IF;
  DELETE FROM storage.objects WHERE bucket_id='permit-documents' AND name LIKE '%/a.pdf';
  IF NOT EXISTS (SELECT 1 FROM storage.objects WHERE name LIKE '%/a.pdf') THEN
    RAISE EXCEPTION 'Non-admin member unexpectedly deleted own permit document';
  END IF;
END $$;
RESET ROLE;

-- Company A owner can upload, update, and delete only within Company A's app.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
INSERT INTO storage.objects(bucket_id,name) VALUES (
 'permit-documents',
 '10000000-0000-0000-0000-000000000001/50000000-0000-0000-0000-000000000001/new.pdf'
);
-- A tenant admin cannot move an object into another tenant's namespace.
DO $$ BEGIN
  BEGIN
    UPDATE storage.objects SET name=
      '10000000-0000-0000-0000-000000000002/50000000-0000-0000-0000-000000000002/forged.pdf'
    WHERE bucket_id='permit-documents' AND name LIKE '%/new.pdf';
    RAISE EXCEPTION 'Cross-tenant object path change unexpectedly accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
UPDATE storage.objects SET name=
 '10000000-0000-0000-0000-000000000001/50000000-0000-0000-0000-000000000001/renamed.pdf'
 WHERE bucket_id='permit-documents'
 AND name LIKE '%/new.pdf';
DELETE FROM storage.objects WHERE bucket_id='permit-documents'
 AND name LIKE '%/renamed.pdf';
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM storage.objects WHERE name LIKE '%/renamed.pdf') THEN
    RAISE EXCEPTION 'Company A owner failed to delete own permit file';
  END IF;
END $$;
RESET ROLE;

-- Malformed paths and nonexistent application IDs must be denied.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
DO $$ BEGIN
  BEGIN
    INSERT INTO storage.objects(bucket_id,name) VALUES (
      'permit-documents',
      'not-a-company-id/50000000-0000-0000-0000-000000000001/bad.pdf'
    );
    RAISE EXCEPTION 'Malformed tenant path unexpectedly accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO storage.objects(bucket_id,name) VALUES (
      'permit-documents',
      '10000000-0000-0000-0000-000000000001/50000000-0000-0000-0000-000000000099/orphan.pdf'
    );
    RAISE EXCEPTION 'Unlinked permit application path unexpectedly accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;

\echo 'PASS: permit document storage tenant isolation and admin write policies'
