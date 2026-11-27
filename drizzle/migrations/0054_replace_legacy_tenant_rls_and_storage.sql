-- Coordinated tenant-scoped RLS and storage policy replacement.
-- This migration replaces (does not layer over) legacy global-role policies.
-- Expense objects in roofing-proposals are intentionally denied until their
-- records and object keys carry an auditable company_id; legacy expense-*
-- names do not encode a tenant and cannot be safely authorized.

DO $preflight$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.leads WHERE company_id IS NULL
    UNION ALL SELECT 1 FROM public.crm_customers WHERE company_id IS NULL
    UNION ALL SELECT 1 FROM public.crm_properties WHERE company_id IS NULL
    UNION ALL SELECT 1 FROM public.roof_jobs WHERE company_id IS NULL
    UNION ALL SELECT 1 FROM public.roof_report_orders WHERE company_id IS NULL
  ) THEN
    RAISE EXCEPTION 'Tenant policy cutover blocked: operational rows without company_id exist';
  END IF;
  IF to_regprocedure('public.is_crm_company_member(uuid)') IS NULL
     OR to_regprocedure('public.is_crm_company_admin(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Tenant policy cutover blocked: company membership helpers are missing';
  END IF;
END
$preflight$;

-- Core CRM records: remove every legacy global-role policy before adding
-- company membership policies. Existing RLS remains enabled.
DROP POLICY IF EXISTS "Owner can view leads" ON public.leads;
DROP POLICY IF EXISTS "Owner can update leads" ON public.leads;
DROP POLICY IF EXISTS "Owner can delete leads" ON public.leads;
DROP POLICY IF EXISTS "Team office sales leads read" ON public.leads;
DROP POLICY IF EXISTS "Team office sales leads update" ON public.leads;

CREATE POLICY "Company members read leads" ON public.leads
  FOR SELECT TO authenticated
  USING (public.is_crm_company_member(company_id));
CREATE POLICY "Company office sales update leads" ON public.leads
  FOR UPDATE TO authenticated
  USING (public.is_crm_company_admin(company_id) OR EXISTS (
    SELECT 1 FROM public.crm_company_memberships m
    WHERE m.company_id=leads.company_id AND m.user_id=auth.uid()
      AND m.role IN ('office','sales')
  ))
  WITH CHECK (public.is_crm_company_admin(company_id) OR EXISTS (
    SELECT 1 FROM public.crm_company_memberships m
    WHERE m.company_id=leads.company_id AND m.user_id=auth.uid()
      AND m.role IN ('office','sales')
  ));
CREATE POLICY "Company admins delete leads" ON public.leads
  FOR DELETE TO authenticated
  USING (public.is_crm_company_admin(company_id));

DROP POLICY IF EXISTS "Owner customers" ON public.crm_customers;
DROP POLICY IF EXISTS "Team customers read" ON public.crm_customers;
DROP POLICY IF EXISTS "Team customers write" ON public.crm_customers;
CREATE POLICY "Company members read customers" ON public.crm_customers
  FOR SELECT TO authenticated USING (public.is_crm_company_member(company_id));
CREATE POLICY "Company office sales write customers" ON public.crm_customers
  FOR UPDATE TO authenticated
  USING (public.is_crm_company_admin(company_id) OR EXISTS (
    SELECT 1 FROM public.crm_company_memberships m
    WHERE m.company_id=crm_customers.company_id AND m.user_id=auth.uid()
      AND m.role IN ('office','sales')
  ))
  WITH CHECK (public.is_crm_company_admin(company_id) OR EXISTS (
    SELECT 1 FROM public.crm_company_memberships m
    WHERE m.company_id=crm_customers.company_id AND m.user_id=auth.uid()
      AND m.role IN ('office','sales')
  ));

DROP POLICY IF EXISTS "Owner properties" ON public.crm_properties;
DROP POLICY IF EXISTS "Team properties insert" ON public.crm_properties;
DROP POLICY IF EXISTS "Team properties read" ON public.crm_properties;
DROP POLICY IF EXISTS "Team properties update" ON public.crm_properties;
CREATE POLICY "Company members read properties" ON public.crm_properties
  FOR SELECT TO authenticated USING (public.is_crm_company_member(company_id));
CREATE POLICY "Company office sales write properties" ON public.crm_properties
  FOR INSERT TO authenticated
  WITH CHECK (public.is_crm_company_admin(company_id) OR EXISTS (
    SELECT 1 FROM public.crm_company_memberships m
    WHERE m.company_id=crm_properties.company_id AND m.user_id=auth.uid()
      AND m.role IN ('office','sales')
  ));
CREATE POLICY "Company office sales update properties" ON public.crm_properties
  FOR UPDATE TO authenticated
  USING (public.is_crm_company_admin(company_id) OR EXISTS (
    SELECT 1 FROM public.crm_company_memberships m
    WHERE m.company_id=crm_properties.company_id AND m.user_id=auth.uid()
      AND m.role IN ('office','sales')
  ))
  WITH CHECK (public.is_crm_company_admin(company_id) OR EXISTS (
    SELECT 1 FROM public.crm_company_memberships m
    WHERE m.company_id=crm_properties.company_id AND m.user_id=auth.uid()
      AND m.role IN ('office','sales')
  ));

DROP POLICY IF EXISTS "Owner jobs" ON public.roof_jobs;
DROP POLICY IF EXISTS "Production jobs" ON public.roof_jobs;
DROP POLICY IF EXISTS "Team jobs read" ON public.roof_jobs;
CREATE POLICY "Company members read jobs" ON public.roof_jobs
  FOR SELECT TO authenticated USING (public.is_crm_company_member(company_id));
CREATE POLICY "Company production roles manage jobs" ON public.roof_jobs
  FOR ALL TO authenticated
  USING (public.is_crm_company_admin(company_id) OR EXISTS (
    SELECT 1 FROM public.crm_company_memberships m
    WHERE m.company_id=roof_jobs.company_id AND m.user_id=auth.uid()
      AND m.role IN ('production_manager')
  ))
  WITH CHECK (public.is_crm_company_admin(company_id) OR EXISTS (
    SELECT 1 FROM public.crm_company_memberships m
    WHERE m.company_id=roof_jobs.company_id AND m.user_id=auth.uid()
      AND m.role IN ('production_manager')
  ));

DROP POLICY IF EXISTS "Owner reads report requests" ON public.roof_report_orders;
DROP POLICY IF EXISTS "Team reports read" ON public.roof_report_orders;
CREATE POLICY "Company members read report requests" ON public.roof_report_orders
  FOR SELECT TO authenticated USING (public.is_crm_company_member(company_id));
CREATE POLICY "Company staff update report requests" ON public.roof_report_orders
  FOR UPDATE TO authenticated
  USING (public.is_crm_company_admin(company_id) OR EXISTS (
    SELECT 1 FROM public.crm_company_memberships m
    WHERE m.company_id=roof_report_orders.company_id AND m.user_id=auth.uid()
      AND m.role IN ('office','sales','production_manager')
  ))
  WITH CHECK (public.is_crm_company_admin(company_id) OR EXISTS (
    SELECT 1 FROM public.crm_company_memberships m
    WHERE m.company_id=roof_report_orders.company_id AND m.user_id=auth.uid()
      AND m.role IN ('office','sales','production_manager')
  ));
CREATE POLICY "Company staff delete report requests" ON public.roof_report_orders
  FOR DELETE TO authenticated
  USING (public.is_crm_company_admin(company_id) OR EXISTS (
    SELECT 1 FROM public.crm_company_memberships m
    WHERE m.company_id=roof_report_orders.company_id AND m.user_id=auth.uid()
      AND m.role IN ('office','sales','production_manager')
  ));
-- Report creation and drawing saves are routed through membership-derived RPCs.

-- Drawings do not yet have a company_id column in the live schema. Their
-- authoritative tenant is the required property_id; scope through that parent.
DROP POLICY IF EXISTS "Owner reads drawings" ON public.roof_drawings;
DROP POLICY IF EXISTS "Owner saves drawing revisions" ON public.roof_drawings;
DROP POLICY IF EXISTS "Team drawings insert" ON public.roof_drawings;
DROP POLICY IF EXISTS "Team drawings read" ON public.roof_drawings;
CREATE POLICY "Company members read drawings" ON public.roof_drawings
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.crm_properties p
    WHERE p.id=roof_drawings.property_id
      AND public.is_crm_company_member(p.company_id)
  ));
