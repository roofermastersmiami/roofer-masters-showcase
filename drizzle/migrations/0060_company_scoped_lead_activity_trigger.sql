-- Preserve automatic lead activity logging after secondary CRM ownership becomes mandatory.
-- tenant-audit: reviewed — trigger derives company_id exclusively from NEW.company_id on the source lead; it never accepts caller-supplied activity ownership.
-- Requires the company_id column on leads and crm_activity from migrations 0042 and 0055.

CREATE OR REPLACE FUNCTION public.log_crm_lead_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.company_id IS NULL THEN
    RAISE EXCEPTION 'Lead company ownership is required for activity logging';
  END IF;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.crm_activity (lead_id, company_id, kind, body)
    VALUES (NEW.id, NEW.company_id, 'lead', 'New lead received: ' || NEW.name);
  ELSIF NEW.pipeline_stage IS DISTINCT FROM OLD.pipeline_stage THEN
    INSERT INTO public.crm_activity (lead_id, company_id, kind, body)
    VALUES (
      NEW.id,
      NEW.company_id,
      'stage',
      'Sales stage manually recorded: ' || NEW.pipeline_stage
    );
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.log_crm_lead_activity() IS
  'Writes lead activity with company_id inherited from the source lead; requires migrations 0042 and 0055.';
