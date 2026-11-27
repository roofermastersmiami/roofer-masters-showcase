-- Add company ownership to secondary CRM, finance, and communication records.
-- This is a data-integrity migration only. RLS replacement is a separate release gate.
-- tenant-audit: reviewed
-- Preconditions: 0042 and 0047 have been applied; exactly one verified company exists.
-- All existing rows are demonstration data and are assigned to that company.
-- No rows are deleted. Parent relationships must resolve to the same company.

DO $preflight$
DECLARE company_count bigint; company_uuid uuid; owner_uuid uuid;
BEGIN
  SELECT count(*) INTO company_count FROM public.crm_companies;
  IF company_count <> 1 THEN
    RAISE EXCEPTION '0055 requires exactly one verified Roofer Masters company; found %', company_count;
  END IF;
  SELECT id, created_by INTO company_uuid, owner_uuid
  FROM public.crm_companies ORDER BY created_at,id LIMIT 1;
  IF NOT EXISTS (SELECT 1 FROM public.crm_company_memberships
    WHERE company_id=company_uuid AND user_id=owner_uuid AND role='owner') THEN
    RAISE EXCEPTION '0055 requires the verified company creator owner membership';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.crm_expenses e LEFT JOIN public.roof_jobs j ON j.id=e.job_id
    WHERE e.job_id IS NOT NULL AND j.id IS NULL
    UNION ALL
    SELECT 1 FROM public.crm_invoices i LEFT JOIN public.crm_properties p ON p.id=i.property_id
    WHERE i.property_id IS NOT NULL AND p.id IS NULL
    UNION ALL
    SELECT 1 FROM public.crm_invoices i LEFT JOIN public.proposals p ON p.id=i.proposal_id
    WHERE i.proposal_id IS NOT NULL AND p.id IS NULL
    UNION ALL
    SELECT 1 FROM public.invoice_project_links x
      LEFT JOIN public.crm_invoices i ON i.id=x.invoice_id
      LEFT JOIN public.roof_jobs j ON j.id=x.job_id
    WHERE i.id IS NULL OR j.id IS NULL
    UNION ALL
    SELECT 1 FROM public.proposals p LEFT JOIN public.crm_properties pr ON pr.id=p.property_id
    WHERE p.property_id IS NOT NULL AND pr.id IS NULL
    UNION ALL
    SELECT 1 FROM public.proposals p LEFT JOIN public.roof_drawings d ON d.id=p.drawing_id
    WHERE p.drawing_id IS NOT NULL AND d.id IS NULL
    UNION ALL
    SELECT 1 FROM public.roof_estimates e LEFT JOIN public.roof_drawings d ON d.id=e.drawing_id
    WHERE e.drawing_id IS NOT NULL AND d.id IS NULL
    UNION ALL
    SELECT 1 FROM public.client_portal_links x LEFT JOIN public.leads l ON l.id=x.lead_id
    WHERE x.lead_id IS NOT NULL AND l.id IS NULL
    UNION ALL
    SELECT 1 FROM public.crm_activity a LEFT JOIN public.leads l ON l.id=a.lead_id
    WHERE a.lead_id IS NOT NULL AND l.id IS NULL
    UNION ALL
    SELECT 1 FROM public.crm_invoices i LEFT JOIN public.leads l ON l.id=i.lead_id
    WHERE i.lead_id IS NOT NULL AND l.id IS NULL
    UNION ALL
    SELECT 1 FROM public.crm_tasks t LEFT JOIN public.leads l ON l.id=t.lead_id
    WHERE t.lead_id IS NOT NULL AND l.id IS NULL
    UNION ALL
    SELECT 1 FROM public.invoice_checkouts x LEFT JOIN public.crm_invoices i ON i.id=x.invoice_id
    WHERE i.id IS NULL
    UNION ALL
    SELECT 1 FROM public.invoice_payments x LEFT JOIN public.crm_invoices i ON i.id=x.invoice_id
    WHERE i.id IS NULL
    UNION ALL
    SELECT 1 FROM public.job_change_orders x LEFT JOIN public.roof_jobs j ON j.id=x.job_id
    WHERE j.id IS NULL
    UNION ALL
    SELECT 1 FROM public.lead_messages x LEFT JOIN public.leads l ON l.id=x.lead_id
    WHERE x.lead_id IS NOT NULL AND l.id IS NULL
    UNION ALL
    SELECT 1 FROM public.proposal_shares x LEFT JOIN public.proposals p ON p.id=x.proposal_id
    WHERE p.id IS NULL
    UNION ALL
    SELECT 1 FROM public.proposals p LEFT JOIN public.leads l ON l.id=p.lead_id
    WHERE p.lead_id IS NOT NULL AND l.id IS NULL
    UNION ALL
    SELECT 1 FROM public.roof_estimates e LEFT JOIN public.leads l ON l.id=e.lead_id
    WHERE e.lead_id IS NOT NULL AND l.id IS NULL
    UNION ALL
    SELECT 1 FROM public.roof_estimates e LEFT JOIN public.crm_properties p ON p.id=e.property_id
    WHERE e.property_id IS NOT NULL AND p.id IS NULL
    UNION ALL
    SELECT 1 FROM public.roof_estimates e LEFT JOIN public.roof_report_orders r ON r.id=e.report_order_id
    WHERE e.report_order_id IS NOT NULL AND r.id IS NULL
    UNION ALL
    SELECT 1 FROM public.proposals p JOIN public.roof_drawings d ON d.id=p.drawing_id
    WHERE p.drawing_id IS NOT NULL AND p.property_id IS NOT NULL
      AND d.property_id IS DISTINCT FROM p.property_id
    UNION ALL
    SELECT 1 FROM public.roof_estimates e JOIN public.roof_drawings d ON d.id=e.drawing_id
    WHERE e.drawing_id IS NOT NULL AND e.property_id IS NOT NULL
      AND d.property_id IS DISTINCT FROM e.property_id
  ) THEN
    RAISE EXCEPTION '0055 found a dangling parent reference; no ownership changes were made';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.crm_invoices i
    JOIN public.crm_properties p ON p.id=i.property_id
    JOIN public.leads l ON l.id=i.lead_id
    WHERE i.property_id IS NOT NULL AND i.lead_id IS NOT NULL
      AND p.company_id IS DISTINCT FROM l.company_id
    UNION ALL
    SELECT 1 FROM public.crm_invoices i
    JOIN public.proposals p ON p.id=i.proposal_id
    JOIN public.leads l ON l.id=i.lead_id
    WHERE i.proposal_id IS NOT NULL AND i.lead_id IS NOT NULL
      AND p.lead_id IS NOT NULL AND p.lead_id IS DISTINCT FROM l.id
    UNION ALL
    SELECT 1 FROM public.invoice_project_links x
    JOIN public.crm_invoices i ON i.id=x.invoice_id
    JOIN public.roof_jobs j ON j.id=x.job_id
    WHERE i.company_id IS DISTINCT FROM j.company_id
    UNION ALL
    SELECT 1 FROM public.proposals p
    JOIN public.crm_properties pr ON pr.id=p.property_id
    JOIN public.leads l ON l.id=p.lead_id
    WHERE p.property_id IS NOT NULL AND p.lead_id IS NOT NULL
      AND pr.company_id IS DISTINCT FROM l.company_id
    UNION ALL
    SELECT 1 FROM public.roof_estimates e
    JOIN public.crm_properties p ON p.id=e.property_id
    JOIN public.leads l ON l.id=e.lead_id
    WHERE e.property_id IS NOT NULL AND e.lead_id IS NOT NULL
      AND p.company_id IS DISTINCT FROM l.company_id
    UNION ALL
    SELECT 1 FROM public.proposals p
    JOIN public.crm_properties pr ON pr.id=p.property_id
    JOIN public.roof_drawings d ON d.id=p.drawing_id
    WHERE p.property_id IS NOT NULL AND p.drawing_id IS NOT NULL
      AND pr.id IS DISTINCT FROM d.property_id
    UNION ALL
    SELECT 1 FROM public.roof_estimates e
    JOIN public.crm_properties p ON p.id=e.property_id
    JOIN public.roof_drawings d ON d.id=e.drawing_id
    WHERE e.property_id IS NOT NULL AND e.drawing_id IS NOT NULL
      AND p.id IS DISTINCT FROM d.property_id
  ) THEN
    RAISE EXCEPTION '0055 found conflicting parent ownership; resolve before retrying';
  END IF;
