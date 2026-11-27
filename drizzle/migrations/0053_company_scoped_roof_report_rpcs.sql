-- Company-scope every roof-report creation and drawing-save RPC.
-- Forward-only migration; depends on company ownership (0042), company-aware
-- lead synchronization (0043), and company-owned roof jobs (0047).
-- Caller company IDs are never accepted. Actor company is derived from auth.uid().
-- tenant-audit: reviewed
-- Security review: all SECURITY DEFINER RPCs derive the actor company from auth.uid(),
-- checks; report/property/revision parents are tenant-verified before writes.
-- EXECUTE is revoked from PUBLIC/anon/service_role and granted only to authenticated.
-- Public intake remains isolated in capture_instant_roof_lead (service_role only).

CREATE OR REPLACE FUNCTION public.create_roof_report_request(
  p_address text, p_title text, p_provider text, p_notes text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  actor_company_id uuid;
  actor_role text;
  property_uuid uuid;
  customer_uuid uuid;
  request_uuid uuid;
  lead_uuid uuid;
  membership_count integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT count(*) INTO membership_count FROM public.crm_company_memberships WHERE user_id = auth.uid();
  IF membership_count <> 1 THEN RAISE EXCEPTION 'A single company membership is required'; END IF;
  SELECT company_id, role INTO actor_company_id, actor_role
  FROM public.crm_company_memberships WHERE user_id = auth.uid();
  IF actor_company_id IS NULL OR actor_role NOT IN ('owner','admin','office','sales','production_manager') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  IF length(trim(coalesce(p_address,''))) < 8 OR length(p_address) > 250
     OR length(trim(coalesce(p_title,''))) < 1 OR length(p_title) > 180
     OR p_provider NOT IN ('manual','eagleview','gaf','roofr','hover','other')
     OR length(coalesce(p_notes,'')) > 4000 THEN
    RAISE EXCEPTION 'Invalid report request';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    actor_company_id::text || ':' ||
    lower(regexp_replace(trim(p_address), '\\s+', ' ', 'g')), 0
  ));

  SELECT id, customer_id INTO property_uuid, customer_uuid
  FROM public.crm_properties
  WHERE company_id = actor_company_id
    AND lower(regexp_replace(trim(address), '\\s+', ' ', 'g')) =
        lower(regexp_replace(trim(p_address), '\\s+', ' ', 'g'))
  ORDER BY created_at LIMIT 1;

  IF property_uuid IS NULL THEN
    INSERT INTO public.leads(company_id,name,phone,email,address,source,page)
    VALUES(actor_company_id,'Property inquiry','',NULL,trim(p_address),'contact','roof-report')
    RETURNING id INTO lead_uuid;
    SELECT id INTO customer_uuid FROM public.crm_customers
    WHERE source_lead_id = lead_uuid AND company_id = actor_company_id;
    SELECT id INTO property_uuid FROM public.crm_properties
    WHERE customer_id = customer_uuid AND company_id = actor_company_id
      AND lower(regexp_replace(trim(address), '\\s+', ' ', 'g')) =
          lower(regexp_replace(trim(p_address), '\\s+', ' ', 'g'))
    LIMIT 1;
  END IF;

  IF property_uuid IS NULL OR customer_uuid IS NULL THEN
    RAISE EXCEPTION 'Could not create or find the property record';
  END IF;
  INSERT INTO public.roof_report_orders(company_id,customer_id,property_id,address,title,provider,notes)
  VALUES(actor_company_id,customer_uuid,property_uuid,trim(p_address),trim(p_title),p_provider,p_notes)
  RETURNING id INTO request_uuid;
  RETURN request_uuid;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_roof_report_request(
  p_address text, p_title text, p_provider text, p_notes text,
  p_customer_phone text, p_customer_email text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  actor_company_id uuid;
  actor_role text;
  property_uuid uuid;
  customer_uuid uuid;
  request_uuid uuid;
  lead_uuid uuid;
  client_name text := trim(coalesce(p_title,''));
  client_phone text := trim(coalesce(p_customer_phone,''));
  client_email text := lower(trim(coalesce(p_customer_email,'')));
  membership_count integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT count(*) INTO membership_count FROM public.crm_company_memberships WHERE user_id = auth.uid();
  IF membership_count <> 1 THEN RAISE EXCEPTION 'A single company membership is required'; END IF;
  SELECT company_id, role INTO actor_company_id, actor_role
  FROM public.crm_company_memberships WHERE user_id = auth.uid();
  IF actor_company_id IS NULL OR actor_role NOT IN ('owner','admin','office','sales','production_manager') THEN
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
    actor_company_id::text || ':' ||
    lower(regexp_replace(trim(p_address), '\\s+', ' ', 'g')), 0
  ));
  SELECT id, customer_id INTO property_uuid, customer_uuid
  FROM public.crm_properties
  WHERE company_id = actor_company_id
    AND lower(regexp_replace(trim(address), '\\s+', ' ', 'g')) =
        lower(regexp_replace(trim(p_address), '\\s+', ' ', 'g'))
  ORDER BY created_at LIMIT 1;

  IF property_uuid IS NULL THEN
    INSERT INTO public.leads(company_id,name,phone,email,address,source,page)
    VALUES(actor_company_id,client_name,client_phone,nullif(client_email,''),trim(p_address),'contact','roof-report')
    RETURNING id INTO lead_uuid;
    SELECT id INTO customer_uuid FROM public.crm_customers
    WHERE source_lead_id = lead_uuid AND company_id = actor_company_id;
    SELECT id INTO property_uuid FROM public.crm_properties
    WHERE customer_id = customer_uuid AND company_id = actor_company_id
      AND lower(regexp_replace(trim(address), '\\s+', ' ', 'g')) =
          lower(regexp_replace(trim(p_address), '\\s+', ' ', 'g'))
    LIMIT 1;
  ELSE
    UPDATE public.crm_customers
    SET name=client_name, phone=client_phone, email=client_email
    WHERE id=customer_uuid AND company_id=actor_company_id
    RETURNING source_lead_id INTO lead_uuid;
    IF lead_uuid IS NOT NULL THEN
      UPDATE public.leads SET name=client_name, phone=client_phone,
        email=nullif(client_email,'')
      WHERE id=lead_uuid AND company_id=actor_company_id;
    END IF;
  END IF;
  IF property_uuid IS NULL OR customer_uuid IS NULL THEN
    RAISE EXCEPTION 'Could not create or find the property record';
  END IF;
  INSERT INTO public.roof_report_orders(
    company_id,customer_id,property_id,address,title,provider,notes,customer_phone,customer_email
  ) VALUES (
    actor_company_id,customer_uuid,property_uuid,trim(p_address),client_name,p_provider,p_notes,client_phone,client_email
  ) RETURNING id INTO request_uuid;
  RETURN request_uuid;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_roof_report_request(
  p_customer_id uuid, p_address text, p_title text, p_provider text, p_notes text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  actor_company_id uuid;
  actor_role text;
  property_uuid uuid;
  request_uuid uuid;
  membership_count integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT count(*) INTO membership_count FROM public.crm_company_memberships WHERE user_id = auth.uid();
  IF membership_count <> 1 THEN RAISE EXCEPTION 'A single company membership is required'; END IF;
  SELECT company_id, role INTO actor_company_id, actor_role
  FROM public.crm_company_memberships WHERE user_id = auth.uid();
  IF actor_company_id IS NULL OR actor_role NOT IN ('owner','admin','office','sales','production_manager') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.crm_customers
    WHERE id=p_customer_id AND company_id=actor_company_id) THEN
    RAISE EXCEPTION 'Customer unavailable';
  END IF;
  IF length(trim(coalesce(p_address,'')))<8 OR length(p_address)>250
     OR length(trim(coalesce(p_title,'')))<1 OR length(p_title)>180
     OR p_provider <> 'manual' OR length(coalesce(p_notes,''))>4000 THEN
    RAISE EXCEPTION 'Invalid report request';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    actor_company_id::text || ':' || p_customer_id::text || ':' ||
    lower(regexp_replace(trim(p_address),'\\s+',' ','g')),0));
  SELECT id INTO property_uuid FROM public.crm_properties
  WHERE customer_id=p_customer_id AND company_id=actor_company_id
    AND lower(regexp_replace(trim(address),'\\s+',' ','g'))=
        lower(regexp_replace(trim(p_address),'\\s+',' ','g'))
  LIMIT 1;
  IF property_uuid IS NULL THEN
    INSERT INTO public.crm_properties(company_id,customer_id,label,address,notes)
    VALUES(actor_company_id,p_customer_id,'Roof report property',trim(p_address),'')
    RETURNING id INTO property_uuid;
  END IF;
  INSERT INTO public.roof_report_orders(company_id,customer_id,property_id,address,title,provider,notes)
  VALUES(actor_company_id,p_customer_id,property_uuid,trim(p_address),trim(p_title),p_provider,p_notes)
  RETURNING id INTO request_uuid;
  RETURN request_uuid;
