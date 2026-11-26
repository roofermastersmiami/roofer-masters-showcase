-- READ-ONLY tenant rollout preflight.
-- Run against production with a read-only database role before designing the
-- membership-aware RLS cutover. This script performs SELECTs only.
-- It intentionally does not infer membership from email, profile, or role text.

\echo '1. Legacy global-role inventory'
SELECT role::text AS app_role, count(*) AS user_count
FROM public.user_roles
GROUP BY role
ORDER BY role::text;

\echo '2. Users with legacy roles and their company memberships'
SELECT
  ur.user_id,
  array_agg(DISTINCT ur.role::text ORDER BY ur.role::text) AS legacy_roles,
  count(DISTINCT m.company_id) AS company_memberships,
  coalesce(
    jsonb_agg(DISTINCT jsonb_build_object(
      'company_id', m.company_id,
      'company_name', c.name,
      'company_role', m.role::text
    )) FILTER (WHERE m.company_id IS NOT NULL),
    '[]'::jsonb
  ) AS memberships
FROM public.user_roles ur
LEFT JOIN public.crm_company_memberships m ON m.user_id = ur.user_id
LEFT JOIN public.crm_companies c ON c.id = m.company_id
GROUP BY ur.user_id
ORDER BY ur.user_id;

\echo '3. Company membership coverage and role distribution'
SELECT
  c.id AS company_id,
  c.name AS company_name,
  c.created_by,
  count(m.user_id) AS membership_count,
  count(*) FILTER (WHERE m.role::text = 'owner') AS owner_count,
  jsonb_object_agg(role_counts.role_name, role_counts.member_count)
    FILTER (WHERE role_counts.role_name IS NOT NULL) AS role_counts
FROM public.crm_companies c
LEFT JOIN public.crm_company_memberships m ON m.company_id = c.id
LEFT JOIN LATERAL (
  SELECT role::text AS role_name, count(*) AS member_count
  FROM public.crm_company_memberships
  WHERE company_id = c.id
  GROUP BY role
) role_counts ON true
GROUP BY c.id, c.name, c.created_by
ORDER BY c.created_at, c.id;

\echo '4. Core records missing ownership (requires migration 0042 to have been applied)'
SELECT 'leads' AS table_name, count(*) FILTER (WHERE company_id IS NULL) AS unassigned
FROM public.leads
UNION ALL
SELECT 'crm_customers', count(*) FILTER (WHERE company_id IS NULL)
FROM public.crm_customers
UNION ALL
SELECT 'crm_properties', count(*) FILTER (WHERE company_id IS NULL)
FROM public.crm_properties
UNION ALL
SELECT 'roof_report_orders', count(*) FILTER (WHERE company_id IS NULL)
FROM public.roof_report_orders;

\echo '5. Remaining legacy-role RLS policies on core tables'
SELECT
  schemaname,
  tablename,
  policyname,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('leads', 'crm_customers', 'crm_properties', 'roof_report_orders')
ORDER BY tablename, policyname;

\echo '6. Table RLS flags for core records'
SELECT
  c.relname AS table_name,
  c.relrowsecurity AS rls_enabled,
  c.relforcerowsecurity AS rls_forced
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('leads', 'crm_customers', 'crm_properties', 'roof_report_orders')
ORDER BY c.relname;

\echo 'PREFLIGHT COMPLETE: review every unmapped user and policy before any RLS cutover.'