END
$preflight$;

ALTER TABLE public.client_portal_links ADD COLUMN IF NOT EXISTS company_id uuid;
ALTER TABLE public.crm_activity ADD COLUMN IF NOT EXISTS company_id uuid;
ALTER TABLE public.crm_expenses ADD COLUMN IF NOT EXISTS company_id uuid;
ALTER TABLE public.crm_invoices ADD COLUMN IF NOT EXISTS company_id uuid;
ALTER TABLE public.crm_tasks ADD COLUMN IF NOT EXISTS company_id uuid;
ALTER TABLE public.invoice_checkouts ADD COLUMN IF NOT EXISTS company_id uuid;
ALTER TABLE public.invoice_payments ADD COLUMN IF NOT EXISTS company_id uuid;
ALTER TABLE public.invoice_project_links ADD COLUMN IF NOT EXISTS company_id uuid;
ALTER TABLE public.job_change_orders ADD COLUMN IF NOT EXISTS company_id uuid;
ALTER TABLE public.lead_messages ADD COLUMN IF NOT EXISTS company_id uuid;
ALTER TABLE public.proposal_shares ADD COLUMN IF NOT EXISTS company_id uuid;
ALTER TABLE public.proposals ADD COLUMN IF NOT EXISTS company_id uuid;
ALTER TABLE public.roof_estimates ADD COLUMN IF NOT EXISTS company_id uuid;

