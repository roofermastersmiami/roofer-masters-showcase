-- Private, company-scoped document storage for permit applications.
-- Object path: {company_id}/{permit_application_id}/{filename}
-- The linked application is authoritative for tenant ownership and access.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'permit-documents',
  'permit-documents',
  false,
  26214400,
  ARRAY['application/pdf', 'image/jpeg', 'image/png']
)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
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
  AND (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  AND (storage.foldername(name))[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
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

CREATE POLICY "Company admins delete permit documents"
ON storage.objects FOR DELETE TO authenticated
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
      AND public.is_crm_company_admin(a.company_id)
  )
);

COMMENT ON POLICY "Company members read permit documents" ON storage.objects IS
  'Permit files are private and readable only by members of the company that owns the linked permit application. Use short-lived signed URLs after authorization.';


-- tenant-audit: reviewed
-- Review: the helper below is SECURITY DEFINER but exposes only a boolean check for
-- a three-segment permit-object path. It binds the application to its company and
-- requires the JWT subject to hold owner/admin membership in that same company.
-- Evaluate storage authorization in a narrowly scoped SECURITY DEFINER helper.
-- Storage's DELETE path must not rely on caller-visible application rows: the
-- helper verifies both the exact application/company pair and the caller's
-- owner/admin membership, using the authenticated JWT subject.
CREATE OR REPLACE FUNCTION public.can_manage_permit_document(_object_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT CASE
    WHEN cardinality(string_to_array(_object_name, '/')) = 3
      AND split_part(_object_name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      AND split_part(_object_name, '/', 2) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      AND nullif(split_part(_object_name, '/', 3), '') IS NOT NULL
    THEN EXISTS (
      SELECT 1
      FROM public.roof_permit_applications a
      JOIN public.crm_company_memberships m
        ON m.company_id = a.company_id
      WHERE a.id::text = split_part(_object_name, '/', 2)
        AND a.company_id::text = split_part(_object_name, '/', 1)
        AND m.user_id = auth.uid()
        AND m.role IN ('owner', 'admin')
    )
    ELSE false
  END
$$;

REVOKE ALL ON FUNCTION public.can_manage_permit_document(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_manage_permit_document(text) TO authenticated, service_role;

DROP POLICY IF EXISTS "Company admins update permit documents" ON storage.objects;
CREATE POLICY "Company admins update permit documents"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'permit-documents'
  AND public.can_manage_permit_document(name)
)
WITH CHECK (
  bucket_id = 'permit-documents'
  AND public.can_manage_permit_document(name)
);

DROP POLICY IF EXISTS "Company admins delete permit documents" ON storage.objects;
CREATE POLICY "Company admins delete permit documents"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'permit-documents'
  AND public.can_manage_permit_document(name)
);
