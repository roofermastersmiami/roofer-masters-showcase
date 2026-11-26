-- Private, company-scoped document storage for permit applications.
-- Object path: {company_id}/{permit_application_id}/{filename}
-- The application row is the authority for both tenant ownership and access.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'permit-documents',
  'permit-documents',
  false,
  26214400,
  ARRAY['application/pdf', 'image/jpeg', 'image/png']
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE POLICY "Company members read permit documents"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'permit-documents'
  AND cardinality(storage.foldername(name)) = 2
  AND (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  AND (storage.foldername(name))[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  AND EXISTS (
    SELECT 1
    FROM public.roof_permit_applications a
    WHERE a.id::text = (storage.foldername(name))[2]
      AND a.company_id::text = (storage.foldername(name))[1]
      AND public.is_crm_company_member(a.company_id)
  )
);

CREATE POLICY "Company admins upload permit documents"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'permit-documents'
  AND cardinality(storage.foldername(name)) = 2
  AND (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  AND (storage.foldername(name))[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  AND EXISTS (
    SELECT 1
    FROM public.roof_permit_applications a
    WHERE a.id::text = (storage.foldername(name))[2]
      AND a.company_id::text = (storage.foldername(name))[1]
      AND public.is_crm_company_admin(a.company_id)
  )
);

CREATE POLICY "Company admins update permit documents"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'permit-documents'
  AND cardinality(storage.foldername(name)) = 2
  AND EXISTS (
    SELECT 1
    FROM public.roof_permit_applications a
    WHERE a.id::text = (storage.foldername(name))[2]
      AND a.company_id::text = (storage.foldername(name))[1]
      AND public.is_crm_company_admin(a.company_id)
  )
)
WITH CHECK (
  bucket_id = 'permit-documents'
  AND cardinality(storage.foldername(name)) = 2
  AND EXISTS (
    SELECT 1
    FROM public.roof_permit_applications a
    WHERE a.id::text = (storage.foldername(name))[2]
      AND a.company_id::text = (storage.foldername(name))[1]
      AND public.is_crm_company_admin(a.company_id)
  )
);

CREATE POLICY "Company admins delete permit documents"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'permit-documents'
  AND cardinality(storage.foldername(name)) = 2
  AND EXISTS (
    SELECT 1
    FROM public.roof_permit_applications a
    WHERE a.id::text = (storage.foldername(name))[2]
      AND a.company_id::text = (storage.foldername(name))[1]
      AND public.is_crm_company_admin(a.company_id)
  )
);

COMMENT ON POLICY "Company members read permit documents" ON storage.objects IS
  'Permit files are private and readable only by members of the company that owns the linked permit application. Use short-lived signed URLs after authorization.';
