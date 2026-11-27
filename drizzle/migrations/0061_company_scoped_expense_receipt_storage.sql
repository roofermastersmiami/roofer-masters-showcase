-- Restore accounting receipt access only for company-owned expense rows.
-- New object keys: expense/{company_id}/{expense_id}/{unique-filename}.
-- Legacy expense-* objects remain inaccessible; no existing object or expense is deleted.

CREATE POLICY "Company accounting members read expense receipts" ON storage.objects
  FOR SELECT TO authenticated USING (
    bucket_id='roofing-proposals'
    AND split_part(name,'/',1)='expense'
    AND split_part(name,'/',2)<>''
    AND split_part(name,'/',3)<>''
    AND split_part(name,'/',4)<>''
    AND split_part(name,'/',5)=''
    AND EXISTS (
      SELECT 1 FROM public.crm_expenses e
      JOIN public.crm_company_memberships m ON m.company_id=e.company_id
      WHERE e.id::text=split_part(name,'/',3)
        AND e.company_id::text=split_part(name,'/',2)
        AND e.receipt_path=name
        AND m.user_id=auth.uid()
        AND m.role IN ('owner','admin','accounting')
    )
  );

CREATE POLICY "Company accounting members upload expense receipts" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (
    bucket_id='roofing-proposals'
    AND split_part(name,'/',1)='expense'
    AND split_part(name,'/',2)<>''
    AND split_part(name,'/',3)<>''
    AND split_part(name,'/',4)<>''
    AND split_part(name,'/',5)=''
    AND EXISTS (
      SELECT 1 FROM public.crm_expenses e
      JOIN public.crm_company_memberships m ON m.company_id=e.company_id
      WHERE e.id::text=split_part(name,'/',3)
        AND e.company_id::text=split_part(name,'/',2)
        AND m.user_id=auth.uid()
        AND m.role IN ('owner','admin','accounting')
    )
  );

CREATE POLICY "Company accounting members delete expense receipts" ON storage.objects
  FOR DELETE TO authenticated USING (
    bucket_id='roofing-proposals'
    AND split_part(name,'/',1)='expense'
    AND split_part(name,'/',2)<>''
    AND split_part(name,'/',3)<>''
    AND split_part(name,'/',4)<>''
    AND split_part(name,'/',5)=''
    AND EXISTS (
      SELECT 1 FROM public.crm_expenses e
      JOIN public.crm_company_memberships m ON m.company_id=e.company_id
      WHERE e.id::text=split_part(name,'/',3)
        AND e.company_id::text=split_part(name,'/',2)
        AND m.user_id=auth.uid()
        AND m.role IN ('owner','admin','accounting')
    )
  );

COMMENT ON POLICY "Company accounting members read expense receipts" ON storage.objects IS
  'Receipt access requires an exact company/expense path and a matching company-owned expense row; only owner/admin/accounting can read.';
COMMENT ON POLICY "Company accounting members upload expense receipts" ON storage.objects IS
  'Receipt upload requires a pre-existing company-owned expense row and owner/admin/accounting membership in that company.';
COMMENT ON POLICY "Company accounting members delete expense receipts" ON storage.objects IS
  'Receipt deletion requires an exact company/expense path and owner/admin/accounting membership; this also permits cleanup when upload succeeded but row attachment failed.';
