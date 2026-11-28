-- Read-only production schema and permitting release preflight.
-- Run with a dedicated read-only PostgreSQL role:
--   psql "$READ_ONLY_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/production-permit-readonly-preflight.sql
-- This file contains catalog/data SELECTs and psql conditionals only.
-- It does not modify schema, rows, migration history, or storage.

\set ON_ERROR_STOP on
BEGIN READ ONLY;
\echo '=== 0. Connection identity ==='
SELECT current_database() AS database_name,
       current_user AS database_role,
       current_setting('server_version') AS postgres_version,
       current_timestamp AS observed_at;

\echo '=== 1. Drizzle migration ledger ==='
SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS has_migration_ledger \gset
\if :has_migration_ledger
SELECT count(*) AS migration_rows, max(created_at) AS latest_created_at
FROM drizzle.__drizzle_migrations;
\else
\echo 'MISSING: drizzle.__drizzle_migrations'
\endif

\echo '=== 2. Company and membership baseline ==='
SELECT to_regclass('public.crm_companies') IS NOT NULL AS has_companies \gset
\if :has_companies
SELECT count(*) AS company_count FROM public.crm_companies;
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema='public' AND table_name='crm_companies'
ORDER BY ordinal_position;
\else
\echo 'MISSING: public.crm_companies'
\endif

SELECT to_regclass('public.crm_company_memberships') IS NOT NULL AS has_memberships \gset
\if :has_memberships
SELECT count(*) AS membership_count FROM public.crm_company_memberships;
SELECT role::text AS membership_role, count(*) AS member_count
FROM public.crm_company_memberships
GROUP BY role::text
ORDER BY role::text;
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema='public' AND table_name='crm_company_memberships'
ORDER BY ordinal_position;
\else
\echo 'MISSING: public.crm_company_memberships'
\endif

SELECT to_regclass('public.crm_company_branding') IS NOT NULL AS has_company_branding \gset
\if :has_company_branding
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema='public' AND table_name='crm_company_branding'
ORDER BY ordinal_position;
\else
\echo 'MISSING: public.crm_company_branding'
\endif

\echo '=== 3. Operational table existence and row counts ==='
SELECT to_regclass('public.leads') IS NOT NULL AS has_leads \gset
\if :has_leads
SELECT 'leads' AS table_name, count(*) AS row_count FROM public.leads;
SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='leads' AND column_name='company_id') AS leads_has_company_id \gset
\if :leads_has_company_id
SELECT 'leads' AS table_name, count(*) FILTER (WHERE company_id IS NULL) AS rows_without_company
FROM public.leads;
\else
\echo 'leads.company_id is absent'
\endif
\else
\echo 'MISSING: public.leads'
\endif

SELECT to_regclass('public.crm_customers') IS NOT NULL AS has_customers \gset
\if :has_customers
SELECT 'crm_customers' AS table_name, count(*) AS row_count FROM public.crm_customers;
SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='crm_customers' AND column_name='company_id') AS customers_has_company_id \gset
\if :customers_has_company_id
SELECT 'crm_customers' AS table_name, count(*) FILTER (WHERE company_id IS NULL) AS rows_without_company
FROM public.crm_customers;
\else
\echo 'crm_customers.company_id is absent'
\endif
\else
\echo 'MISSING: public.crm_customers'
\endif

SELECT to_regclass('public.crm_properties') IS NOT NULL AS has_properties \gset
\if :has_properties
SELECT 'crm_properties' AS table_name, count(*) AS row_count FROM public.crm_properties;
SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='crm_properties' AND column_name='company_id') AS properties_has_company_id \gset
\if :properties_has_company_id
SELECT 'crm_properties' AS table_name, count(*) FILTER (WHERE company_id IS NULL) AS rows_without_company
FROM public.crm_properties;
\else
\echo 'crm_properties.company_id is absent'
\endif
\else
\echo 'MISSING: public.crm_properties'
\endif

SELECT to_regclass('public.roof_report_orders') IS NOT NULL AS has_roof_report_orders \gset
\if :has_roof_report_orders
SELECT 'roof_report_orders' AS table_name, count(*) AS row_count FROM public.roof_report_orders;
SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='roof_report_orders' AND column_name='company_id') AS orders_has_company_id \gset
\if :orders_has_company_id
SELECT 'roof_report_orders' AS table_name, count(*) FILTER (WHERE company_id IS NULL) AS rows_without_company
FROM public.roof_report_orders;
\else
\echo 'roof_report_orders.company_id is absent'
\endif
\else
\echo 'MISSING: public.roof_report_orders'
\endif

