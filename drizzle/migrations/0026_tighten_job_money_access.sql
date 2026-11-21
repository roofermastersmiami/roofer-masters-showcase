DROP POLICY IF EXISTS "Team jobs read" ON public.roof_jobs;
CREATE POLICY "Team jobs read" ON public.roof_jobs FOR SELECT TO authenticated USING (public.has_any_role(auth.uid(), ARRAY['office','accounting']::public.app_role[]));
DROP POLICY IF EXISTS "Production change orders" ON public.job_change_orders;
CREATE POLICY "Accounting change orders" ON public.job_change_orders FOR ALL TO authenticated USING (public.has_any_role(auth.uid(), ARRAY['accounting']::public.app_role[])) WITH CHECK (public.has_any_role(auth.uid(), ARRAY['accounting']::public.app_role[]));