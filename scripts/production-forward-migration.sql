-- =====================================================================
-- FORWARD-ONLY PRODUCTION MIGRATION — Roofer Masters tenant cutover
-- =====================================================================
-- DO NOT RUN against production without explicit release approval.
-- DO NOT RUN with drizzle-kit migrate. Run exactly as documented in
-- docs/production-forward-migration-runbook.md, with psql, as the
-- database owner, after a verified backup and a fresh read-only
-- preflight (scripts/production-permit-readonly-preflight.sql).
--
-- What this does, in one transaction (all-or-nothing):
--   S0  Preflight assertions + pre-migration record-count snapshot.
--   S1  Verifies the objects production already has out-of-band
--       (migrations 0030/0033/0034 report RPCs; company foundation
--       from the live schema that supersedes 0038/0039). Aborts for
--       manual review if any are missing — it never overwrites a
--       live function definition by signature alone.
--   S2  Applies the missing historical migrations in journal order:
--       0031, 0032, 0035, 0036, 0037, 0040, 0041.
--       (0038/0039 are intentionally NOT replayed: production's
--       company/branding schema supersedes them. 0040 is applied
--       because it is idempotent and normalizes the theme checks.)
--   S3  Applies migrations 0042-0055 (company ownership foundation,
--       permit schema, company-scoped RPCs, core RLS replacement).
--   S4  REPAIR R-1: adds the UNIQUE(id, company_id) constraint on
--       roof_report_orders that migration 0056 requires but no
--       earlier migration creates (chain defect found in rehearsal;
--       the CI fixture masked it by hand-creating the constraint).
--   S5  Applies migrations 0056-0067 (secondary operational tenant
--       scope, scoped invoice/proposal/expense/drawing guards,
--       change-order approval guard, core role matrix).
--   S6  Post-assertions: record counts unchanged, no unowned rows,
--       anonymous EXECUTE revoked on company helpers, permit buckets
--       present, no legacy global-role policy left on tenant tables.
--
-- Forward-only: there is no down script. Rollback = restore the
-- pre-migration backup taken in the runbook. Every statement is a
-- historical migration file (applied verbatim via \ir) or an
-- explicitly reviewed repair block below.
-- =====================================================================

\set ON_ERROR_STOP on
\timing off

BEGIN;

-- ---------- S0: preflight ----------
DO $preflight$
DECLARE
  company_count bigint;
BEGIN
  SELECT count(*) INTO company_count FROM public.crm_companies;
  IF company_count <> 1 THEN
    RAISE EXCEPTION 'ABORT: expected exactly 1 company at cutover, found %', company_count;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'is_crm_company_member') THEN
    RAISE EXCEPTION 'ABORT: helper is_crm_company_member missing (0039-class foundation not present)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'is_crm_company_admin') THEN
    RAISE EXCEPTION 'ABORT: helper is_crm_company_admin missing';
  END IF;
END $preflight$;

CREATE TEMP TABLE _pre_counts (table_name text PRIMARY KEY, row_count bigint) ON COMMIT DROP;
INSERT INTO _pre_counts
  SELECT 'leads', count(*) FROM public.leads
  UNION ALL SELECT 'crm_customers', count(*) FROM public.crm_customers
  UNION ALL SELECT 'crm_properties', count(*) FROM public.crm_properties
  UNION ALL SELECT 'roof_report_orders', count(*) FROM public.roof_report_orders
  UNION ALL SELECT 'roof_jobs', count(*) FROM public.roof_jobs
  UNION ALL SELECT 'proposals', count(*) FROM public.proposals
  UNION ALL SELECT 'roof_drawings', count(*) FROM public.roof_drawings
  UNION ALL SELECT 'crm_invoices', count(*) FROM public.crm_invoices
  UNION ALL SELECT 'crm_activity', count(*) FROM public.crm_activity
  UNION ALL SELECT 'lead_messages', count(*) FROM public.lead_messages;

-- ---------- S1: verify out-of-band production objects (0030/0033/0034) ----------
DO $verify_rpc$
DECLARE
  sig_count int;
BEGIN
  -- The live audit confirmed a 4-argument and a 6-argument overload of
  -- create_roof_report_request in production. Verify, never overwrite.
  SELECT count(*) INTO sig_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'create_roof_report_request'
    AND p.pronargs IN (4, 6);
  IF sig_count < 2 THEN
    RAISE EXCEPTION 'ABORT: expected 4-arg and 6-arg create_roof_report_request overloads (0033/0034), found % matching', sig_count;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'roof_report_orders'
      AND column_name = 'customer_phone'
  ) THEN
    RAISE EXCEPTION 'ABORT: roof_report_orders.customer_phone (0034) missing — reconcile 0030-0034 manually before running this script';
  END IF;
