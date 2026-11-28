-- Restore company-scoped access to proposal PDFs after migration 0054
-- intentionally removes legacy global-role proposal storage policies.
-- tenant-audit: reviewed — object paths begin with the proposal UUID; every
-- operation resolves that proposal row and authorizes against its company.
-- Expense receipts remain denied until their upload flow uses an auditable
-- company/expense-linked object path and row-first persistence.

-- Resolve proposal ownership outside the caller's proposal-table RLS.
-- Storage access remains constrained to the exact proposal UUID in the object path.
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
        AND (
          NOT write_access
          OR m.role IN ('owner','admin','office','sales')
        )
    )
  END
$$;
REVOKE ALL ON FUNCTION public.can_access_company_proposal_file(text,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_access_company_proposal_file(text,boolean) TO authenticated;

CREATE POLICY "Company members read proposal files" ON storage.objects
  FOR SELECT TO authenticated USING (
    bucket_id = 'roofing-proposals'
    AND split_part(name, '/', 1) <> 'roof-report'
    AND split_part(name, '/', 1) NOT LIKE 'expense-%'
    AND public.can_access_company_proposal_file(name, false)
  );

CREATE POLICY "Company staff upload proposal files" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (
    bucket_id = 'roofing-proposals'
    AND split_part(name, '/', 1) <> 'roof-report'
    AND split_part(name, '/', 1) NOT LIKE 'expense-%'
    AND public.can_access_company_proposal_file(name, true)
  );

CREATE POLICY "Company staff delete proposal files" ON storage.objects
  FOR DELETE TO authenticated USING (
    bucket_id = 'roofing-proposals'
    AND split_part(name, '/', 1) <> 'roof-report'
    AND split_part(name, '/', 1) NOT LIKE 'expense-%'
    AND public.can_access_company_proposal_file(name, true)
  );

COMMENT ON POLICY "Company members read proposal files" ON storage.objects IS
  'Proposal PDFs are readable only by members of the company owning the proposal UUID in the object path; lookup bypasses proposal-table RLS safely.';
COMMENT ON POLICY "Company staff upload proposal files" ON storage.objects IS
  'Only owner/admin/office/sales members can upload a PDF under a proposal owned by their company.';
COMMENT ON POLICY "Company staff delete proposal files" ON storage.objects IS
  'Only owner/admin/office/sales members can delete files under proposals owned by their company.';
