-- Enforce same-company ownership for drawing references on proposals and estimates.
-- roof_drawings is property-owned rather than directly company-owned, so resolve
-- its company through the authoritative crm_properties parent on every write.
CREATE OR REPLACE FUNCTION public.enforce_company_owned_drawing_reference()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  drawing_property_id uuid;
  drawing_company_id uuid;
BEGIN
  IF NEW.drawing_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT p.id, p.company_id
    INTO drawing_property_id, drawing_company_id
  FROM public.roof_drawings d
  JOIN public.crm_properties p ON p.id = d.property_id
  WHERE d.id = NEW.drawing_id;

  IF drawing_property_id IS NULL OR drawing_company_id IS NULL THEN
    RAISE EXCEPTION 'Drawing must belong to a company-owned property';
  END IF;

  IF drawing_company_id IS DISTINCT FROM NEW.company_id THEN
    RAISE EXCEPTION 'Drawing belongs to another company';
  END IF;

  IF NEW.property_id IS NOT NULL
     AND NEW.property_id IS DISTINCT FROM drawing_property_id THEN
    RAISE EXCEPTION 'Drawing and record must reference the same property';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_company_owned_drawing_reference() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS proposals_company_drawing_guard ON public.proposals;
CREATE TRIGGER proposals_company_drawing_guard
BEFORE INSERT OR UPDATE OF drawing_id, property_id, company_id
ON public.proposals
FOR EACH ROW
EXECUTE FUNCTION public.enforce_company_owned_drawing_reference();

DROP TRIGGER IF EXISTS roof_estimates_company_drawing_guard ON public.roof_estimates;
CREATE TRIGGER roof_estimates_company_drawing_guard
BEFORE INSERT OR UPDATE OF drawing_id, property_id, company_id
ON public.roof_estimates
FOR EACH ROW
EXECUTE FUNCTION public.enforce_company_owned_drawing_reference();

COMMENT ON FUNCTION public.enforce_company_owned_drawing_reference() IS
  'Rejects proposal and roof-estimate drawing references unless the drawing property belongs to the record company and any explicit property_id matches.';
