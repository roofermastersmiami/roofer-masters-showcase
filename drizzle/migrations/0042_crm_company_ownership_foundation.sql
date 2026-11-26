-- Establish company ownership and same-company parent relationships for core CRM records.
-- This is a preparatory data-integrity migration, NOT the tenant-isolation release gate.
-- Existing global-role RLS policies remain unchanged until the membership backfill and
-- policy/RPC/storage replacement are reviewed together in later migrations.

DO $preflight$
DECLARE
  company_count bigint;
  company_uuid uuid;
  owner_uuid uuid;
BEGIN
  SELECT count(*) INTO company_count FROM public.crm_companies;
  IF company_count <> 1 THEN
    RAISE EXCEPTION
      'Migration 0042 requires exactly one verified legacy company; found %. Resolve company ownership mapping before applying.',
      company_count;
  END IF;

  SELECT id, created_by INTO company_uuid, owner_uuid
  FROM public.crm_companies
  ORDER BY created_at, id
  LIMIT 1;

  IF NOT EXISTS (
    SELECT 1 FROM public.crm_company_memberships
    WHERE company_id = company_uuid
      AND user_id = owner_uuid
      AND role = 'owner'
  ) THEN
    RAISE EXCEPTION
      'Migration 0042 requires the company creator to have an owner membership. No data was changed.';
  END IF;
END
$preflight$;

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS company_id uuid;
ALTER TABLE public.crm_customers
  ADD COLUMN IF NOT EXISTS company_id uuid;
ALTER TABLE public.crm_properties
  ADD COLUMN IF NOT EXISTS company_id uuid;
ALTER TABLE public.roof_report_orders
  ADD COLUMN IF NOT EXISTS company_id uuid;

-- A single company is an explicit precondition above, so this backfill assigns
-- the existing single-tenant dataset without guessing from email or record text.
UPDATE public.leads
SET company_id = (SELECT id FROM public.crm_companies LIMIT 1)
WHERE company_id IS NULL;
UPDATE public.crm_customers
SET company_id = (SELECT id FROM public.crm_companies LIMIT 1)
WHERE company_id IS NULL;
UPDATE public.crm_properties
SET company_id = (SELECT id FROM public.crm_companies LIMIT 1)
WHERE company_id IS NULL;
UPDATE public.roof_report_orders
SET company_id = (SELECT id FROM public.crm_companies LIMIT 1)
WHERE company_id IS NULL;

DO $verify$
BEGIN
  IF EXISTS (SELECT 1 FROM public.leads WHERE company_id IS NULL)
     OR EXISTS (SELECT 1 FROM public.crm_customers WHERE company_id IS NULL)
     OR EXISTS (SELECT 1 FROM public.crm_properties WHERE company_id IS NULL)
     OR EXISTS (SELECT 1 FROM public.roof_report_orders WHERE company_id IS NULL) THEN
    RAISE EXCEPTION 'Migration 0042 backfill incomplete; refusing NOT NULL constraints';
  END IF;
END
$verify$;

ALTER TABLE public.leads ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE public.crm_customers ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE public.crm_properties ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE public.roof_report_orders ALTER COLUMN company_id SET NOT NULL;

ALTER TABLE public.leads
  ADD CONSTRAINT leads_company_id_fkey
  FOREIGN KEY (company_id) REFERENCES public.crm_companies(id) ON DELETE RESTRICT;
ALTER TABLE public.crm_customers
  ADD CONSTRAINT crm_customers_company_id_fkey
  FOREIGN KEY (company_id) REFERENCES public.crm_companies(id) ON DELETE RESTRICT;
ALTER TABLE public.crm_properties
  ADD CONSTRAINT crm_properties_company_id_fkey
  FOREIGN KEY (company_id) REFERENCES public.crm_companies(id) ON DELETE RESTRICT;
ALTER TABLE public.roof_report_orders
  ADD CONSTRAINT roof_report_orders_company_id_fkey
  FOREIGN KEY (company_id) REFERENCES public.crm_companies(id) ON DELETE RESTRICT;

-- Composite unique keys let PostgreSQL enforce tenant consistency for parent links.
ALTER TABLE public.leads
  ADD CONSTRAINT leads_id_company_id_key UNIQUE (id, company_id);
ALTER TABLE public.crm_customers
  ADD CONSTRAINT crm_customers_id_company_id_key UNIQUE (id, company_id);
ALTER TABLE public.crm_properties
  ADD CONSTRAINT crm_properties_id_company_id_key UNIQUE (id, company_id);

-- A customer and its source lead must belong to the same company.
ALTER TABLE public.crm_customers
  ADD CONSTRAINT crm_customers_source_lead_company_fkey
  FOREIGN KEY (source_lead_id, company_id)
  REFERENCES public.leads(id, company_id) ON DELETE RESTRICT;

-- Lead/customer reverse links cannot cross company boundaries.
ALTER TABLE public.leads
  ADD CONSTRAINT leads_customer_company_fkey
  FOREIGN KEY (customer_id, company_id)
  REFERENCES public.crm_customers(id, company_id) ON DELETE RESTRICT;

ALTER TABLE public.crm_properties
  ADD CONSTRAINT crm_properties_customer_company_fkey
  FOREIGN KEY (customer_id, company_id)
  REFERENCES public.crm_customers(id, company_id) ON DELETE CASCADE;

ALTER TABLE public.roof_report_orders
  ADD CONSTRAINT roof_report_orders_customer_company_fkey
  FOREIGN KEY (customer_id, company_id)
  REFERENCES public.crm_customers(id, company_id) ON DELETE RESTRICT;
ALTER TABLE public.roof_report_orders
  ADD CONSTRAINT roof_report_orders_property_company_fkey
  FOREIGN KEY (property_id, company_id)
  REFERENCES public.crm_properties(id, company_id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS leads_company_id_idx ON public.leads(company_id);
CREATE INDEX IF NOT EXISTS crm_customers_company_id_idx ON public.crm_customers(company_id);
CREATE INDEX IF NOT EXISTS crm_properties_company_id_idx ON public.crm_properties(company_id);
CREATE INDEX IF NOT EXISTS roof_report_orders_company_id_idx ON public.roof_report_orders(company_id);

COMMENT ON COLUMN public.leads.company_id IS
  'Owning CRM company. RLS still uses legacy role policies until the tenant authorization release gate is completed.';
COMMENT ON COLUMN public.crm_customers.company_id IS
  'Owning CRM company. Same-company lead/property/report relationships are enforced by composite foreign keys.';
COMMENT ON COLUMN public.crm_properties.company_id IS
  'Owning CRM company. Same-company customer relationship is enforced by composite foreign key.';
COMMENT ON COLUMN public.roof_report_orders.company_id IS
  'Owning CRM company. Same-company customer and property relationships are enforced by composite foreign keys.';