END $verify_rpc$;

-- ---------- S2: missing historical migrations ----------
\ir ../drizzle/migrations/0031_production_manager_roof_report_files.sql
\ir ../drizzle/migrations/0032_swipe_delete_customers.sql
\ir ../drizzle/migrations/0035_signed_contract_storage.sql
\ir ../drizzle/migrations/0036_free_ai_receptionist_calendar.sql
\ir ../drizzle/migrations/0037_pdf_sign_templates.sql
\ir ../drizzle/migrations/0040_persist_crm_theme_accent.sql
\ir ../drizzle/migrations/0041_company_permit_qualifier_settings.sql

-- ---------- S3: company ownership + permitting chain (0042-0055) ----------
\ir ../drizzle/migrations/0042_crm_company_ownership_foundation.sql
\ir ../drizzle/migrations/0043_company_aware_lead_customer_sync.sql
\ir ../drizzle/migrations/0044_company_scoped_customer_save.sql
\ir ../drizzle/migrations/0045_trusted_public_lead_company.sql
\ir ../drizzle/migrations/0046_company_scoped_customer_delete.sql
\ir ../drizzle/migrations/0047_company_owned_roof_jobs.sql
\ir ../drizzle/migrations/0048_company_permit_applications_and_inspections.sql
\ir ../drizzle/migrations/0049_company_scoped_permit_document_storage.sql
\ir ../drizzle/migrations/0050_company_roof_product_approvals.sql
\ir ../drizzle/migrations/0051_company_permit_noc_tracking.sql
\ir ../drizzle/migrations/0052_product_approval_code_edition.sql
\ir ../drizzle/migrations/0053_company_scoped_roof_report_rpcs.sql
\ir ../drizzle/migrations/0054_replace_legacy_tenant_rls_and_storage.sql
\ir ../drizzle/migrations/0055_pdf_signature_requests.sql

-- ---------- S4: REPAIR R-1 (chain defect: missing composite unique) ----------
-- Migration 0056 adds roof_estimates.report_company_fkey referencing
-- roof_report_orders(id, company_id), but no migration in 0000-0055
-- ever creates UNIQUE(id, company_id) on roof_report_orders (0042 adds
-- it for leads/customers/properties; 0047 for roof_jobs). Without this
-- repair, 0056 fails on any journal-built database. Guarded so the
-- script stays re-runnable after a partial rehearsal.
DO $repair_r1$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.roof_report_orders'::regclass
      AND conname = 'roof_report_orders_id_company_id_key'
  ) THEN
    ALTER TABLE public.roof_report_orders
      ADD CONSTRAINT roof_report_orders_id_company_id_key UNIQUE (id, company_id);
  END IF;
END $repair_r1$;

-- REPAIR R-2: drop the legacy global-role storage policy from 0031.
-- "Production manager roof report files" authorizes ANY user holding
-- the global production_manager role to ALL operations on every
-- 'roof-report/%' object in roofing-proposals, with no company check.
-- Permissive policies OR together, so it silently defeats the
-- company-scoped roof-report file policies from 0054/0067 (which
-- already include production_manager within their own company).
-- Found in rehearsal step-3 verification, 2026-11-28.
DROP POLICY IF EXISTS "Production manager roof report files" ON storage.objects;

-- ---------- S5: secondary operational tenant scope (0056-0067) ----------
\ir ../drizzle/migrations/0056_secondary_operational_company_ownership.sql
\ir ../drizzle/migrations/0057_company_scoped_invoice_payment_rpcs.sql
\ir ../drizzle/migrations/0058_company_scoped_invoice_checkout_reservation.sql
\ir ../drizzle/migrations/0059_company_scope_instant_estimate_intake.sql
\ir ../drizzle/migrations/0060_company_scoped_lead_activity_trigger.sql
\ir ../drizzle/migrations/0061_company_scoped_proposal_storage.sql
\ir ../drizzle/migrations/0062_company_scoped_expense_receipt_storage.sql
\ir ../drizzle/migrations/0063_company_owned_drawing_references.sql
\ir ../drizzle/migrations/0064_prevent_drawing_parent_reassignment.sql
\ir ../drizzle/migrations/0065_replace_secondary_operational_rls.sql
\ir ../drizzle/migrations/0066_prevent_unverified_change_order_approval.sql
\ir ../drizzle/migrations/0067_enforce_core_company_role_matrix.sql

-- ---------- S6: post-assertions ----------
DO $post_counts$
DECLARE
  mismatch text;
