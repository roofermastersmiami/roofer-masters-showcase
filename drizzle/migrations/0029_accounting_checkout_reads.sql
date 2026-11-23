-- Match checkout visibility to the admin/accounting invoice workflow.
DROP POLICY IF EXISTS "Owner checkout reads" ON public.invoice_checkouts;
CREATE POLICY "Accounting checkout reads" ON public.invoice_checkouts
  FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','accounting']::public.app_role[]));
