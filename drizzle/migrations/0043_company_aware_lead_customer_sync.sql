-- Keep the legacy lead -> customer/property fan-out compatible with company ownership.
-- This migration depends on 0042 and must be applied only after 0042 is reconciled
-- against the production schema. It does not change RLS or enable tenant onboarding.

CREATE OR REPLACE FUNCTION public.sync_lead_customer()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cid uuid;
BEGIN
  IF NEW.company_id IS NULL THEN
    RAISE EXCEPTION 'Lead company ownership is required';
  END IF;

  cid := coalesce(NEW.customer_id, NEW.id);

  INSERT INTO public.crm_customers (
    id, source_lead_id, company_id, name, phone, email
  )
  VALUES (
    cid, NEW.id, NEW.company_id, NEW.name,
    coalesce(NEW.phone, ''), coalesce(NEW.email, '')
  )
  ON CONFLICT (id) DO UPDATE
  SET
    name = EXCLUDED.name,
    phone = EXCLUDED.phone,
    email = EXCLUDED.email
  WHERE public.crm_customers.company_id = EXCLUDED.company_id;

  IF NEW.customer_id IS NULL THEN
    UPDATE public.leads
    SET customer_id = cid
    WHERE id = NEW.id
      AND company_id = NEW.company_id;
  END IF;

  IF NEW.address IS NOT NULL AND length(trim(NEW.address)) > 0 THEN
    INSERT INTO public.crm_properties (
      customer_id, company_id, address
    )
    VALUES (cid, NEW.company_id, NEW.address)
    ON CONFLICT (customer_id, address) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.sync_lead_customer() IS
  'Creates/updates the CRM customer and property using the source lead company_id; requires migration 0042.';