BEGIN
  SELECT string_agg(p.table_name || ': ' || p.row_count || ' -> ' || a.row_count, ', ')
  INTO mismatch
  FROM _pre_counts p
  JOIN (
    SELECT 'leads' AS table_name, count(*) AS row_count FROM public.leads
    UNION ALL SELECT 'crm_customers', count(*) FROM public.crm_customers
    UNION ALL SELECT 'crm_properties', count(*) FROM public.crm_properties
    UNION ALL SELECT 'roof_report_orders', count(*) FROM public.roof_report_orders
    UNION ALL SELECT 'roof_jobs', count(*) FROM public.roof_jobs
    UNION ALL SELECT 'proposals', count(*) FROM public.proposals
    UNION ALL SELECT 'roof_drawings', count(*) FROM public.roof_drawings
    UNION ALL SELECT 'crm_invoices', count(*) FROM public.crm_invoices
    UNION ALL SELECT 'crm_activity', count(*) FROM public.crm_activity
    UNION ALL SELECT 'lead_messages', count(*) FROM public.lead_messages
  ) a ON a.table_name = p.table_name
  WHERE a.row_count <> p.row_count;
  IF mismatch IS NOT NULL THEN
    RAISE EXCEPTION 'ABORT: record counts changed during migration: %', mismatch;
  END IF;
END $post_counts$;

DO $post_ownership$
DECLARE
  unowned text;
BEGIN
  SELECT string_agg(tbl, ', ') INTO unowned FROM (
    SELECT 'leads' AS tbl WHERE EXISTS (SELECT 1 FROM public.leads WHERE company_id IS NULL)
    UNION ALL SELECT 'crm_customers' WHERE EXISTS (SELECT 1 FROM public.crm_customers WHERE company_id IS NULL)
    UNION ALL SELECT 'crm_properties' WHERE EXISTS (SELECT 1 FROM public.crm_properties WHERE company_id IS NULL)
    UNION ALL SELECT 'roof_report_orders' WHERE EXISTS (SELECT 1 FROM public.roof_report_orders WHERE company_id IS NULL)
    UNION ALL SELECT 'roof_jobs' WHERE EXISTS (SELECT 1 FROM public.roof_jobs WHERE company_id IS NULL)
    UNION ALL SELECT 'proposals' WHERE EXISTS (SELECT 1 FROM public.proposals WHERE company_id IS NULL)
    -- roof_drawings intentionally has no company_id column: ownership
    -- resolves through its property (migrations 0054/0063/0064). Assert
    -- instead that every drawing links to an owned property.
    UNION ALL SELECT 'roof_drawings(unowned property)' WHERE EXISTS (
      SELECT 1 FROM public.roof_drawings d
      JOIN public.crm_properties p ON p.id = d.property_id
      WHERE p.company_id IS NULL
    )
    UNION ALL SELECT 'crm_invoices' WHERE EXISTS (SELECT 1 FROM public.crm_invoices WHERE company_id IS NULL)
  ) s;
  IF unowned IS NOT NULL THEN
    RAISE EXCEPTION 'ABORT: rows without company ownership remain in: %', unowned;
  END IF;
END $post_ownership$;

DO $post_security$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('is_crm_company_member', 'is_crm_company_admin', 'has_role', 'has_any_role')
      AND has_function_privilege('anon', p.oid, 'EXECUTE')
  ) THEN
    RAISE EXCEPTION 'ABORT: anonymous EXECUTE still granted on a company/role helper';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'permit-documents') THEN
    RAISE EXCEPTION 'ABORT: permit-documents bucket missing after migration';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'Production manager roof report files'
  ) THEN
    RAISE EXCEPTION 'ABORT: legacy global-role roof-report storage policy (0031) still present';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('leads','crm_customers','crm_properties','roof_jobs','roof_report_orders',
                        'client_portal_links','crm_activity','crm_expenses','crm_invoices','crm_tasks',
                        'invoice_checkouts','invoice_payments','invoice_project_links','job_change_orders',
                        'lead_messages','proposal_shares','proposals','roof_estimates')
      AND (qual ILIKE '%has_role%' OR qual ILIKE '%has_any_role%'
           OR with_check ILIKE '%has_role%' OR with_check ILIKE '%has_any_role%')
  ) THEN
    RAISE EXCEPTION 'ABORT: a legacy global-role policy remains on a tenant table';
  END IF;
END $post_security$;

COMMIT;

-- Post-commit evidence (read-only): run the preflight script again and
-- archive both outputs with the release record.
SELECT 'FORWARD MIGRATION COMPLETE' AS status;
