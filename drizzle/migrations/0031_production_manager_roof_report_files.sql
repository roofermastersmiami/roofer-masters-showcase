-- Production managers can access only company-owned roof report PDFs.
-- Keep proposal documents and expense receipts under their existing role policies.
CREATE POLICY "Production manager roof report files" ON storage.objects FOR ALL TO authenticated
 USING (
   bucket_id = 'roofing-proposals'
   AND name LIKE 'roof-report/%'
   AND public.has_any_role(auth.uid(), ARRAY['production_manager']::public.app_role[])
 )
 WITH CHECK (
   bucket_id = 'roofing-proposals'
   AND name LIKE 'roof-report/%'
   AND public.has_any_role(auth.uid(), ARRAY['production_manager']::public.app_role[])
 );
