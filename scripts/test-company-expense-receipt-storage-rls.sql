-- Two-company adversarial integration test for migration 0061 expense receipt storage.
-- Run only in a disposable PostgreSQL database.
\set ON_ERROR_STOP on
\ir test-secondary-operational-company-ownership.sql

-- Extend the intentionally minimal shared fixture to match the expense table.
ALTER TABLE crm_expenses ADD COLUMN description text NOT NULL DEFAULT 'Fixture expense';
ALTER TABLE crm_expenses ADD COLUMN category text NOT NULL DEFAULT 'materials';
ALTER TABLE crm_expenses ADD COLUMN amount_cents bigint NOT NULL DEFAULT 10000;
ALTER TABLE crm_expenses ADD COLUMN incurred_at date NOT NULL DEFAULT current_date;
ALTER TABLE crm_expenses ADD COLUMN receipt_path text;

DO $role_setup$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
END $role_setup$;
CREATE SCHEMA storage;
CREATE TABLE storage.buckets(id text PRIMARY KEY,name text NOT NULL,public boolean NOT NULL DEFAULT false);
CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text NOT NULL REFERENCES storage.buckets(id),name text NOT NULL,owner_id uuid,UNIQUE(bucket_id,name));
INSERT INTO storage.buckets(id,name,public) VALUES ('roofing-proposals','roofing-proposals',false);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
GRANT USAGE ON SCHEMA public,auth,storage TO authenticated;
GRANT SELECT,INSERT,DELETE ON storage.objects TO authenticated;
GRANT SELECT ON storage.buckets,public.crm_expenses,public.crm_company_memberships TO authenticated;
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage.objects FORCE ROW LEVEL SECURITY;

-- Company A is seeded by the shared migration fixture. Add an isolated company B,
-- its accounting member, and one expense per company.
INSERT INTO auth.users VALUES ('00000000-0000-0000-0000-000000000004');
INSERT INTO crm_company_memberships(company_id,user_id,role) VALUES
 ('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000004','accounting');
INSERT INTO crm_expenses(id,company_id,description,category,amount_cents,incurred_at,receipt_path)
VALUES ('80000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','Company B expense','materials',20000,current_date,NULL);

\ir ../drizzle/migrations/0061_company_scoped_expense_receipt_storage.sql

-- Company A accounting member can upload only under its existing expense row.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
INSERT INTO storage.objects(bucket_id,name) VALUES
 ('roofing-proposals','expense/10000000-0000-0000-0000-000000000001/92000000-0000-0000-0000-000000000001/a.pdf');
DO $$ BEGIN
  BEGIN
    INSERT INTO storage.objects(bucket_id,name) VALUES ('roofing-proposals','expense/10000000-0000-0000-0000-000000000002/80000000-0000-0000-0000-000000000002/forged.pdf');
    RAISE EXCEPTION 'Cross-company receipt upload unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO storage.objects(bucket_id,name) VALUES ('roofing-proposals','expense/10000000-0000-0000-0000-000000000099/80000000-0000-0000-0000-000000000099/orphan.pdf');
    RAISE EXCEPTION 'Orphan receipt upload unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO storage.objects(bucket_id,name) VALUES ('roofing-proposals','expense-legacy/receipt.pdf');
    RAISE EXCEPTION 'Legacy unscoped receipt upload unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;

-- Attach the object to its expense row as the database owner, mirroring the
-- application upload-then-update sequence.
UPDATE crm_expenses SET receipt_path='expense/10000000-0000-0000-0000-000000000001/92000000-0000-0000-0000-000000000001/a.pdf'
 WHERE id='92000000-0000-0000-0000-000000000001';

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
DO $ BEGIN
  IF (SELECT count(*) FROM storage.objects WHERE bucket_id='roofing-proposals')<>1
    THEN RAISE EXCEPTION 'Company A can read another tenant or legacy receipt'; END IF;
END $;
RESET ROLE;

-- Company B cannot read or delete Company A's object; RLS silently filters DELETE.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000004',false);
DO $$ BEGIN
  IF (SELECT count(*) FROM storage.objects WHERE bucket_id='roofing-proposals')<>0
    THEN RAISE EXCEPTION 'Company B read Company A receipt'; END IF;
  DELETE FROM storage.objects WHERE name='expense/10000000-0000-0000-0000-000000000001/92000000-0000-0000-0000-000000000001/a.pdf';
END $$;
RESET ROLE;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM storage.objects WHERE name='expense/10000000-0000-0000-0000-000000000001/92000000-0000-0000-0000-000000000001/a.pdf')
    THEN RAISE EXCEPTION 'Cross-company DELETE removed a receipt'; END IF;
  IF (SELECT count(*) FROM crm_expenses WHERE id IN ('92000000-0000-0000-0000-000000000001','80000000-0000-0000-0000-000000000002'))<>2
    THEN RAISE EXCEPTION 'Expense records were deleted'; END IF;
END $$;
\echo 'PASS: expense receipt storage tenant isolation, accounting roles, orphan denial, and record preservation'