END;
$$;

-- The drawing RPC is also SECURITY DEFINER; authorize and validate every parent
-- using the actor's company before writing the drawing or report metadata.
CREATE OR REPLACE FUNCTION public.save_report_drawing(
  p_drawing jsonb, p_report_id uuid, p_report jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  actor_company_id uuid;
  actor_role text;
  did uuid;
  rep public.roof_report_orders%ROWTYPE;
  membership_count integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT count(*) INTO membership_count FROM public.crm_company_memberships WHERE user_id=auth.uid();
  IF membership_count <> 1 THEN RAISE EXCEPTION 'A single company membership is required'; END IF;
  SELECT company_id,role INTO actor_company_id,actor_role
  FROM public.crm_company_memberships WHERE user_id=auth.uid();
  IF actor_company_id IS NULL OR actor_role NOT IN ('owner','admin','office','sales','production_manager') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  SELECT * INTO rep FROM public.roof_report_orders
  WHERE id=p_report_id AND company_id=actor_company_id FOR UPDATE;
  IF rep.id IS NULL OR rep.property_id IS DISTINCT FROM nullif(p_drawing->>'property_id','')::uuid THEN
    RAISE EXCEPTION 'Report unavailable or property does not match';
  END IF;
  IF nullif(p_drawing->>'parent_id','') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.roof_drawings d
      JOIN public.crm_properties p ON p.id=d.property_id
      WHERE d.id=(p_drawing->>'parent_id')::uuid
        AND d.property_id=rep.property_id
        AND p.company_id=actor_company_id
    ) THEN
      RAISE EXCEPTION 'Drawing revision parent unavailable';
    END IF;
  END IF;
  INSERT INTO public.roof_drawings(
    property_id,title,geometry,measurements,revision,parent_id,media,report_order_id
  ) VALUES (
    rep.property_id,p_drawing->>'title',p_drawing->'geometry',
    p_drawing->'measurements',(p_drawing->>'revision')::int,
    nullif(p_drawing->>'parent_id','')::uuid,
    coalesce(p_drawing->'media','[]'::jsonb),p_report_id
  ) RETURNING id INTO did;
  UPDATE public.roof_report_orders SET
    drawing_id=did,title=p_drawing->>'title',measurements=p_report->'measurements',
    notes=coalesce(p_report->>'notes',''),
    status=CASE WHEN coalesce((p_report->>'verified')::boolean,false) THEN 'reviewed' ELSE 'requested' END,
    reviewed_at=CASE WHEN coalesce((p_report->>'verified')::boolean,false) THEN now() ELSE NULL END
  WHERE id=p_report_id AND company_id=actor_company_id;
  RETURN did;
END;
$$;

REVOKE ALL ON FUNCTION public.create_roof_report_request(text,text,text,text) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.create_roof_report_request(text,text,text,text,text,text) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.create_roof_report_request(uuid,text,text,text,text) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.save_report_drawing(jsonb,uuid,jsonb) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.create_roof_report_request(text,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_roof_report_request(text,text,text,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_roof_report_request(uuid,text,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_report_drawing(jsonb,uuid,jsonb) TO authenticated;

COMMENT ON FUNCTION public.create_roof_report_request(text,text,text,text) IS
  'Creates a report only inside the authenticated actor company; address matching is company-scoped.';
COMMENT ON FUNCTION public.create_roof_report_request(text,text,text,text,text,text) IS
  'Creates/updates a report customer only inside the authenticated actor company.';
COMMENT ON FUNCTION public.create_roof_report_request(uuid,text,text,text,text) IS
  'Creates a report for a customer belonging to the authenticated actor company.';
COMMENT ON FUNCTION public.save_report_drawing(jsonb,uuid,jsonb) IS
  'Atomically saves report drawing only after verifying report, property, and revision parent are in the actor company.';
