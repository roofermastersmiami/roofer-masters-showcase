-- Restore company-scoped access to proposal PDFs after migration 0054
-- intentionally removes legacy global-role proposal storage policies.
-- tenant-audit: reviewed — object paths begin with the proposal UUID; every
-- operation resolves that proposal row and authorizes against its company.
-- Expense receipts remain denied until their upload flow uses an auditable
-- company/expense-linked object path and row-first persistence.

CREATE POLICY "Company members read proposal files" ON storage.objects
  FOR SELECT TO authenticated USING (
    bucket_id = 'roofing-proposals'
    AND split_part(name, '/', 1) <> 'roof-report'
    AND split_part(name, '/', 1) NOT LIKE 'expense-%'
    AND EXISTS (
      SELECT 1 FROM public.proposals p
      WHERE p.id::text = split_part(name, '/', 1)
        AND public.is_crm_company_member(p.company_id)
    )
  );

CREATE POLICY "Company staff upload proposal files" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (
    bucket_id = 'roofing-proposals'
    AND split_part(name, '/', 1) <> 'roof-report'
    AND split_part(name, '/', 1) NOT LIKE 'expense-%'
    AND EXISTS (
      SELECT 1 FROM public.proposals p
      JOIN public.crm_company_memberships m ON m.company_id = p.company_id
      WHERE p.id::text = split_part(name, '/', 1)
        AND m.user_id = auth.uid()
        AND m.role IN ('owner','admin','office','sales')
    )
  );

CREATE POLICY "Company staff delete proposal files" ON storage.objects
  FOR DELETE TO authenticated USING (
    bucket_id = 'roofing-proposals'
    AND split_part(name, '/', 1) <> 'roof-report'
    AND split_part(name, '/', 1) NOT LIKE 'expense-%'
    AND EXISTS (
      SELECT 1 FROM public.proposals p
      JOIN public.crm_company_memberships m ON m.company_id = p.company_id
      WHERE p.id::text = split_part(name, '/', 1)
        AND m.user_id = auth.uid()
        AND m.role IN ('owner','admin','office','sales')
    )
  );

COMMENT ON POLICY "Company members read proposal files" ON storage.objects IS
  'Proposal PDFs are readable only by members of the company owning the proposal UUID in the object path.';
COMMENT ON POLICY "Company staff upload proposal files" ON storage.objects IS
  'Only owner/admin/office/sales members can upload a PDF under a proposal owned by their company.';
COMMENT ON POLICY "Company staff delete proposal files" ON storage.objects IS
  'Only owner/admin/office/sales members can delete files under proposals owned by their company.';
