-- Accounting users can view invoices and payment history in the same workflow
-- where they are permitted to issue invoices and record payments.
DROP POLICY IF EXISTS "Owner invoice reads" ON public.crm_invoices;
CREATE POLICY "Accounting invoice reads" ON public.crm_invoices
  FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','accounting']::public.app_role[]));

DROP POLICY IF EXISTS "Owner payment reads" ON public.invoice_payments;
CREATE POLICY "Accounting payment reads" ON public.invoice_payments
  FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','accounting']::public.app_role[]));