SELECT to_regclass('public.roof_jobs') IS NOT NULL AS has_roof_jobs \gset
\if :has_roof_jobs
SELECT 'roof_jobs' AS table_name, count(*) AS row_count FROM public.roof_jobs;
SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='roof_jobs' AND column_name='company_id') AS roof_jobs_has_company_id \gset
\if :roof_jobs_has_company_id
SELECT 'roof_jobs' AS table_name, count(*) FILTER (WHERE company_id IS NULL) AS rows_without_company
FROM public.roof_jobs;
\else
\echo 'roof_jobs.company_id is absent'
\endif
\else
\echo 'MISSING: public.roof_jobs'
\endif

\echo '=== 4. Constraints and indexes on CRM / roof tables ==='
SELECT c.conrelid::regclass AS table_name,
       c.conname,
       c.contype,
       pg_get_constraintdef(c.oid) AS definition,
       c.convalidated
FROM pg_constraint c
JOIN pg_namespace n ON n.oid=c.connamespace
WHERE n.nspname='public'
  AND c.conrelid::regclass::text IN (
    'leads','crm_customers','crm_properties','roof_report_orders',
    'roof_jobs','crm_companies','crm_company_memberships',
    'roof_permit_applications','roof_permit_inspections',
    'crm_company_permit_settings','roof_product_approvals',
    'roof_permit_noc_tracking'
  )
ORDER BY table_name::text, c.conname;

SELECT schemaname, tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname='public'
  AND tablename IN (
    'leads','crm_customers','crm_properties','roof_report_orders',
    'roof_jobs','roof_permit_applications','roof_permit_inspections',
    'crm_company_permit_settings','roof_product_approvals','roof_permit_noc_tracking'
  )
ORDER BY tablename, indexname;

\echo '=== 5. RLS flags and policy definitions ==='
SELECT n.nspname AS schema_name, c.relname AS table_name,
       c.relrowsecurity AS rls_enabled,
       c.relforcerowsecurity AS rls_forced
FROM pg_class c
JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE (n.nspname='public' AND c.relname IN (
    'leads','crm_customers','crm_properties','roof_report_orders',
    'roof_jobs','roof_permit_applications','roof_permit_inspections',
    'crm_company_permit_settings','roof_product_approvals','roof_permit_noc_tracking',
    'crm_companies','crm_company_memberships','crm_company_branding'
  ))
   OR (n.nspname='storage' AND c.relname IN ('objects','buckets'))
ORDER BY schema_name, table_name;

SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname IN ('public','storage')
ORDER BY schemaname, tablename, policyname;

\echo '=== 6. Triggers on CRM / roof tables ==='
SELECT event_object_schema, event_object_table, trigger_name,
       action_timing, event_manipulation, action_statement
FROM information_schema.triggers
WHERE event_object_schema='public'
  AND event_object_table IN (
    'leads','crm_customers','crm_properties','roof_report_orders',
    'roof_jobs','roof_permit_applications','roof_permit_inspections'
  )
ORDER BY event_object_table, trigger_name, event_manipulation;

\echo '=== 7. Privileged function definitions and grants ==='
SELECT n.nspname AS schema_name,
       p.proname AS function_name,
       pg_get_function_identity_arguments(p.oid) AS identity_arguments,
       p.prosecdef AS security_definer,
       p.proconfig AS function_settings,
       pg_get_functiondef(p.oid) AS definition,
       pg_get_userbyid(p.proowner) AS owner,
       p.proacl AS raw_acl
FROM pg_proc p
JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public'
  AND p.proname IN (
    'is_crm_company_member','is_crm_company_admin',
    'save_crm_customer','delete_crm_customer',
    'capture_instant_roof_lead','create_roof_report_request',
    'has_role','has_any_role','can_access_company_proposal_file',
    'can_access_company_expense_receipt','can_access_company_job_photo'
  )
ORDER BY p.proname, identity_arguments;

\echo '=== 8. Supabase storage buckets and storage policies ==='
SELECT to_regclass('storage.buckets') IS NOT NULL AS has_storage_buckets \gset
\if :has_storage_buckets
SELECT id, name, public, file_size_limit, allowed_mime_types
FROM storage.buckets
ORDER BY name;
-- Expected production buckets, checked by name so a missing bucket is flagged
-- as drift instead of silently absent from the inventory above.
SELECT expected.bucket_id AS expected_bucket,
       (b.id IS NOT NULL) AS bucket_present,
       b.public AS bucket_public
FROM (VALUES ('crm-company-branding'), ('roof-job-photos'), ('roofing-proposals'),
        ('signed-contracts'), ('permit-documents'), ('pdf-signature-documents'))
  AS expected(bucket_id)
LEFT JOIN storage.buckets b ON b.id = expected.bucket_id
ORDER BY expected.bucket_id;
\else
\echo 'MISSING: storage.buckets'
\endif