-- The single-company preflight makes this an explicit, deterministic legacy-data backfill.
UPDATE public.client_portal_links SET company_id=(SELECT id FROM public.crm_companies LIMIT 1) WHERE company_id IS NULL;
UPDATE public.crm_activity SET company_id=(SELECT id FROM public.crm_companies LIMIT 1) WHERE company_id IS NULL;
UPDATE public.crm_expenses SET company_id=(SELECT id FROM public.crm_companies LIMIT 1) WHERE company_id IS NULL;
UPDATE public.crm_invoices SET company_id=(SELECT id FROM public.crm_companies LIMIT 1) WHERE company_id IS NULL;
UPDATE public.crm_tasks SET company_id=(SELECT id FROM public.crm_companies LIMIT 1) WHERE company_id IS NULL;
UPDATE public.invoice_checkouts SET company_id=(SELECT id FROM public.crm_companies LIMIT 1) WHERE company_id IS NULL;
UPDATE public.invoice_payments SET company_id=(SELECT id FROM public.crm_companies LIMIT 1) WHERE company_id IS NULL;
UPDATE public.invoice_project_links SET company_id=(SELECT id FROM public.crm_companies LIMIT 1) WHERE company_id IS NULL;
UPDATE public.job_change_orders SET company_id=(SELECT id FROM public.crm_companies LIMIT 1) WHERE company_id IS NULL;
UPDATE public.lead_messages SET company_id=(SELECT id FROM public.crm_companies LIMIT 1) WHERE company_id IS NULL;
UPDATE public.proposal_shares SET company_id=(SELECT id FROM public.crm_companies LIMIT 1) WHERE company_id IS NULL;
UPDATE public.proposals SET company_id=(SELECT id FROM public.crm_companies LIMIT 1) WHERE company_id IS NULL;
UPDATE public.roof_estimates SET company_id=(SELECT id FROM public.crm_companies LIMIT 1) WHERE company_id IS NULL;

DO $verify$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.client_portal_links WHERE company_id IS NULL
    UNION ALL SELECT 1 FROM public.crm_activity WHERE company_id IS NULL
    UNION ALL SELECT 1 FROM public.crm_expenses WHERE company_id IS NULL
    UNION ALL SELECT 1 FROM public.crm_invoices WHERE company_id IS NULL
    UNION ALL SELECT 1 FROM public.crm_tasks WHERE company_id IS NULL
    UNION ALL SELECT 1 FROM public.invoice_checkouts WHERE company_id IS NULL
    UNION ALL SELECT 1 FROM public.invoice_payments WHERE company_id IS NULL
    UNION ALL SELECT 1 FROM public.invoice_project_links WHERE company_id IS NULL
    UNION ALL SELECT 1 FROM public.job_change_orders WHERE company_id IS NULL
    UNION ALL SELECT 1 FROM public.lead_messages WHERE company_id IS NULL
    UNION ALL SELECT 1 FROM public.proposal_shares WHERE company_id IS NULL
    UNION ALL SELECT 1 FROM public.proposals WHERE company_id IS NULL
    UNION ALL SELECT 1 FROM public.roof_estimates WHERE company_id IS NULL
  ) THEN RAISE EXCEPTION '0055 ownership backfill incomplete'; END IF;
END
$verify$;

ALTER TABLE public.client_portal_links ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE public.crm_activity ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE public.crm_expenses ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE public.crm_invoices ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE public.crm_tasks ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE public.invoice_checkouts ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE public.invoice_payments ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE public.invoice_project_links ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE public.job_change_orders ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE public.lead_messages ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE public.proposal_shares ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE public.proposals ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE public.roof_estimates ALTER COLUMN company_id SET NOT NULL;

