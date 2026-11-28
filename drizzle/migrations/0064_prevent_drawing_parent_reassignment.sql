-- Prevent parent reassignment from invalidating existing tenant-owned drawing references.
-- tenant-audit: reviewed — parent mutation triggers and SHARE locks keep proposal/estimate drawing ownership consistent under concurrent writes.
-- A drawing inherits company ownership from crm_properties. Guard both sides
-- of that relationship: moving a drawing, or changing its property's company.

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
  WHERE d.id = NEW.drawing_id
  FOR SHARE OF d, p;

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

CREATE OR REPLACE FUNCTION public.prevent_referenced_drawing_reassignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  next_company_id uuid;
BEGIN
  IF NEW.property_id IS NOT DISTINCT FROM OLD.property_id THEN
    RETURN NEW;
  END IF;

  IF NEW.property_id IS NOT NULL THEN
    SELECT company_id INTO next_company_id
    FROM public.crm_properties
    WHERE id = NEW.property_id
    FOR SHARE;
  END IF;

  IF next_company_id IS NULL AND (
    EXISTS (SELECT 1 FROM public.proposals WHERE drawing_id = OLD.id)
    OR EXISTS (SELECT 1 FROM public.roof_estimates WHERE drawing_id = OLD.id)
  ) THEN
    RAISE EXCEPTION 'A referenced drawing cannot be moved to a property without company ownership';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.proposals p
    WHERE p.drawing_id = OLD.id
      AND (
        p.company_id IS DISTINCT FROM next_company_id
        OR (p.property_id IS NOT NULL AND p.property_id IS DISTINCT FROM NEW.property_id)
      )
  ) OR EXISTS (
    SELECT 1 FROM public.roof_estimates e
    WHERE e.drawing_id = OLD.id
      AND (
        e.company_id IS DISTINCT FROM next_company_id
        OR (e.property_id IS NOT NULL AND e.property_id IS DISTINCT FROM NEW.property_id)
      )
  ) THEN
    RAISE EXCEPTION 'Cannot reassign a drawing while proposals or estimates reference its current company/property';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.prevent_referenced_property_company_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.company_id IS NOT DISTINCT FROM OLD.company_id THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.roof_drawings d
    JOIN public.proposals p ON p.drawing_id = d.id
    WHERE d.property_id = OLD.id
      AND p.company_id IS DISTINCT FROM NEW.company_id
  ) OR EXISTS (
    SELECT 1
    FROM public.roof_drawings d
    JOIN public.roof_estimates e ON e.drawing_id = d.id
    WHERE d.property_id = OLD.id
      AND e.company_id IS DISTINCT FROM NEW.company_id
  ) THEN
    RAISE EXCEPTION 'Cannot change property company while referenced drawings are attached to proposals or estimates';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_company_owned_drawing_reference() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prevent_referenced_drawing_reassignment() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prevent_referenced_property_company_change() FROM PUBLIC;

DROP TRIGGER IF EXISTS roof_drawings_company_reassignment_guard ON public.roof_drawings;
CREATE TRIGGER roof_drawings_company_reassignment_guard
BEFORE UPDATE OF property_id ON public.roof_drawings
FOR EACH ROW
EXECUTE FUNCTION public.prevent_referenced_drawing_reassignment();

DROP TRIGGER IF EXISTS crm_properties_drawing_company_reassignment_guard ON public.crm_properties;
CREATE TRIGGER crm_properties_drawing_company_reassignment_guard
BEFORE UPDATE OF company_id ON public.crm_properties
FOR EACH ROW
EXECUTE FUNCTION public.prevent_referenced_property_company_change();

COMMENT ON FUNCTION public.prevent_referenced_drawing_reassignment() IS
  'Prevents changing the property of a drawing when existing proposal or estimate references would become cross-company or cross-property.';
COMMENT ON FUNCTION public.prevent_referenced_property_company_change() IS
  'Prevents changing a property company when a drawing referenced by a proposal or estimate would become cross-company.';
