-- tenant-audit: reviewed — security-definer public intake accepts company_id only from trusted server configuration, verifies the company exists, copies it to lead/estimate/job rows, and remains service_role-only.
-- Keep trusted instant-estimate intake compatible with mandatory company ownership.
-- The company UUID continues to come only from server-side configuration.
CREATE OR REPLACE FUNCTION public.capture_instant_roof_lead(
  p_lead jsonb,
  p_qualification jsonb,
  p_category text,
  p_total bigint
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  lid uuid;
  company_uuid uuid;
BEGIN
  IF coalesce(p_lead->>'company_id', '') !~*
    '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'Invalid public lead company configuration';
  END IF;

  company_uuid := (p_lead->>'company_id')::uuid;
  IF NOT EXISTS (SELECT 1 FROM public.crm_companies WHERE id = company_uuid) THEN
    RAISE EXCEPTION 'Public lead company is unavailable';
  END IF;

  INSERT INTO public.leads(
    company_id, name, phone, email, address, service, message, source, page, qualification
  )
  VALUES (
    company_uuid,
    p_lead->>'name',
    p_lead->>'phone',
    NULLIF(p_lead->>'email',''),
    p_lead->>'address',
    p_category,
    p_lead->>'message',
    'quote',
    'instant-estimator',
    p_qualification
  )
  RETURNING id INTO lid;

  IF p_total > 0 THEN
    INSERT INTO public.roof_estimates(
      company_id, lead_id, title, category, inputs, total_cents
    )
    VALUES (
      company_uuid, lid, 'Instant roof estimate', p_category, p_qualification, p_total
    );
  END IF;

  INSERT INTO public.roof_jobs(company_id,lead_id,title,status,notes)
  VALUES(company_uuid,lid,p_category || ' — inspection requested','on_hold',
    'Instant estimate lead. Unscheduled; scope and final price require owner inspection.');

  RETURN lid;
END;
$$;

REVOKE ALL ON FUNCTION public.capture_instant_roof_lead(jsonb,jsonb,text,bigint)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.capture_instant_roof_lead(jsonb,jsonb,text,bigint)
  TO service_role;

COMMENT ON FUNCTION public.capture_instant_roof_lead(jsonb,jsonb,text,bigint) IS
  'Public instant-estimate intake. company_id must be resolved from trusted server configuration and inherited by all created records.';
