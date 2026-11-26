-- Add company ownership and same-company parent constraints to roof jobs.
-- Depends on 0042. Data integrity only: legacy RLS remains unchanged, and
-- crew authorization/storage isolation are separate release requirements.
-- Jobs inherit company from their lead/property. Orphaned or conflicting
-- relationships fail closed; parentless jobs use the sole verified legacy company.

DO $preflight$
DECLARE
  company_count bigint;
BEGIN
  SELECT count(*) INTO company_count FROM public.crm_companies;
  IF company_count <> 1 THEN
    RAISE EXCEPTION
      'Migration 0047 requires exactly one verified legacy company; found %.',
      company_count;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.roof_jobs j
    LEFT JOIN public.leads l ON l.id = j.lead_id
    LEFT JOIN public.crm_properties p ON p.id = j.property_id
    WHERE (j.lead_id IS NOT NULL AND l.id IS NULL)
       OR (j.property_id IS NOT NULL AND p.id IS NULL)
       OR (l.id IS NOT NULL AND p.id IS NOT NULL
           AND l.company_id IS DISTINCT FROM p.company_id)
  ) THEN
    RAISE EXCEPTION
      'Migration 0047 found a dangling or cross-company job parent. Resolve job links before retrying.';
  END IF;
END
$preflight$;

ALTER TABLE public.roof_jobs
  ADD COLUMN IF NOT EXISTS company_id uuid;

UPDATE public.roof_jobs j
SET company_id = COALESCE(
  (SELECT l.company_id FROM public.leads l WHERE l.id = j.lead_id),
  (SELECT p.company_id FROM public.crm_properties p WHERE p.id = j.property_id),
  (SELECT c.id FROM public.crm_companies c ORDER BY c.created_at, c.id LIMIT 1)
)
WHERE j.company_id IS NULL;

DO $verify$
BEGIN
  IF EXISTS (SELECT 1 FROM public.roof_jobs WHERE company_id IS NULL) THEN
    RAISE EXCEPTION 'Migration 0047 could not assign company ownership to every roof job.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.roof_jobs j
    JOIN public.leads l ON l.id = j.lead_id
    WHERE j.company_id IS DISTINCT FROM l.company_id
  ) OR EXISTS (
    SELECT 1 FROM public.roof_jobs j
    JOIN public.crm_properties p ON p.id = j.property_id
    WHERE j.company_id IS DISTINCT FROM p.company_id
  ) THEN
    RAISE EXCEPTION 'Migration 0047 detected a cross-company job parent after backfill.';
  END IF;
END
$verify$;

ALTER TABLE public.roof_jobs
  ALTER COLUMN company_id SET NOT NULL;

ALTER TABLE public.roof_jobs
  ADD CONSTRAINT roof_jobs_company_id_fkey
  FOREIGN KEY (company_id) REFERENCES public.crm_companies(id) ON DELETE RESTRICT;

ALTER TABLE public.roof_jobs
  ADD CONSTRAINT roof_jobs_id_company_id_key UNIQUE (id, company_id);

ALTER TABLE public.roof_jobs
  ADD CONSTRAINT roof_jobs_lead_company_fkey
  FOREIGN KEY (lead_id, company_id)
  REFERENCES public.leads(id, company_id) ON DELETE RESTRICT;

ALTER TABLE public.roof_jobs
  ADD CONSTRAINT roof_jobs_property_company_fkey
  FOREIGN KEY (property_id, company_id)
  REFERENCES public.crm_properties(id, company_id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS roof_jobs_company_id_idx
  ON public.roof_jobs(company_id);

COMMENT ON COLUMN public.roof_jobs.company_id IS
  'Owning CRM company. Lead and property parent links are constrained to the same company; RLS and crew/storage authorization remain separate release requirements.';
