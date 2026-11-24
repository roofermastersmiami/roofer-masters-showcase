-- Free receptionist and appointment calendar.
-- All times are stored as timestamptz; business hours are America/New_York.
CREATE TABLE IF NOT EXISTS public.appointments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  customer_name text NOT NULL CHECK (char_length(trim(customer_name)) BETWEEN 2 AND 180),
  customer_phone text NOT NULL CHECK (char_length(trim(customer_phone)) BETWEEN 7 AND 30),
  customer_email text,
  property_address text NOT NULL CHECK (char_length(trim(property_address)) BETWEEN 8 AND 300),
  service_type text NOT NULL CHECK (service_type IN ('Roof Inspection','Leak Repair','Full Replacement Estimate','Roof Repair','Gutter Estimate','Other')),
  start_time timestamptz NOT NULL,
  end_time timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'Scheduled' CHECK (status IN ('Scheduled','Completed','Cancelled')),
  notes text NOT NULL DEFAULT '',
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','ai_chat','ai_voice','email')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_time > start_time),
  CHECK (end_time - start_time <= interval '4 hours')
);
CREATE INDEX IF NOT EXISTS appointments_start_time_idx ON public.appointments(start_time);
CREATE INDEX IF NOT EXISTS appointments_lead_id_idx ON public.appointments(lead_id);
CREATE INDEX IF NOT EXISTS appointments_active_window_idx ON public.appointments(start_time,end_time) WHERE status <> 'Cancelled';

CREATE TABLE IF NOT EXISTS public.receptionist_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  channel text NOT NULL CHECK (channel IN ('chat','browser_voice','email')),
  direction text NOT NULL CHECK (direction IN ('inbound','outbound','system')),
  message text NOT NULL CHECK (char_length(message) BETWEEN 1 AND 12000),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS receptionist_logs_lead_created_idx ON public.receptionist_logs(lead_id,created_at DESC);

ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.receptionist_logs ENABLE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE ON public.appointments TO authenticated;
GRANT SELECT ON public.receptionist_logs TO authenticated;
GRANT ALL ON public.appointments, public.receptionist_logs TO service_role;
DROP POLICY IF EXISTS "CRM staff manage appointments" ON public.appointments;
CREATE POLICY "CRM staff manage appointments" ON public.appointments
  FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['office','sales','production_manager']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['office','sales','production_manager']::public.app_role[]));
DROP POLICY IF EXISTS "CRM staff read receptionist logs" ON public.receptionist_logs;
CREATE POLICY "CRM staff read receptionist logs" ON public.receptionist_logs
  FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['office','sales','production_manager']::public.app_role[]));

CREATE OR REPLACE FUNCTION public.get_available_slots(target_date date)
RETURNS TABLE(slot_start timestamptz, slot_end timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  WITH business_day AS (
    SELECT target_date::timestamp AT TIME ZONE 'America/New_York' AS day_start
    WHERE extract(isodow FROM target_date) BETWEEN 1 AND 6
      AND target_date >= (now() AT TIME ZONE 'America/New_York')::date
  ), slots AS (
    SELECT day_start + make_interval(hours => h) AS starts_at
    FROM business_day CROSS JOIN generate_series(8,17) AS h
  )
  SELECT s.starts_at, s.starts_at + interval '1 hour'
  FROM slots s
  WHERE s.starts_at > now()
    AND NOT EXISTS (
      SELECT 1 FROM public.appointments a
      WHERE a.status <> 'Cancelled'
        AND tstzrange(a.start_time,a.end_time,'[)') &&
            tstzrange(s.starts_at,s.starts_at + interval '1 hour','[)')
    )
  ORDER BY s.starts_at;
$$;
REVOKE ALL ON FUNCTION public.get_available_slots(date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_available_slots(date) TO anon, authenticated, service_role;

-- A single database transaction and advisory lock prevent two callers booking the same slot.
CREATE OR REPLACE FUNCTION public.book_roof_appointment(
  p_lead_id uuid, p_customer_name text, p_customer_phone text, p_customer_email text,
  p_property_address text, p_service_type text, p_start_time timestamptz,
  p_notes text DEFAULT '', p_source text DEFAULT 'manual'
) RETURNS public.appointments
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE result public.appointments;
BEGIN
  IF p_start_time IS NULL OR p_start_time <= now()
     OR p_service_type NOT IN ('Roof Inspection','Leak Repair','Full Replacement Estimate','Roof Repair','Gutter Estimate','Other')
     OR p_source NOT IN ('manual','ai_chat','ai_voice','email') THEN
    RAISE EXCEPTION 'Invalid appointment details';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(date_trunc('hour',p_start_time)::text,0));
  IF NOT EXISTS (
    SELECT 1 FROM public.get_available_slots((p_start_time AT TIME ZONE 'America/New_York')::date) s
    WHERE s.slot_start = p_start_time AND s.slot_end = p_start_time + interval '1 hour'
  ) THEN
    RAISE EXCEPTION 'That appointment slot is no longer available';
  END IF;
  INSERT INTO public.appointments(
    lead_id,customer_name,customer_phone,customer_email,property_address,service_type,
    start_time,end_time,notes,source
  ) VALUES (
    p_lead_id,trim(p_customer_name),trim(p_customer_phone),nullif(trim(coalesce(p_customer_email,'')),''),
    trim(p_property_address),p_service_type,p_start_time,p_start_time + interval '1 hour',
    coalesce(p_notes,''),p_source
  ) RETURNING * INTO result;
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.book_roof_appointment(uuid,text,text,text,text,text,timestamptz,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.book_roof_appointment(uuid,text,text,text,text,text,timestamptz,text,text) TO service_role;
NOTIFY pgrst, 'reload schema';
