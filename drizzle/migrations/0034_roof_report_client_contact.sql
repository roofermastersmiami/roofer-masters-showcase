-- Store client contact details with each address-first roof report and keep
-- the linked CRM customer/lead in sync for future documents.
ALTER TABLE public.roof_report_orders
  ADD COLUMN IF NOT EXISTS customer_phone text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS customer_email text NOT NULL DEFAULT '';

CREATE OR REPLACE FUNCTION public.create_roof_report_request(
  p_address text,
  p_title text,
  p_provider text,
  p_notes text,
  p_customer_phone text,
  p_customer_email text
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
  client_name text := trim(coalesce(p_title, ''));
  client_phone text := trim(coalesce(p_customer_phone, ''));
  client_email text := lower(trim(coalesce(p_customer_email, '')));
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['office','sales']::public.app_role[]) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  IF length(trim(coalesce(p_address,''))) < 8 OR length(p_address) > 250
     OR length(client_name) < 2 OR length(client_name) > 180
     OR length(client_phone) > 30 OR length(client_email) > 255
     OR (client_email <> '' AND client_email !~* '^[A-Z0-9._%+\\-]+@[A-Z0-9.\\-]+\\.[A-Z]{2,}$')
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
    VALUES (client_name, client_phone, nullif(client_email, ''), trim(p_address), 'contact', 'roof-report')
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
  ELSE
    UPDATE public.crm_customers
    SET name = client_name, phone = client_phone, email = client_email
    WHERE id = customer_uuid
    RETURNING source_lead_id INTO lead_uuid;

    IF lead_uuid IS NOT NULL THEN
      UPDATE public.leads
      SET name = client_name, phone = client_phone, email = nullif(client_email, '')
      WHERE id = lead_uuid;
    END IF;
  END IF;

  IF property_uuid IS NULL OR customer_uuid IS NULL THEN
    RAISE EXCEPTION 'Could not create or find the property record';
  END IF;

  INSERT INTO public.roof_report_orders(
    customer_id, property_id, address, title, provider, notes, customer_phone, customer_email
  )
  VALUES (
    customer_uuid, property_uuid, trim(p_address), client_name, p_provider, p_notes, client_phone, client_email
  )
  RETURNING id INTO request_uuid;

  RETURN request_uuid;
END;
$$;

REVOKE ALL ON FUNCTION public.create_roof_report_request(text,text,text,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_roof_report_request(text,text,text,text,text,text) TO authenticated;
NOTIFY pgrst, 'reload schema';