ALTER TABLE public.client_portal_links ADD CONSTRAINT client_portal_links_company_fkey FOREIGN KEY(company_id) REFERENCES public.crm_companies(id) ON DELETE RESTRICT;
ALTER TABLE public.crm_activity ADD CONSTRAINT crm_activity_company_fkey FOREIGN KEY(company_id) REFERENCES public.crm_companies(id) ON DELETE RESTRICT;
ALTER TABLE public.crm_expenses ADD CONSTRAINT crm_expenses_company_fkey FOREIGN KEY(company_id) REFERENCES public.crm_companies(id) ON DELETE RESTRICT;
ALTER TABLE public.crm_invoices ADD CONSTRAINT crm_invoices_company_fkey FOREIGN KEY(company_id) REFERENCES public.crm_companies(id) ON DELETE RESTRICT;
ALTER TABLE public.crm_tasks ADD CONSTRAINT crm_tasks_company_fkey FOREIGN KEY(company_id) REFERENCES public.crm_companies(id) ON DELETE RESTRICT;
ALTER TABLE public.invoice_checkouts ADD CONSTRAINT invoice_checkouts_company_fkey FOREIGN KEY(company_id) REFERENCES public.crm_companies(id) ON DELETE RESTRICT;
ALTER TABLE public.invoice_payments ADD CONSTRAINT invoice_payments_company_fkey FOREIGN KEY(company_id) REFERENCES public.crm_companies(id) ON DELETE RESTRICT;
ALTER TABLE public.invoice_project_links ADD CONSTRAINT invoice_project_links_company_fkey FOREIGN KEY(company_id) REFERENCES public.crm_companies(id) ON DELETE RESTRICT;
ALTER TABLE public.job_change_orders ADD CONSTRAINT job_change_orders_company_fkey FOREIGN KEY(company_id) REFERENCES public.crm_companies(id) ON DELETE RESTRICT;
ALTER TABLE public.lead_messages ADD CONSTRAINT lead_messages_company_fkey FOREIGN KEY(company_id) REFERENCES public.crm_companies(id) ON DELETE RESTRICT;
ALTER TABLE public.proposal_shares ADD CONSTRAINT proposal_shares_company_fkey FOREIGN KEY(company_id) REFERENCES public.crm_companies(id) ON DELETE RESTRICT;
ALTER TABLE public.proposals ADD CONSTRAINT proposals_company_fkey FOREIGN KEY(company_id) REFERENCES public.crm_companies(id) ON DELETE RESTRICT;
ALTER TABLE public.roof_estimates ADD CONSTRAINT roof_estimates_company_fkey FOREIGN KEY(company_id) REFERENCES public.crm_companies(id) ON DELETE RESTRICT;

-- Composite parent keys make cross-company links impossible even if a caller
-- supplies valid UUIDs from two different companies.
ALTER TABLE public.crm_invoices ADD CONSTRAINT crm_invoices_id_company_key UNIQUE(id,company_id);
ALTER TABLE public.proposals ADD CONSTRAINT proposals_id_company_key UNIQUE(id,company_id);

