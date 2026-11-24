-- Repair deployments where the address-first roof-report RPC was not exposed
-- to PostgREST. This idempotently restores the exact named-argument signature
-- used by src/lib/roof-orders.functions.ts.
CREATE OR REPLACE FUNCTION public.create_roof_report_request(
  p_address text,
  p_title text,
  p_provider text,
  p_notes text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $$
DECLARE
  property_uuid uuid;
  customer_uuid uuid;
  request_uuid uuid;
  lead_uuid uuid;
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['office','sales']::public.app_role[]) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  IF length(trim(coalesce(p_address,''))) < 8 OR length(p_address) > 250
     OR length(trim(coalesce(p_title,''))) < 1 OR length(p_title) > 180
     OR p_provider NOT IN ('manual','eagleview','gaf','roofr','hover','other')
     OR length(coalesce(p_notes,'')) > 4000 THEN
    RAISE EXCEPTION 'Invalid report request';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    lower(regexp_replace(trim(p_address), '\\s+', ' ', 'g')), 0
  ));

  SELECT id, customer_id INTO property_uuid, customer_uuid
  FROM public.crm_properties
  WHERE lower(regexp_replace(trim(address), '\\s+', ' ', 'g')) =
        lower(regexp_replace(trim(p_address), '\\s+', ' ', 'g'))
  ORDER BY created_at
  LIMIT 1;

  IF property_uuid IS NULL THEN
    INSERT INTO public.leads(name, phone, email, address, source, page)
    VALUES ('Property inquiry', '', NULL, trim(p_address), 'contact', 'roof-report')
    RETURNING id INTO lead_uuid;

    SELECT id INTO customer_uuid
    FROM public.crm_customers
    WHERE source_lead_id = lead_uuid;

    SELECT id INTO property_uuid
    FROM public.crm_properties
    WHERE customer_id = customer_uuid
      AND lower(regexp_replace(trim(address), '\\s+', ' ', 'g')) =
          lower(regexp_replace(trim(p_address), '\\s+', ' ', 'g'))
    LIMIT 1;
  END IF;

  IF property_uuid IS NULL OR customer_uuid IS NULL THEN
    RAISE EXCEPTION 'Could not create or find the property record';
  END IF;

  INSERT INTO public.roof_report_orders(customer_id, property_id, address, title, provider, notes)
  VALUES (customer_uuid, property_uuid, trim(p_address), trim(p_title), p_provider, p_notes)
  RETURNING id INTO request_uuid;

  RETURN request_uuid;
END;
$$;
REVOKE ALL ON FUNCTION public.create_roof_report_request(text,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_roof_report_request(text,text,text,text) TO authenticated;

NOTIFY pgrst, 'reload schema';
