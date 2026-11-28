-- Tighten core CRM and storage reads to the intended company role matrix.
-- Migration 0054 initially used is_crm_company_member() for several reads. That
-- helper includes crew and every future membership role; the legacy policy
-- matrix did not grant every role access to every operational record.
-- tenant-audit: reviewed — explicit per-table role sets, owner/admin helper,
-- SECURITY DEFINER storage lookup with fixed search_path, assigned-crew photo
-- access only, and anonymous execution revoked from company helper functions.

REVOKE ALL ON FUNCTION public.is_crm_company_member(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_crm_company_admin(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_crm_company_member(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_crm_company_admin(uuid) TO authenticated, service_role;

-- The legacy SECURITY DEFINER global-role helper accepts arbitrary user IDs.
-- It is not a public RPC; callers are limited to authenticated/service roles.
REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.has_any_role(uuid, public.app_role[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_any_role(uuid, public.app_role[]) TO authenticated, service_role;

-- Leads: owner/admin, office, sales, production manager, and accounting.
DROP POLICY IF EXISTS "Company members read leads" ON public.leads;
CREATE POLICY "Company staff read leads" ON public.leads
  FOR SELECT TO authenticated
  USING (
    public.is_crm_company_admin(company_id)
    OR EXISTS (
      SELECT 1 FROM public.crm_company_memberships m
      WHERE m.company_id=leads.company_id AND m.user_id=auth.uid()
        AND m.role IN ('office','sales','production_manager','accounting')
    )
  );

-- Customers and properties: same read roles as the legacy CRM policies.
DROP POLICY IF EXISTS "Company members read customers" ON public.crm_customers;
CREATE POLICY "Company staff read customers" ON public.crm_customers
  FOR SELECT TO authenticated
  USING (
    public.is_crm_company_admin(company_id)
    OR EXISTS (
      SELECT 1 FROM public.crm_company_memberships m
      WHERE m.company_id=crm_customers.company_id AND m.user_id=auth.uid()
        AND m.role IN ('office','sales','production_manager','accounting')
    )
  );

DROP POLICY IF EXISTS "Company members read properties" ON public.crm_properties;
CREATE POLICY "Company staff read properties" ON public.crm_properties
  FOR SELECT TO authenticated
  USING (
    public.is_crm_company_admin(company_id)
    OR EXISTS (
      SELECT 1 FROM public.crm_company_memberships m
      WHERE m.company_id=crm_properties.company_id AND m.user_id=auth.uid()
        AND m.role IN ('office','sales','production_manager','accounting')
    )
  );

-- Jobs: office/accounting read; production managers and admins retain the
-- separate FOR ALL management policy. Sales and crew do not gain job-row reads.
DROP POLICY IF EXISTS "Company members read jobs" ON public.roof_jobs;
CREATE POLICY "Company office accounting read jobs" ON public.roof_jobs
  FOR SELECT TO authenticated
  USING (
    public.is_crm_company_admin(company_id)
    OR EXISTS (
      SELECT 1 FROM public.crm_company_memberships m
      WHERE m.company_id=roof_jobs.company_id AND m.user_id=auth.uid()
        AND m.role IN ('office','accounting')
    )
  );

-- Report requests: owner/admin, office, sales, and production managers.
DROP POLICY IF EXISTS "Company members read report requests" ON public.roof_report_orders;
CREATE POLICY "Company staff read report requests" ON public.roof_report_orders
  FOR SELECT TO authenticated
  USING (
    public.is_crm_company_admin(company_id)
    OR EXISTS (
      SELECT 1 FROM public.crm_company_memberships m
      WHERE m.company_id=roof_report_orders.company_id AND m.user_id=auth.uid()
        AND m.role IN ('office','sales','production_manager')
    )
  );

-- Drawings inherit company ownership from their property. Accounting and crew
-- are not granted general drawing access by the legacy role matrix.
DROP POLICY IF EXISTS "Company members read drawings" ON public.roof_drawings;
CREATE POLICY "Company staff read drawings" ON public.roof_drawings
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.crm_properties p
      WHERE p.id=roof_drawings.property_id
        AND (
          public.is_crm_company_admin(p.company_id)
          OR EXISTS (
            SELECT 1 FROM public.crm_company_memberships m
            WHERE m.company_id=p.company_id AND m.user_id=auth.uid()
              AND m.role IN ('office','sales','production_manager')
          )
        )
    )
  );

-- Proposal PDFs are visible to the same roles that manage proposal records.
-- SECURITY DEFINER is required because proposals have their own RLS policy.
CREATE OR REPLACE FUNCTION public.can_access_company_proposal_file(
  object_name text,
  write_access boolean DEFAULT false
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN split_part(object_name, '/', 1) = ''
      OR split_part(object_name, '/', 2) = ''
      OR split_part(object_name, '/', 1) !~ '^[0-9a-fA-F-]{36}$'
    THEN false
    ELSE EXISTS (
      SELECT 1
      FROM public.proposals p
      JOIN public.crm_company_memberships m ON m.company_id = p.company_id
      WHERE p.id::text = split_part(object_name, '/', 1)
        AND m.user_id = auth.uid()
        AND (NOT write_access OR m.role IN ('owner','admin','office','sales'))
    )
  END
$$;
REVOKE ALL ON FUNCTION public.can_access_company_proposal_file(text,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_access_company_proposal_file(text,boolean) TO authenticated;

-- Storage policies must not depend on caller-visible roof_jobs rows for crew
-- assignment checks. This SECURITY DEFINER helper reads only the exact job
-- UUID in the object path and returns a boolean; crew are limited to assigned
-- jobs and do not receive general roof_jobs table access.
CREATE OR REPLACE FUNCTION public.can_access_company_job_photo(
  object_name text,
  write_access boolean DEFAULT false
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN split_part(object_name, '/', 1) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      OR split_part(object_name, '/', 2) = ''
      OR split_part(object_name, '/', 3) <> ''
    THEN false
    ELSE EXISTS (
      SELECT 1
      FROM public.roof_jobs j
      JOIN public.crm_company_memberships m ON m.company_id=j.company_id
      WHERE j.id::text=split_part(object_name, '/', 1)
        AND m.user_id=auth.uid()
        AND (
          m.role IN ('owner','admin','office','sales','production_manager')
          OR (
            m.role='crew'
            AND auth.uid() = ANY(coalesce(j.assigned_user_ids, ARRAY[]::uuid[]))
          )
        )
        AND (
          NOT write_access
          OR m.role IN ('owner','admin','office','sales','production_manager')
          OR (
            m.role='crew'
            AND auth.uid() = ANY(coalesce(j.assigned_user_ids, ARRAY[]::uuid[]))
          )
        )
    )
  END
$$;
REVOKE ALL ON FUNCTION public.can_access_company_job_photo(text,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_access_company_job_photo(text,boolean) TO authenticated;

DROP POLICY IF EXISTS "Company members read job photos" ON storage.objects;
CREATE POLICY "Company members read job photos" ON storage.objects
  FOR SELECT TO authenticated USING (
    bucket_id='roof-job-photos'
    AND public.can_access_company_job_photo(name, false)
  );

DROP POLICY IF EXISTS "Company members upload job photos" ON storage.objects;
CREATE POLICY "Company members upload job photos" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (
    bucket_id='roof-job-photos'
    AND public.can_access_company_job_photo(name, true)
  );

DROP POLICY IF EXISTS "Company admins delete job photos" ON storage.objects;
CREATE POLICY "Company admins delete job photos" ON storage.objects
  FOR DELETE TO authenticated USING (
    bucket_id='roof-job-photos'
    AND EXISTS (
      SELECT 1 FROM public.roof_jobs j
      JOIN public.crm_company_memberships m ON m.company_id=j.company_id
      WHERE j.id::text=split_part(name, '/', 1)
        AND m.user_id=auth.uid()
        AND m.role IN ('owner','admin')
    )
  );

-- Report PDFs follow the same read roles as report rows; upload/update/delete
-- policies from 0054 remain restricted to owner/admin/office/sales/production.
DROP POLICY IF EXISTS "Company members read roof report files" ON storage.objects;
CREATE POLICY "Company staff read roof report files" ON storage.objects
  FOR SELECT TO authenticated USING (
    bucket_id='roofing-proposals'
    AND name NOT LIKE 'expense-%'
    AND split_part(name,'/',1)='roof-report'
    AND EXISTS (
      SELECT 1 FROM public.roof_report_orders r
      JOIN public.crm_company_memberships m ON m.company_id=r.company_id
      WHERE r.id::text=split_part(name,'/',2)
        AND m.user_id=auth.uid()
        AND m.role IN ('owner','admin','office','sales','production_manager')
    )
  );

COMMENT ON FUNCTION public.can_access_company_proposal_file(text,boolean) IS
  'Allows proposal PDF reads to any member of the owning company; upload/delete is limited to owner/admin/office/sales.';
COMMENT ON FUNCTION public.can_access_company_job_photo(text,boolean) IS
  'Allows job photo access to owner/admin/office/sales/production_manager and assigned crew in the owning company; does not expose job rows.';