ALTER TABLE public.client_portal_links ADD CONSTRAINT client_portal_links_lead_company_fkey FOREIGN KEY(lead_id,company_id) REFERENCES public.leads(id,company_id) ON DELETE CASCADE;
ALTER TABLE public.crm_activity ADD CONSTRAINT crm_activity_lead_company_fkey FOREIGN KEY(lead_id,company_id) REFERENCES public.leads(id,company_id) ON DELETE SET NULL (lead_id);
ALTER TABLE public.crm_expenses ADD CONSTRAINT crm_expenses_job_company_fkey FOREIGN KEY(job_id,company_id) REFERENCES public.roof_jobs(id,company_id) ON DELETE RESTRICT;
ALTER TABLE public.crm_invoices ADD CONSTRAINT crm_invoices_lead_company_fkey FOREIGN KEY(lead_id,company_id) REFERENCES public.leads(id,company_id) ON DELETE SET NULL (lead_id);
ALTER TABLE public.crm_invoices ADD CONSTRAINT crm_invoices_property_company_fkey FOREIGN KEY(property_id,company_id) REFERENCES public.crm_properties(id,company_id) ON DELETE RESTRICT;
ALTER TABLE public.crm_invoices ADD CONSTRAINT crm_invoices_proposal_company_fkey FOREIGN KEY(proposal_id,company_id) REFERENCES public.proposals(id,company_id) ON DELETE SET NULL (proposal_id);
ALTER TABLE public.crm_tasks ADD CONSTRAINT crm_tasks_lead_company_fkey FOREIGN KEY(lead_id,company_id) REFERENCES public.leads(id,company_id) ON DELETE SET NULL (lead_id);
ALTER TABLE public.invoice_checkouts ADD CONSTRAINT invoice_checkouts_invoice_company_fkey FOREIGN KEY(invoice_id,company_id) REFERENCES public.crm_invoices(id,company_id) ON DELETE CASCADE;
ALTER TABLE public.invoice_payments ADD CONSTRAINT invoice_payments_invoice_company_fkey FOREIGN KEY(invoice_id,company_id) REFERENCES public.crm_invoices(id,company_id) ON DELETE RESTRICT;
ALTER TABLE public.invoice_project_links ADD CONSTRAINT invoice_project_links_invoice_company_fkey FOREIGN KEY(invoice_id,company_id) REFERENCES public.crm_invoices(id,company_id) ON DELETE CASCADE;
ALTER TABLE public.invoice_project_links ADD CONSTRAINT invoice_project_links_job_company_fkey FOREIGN KEY(job_id,company_id) REFERENCES public.roof_jobs(id,company_id) ON DELETE CASCADE;
ALTER TABLE public.job_change_orders ADD CONSTRAINT job_change_orders_job_company_fkey FOREIGN KEY(job_id,company_id) REFERENCES public.roof_jobs(id,company_id) ON DELETE CASCADE;
ALTER TABLE public.lead_messages ADD CONSTRAINT lead_messages_lead_company_fkey FOREIGN KEY(lead_id,company_id) REFERENCES public.leads(id,company_id) ON DELETE CASCADE;
ALTER TABLE public.proposal_shares ADD CONSTRAINT proposal_shares_proposal_company_fkey FOREIGN KEY(proposal_id,company_id) REFERENCES public.proposals(id,company_id) ON DELETE CASCADE;
ALTER TABLE public.proposals ADD CONSTRAINT proposals_lead_company_fkey FOREIGN KEY(lead_id,company_id) REFERENCES public.leads(id,company_id) ON DELETE SET NULL (lead_id);
ALTER TABLE public.proposals ADD CONSTRAINT proposals_property_company_fkey FOREIGN KEY(property_id,company_id) REFERENCES public.crm_properties(id,company_id) ON DELETE RESTRICT;
ALTER TABLE public.roof_estimates ADD CONSTRAINT roof_estimates_lead_company_fkey FOREIGN KEY(lead_id,company_id) REFERENCES public.leads(id,company_id) ON DELETE SET NULL (lead_id);
ALTER TABLE public.roof_estimates ADD CONSTRAINT roof_estimates_property_company_fkey FOREIGN KEY(property_id,company_id) REFERENCES public.crm_properties(id,company_id) ON DELETE RESTRICT;
ALTER TABLE public.roof_estimates ADD CONSTRAINT roof_estimates_report_company_fkey FOREIGN KEY(report_order_id,company_id) REFERENCES public.roof_report_orders(id,company_id) ON DELETE SET NULL (report_order_id);

CREATE INDEX IF NOT EXISTS client_portal_links_company_id_idx ON public.client_portal_links(company_id);
CREATE INDEX IF NOT EXISTS crm_activity_company_id_idx ON public.crm_activity(company_id);
CREATE INDEX IF NOT EXISTS crm_expenses_company_id_idx ON public.crm_expenses(company_id);
CREATE INDEX IF NOT EXISTS crm_invoices_company_id_idx ON public.crm_invoices(company_id);
CREATE INDEX IF NOT EXISTS crm_tasks_company_id_idx ON public.crm_tasks(company_id);
CREATE INDEX IF NOT EXISTS invoice_checkouts_company_id_idx ON public.invoice_checkouts(company_id);
CREATE INDEX IF NOT EXISTS invoice_payments_company_id_idx ON public.invoice_payments(company_id);
CREATE INDEX IF NOT EXISTS invoice_project_links_company_id_idx ON public.invoice_project_links(company_id);
CREATE INDEX IF NOT EXISTS job_change_orders_company_id_idx ON public.job_change_orders(company_id);
CREATE INDEX IF NOT EXISTS lead_messages_company_id_idx ON public.lead_messages(company_id);
CREATE INDEX IF NOT EXISTS proposal_shares_company_id_idx ON public.proposal_shares(company_id);
CREATE INDEX IF NOT EXISTS proposals_company_id_idx ON public.proposals(company_id);
CREATE INDEX IF NOT EXISTS roof_estimates_company_id_idx ON public.roof_estimates(company_id);

COMMENT ON COLUMN public.proposals.company_id IS 'Owning company; parent drawing/property consistency is validated in the authorization cutover.';
COMMENT ON COLUMN public.roof_estimates.company_id IS 'Owning company; parent drawing consistency is validated in the authorization cutover.';