CREATE POLICY "Company production roles insert drawings" ON public.roof_drawings
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.crm_properties p
    JOIN public.crm_company_memberships m ON m.company_id=p.company_id
    WHERE p.id=roof_drawings.property_id AND m.user_id=auth.uid()
      AND m.role IN ('owner','admin','office','sales','production_manager')
  ));

-- Storage policy replacement. Preserve the separate company-branding policies.
DROP POLICY IF EXISTS "Crew assigned job photos read" ON storage.objects;
DROP POLICY IF EXISTS "Crew assigned job photos upload" ON storage.objects;
DROP POLICY IF EXISTS "Owner job photos" ON storage.objects;
DROP POLICY IF EXISTS "Team roof photos" ON storage.objects;
DROP POLICY IF EXISTS "Owners delete proposal files" ON storage.objects;
DROP POLICY IF EXISTS "Owners read proposal files" ON storage.objects;
DROP POLICY IF EXISTS "Owners update proposal files" ON storage.objects;
DROP POLICY IF EXISTS "Owners upload proposal files" ON storage.objects;
DROP POLICY IF EXISTS "Sales proposal files" ON storage.objects;
DROP POLICY IF EXISTS "Accounting receipts" ON storage.objects;
DROP POLICY IF EXISTS "CRM staff upload signed contracts" ON storage.objects;
DROP POLICY IF EXISTS "CRM staff read signed contracts" ON storage.objects;

