-- Company-scope the CRM customer save RPC.
-- Depends on 0042 company ownership and 0043 company-aware lead sync.
-- Fails closed when the user has zero or multiple company memberships.
CREATE OR REPLACE FUNCTION public.save_crm_customer(p_customer jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  cid uuid;
  lid uuid;
  company_count integer;
  actor_company_id uuid;
  actor_role text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT count(*), min(company_id) INTO company_count, actor_company_id
  FROM public.crm_company_memberships WHERE user_id = auth.uid();
  IF company_count <> 1 OR actor_company_id IS NULL THEN
    RAISE EXCEPTION 'A single active company membership is required';
  END IF;
  SELECT role INTO actor_role FROM public.crm_company_memberships
  WHERE user_id = auth.uid() AND company_id = actor_company_id;
  IF actor_role NOT IN ('owner','admin','office','sales') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  IF length(trim(coalesce(p_customer->>'name',''))) < 2
     OR length(p_customer->>'name') > 100
     OR length(coalesce(p_customer->>'phone','')) > 30
     OR length(coalesce(p_customer->>'email','')) > 255
     OR length(coalesce(p_customer->>'billing_address','')) > 250
     OR length(coalesce(p_customer->>'notes','')) > 4000
     OR coalesce(p_customer->>'customer_type','') NOT IN
       ('residential','commercial','property_manager') THEN
    RAISE EXCEPTION 'Invalid customer';
  END IF;
  IF p_customer->>'id' IS NULL THEN
    INSERT INTO public.leads(company_id,name,phone,email,source,page)
    VALUES (actor_company_id,trim(p_customer->>'name'),
      coalesce(p_customer->>'phone',''),nullif(p_customer->>'email',''),
      'contact','owner-crm')
    RETURNING id INTO cid;
  ELSE
    cid := (p_customer->>'id')::uuid;
    IF NOT EXISTS (SELECT 1 FROM public.crm_customers
      WHERE id=cid AND company_id=actor_company_id) THEN
      RAISE EXCEPTION 'Customer unavailable';
    END IF;
  END IF;
  UPDATE public.crm_customers SET
    name=trim(p_customer->>'name'),
    phone=coalesce(p_customer->>'phone',''),
    email=coalesce(p_customer->>'email',''),
    billing_address=coalesce(p_customer->>'billing_address',''),
    customer_type=p_customer->>'customer_type',
    notes=coalesce(p_customer->>'notes','')
  WHERE id=cid AND company_id=actor_company_id
  RETURNING source_lead_id INTO lid;
  IF NOT FOUND THEN RAISE EXCEPTION 'Customer unavailable'; END IF;
  IF lid IS NOT NULL THEN
    UPDATE public.leads SET name=trim(p_customer->>'name'),
      phone=coalesce(p_customer->>'phone',''),
      email=nullif(p_customer->>'email','')
    WHERE id=lid AND company_id=actor_company_id;
  END IF;
  RETURN cid;
END;
$$;
REVOKE ALL ON FUNCTION public.save_crm_customer(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_crm_customer(jsonb) TO authenticated, service_role;
COMMENT ON FUNCTION public.save_crm_customer(jsonb) IS
  'Company-scoped CRM customer save; depends on migrations 0042 and 0043.';
