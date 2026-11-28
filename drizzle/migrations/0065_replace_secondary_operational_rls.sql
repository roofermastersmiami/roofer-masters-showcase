-- Replace legacy global-role policies on the secondary operational tables.
-- Adding company policies alongside the legacy policies would be unsafe because
-- PostgreSQL combines permissive policies with OR semantics.
-- tenant-audit: reviewed — all 13 tables drop every prior policy and re-create
-- operation-specific policies using the authenticated user's company membership.
-- Privileged public-token/payment flows continue through audited server functions.

DO $drop_legacy$
DECLARE
  target record;
  policy record;
BEGIN
  FOR target IN
    SELECT * FROM (VALUES
      ('public','client_portal_links'),
      ('public','crm_activity'),
      ('public','crm_expenses'),
      ('public','crm_invoices'),
      ('public','crm_tasks'),
      ('public','invoice_checkouts'),
      ('public','invoice_payments'),
      ('public','invoice_project_links'),
      ('public','job_change_orders'),
      ('public','lead_messages'),
      ('public','proposal_shares'),
      ('public','proposals'),
      ('public','roof_estimates')
    ) AS t(schema_name, table_name)
  LOOP
    FOR policy IN
      SELECT polname
      FROM pg_policy
      WHERE polrelid = format('%I.%I', target.schema_name, target.table_name)::regclass
    LOOP
      EXECUTE format('DROP POLICY %I ON %I.%I',
        policy.polname, target.schema_name, target.table_name);
    END LOOP;
  END LOOP;
END;
$drop_legacy$;

ALTER TABLE public.client_portal_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_activity ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_checkouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_project_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_change_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.proposal_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roof_estimates ENABLE ROW LEVEL SECURITY;

-- Customer portal capability records: only office/sales and company admins
-- may issue, inspect, or revoke a portal link for their own company's lead.
CREATE POLICY "Company staff manage client portal links"
  ON public.client_portal_links FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.crm_company_memberships m
    WHERE m.company_id=client_portal_links.company_id
      AND m.user_id=auth.uid()
      AND m.role IN ('owner','admin','office','sales')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.crm_company_memberships m
    WHERE m.company_id=client_portal_links.company_id
      AND m.user_id=auth.uid()
      AND m.role IN ('owner','admin','office','sales')
  ));

-- Activity is readable by the CRM and production teams. Manual call notes
-- are writable by owner/admin/office/sales; trigger-generated events use a
-- SECURITY DEFINER trigger and inherit company_id from the source lead.
CREATE POLICY "Company staff read CRM activity"
  ON public.crm_activity FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.crm_company_memberships m
    WHERE m.company_id=crm_activity.company_id
      AND m.user_id=auth.uid()
      AND m.role IN ('owner','admin','office','sales','production_manager')
  ));
CREATE POLICY "Company office sales record CRM activity"
  ON public.crm_activity FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.crm_company_memberships m
    WHERE m.company_id=crm_activity.company_id
      AND m.user_id=auth.uid()
      AND m.role IN ('owner','admin','office','sales')
  ));

-- Expenses are restricted to accounting and company administrators.
CREATE POLICY "Company accounting manage expenses"
  ON public.crm_expenses FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.crm_company_memberships m
    WHERE m.company_id=crm_expenses.company_id
      AND m.user_id=auth.uid()
      AND m.role IN ('owner','admin','accounting')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.crm_company_memberships m
    WHERE m.company_id=crm_expenses.company_id
      AND m.user_id=auth.uid()
      AND m.role IN ('owner','admin','accounting')
  ));

-- Invoice and payment history is read-only to authenticated accounting
-- members. Creation and settlement remain behind server-side RPCs/webhooks.
CREATE POLICY "Company accounting read invoices"
  ON public.crm_invoices FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.crm_company_memberships m
    WHERE m.company_id=crm_invoices.company_id
      AND m.user_id=auth.uid()
      AND m.role IN ('owner','admin','accounting')
  ));
CREATE POLICY "Company accounting read invoice checkouts"
  ON public.invoice_checkouts FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.crm_company_memberships m
    WHERE m.company_id=invoice_checkouts.company_id
      AND m.user_id=auth.uid()
      AND m.role IN ('owner','admin','accounting')
  ));
