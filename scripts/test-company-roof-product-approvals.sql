-- Integration test for migration 0050. Reuses the two-company permit fixture.
\set ON_ERROR_STOP on
\ir ../scripts/test-company-permit-records-rls.sql
\ir ../drizzle/migrations/0050_company_roof_product_approvals.sql

INSERT INTO public.roof_product_approvals(
 id,company_id,permit_application_id,approval_kind,approval_number,manufacturer,product_name,
 approval_status,hvhz_status,created_by
) VALUES (
 '70000000-0000-0000-0000-000000000001',
 '10000000-0000-0000-0000-000000000001',
 '50000000-0000-0000-0000-000000000001',
 'miami_dade_noa','NOA-TEST-001','Test Manufacturer','Metal Panel System','unverified','unknown',
 '00000000-0000-0000-0000-000000000001'
),(
 '70000000-0000-0000-0000-000000000002',
 '10000000-0000-0000-0000-000000000002',
 '50000000-0000-0000-0000-000000000002',
 'florida_product_approval','FPA-TEST-002','Other Manufacturer','Shingle System','unverified','yes',
 '00000000-0000-0000-0000-000000000002'
);

DO $$ BEGIN
 IF NOT (SELECT relforcerowsecurity FROM pg_class WHERE oid='public.roof_product_approvals'::regclass) THEN
   RAISE EXCEPTION 'Product approval table must FORCE RLS';
 END IF;
 IF has_table_privilege('anon','public.roof_product_approvals','SELECT') THEN
   RAISE EXCEPTION 'anon unexpectedly has product approval SELECT';
 END IF;
 IF NOT EXISTS (
   SELECT 1 FROM pg_constraint
   WHERE conname='roof_product_approvals_application_company_fkey'
 ) THEN RAISE EXCEPTION 'Same-company permit application foreign key missing'; END IF;
END $$;

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',false);
DO $$ BEGIN
 IF (SELECT count(*) FROM public.roof_product_approvals) <> 1 THEN
   RAISE EXCEPTION 'Company A member must see only Company A approvals';
 END IF;
 BEGIN
   INSERT INTO public.roof_product_approvals(company_id,permit_application_id,approval_kind,approval_number,manufacturer,product_name)
   VALUES ('10000000-0000-0000-0000-000000000002','50000000-0000-0000-0000-000000000002','miami_dade_noa','FORGED','Bad','Bad');
   RAISE EXCEPTION 'Non-admin member unexpectedly created product approval';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $$;
RESET ROLE;

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
DO $$ BEGIN
 IF (SELECT count(*) FROM public.roof_product_approvals) <> 1 THEN
   RAISE EXCEPTION 'Company A owner must not see Company B approvals';
 END IF;
 BEGIN
   INSERT INTO public.roof_product_approvals(company_id,permit_application_id,approval_kind,approval_number,manufacturer,product_name)
   VALUES ('10000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000002','miami_dade_noa','CROSS','Bad','Bad');
   RAISE EXCEPTION 'Cross-company approval/application relationship unexpectedly accepted';
 EXCEPTION WHEN foreign_key_violation THEN NULL;
 END;
 BEGIN
   INSERT INTO public.roof_product_approvals(company_id,permit_application_id,approval_kind,approval_number,manufacturer,product_name,approval_status)
   VALUES ('10000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','miami_dade_noa','BAD-VERIFY','Bad','Bad','verified');
   RAISE EXCEPTION 'Verified approval without verifier metadata unexpectedly accepted';
 EXCEPTION WHEN check_violation THEN NULL;
 END;
END $$;
RESET ROLE;

\echo 'PASS: product approval records are company isolated, admin managed, and linked to same-company permit applications'
