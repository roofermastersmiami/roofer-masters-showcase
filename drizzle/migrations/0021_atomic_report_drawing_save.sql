CREATE OR REPLACE FUNCTION public.save_report_drawing(p_drawing jsonb, p_report_id uuid, p_report jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE did uuid; rep public.roof_report_orders;
BEGIN
 IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'Owner access required'; END IF;
 SELECT * INTO rep FROM public.roof_report_orders WHERE id=p_report_id FOR UPDATE;
 IF rep.id IS NULL OR rep.property_id <> (p_drawing->>'property_id')::uuid THEN RAISE EXCEPTION 'Report property does not match'; END IF;
 INSERT INTO public.roof_drawings(property_id,title,geometry,measurements,revision,parent_id,media,report_order_id)
 VALUES((p_drawing->>'property_id')::uuid,p_drawing->>'title',p_drawing->'geometry',p_drawing->'measurements',(p_drawing->>'revision')::int,NULLIF(p_drawing->>'parent_id','')::uuid,coalesce(p_drawing->'media','[]'::jsonb),p_report_id) RETURNING id INTO did;
 UPDATE public.roof_report_orders SET drawing_id=did,title=p_drawing->>'title',measurements=p_report->'measurements',notes=coalesce(p_report->>'notes',''),
  status=CASE WHEN (p_report->>'verified')::boolean THEN 'reviewed' ELSE 'requested' END,
  reviewed_at=CASE WHEN (p_report->>'verified')::boolean THEN now() ELSE NULL END WHERE id=p_report_id;
 RETURN did;
END $$;
REVOKE ALL ON FUNCTION public.save_report_drawing(jsonb,uuid,jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.save_report_drawing(jsonb,uuid,jsonb) TO authenticated;
CREATE OR REPLACE FUNCTION public.enforce_own_report_provider() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN IF NEW.provider<>'manual' THEN RAISE EXCEPTION 'Only company-owned reports can be created'; END IF; RETURN NEW; END $$;
DROP TRIGGER IF EXISTS enforce_own_report_provider ON public.roof_report_orders;
CREATE TRIGGER enforce_own_report_provider BEFORE INSERT ON public.roof_report_orders FOR EACH ROW EXECUTE FUNCTION public.enforce_own_report_provider();