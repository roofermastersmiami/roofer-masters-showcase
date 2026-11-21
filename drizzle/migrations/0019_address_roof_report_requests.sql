CREATE TABLE public.roof_report_orders (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), customer_id uuid NOT NULL REFERENCES public.crm_customers(id), property_id uuid NOT NULL REFERENCES public.crm_properties(id), address text NOT NULL, title text NOT NULL DEFAULT 'Roof measurement report', provider text NOT NULL DEFAULT 'manual', status text NOT NULL DEFAULT 'requested' CHECK(status IN ('requested','ordered','received','reviewed','cancelled')), provider_reference text NOT NULL DEFAULT '', file_path text, measurements jsonb, notes text NOT NULL DEFAULT '', reviewed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.roof_report_orders TO authenticated;
GRANT ALL ON public.roof_report_orders TO service_role;
ALTER TABLE public.roof_report_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owner reads report requests" ON public.roof_report_orders FOR SELECT TO authenticated USING(public.has_role(auth.uid(),'admin'));
CREATE INDEX roof_report_orders_customer_idx ON public.roof_report_orders(customer_id);
ALTER TABLE public.roof_estimates ADD COLUMN report_order_id uuid REFERENCES public.roof_report_orders(id) ON DELETE SET NULL;
CREATE FUNCTION public.create_roof_report_request(p_customer_id uuid,p_address text,p_title text,p_provider text,p_notes text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE property_uuid uuid; request_uuid uuid;
BEGIN
 IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'Owner access required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.crm_customers WHERE id=p_customer_id) THEN RAISE EXCEPTION 'Customer not found'; END IF;
 IF length(trim(p_address))<8 OR length(p_address)>250 OR length(trim(p_title))<1 OR length(p_title)>180 OR p_provider NOT IN ('manual','eagleview','gaf','roofr','hover','other') OR length(p_notes)>4000 THEN RAISE EXCEPTION 'Invalid report request'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_customer_id::text||lower(regexp_replace(trim(p_address),'\s+',' ','g')),0));
 SELECT id INTO property_uuid FROM public.crm_properties WHERE customer_id=p_customer_id AND lower(regexp_replace(trim(address),'\s+',' ','g'))=lower(regexp_replace(trim(p_address),'\s+',' ','g')) LIMIT 1;
 IF property_uuid IS NULL THEN INSERT INTO public.crm_properties(customer_id,label,address,notes) VALUES(p_customer_id,'Roof report property',trim(p_address),'') RETURNING id INTO property_uuid; END IF;
 INSERT INTO public.roof_report_orders(customer_id,property_id,address,title,provider,notes) VALUES(p_customer_id,property_uuid,trim(p_address),trim(p_title),p_provider,p_notes) RETURNING id INTO request_uuid;
 RETURN request_uuid;
END $$;
REVOKE ALL ON FUNCTION public.create_roof_report_request(uuid,text,text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_roof_report_request(uuid,text,text,text,text) TO authenticated;
CREATE TRIGGER report_order_updated BEFORE UPDATE ON public.roof_report_orders FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();