-- Per-account company branding and CRM palette preferences.
-- The owner_user_id is the account boundary until company membership/tenant
-- relationships are introduced across the operational CRM tables.
CREATE TABLE IF NOT EXISTS public.crm_company_branding (
  owner_user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  company_name text CHECK (company_name IS NULL OR char_length(trim(company_name)) <= 160),
  logo_path text,
  theme_palette text NOT NULL DEFAULT 'executive-berry'
    CHECK (theme_palette IN ('executive-berry', 'modern-enterprise', 'canyon-corporate')),
  sidebar_appearance text NOT NULL DEFAULT 'navy'
    CHECK (sidebar_appearance IN ('navy', 'light', 'accent', 'charcoal', 'gradient', 'steel')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.crm_company_branding ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON public.crm_company_branding TO authenticated;
CREATE POLICY "Account owners read their company branding"
ON public.crm_company_branding FOR SELECT TO authenticated
USING (owner_user_id = auth.uid());
CREATE POLICY "Account owners create their company branding"
ON public.crm_company_branding FOR INSERT TO authenticated
WITH CHECK (owner_user_id = auth.uid());
CREATE POLICY "Account owners update their company branding"
ON public.crm_company_branding FOR UPDATE TO authenticated
USING (owner_user_id = auth.uid())
WITH CHECK (owner_user_id = auth.uid());

CREATE TRIGGER crm_company_branding_updated_at
BEFORE UPDATE ON public.crm_company_branding
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Public-read logos are intended for CRM headers and customer-facing documents.
-- Upload/update/delete remain restricted to the authenticated account owner path.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('crm-company-branding', 'crm-company-branding', true, 2097152,
        ARRAY['image/png', 'image/jpeg', 'image/webp'])
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE POLICY "Account owners upload company logos"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'crm-company-branding'
  AND (storage.foldername(name))[1] = auth.uid()::text
);
CREATE POLICY "Account owners update company logos"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'crm-company-branding'
  AND (storage.foldername(name))[1] = auth.uid()::text
)
WITH CHECK (
  bucket_id = 'crm-company-branding'
  AND (storage.foldername(name))[1] = auth.uid()::text
);
CREATE POLICY "Account owners delete company logos"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'crm-company-branding'
  AND (storage.foldername(name))[1] = auth.uid()::text
);
