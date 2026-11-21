CREATE OR REPLACE FUNCTION public.has_any_role(_user_id uuid, _roles public.app_role[])
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
 SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id=_user_id AND (role='admin' OR role = ANY(_roles)))
$$;
REVOKE ALL ON FUNCTION public.has_any_role(uuid, public.app_role[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_any_role(uuid, public.app_role[]) TO authenticated, service_role;

-- Customer-facing CRM data
CREATE POLICY "Team office sales leads read" ON public.leads FOR SELECT TO authenticated USING (public.has_any_role(auth.uid(), ARRAY['office','sales','production_manager','accounting']::public.app_role[]));
CREATE POLICY "Team office sales leads update" ON public.leads FOR UPDATE TO authenticated USING (public.has_any_role(auth.uid(), ARRAY['office','sales']::public.app_role[])) WITH CHECK (public.has_any_role(auth.uid(), ARRAY['office','sales']::public.app_role[]));
CREATE POLICY "Team customers read" ON public.crm_customers FOR SELECT TO authenticated USING (public.has_any_role(auth.uid(), ARRAY['office','sales','production_manager','accounting']::public.app_role[]));
CREATE POLICY "Team customers write" ON public.crm_customers FOR UPDATE TO authenticated USING (public.has_any_role(auth.uid(), ARRAY['office','sales']::public.app_role[])) WITH CHECK (public.has_any_role(auth.uid(), ARRAY['office','sales']::public.app_role[]));
CREATE POLICY "Team properties read" ON public.crm_properties FOR SELECT TO authenticated USING (public.has_any_role(auth.uid(), ARRAY['office','sales','production_manager','accounting']::public.app_role[]));
CREATE POLICY "Team properties insert" ON public.crm_properties FOR INSERT TO authenticated WITH CHECK (public.has_any_role(auth.uid(), ARRAY['office','sales']::public.app_role[]));
CREATE POLICY "Team properties update" ON public.crm_properties FOR UPDATE TO authenticated USING (public.has_any_role(auth.uid(), ARRAY['office','sales']::public.app_role[])) WITH CHECK (public.has_any_role(auth.uid(), ARRAY['office','sales']::public.app_role[]));
CREATE POLICY "Team activity read" ON public.crm_activity FOR SELECT TO authenticated USING (public.has_any_role(auth.uid(), ARRAY['office','sales','production_manager']::public.app_role[]));
CREATE POLICY "Team activity insert" ON public.crm_activity FOR INSERT TO authenticated WITH CHECK (public.has_any_role(auth.uid(), ARRAY['office','sales','production_manager']::public.app_role[]));
CREATE POLICY "Team tasks" ON public.crm_tasks FOR ALL TO authenticated USING (public.has_any_role(auth.uid(), ARRAY['office','sales','production_manager']::public.app_role[])) WITH CHECK (public.has_any_role(auth.uid(), ARRAY['office','sales','production_manager']::public.app_role[]));
CREATE POLICY "Team messages read" ON public.lead_messages FOR SELECT TO authenticated USING (public.has_any_role(auth.uid(), ARRAY['office','sales']::public.app_role[]));
CREATE POLICY "Team messages reply" ON public.lead_messages FOR INSERT TO authenticated WITH CHECK (sender='owner' AND public.has_any_role(auth.uid(), ARRAY['office','sales']::public.app_role[]));
CREATE POLICY "Office portal links" ON public.client_portal_links FOR ALL TO authenticated USING (public.has_any_role(auth.uid(), ARRAY['office','sales']::public.app_role[])) WITH CHECK (public.has_any_role(auth.uid(), ARRAY['office','sales']::public.app_role[]));

-- Sales documents
CREATE POLICY "Sales proposals" ON public.proposals FOR ALL TO authenticated USING (public.has_any_role(auth.uid(), ARRAY['office','sales']::public.app_role[])) WITH CHECK (public.has_any_role(auth.uid(), ARRAY['office','sales']::public.app_role[]));
CREATE POLICY "Sales proposal shares read" ON public.proposal_shares FOR SELECT TO authenticated USING (public.has_any_role(auth.uid(), ARRAY['office','sales']::public.app_role[]));
CREATE POLICY "Sales estimates" ON public.roof_estimates FOR ALL TO authenticated USING (public.has_any_role(auth.uid(), ARRAY['office','sales']::public.app_role[])) WITH CHECK (public.has_any_role(auth.uid(), ARRAY['office','sales']::public.app_role[]));
CREATE POLICY "Team drawings read" ON public.roof_drawings FOR SELECT TO authenticated USING (public.has_any_role(auth.uid(), ARRAY['office','sales','production_manager']::public.app_role[]));
CREATE POLICY "Team drawings insert" ON public.roof_drawings FOR INSERT TO authenticated WITH CHECK (public.has_any_role(auth.uid(), ARRAY['office','sales','production_manager']::public.app_role[]));
CREATE POLICY "Team reports read" ON public.roof_report_orders FOR SELECT TO authenticated USING (public.has_any_role(auth.uid(), ARRAY['office','sales','production_manager']::public.app_role[]));

-- Production
CREATE POLICY "Production jobs" ON public.roof_jobs FOR ALL TO authenticated USING (public.has_any_role(auth.uid(), ARRAY['production_manager']::public.app_role[])) WITH CHECK (public.has_any_role(auth.uid(), ARRAY['production_manager']::public.app_role[]));
CREATE POLICY "Team jobs read" ON public.roof_jobs FOR SELECT TO authenticated USING (public.has_any_role(auth.uid(), ARRAY['office','sales','accounting']::public.app_role[]));
CREATE POLICY "Production change orders" ON public.job_change_orders FOR ALL TO authenticated USING (public.has_any_role(auth.uid(), ARRAY['production_manager','accounting']::public.app_role[])) WITH CHECK (public.has_any_role(auth.uid(), ARRAY['production_manager']::public.app_role[]));

-- Finance (owner + accounting only)
CREATE POLICY "Accounting invoices read" ON public.crm_invoices FOR SELECT TO authenticated USING (public.has_any_role(auth.uid(), ARRAY['accounting']::public.app_role[]));
CREATE POLICY "Accounting payments read" ON public.invoice_payments FOR SELECT TO authenticated USING (public.has_any_role(auth.uid(), ARRAY['accounting']::public.app_role[]));
CREATE POLICY "Accounting checkouts read" ON public.invoice_checkouts FOR SELECT TO authenticated USING (public.has_any_role(auth.uid(), ARRAY['accounting']::public.app_role[]));
CREATE POLICY "Accounting expenses" ON public.crm_expenses FOR ALL TO authenticated USING (public.has_any_role(auth.uid(), ARRAY['accounting']::public.app_role[])) WITH CHECK (public.has_any_role(auth.uid(), ARRAY['accounting']::public.app_role[]));
CREATE POLICY "Accounting allocations" ON public.invoice_project_links FOR ALL TO authenticated USING (public.has_any_role(auth.uid(), ARRAY['accounting']::public.app_role[])) WITH CHECK (public.has_any_role(auth.uid(), ARRAY['accounting']::public.app_role[]));
CREATE POLICY "Accounting cost catalog" ON public.roof_cost_catalog FOR ALL TO authenticated USING (public.has_any_role(auth.uid(), ARRAY['accounting']::public.app_role[])) WITH CHECK (public.has_any_role(auth.uid(), ARRAY['accounting']::public.app_role[]));

-- Storage
CREATE POLICY "Team roof photos" ON storage.objects FOR ALL TO authenticated
 USING (bucket_id='roof-job-photos' AND public.has_any_role(auth.uid(), ARRAY['office','sales','production_manager']::public.app_role[]))
 WITH CHECK (bucket_id='roof-job-photos' AND public.has_any_role(auth.uid(), ARRAY['office','sales','production_manager']::public.app_role[]));
CREATE POLICY "Crew assigned job photos read" ON storage.objects FOR SELECT TO authenticated
 USING (bucket_id='roof-job-photos' AND EXISTS (SELECT 1 FROM public.roof_jobs j WHERE j.id::text = split_part(name,'/',1) AND auth.uid() = ANY(j.assigned_user_ids)) AND public.has_any_role(auth.uid(), ARRAY['crew']::public.app_role[]));
CREATE POLICY "Crew assigned job photos upload" ON storage.objects FOR INSERT TO authenticated
 WITH CHECK (bucket_id='roof-job-photos' AND EXISTS (SELECT 1 FROM public.roof_jobs j WHERE j.id::text = split_part(name,'/',1) AND auth.uid() = ANY(j.assigned_user_ids)) AND public.has_any_role(auth.uid(), ARRAY['crew']::public.app_role[]));
CREATE POLICY "Sales proposal files" ON storage.objects FOR ALL TO authenticated
 USING (bucket_id='roofing-proposals' AND name NOT LIKE 'expense-%' AND public.has_any_role(auth.uid(), ARRAY['office','sales']::public.app_role[]))
 WITH CHECK (bucket_id='roofing-proposals' AND name NOT LIKE 'expense-%' AND public.has_any_role(auth.uid(), ARRAY['office','sales']::public.app_role[]));
CREATE POLICY "Accounting receipts" ON storage.objects FOR ALL TO authenticated
 USING (bucket_id='roofing-proposals' AND name LIKE 'expense-%' AND public.has_any_role(auth.uid(), ARRAY['accounting']::public.app_role[]))
 WITH CHECK (bucket_id='roofing-proposals' AND name LIKE 'expense-%' AND public.has_any_role(auth.uid(), ARRAY['accounting']::public.app_role[]));

-- RPCs: widen to the matching roles (admin always allowed by has_any_role)
CREATE OR REPLACE FUNCTION public.record_invoice_payment(p_invoice_id uuid, p_amount_cents bigint, p_method text, p_reference text, p_received_at timestamp with time zone)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE inv public.crm_invoices; payment_id uuid;
BEGIN
 IF NOT public.has_any_role(auth.uid(), ARRAY['accounting']::public.app_role[]) THEN RAISE EXCEPTION 'Owner or accounting access required'; END IF;
 IF p_method NOT IN ('cash','check','bank_transfer','card_external') OR p_amount_cents <= 0 OR p_received_at IS NULL THEN RAISE EXCEPTION 'Invalid payment'; END IF;
 SELECT * INTO inv FROM public.crm_invoices WHERE id = p_invoice_id FOR UPDATE;
 IF inv.id IS NULL OR inv.status <> 'issued' THEN RAISE EXCEPTION 'Issue the invoice before recording a payment'; END IF;
 IF EXISTS(SELECT 1 FROM public.invoice_checkouts WHERE invoice_id=inv.id AND status='pending') THEN RAISE EXCEPTION 'An online payment is pending; wait for completion or cancel checkout first'; END IF;
 IF p_amount_cents > inv.total_cents - inv.paid_cents THEN RAISE EXCEPTION 'Payment exceeds outstanding balance'; END IF;
 INSERT INTO public.invoice_payments(invoice_id, amount_cents, method, reference, received_at,environment) VALUES(p_invoice_id,p_amount_cents,p_method,left(p_reference,200),p_received_at,inv.environment) RETURNING id INTO payment_id;
 UPDATE public.crm_invoices SET paid_cents = paid_cents + p_amount_cents WHERE id = p_invoice_id;
 RETURN payment_id;
END; $function$;

CREATE OR REPLACE FUNCTION public.set_invoice_status(p_invoice_id uuid, p_status text)
 RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE inv public.crm_invoices;
BEGIN
 IF NOT public.has_any_role(auth.uid(), ARRAY['accounting']::public.app_role[]) THEN RAISE EXCEPTION 'Owner or accounting access required'; END IF;
 SELECT * INTO inv FROM public.crm_invoices WHERE id=p_invoice_id FOR UPDATE;
 IF inv.id IS NULL OR p_status NOT IN ('issued','void') THEN RAISE EXCEPTION 'Invoice unavailable'; END IF;
 IF EXISTS(SELECT 1 FROM public.invoice_checkouts WHERE invoice_id=inv.id AND status='pending') THEN RAISE EXCEPTION 'Cancel pending checkout first'; END IF;
 IF p_status='issued' AND inv.status<>'draft' THEN RAISE EXCEPTION 'Only draft invoices can be issued'; END IF;
 IF p_status='void' AND (inv.paid_cents<>0 OR inv.status='void') THEN RAISE EXCEPTION 'Paid or void invoices cannot be withdrawn'; END IF;
 UPDATE public.crm_invoices SET status=p_status WHERE id=inv.id;
 RETURN true;
END; $function$;

CREATE OR REPLACE FUNCTION public.save_report_drawing(p_drawing jsonb, p_report_id uuid, p_report jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE did uuid; rep public.roof_report_orders;
BEGIN
 IF NOT public.has_any_role(auth.uid(), ARRAY['office','sales','production_manager']::public.app_role[]) THEN RAISE EXCEPTION 'Access denied'; END IF;
 SELECT * INTO rep FROM public.roof_report_orders WHERE id=p_report_id FOR UPDATE;
 IF rep.id IS NULL OR rep.property_id <> (p_drawing->>'property_id')::uuid THEN RAISE EXCEPTION 'Report property does not match'; END IF;
 INSERT INTO public.roof_drawings(property_id,title,geometry,measurements,revision,parent_id,media,report_order_id)
 VALUES((p_drawing->>'property_id')::uuid,p_drawing->>'title',p_drawing->'geometry',p_drawing->'measurements',(p_drawing->>'revision')::int,NULLIF(p_drawing->>'parent_id','')::uuid,coalesce(p_drawing->'media','[]'::jsonb),p_report_id) RETURNING id INTO did;
 UPDATE public.roof_report_orders SET drawing_id=did,title=p_drawing->>'title',measurements=p_report->'measurements',notes=coalesce(p_report->>'notes',''),
  status=CASE WHEN (p_report->>'verified')::boolean THEN 'reviewed' ELSE 'requested' END,
  reviewed_at=CASE WHEN (p_report->>'verified')::boolean THEN now() ELSE NULL END WHERE id=p_report_id;
 RETURN did;
END $$;

CREATE OR REPLACE FUNCTION public.create_roof_report_request(p_customer_id uuid, p_address text, p_title text, p_provider text, p_notes text)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE property_uuid uuid; request_uuid uuid;
BEGIN
 IF NOT public.has_any_role(auth.uid(), ARRAY['office','sales','production_manager']::public.app_role[]) THEN RAISE EXCEPTION 'Access denied'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.crm_customers WHERE id=p_customer_id) THEN RAISE EXCEPTION 'Customer not found'; END IF;
 IF length(trim(p_address))<8 OR length(p_address)>250 OR length(trim(p_title))<1 OR length(p_title)>180 OR p_provider <> 'manual' OR length(p_notes)>4000 THEN RAISE EXCEPTION 'Invalid report request'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_customer_id::text||lower(regexp_replace(trim(p_address),'\s+',' ','g')),0));
 SELECT id INTO property_uuid FROM public.crm_properties WHERE customer_id=p_customer_id AND lower(regexp_replace(trim(address),'\s+',' ','g'))=lower(regexp_replace(trim(p_address),'\s+',' ','g')) LIMIT 1;
 IF property_uuid IS NULL THEN INSERT INTO public.crm_properties(customer_id,label,address,notes) VALUES(p_customer_id,'Roof report property',trim(p_address),'') RETURNING id INTO property_uuid; END IF;
 INSERT INTO public.roof_report_orders(customer_id,property_id,address,title,provider,notes) VALUES(p_customer_id,property_uuid,trim(p_address),trim(p_title),p_provider,p_notes) RETURNING id INTO request_uuid;
 RETURN request_uuid;
END $function$;