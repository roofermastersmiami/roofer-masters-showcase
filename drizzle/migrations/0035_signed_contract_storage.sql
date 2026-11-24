-- Private storage for flattened, signed roof contracts.
-- Object path: {lead_id}/{roof_report_id}/{timestamp}-{address}-signed.pdf
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('signed-contracts', 'signed-contracts', false, 31457280, ARRAY['application/pdf'])
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = 31457280,
  allowed_mime_types = ARRAY['application/pdf'];

DROP POLICY IF EXISTS "CRM staff upload signed contracts" ON storage.objects;
CREATE POLICY "CRM staff upload signed contracts"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'signed-contracts'
  AND (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  AND (storage.foldername(name))[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  AND EXISTS (
    SELECT 1 FROM public.crm_customers c
    WHERE c.source_lead_id::text = (storage.foldername(name))[1]
  )
  AND public.has_any_role(auth.uid(), ARRAY['office','sales','production_manager']::public.app_role[])
);

DROP POLICY IF EXISTS "CRM staff read signed contracts" ON storage.objects;
CREATE POLICY "CRM staff read signed contracts"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'signed-contracts'
  AND (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  AND EXISTS (
    SELECT 1 FROM public.crm_customers c
    WHERE c.source_lead_id::text = (storage.foldername(name))[1]
  )
  AND public.has_any_role(auth.uid(), ARRAY['office','sales','production_manager']::public.app_role[])
);