\echo '=== 9. Permit-specific schema and company backfill integrity ==='
SELECT expected.table_name,
       (to_regclass(format('public.%I', expected.table_name)) IS NOT NULL) AS table_present
FROM (VALUES
  ('crm_company_permit_settings'),
  ('roof_permit_applications'),
  ('roof_permit_inspections'),
  ('roof_product_approvals'),
  ('roof_permit_noc_tracking')
) AS expected(table_name)
ORDER BY expected.table_name;

SELECT expected.table_name,
       EXISTS (
         SELECT 1 FROM information_schema.columns c
         WHERE c.table_schema='public'
           AND c.table_name=expected.table_name
           AND c.column_name='company_id'
       ) AS company_id_present
FROM (VALUES
  ('leads'),('crm_customers'),('crm_properties'),('roof_report_orders'),
  ('roof_jobs'),('crm_company_permit_settings'),
  ('roof_permit_applications'),('roof_permit_inspections'),
  ('roof_product_approvals'),('roof_permit_noc_tracking')
) AS expected(table_name)
ORDER BY expected.table_name;

SELECT
 (SELECT count(*) FROM public.leads l
   LEFT JOIN public.crm_customers c ON c.id=l.customer_id
   WHERE l.customer_id IS NOT NULL AND c.id IS NULL) AS lead_customer_orphans,
 (SELECT count(*) FROM public.crm_customers c
   LEFT JOIN public.leads l ON l.id=c.source_lead_id
   WHERE c.source_lead_id IS NOT NULL AND l.id IS NULL) AS customer_source_lead_orphans,
 (SELECT count(*) FROM public.crm_properties p
   LEFT JOIN public.crm_customers c ON c.id=p.customer_id
   WHERE p.customer_id IS NOT NULL AND c.id IS NULL) AS property_customer_orphans,
 (SELECT count(*) FROM public.roof_report_orders r
   LEFT JOIN public.crm_customers c ON c.id=r.customer_id
   WHERE r.customer_id IS NOT NULL AND c.id IS NULL) AS report_customer_orphans,
 (SELECT count(*) FROM public.roof_report_orders r
   LEFT JOIN public.crm_properties p ON p.id=r.property_id
   WHERE r.property_id IS NOT NULL AND p.id IS NULL) AS report_property_orphans,
 (SELECT count(*) FROM public.roof_jobs j
   LEFT JOIN public.leads l ON l.id=j.lead_id
   WHERE j.lead_id IS NOT NULL AND l.id IS NULL) AS job_lead_orphans,
 (SELECT count(*) FROM public.roof_jobs j
   LEFT JOIN public.crm_properties p ON p.id=j.property_id
   WHERE j.property_id IS NOT NULL AND p.id IS NULL) AS job_property_orphans,
 (SELECT count(*) FROM public.crm_customers WHERE source_lead_id IS NULL) AS customers_without_source_lead,
 (SELECT count(*) FROM public.roof_jobs WHERE lead_id IS NULL AND property_id IS NULL) AS jobs_without_lead_or_property,
 (SELECT count(*) FROM (
   SELECT customer_id, lower(regexp_replace(trim(address), '\\s+', ' ', 'g')) AS normalized_address
   FROM public.crm_properties
   GROUP BY customer_id, lower(regexp_replace(trim(address), '\\s+', ' ', 'g'))
   HAVING count(*)>1
 ) duplicate_properties) AS duplicate_property_address_groups;

\echo '=== 10. Authorization helper grants ==='
SELECT expected.signature,
       (to_regprocedure(expected.signature) IS NOT NULL) AS function_present,
       CASE WHEN to_regprocedure(expected.signature) IS NULL THEN NULL
            ELSE has_function_privilege('anon', to_regprocedure(expected.signature), 'EXECUTE') END AS anon_can_execute,
       CASE WHEN to_regprocedure(expected.signature) IS NULL THEN NULL
            ELSE has_function_privilege('authenticated', to_regprocedure(expected.signature), 'EXECUTE') END AS authenticated_can_execute
FROM (VALUES
  ('public.is_crm_company_member(uuid)'),
  ('public.is_crm_company_admin(uuid)'),
  ('public.has_role(uuid,public.app_role)'),
  ('public.has_any_role(uuid,public.app_role[])'),
  ('public.can_access_company_proposal_file(text,boolean)'),
  ('public.can_access_company_expense_receipt(text,boolean)'),
  ('public.can_access_company_job_photo(text,boolean)')
) AS expected(signature)
ORDER BY expected.signature;

\echo '=== PREFLIGHT COMPLETE ==='
\echo 'Review exact outputs and compare against the repository migrations before any write operation.'
COMMIT;