-- Roof job photos use {job_id}/{filename}. Job ownership is authoritative;
-- crew access additionally requires a crew membership and explicit assignment.
CREATE POLICY "Company members read job photos" ON storage.objects
  FOR SELECT TO authenticated USING (
    bucket_id='roof-job-photos'
    AND EXISTS (
      SELECT 1 FROM public.roof_jobs j
      WHERE j.id::text=split_part(name,'/',1)
        AND (
          public.is_crm_company_admin(j.company_id)
          OR EXISTS (
            SELECT 1 FROM public.crm_company_memberships m
            WHERE m.company_id=j.company_id AND m.user_id=auth.uid()
              AND m.role IN ('office','sales','production_manager')
          )
          OR (
            auth.uid() = ANY(j.assigned_user_ids)
            AND EXISTS (
              SELECT 1 FROM public.crm_company_memberships m
              WHERE m.company_id=j.company_id AND m.user_id=auth.uid()
                AND m.role='crew'
            )
          )
        )
    )
  );
CREATE POLICY "Company members upload job photos" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (
    bucket_id='roof-job-photos'
    AND EXISTS (
      SELECT 1 FROM public.roof_jobs j
      WHERE j.id::text=split_part(name,'/',1)
        AND (
          public.is_crm_company_admin(j.company_id)
          OR EXISTS (
            SELECT 1 FROM public.crm_company_memberships m
            WHERE m.company_id=j.company_id AND m.user_id=auth.uid()
              AND m.role IN ('office','sales','production_manager')
          )
          OR (
            auth.uid() = ANY(j.assigned_user_ids)
            AND EXISTS (
              SELECT 1 FROM public.crm_company_memberships m
              WHERE m.company_id=j.company_id AND m.user_id=auth.uid()
                AND m.role='crew'
            )
          )
        )
    )
  );
CREATE POLICY "Company admins delete job photos" ON storage.objects
  FOR DELETE TO authenticated USING (
    bucket_id='roof-job-photos'
    AND EXISTS (SELECT 1 FROM public.roof_jobs j
      WHERE j.id::text=split_part(name,'/',1)
        AND public.is_crm_company_admin(j.company_id))
  );

-- Roof report PDFs use roof-report/{report_id}/{filename}; resolve tenant
-- through the company-owned report row. expense-* objects remain denied:
-- their current object names do not identify a company or parent expense row.
CREATE POLICY "Company members read roof report files" ON storage.objects
  FOR SELECT TO authenticated USING (
    bucket_id='roofing-proposals'
    AND name NOT LIKE 'expense-%'
    AND split_part(name,'/',1)='roof-report'
    AND EXISTS (SELECT 1 FROM public.roof_report_orders r
      WHERE r.id::text=split_part(name,'/',2)
        AND public.is_crm_company_member(r.company_id))
  );
