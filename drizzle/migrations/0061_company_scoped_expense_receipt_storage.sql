-- SECURITY DEFINER is required because the expense table itself has RLS;
-- a policy subquery executed as the caller can otherwise hide the parent row
-- and silently block valid receipt cleanup. The helper returns only a boolean.
CREATE OR REPLACE FUNCTION public.can_access_company_expense_receipt(
  object_name text,
  require_attached boolean DEFAULT false
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN split_part(object_name,'/',1) <> 'expense'
      OR split_part(object_name,'/',2) = ''
      OR split_part(object_name,'/',3) = ''
      OR split_part(object_name,'/',4) = ''
      OR split_part(object_name,'/',5) <> ''
    THEN false
    ELSE EXISTS (
      SELECT 1
      FROM public.crm_expenses e
      JOIN public.crm_company_memberships m ON m.company_id=e.company_id
      WHERE e.id::text=split_part(object_name,'/',3)
        AND e.company_id::text=split_part(object_name,'/',2)
        AND (NOT require_attached OR e.receipt_path=object_name)
        AND m.user_id=auth.uid()
        AND m.role IN ('owner','admin','accounting')
    )
  END
$$;
REVOKE ALL ON FUNCTION public.can_access_company_expense_receipt(text,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_access_company_expense_receipt(text,boolean) TO authenticated;

-- Restore accounting receipt access only for company-owned expense rows.
-- New object keys: expense/{company_id}/{expense_id}/{unique-filename}.
-- Legacy expense-* objects remain inaccessible; no existing object or expense is deleted.

CREATE POLICY "Company accounting members read expense receipts" ON storage.objects
  FOR SELECT TO authenticated USING (
    bucket_id='roofing-proposals'
    AND public.can_access_company_expense_receipt(name, false)
  );

CREATE POLICY "Company accounting members upload expense receipts" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (
    bucket_id='roofing-proposals'
    AND public.can_access_company_expense_receipt(name, false)
  );

CREATE POLICY "Company accounting members delete expense receipts" ON storage.objects
  FOR DELETE TO authenticated USING (
    bucket_id='roofing-proposals'
    AND public.can_access_company_expense_receipt(name, false)
  );

COMMENT ON POLICY "Company accounting members read expense receipts" ON storage.objects IS
  'Receipt access requires an exact company/expense path and a matching company-owned expense row; company accounting members can read pending uploads before attachment.';
COMMENT ON POLICY "Company accounting members upload expense receipts" ON storage.objects IS
  'Receipt upload requires a pre-existing company-owned expense row and owner/admin/accounting membership in that company.';
COMMENT ON POLICY "Company accounting members delete expense receipts" ON storage.objects IS
  'Receipt deletion requires an exact company/expense path and owner/admin/accounting membership; this also permits cleanup when upload succeeded but row attachment failed.';
