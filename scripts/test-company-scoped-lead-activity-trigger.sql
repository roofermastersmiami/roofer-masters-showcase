\set ON_ERROR_STOP on
CREATE TABLE public.leads (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL,
  name text NOT NULL,
  pipeline_stage text
);
CREATE TABLE public.crm_activity (
  id bigserial PRIMARY KEY,
  lead_id uuid NOT NULL,
  company_id uuid NOT NULL,
  kind text NOT NULL,
  body text NOT NULL
);

\i drizzle/migrations/0060_company_scoped_lead_activity_trigger.sql

CREATE TRIGGER crm_lead_activity
AFTER INSERT OR UPDATE OF pipeline_stage ON public.leads
FOR EACH ROW EXECUTE FUNCTION public.log_crm_lead_activity();

INSERT INTO public.leads (id, company_id, name, pipeline_stage)
VALUES
  ('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'Roofer Masters demo lead', 'new'),
  ('10000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'Second tenant demo lead', 'new');

DO $$
BEGIN
  IF (SELECT count(*) FROM public.crm_activity) <> 2 THEN
    RAISE EXCEPTION 'Expected one automatic activity per inserted lead';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.crm_activity a
    JOIN public.leads l ON l.id = a.lead_id
    WHERE a.company_id IS DISTINCT FROM l.company_id
  ) THEN
    RAISE EXCEPTION 'Insert activity did not inherit source lead company';
  END IF;
END;
$$;

UPDATE public.leads
SET pipeline_stage = 'qualified'
WHERE id = '10000000-0000-4000-8000-000000000001';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.crm_activity
    WHERE lead_id = '10000000-0000-4000-8000-000000000001'
      AND company_id = '20000000-0000-4000-8000-000000000001'
      AND kind = 'stage'
      AND body = 'Sales stage manually recorded: qualified'
  ) THEN
    RAISE EXCEPTION 'Stage-change activity missing or assigned to wrong company';
  END IF;
  IF (SELECT count(*) FROM public.crm_activity WHERE company_id = '20000000-0000-4000-8000-000000000002') <> 1 THEN
    RAISE EXCEPTION 'Activity from the second tenant was changed unexpectedly';
  END IF;
END;
$$;

SELECT 'PASS: lead insert and stage activity inherit the correct company' AS result;