CREATE POLICY "Company staff upload roof report files" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (
    bucket_id='roofing-proposals'
    AND name NOT LIKE 'expense-%'
    AND split_part(name,'/',1)='roof-report'
    AND EXISTS (SELECT 1 FROM public.roof_report_orders r
      WHERE r.id::text=split_part(name,'/',2)
        AND (
          public.is_crm_company_admin(r.company_id)
          OR EXISTS (SELECT 1 FROM public.crm_company_memberships m
            WHERE m.company_id=r.company_id AND m.user_id=auth.uid()
              AND m.role IN ('office','sales','production_manager'))
        ))
  );
CREATE POLICY "Company admins update roof report files" ON storage.objects
  FOR UPDATE TO authenticated USING (
    bucket_id='roofing-proposals'
    AND name NOT LIKE 'expense-%'
    AND split_part(name,'/',1)='roof-report'
    AND EXISTS (SELECT 1 FROM public.roof_report_orders r
      WHERE r.id::text=split_part(name,'/',2)
        AND public.is_crm_company_admin(r.company_id))
  ) WITH CHECK (
    bucket_id='roofing-proposals'
    AND name NOT LIKE 'expense-%'
    AND split_part(name,'/',1)='roof-report'
    AND EXISTS (SELECT 1 FROM public.roof_report_orders r
      WHERE r.id::text=split_part(name,'/',2)
        AND public.is_crm_company_admin(r.company_id))
  );
CREATE POLICY "Company admins delete roof report files" ON storage.objects
  FOR DELETE TO authenticated USING (
    bucket_id='roofing-proposals'
    AND name NOT LIKE 'expense-%'
    AND split_part(name,'/',1)='roof-report'
    AND EXISTS (SELECT 1 FROM public.roof_report_orders r
      WHERE r.id::text=split_part(name,'/',2)
        AND public.is_crm_company_admin(r.company_id))
  );

-- Signed contracts use {lead_id}/{report_id}/{filename}. Both IDs must
-- resolve to the same company's source lead and report.
INSERT INTO storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
VALUES ('signed-contracts','signed-contracts',false,31457280,ARRAY['application/pdf'])
ON CONFLICT (id) DO UPDATE SET public=false,file_size_limit=31457280,
  allowed_mime_types=ARRAY['application/pdf'];
CREATE POLICY "Company members read signed contracts" ON storage.objects
  FOR SELECT TO authenticated USING (
    bucket_id='signed-contracts'
    AND EXISTS (
      SELECT 1 FROM public.roof_report_orders r
      JOIN public.crm_customers c ON c.id=r.customer_id AND c.company_id=r.company_id
      WHERE r.id::text=split_part(name,'/',2)
        AND c.source_lead_id::text=split_part(name,'/',1)
        AND public.is_crm_company_member(r.company_id)
    )
  );
CREATE POLICY "Company staff upload signed contracts" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (
    bucket_id='signed-contracts'
    AND EXISTS (
      SELECT 1 FROM public.roof_report_orders r
      JOIN public.crm_customers c ON c.id=r.customer_id AND c.company_id=r.company_id
      WHERE r.id::text=split_part(name,'/',2)
        AND c.source_lead_id::text=split_part(name,'/',1)
        AND (
          public.is_crm_company_admin(r.company_id)
          OR EXISTS (SELECT 1 FROM public.crm_company_memberships m
            WHERE m.company_id=r.company_id AND m.user_id=auth.uid()
              AND m.role IN ('office','sales','production_manager'))
        )
    )
  );
CREATE POLICY "Company admins delete signed contracts" ON storage.objects
  FOR DELETE TO authenticated USING (
    bucket_id='signed-contracts'
    AND EXISTS (
      SELECT 1 FROM public.roof_report_orders r
      JOIN public.crm_customers c ON c.id=r.customer_id AND c.company_id=r.company_id
      WHERE r.id::text=split_part(name,'/',2)
        AND c.source_lead_id::text=split_part(name,'/',1)
        AND public.is_crm_company_admin(r.company_id)
    )
  );

COMMENT ON POLICY "Company members read roof report files" ON storage.objects IS
  'Only members of the company owning the referenced roof report can read report PDFs; legacy expense-* objects are intentionally denied pending tenant-key migration.';
