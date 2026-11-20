CREATE TABLE public.instant_roof_rates(category text PRIMARY KEY CHECK(category IN ('Metal Roof','Tile Roof','Shingle Roof','TPO','Flat Roof')), low_cents bigint NOT NULL CHECK(low_cents>0), high_cents bigint NOT NULL CHECK(high_cents>=low_cents), enabled boolean NOT NULL DEFAULT false);
GRANT SELECT ON public.instant_roof_rates TO anon;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.instant_roof_rates TO authenticated;
GRANT ALL ON public.instant_roof_rates TO service_role;
ALTER TABLE public.instant_roof_rates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public active roof rates" ON public.instant_roof_rates FOR SELECT TO anon USING(enabled);
CREATE POLICY "Owner roof rates" ON public.instant_roof_rates FOR ALL TO authenticated USING(public.has_role(auth.uid(),'admin')) WITH CHECK(public.has_role(auth.uid(),'admin'));
CREATE TABLE public.job_change_orders(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),job_id uuid NOT NULL REFERENCES public.roof_jobs(id) ON DELETE CASCADE,title text NOT NULL CHECK(length(title) BETWEEN 1 AND 180),scope text NOT NULL CHECK(length(scope) BETWEEN 1 AND 4000),amount_cents bigint NOT NULL DEFAULT 0,days_added integer NOT NULL DEFAULT 0 CHECK(days_added BETWEEN -365 AND 365),status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','pending','approved','rejected')),approved_by text,approved_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),CHECK(status <> 'approved' OR (length(approved_by)>1 AND approved_at IS NOT NULL)));
GRANT SELECT,INSERT,UPDATE,DELETE ON public.job_change_orders TO authenticated;
GRANT ALL ON public.job_change_orders TO service_role;
ALTER TABLE public.job_change_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owner change orders" ON public.job_change_orders FOR ALL TO authenticated USING(public.has_role(auth.uid(),'admin')) WITH CHECK(public.has_role(auth.uid(),'admin'));
CREATE INDEX job_change_orders_job_idx ON public.job_change_orders(job_id);
ALTER TABLE public.leads ADD COLUMN qualification jsonb;
CREATE FUNCTION public.capture_instant_roof_lead(p_lead jsonb,p_qualification jsonb,p_category text,p_total bigint) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE lid uuid;
BEGIN
INSERT INTO public.leads(name,phone,email,address,service,message,source,page,qualification) VALUES(p_lead->>'name',p_lead->>'phone',NULLIF(p_lead->>'email',''),p_lead->>'address',p_category,p_lead->>'message','quote','instant-estimator',p_qualification) RETURNING id INTO lid;
IF p_total IS NOT NULL THEN INSERT INTO public.roof_estimates(lead_id,title,category,inputs,total_cents) VALUES(lid,'Instant roof estimate',p_category,p_qualification,p_total); END IF;
INSERT INTO public.roof_jobs(lead_id,title,status,notes) VALUES(lid,p_category || ' — inspection requested','on_hold','Instant estimate lead. Unscheduled; scope and final price require owner inspection.');
RETURN lid;
END; $$;
REVOKE ALL ON FUNCTION public.capture_instant_roof_lead(jsonb,jsonb,text,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.capture_instant_roof_lead(jsonb,jsonb,text,bigint) TO service_role;