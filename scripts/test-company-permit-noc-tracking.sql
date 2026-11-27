-- PostgreSQL integration test for migration 0051.
\set ON_ERROR_STOP on
\ir ../scripts/test-company-permit-records-rls.sql
\ir ../drizzle/migrations/0051_company_permit_noc_tracking.sql

INSERT INTO public.roof_permit_noc_tracking(
 company_id,permit_application_id,assessment_status,recording_status,
 contract_value_cents,threshold_amount_cents,assessment_basis,threshold_source_url,
 recording_county,instrument_number,recorded_on,created_by
) VALUES (
 '10000000-0000-0000-0000-000000000001',
 '50000000-0000-0000-0000-000000000001',
 'required','recorded',2500000,500000,'Verified current county checklist and project contract value.',
 'https://example.gov/noc-threshold','Miami-Dade','2026-123456',CURRENT_DATE,
 '00000000-0000-0000-0000-000000000001'
),(
 '10000000-0000-0000-0000-000000000002',
 '50000000-0000-0000-0000-000000000002',
 'not_assessed','not_started',NULL,NULL,'',NULL,'',NULL,NULL,
 '00000000-0000-0000-0000-000000000002'
);

DO $$ BEGIN
 IF NOT (SELECT relforcerowsecurity FROM pg_class WHERE oid='public.roof_permit_noc_tracking'::regclass) THEN
   RAISE EXCEPTION 'NOC tracking table must FORCE RLS';
 END IF;
 IF has_table_privilege('anon','public.roof_permit_noc_tracking','SELECT') THEN
   RAISE EXCEPTION 'anon unexpectedly has NOC SELECT';
 END IF;
END $$;

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',false);
DO $$ BEGIN
 IF (SELECT count(*) FROM public.roof_permit_noc_tracking) <> 1 THEN
   RAISE EXCEPTION 'Company A member must see only Company A NOC records';
 END IF;
 BEGIN
   INSERT INTO public.roof_permit_noc_tracking(company_id,permit_application_id,assessment_status,recording_status)
   VALUES ('10000000-0000-0000-0000-000000000002','50000000-0000-0000-0000-000000000002','not_assessed','not_started');
   RAISE EXCEPTION 'Non-admin unexpectedly created NOC record';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $$;
RESET ROLE;

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
DO $$ BEGIN
 IF (SELECT count(*) FROM public.roof_permit_noc_tracking) <> 1 THEN
   RAISE EXCEPTION 'Company A owner must not see Company B NOC record';
 END IF;
 BEGIN
   INSERT INTO public.roof_permit_noc_tracking(company_id,permit_application_id,assessment_status,recording_status)
   VALUES ('10000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000002','not_assessed','not_started');
   RAISE EXCEPTION 'Cross-company NOC/application relationship unexpectedly accepted';
 EXCEPTION WHEN foreign_key_violation OR unique_violation THEN NULL;
 END;
 BEGIN
   INSERT INTO public.roof_permit_noc_tracking(
    company_id,permit_application_id,assessment_status,recording_status
   ) VALUES (
    '10000000-0000-0000-0000-000000000001',
    '50000000-0000-0000-0000-000000000001','required','recorded'
   );
   RAISE EXCEPTION 'Recorded NOC without clerk evidence unexpectedly accepted';
 EXCEPTION WHEN check_violation THEN NULL;
 END;
END $$;
RESET ROLE;

\echo 'PASS: NOC records are company isolated, admin managed, and require clerk evidence when marked recorded'