CREATE POLICY "Company accounting read invoice payments"
  ON public.invoice_payments FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.crm_company_memberships m
    WHERE m.company_id=invoice_payments.company_id
      AND m.user_id=auth.uid()
      AND m.role IN ('owner','admin','accounting')
  ));

-- Follow-up tasks are visible and manageable only inside the user's company.
CREATE POLICY "Company office production manage tasks"
  ON public.crm_tasks FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.crm_company_memberships m
    WHERE m.company_id=crm_tasks.company_id
      AND m.user_id=auth.uid()
      AND m.role IN ('owner','admin','office','sales','production_manager')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.crm_company_memberships m
    WHERE m.company_id=crm_tasks.company_id
      AND m.user_id=auth.uid()
      AND m.role IN ('owner','admin','office','sales','production_manager')
  ));

-- Invoice allocations and change orders are accounting workflows.
CREATE POLICY "Company accounting manage invoice allocations"
  ON public.invoice_project_links FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.crm_company_memberships m
    WHERE m.company_id=invoice_project_links.company_id
      AND m.user_id=auth.uid()
      AND m.role IN ('owner','admin','accounting')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.crm_company_memberships m
    WHERE m.company_id=invoice_project_links.company_id
      AND m.user_id=auth.uid()
      AND m.role IN ('owner','admin','accounting')
  ));
CREATE POLICY "Company accounting manage change orders"
  ON public.job_change_orders FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.crm_company_memberships m
    WHERE m.company_id=job_change_orders.company_id
      AND m.user_id=auth.uid()
      AND m.role IN ('owner','admin','accounting')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.crm_company_memberships m
    WHERE m.company_id=job_change_orders.company_id
      AND m.user_id=auth.uid()
      AND m.role IN ('owner','admin','accounting')
  ));

-- Staff can read customer messages and send staff replies. Public chat
-- endpoints use a verified per-lead token and service_role, never anon RLS.
CREATE POLICY "Company office sales read lead messages"
  ON public.lead_messages FOR SELECT TO authenticated
  USING (sender IN ('customer','owner') AND EXISTS (
    SELECT 1 FROM public.crm_company_memberships m
    WHERE m.company_id=lead_messages.company_id
      AND m.user_id=auth.uid()
      AND m.role IN ('owner','admin','office','sales')
  ));
CREATE POLICY "Company office sales reply to lead messages"
  ON public.lead_messages FOR INSERT TO authenticated
  WITH CHECK (sender='owner' AND EXISTS (
    SELECT 1 FROM public.crm_company_memberships m
    WHERE m.company_id=lead_messages.company_id
      AND m.user_id=auth.uid()
      AND m.role IN ('owner','admin','office','sales')
  ));

-- Proposal documents and estimates are available to sales/office and
-- company administrators. Public share/sign routes use capability tokens.
CREATE POLICY "Company sales manage proposal shares"
  ON public.proposal_shares FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.crm_company_memberships m
    WHERE m.company_id=proposal_shares.company_id
      AND m.user_id=auth.uid()
      AND m.role IN ('owner','admin','office','sales')
  ));
CREATE POLICY "Company sales manage proposals"
  ON public.proposals FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.crm_company_memberships m
    WHERE m.company_id=proposals.company_id
      AND m.user_id=auth.uid()
      AND m.role IN ('owner','admin','office','sales')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.crm_company_memberships m
    WHERE m.company_id=proposals.company_id
      AND m.user_id=auth.uid()
      AND m.role IN ('owner','admin','office','sales')
  ));
CREATE POLICY "Company sales manage roof estimates"
  ON public.roof_estimates FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.crm_company_memberships m
    WHERE m.company_id=roof_estimates.company_id
      AND m.user_id=auth.uid()
      AND m.role IN ('owner','admin','office','sales')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.crm_company_memberships m
    WHERE m.company_id=roof_estimates.company_id
      AND m.user_id=auth.uid()
      AND m.role IN ('owner','admin','office','sales')
  ));

-- Keep legacy role checks out of all 13 operational-table policies.
COMMENT ON POLICY "Company accounting manage expenses" ON public.crm_expenses IS
  'Expense access is limited to accounting, owner, and admin members of the owning company.';
COMMENT ON POLICY "Company accounting manage invoice allocations" ON public.invoice_project_links IS
  'Invoice allocations can only be read or changed by accounting, owner, and admin members of the invoice company.';
