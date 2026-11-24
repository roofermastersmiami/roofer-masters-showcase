-- Reusable PDF signing templates and secure staff template storage.
CREATE TABLE IF NOT EXISTS public.pdf_sign_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (char_length(trim(name)) BETWEEN 2 AND 120),
  file_path text NOT NULL,
  fields jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(fields) = 'array'),
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pdf_sign_templates_file_path_unique UNIQUE (file_path)
);
CREATE INDEX IF NOT EXISTS pdf_sign_templates_updated_at_idx
  ON public.pdf_sign_templates(updated_at DESC);
ALTER TABLE public.pdf_sign_templates ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pdf_sign_templates TO authenticated;
CREATE POLICY "CRM staff manage PDF signing templates"
ON public.pdf_sign_templates FOR ALL TO authenticated
USING (public.has_any_role(auth.uid(), ARRAY['admin','office','sales','production_manager']::public.app_role[]))
WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','office','sales','production_manager']::public.app_role[]));

-- The roofing-proposals bucket also stores reusable blank PDF templates.
DROP POLICY IF EXISTS "CRM staff read PDF templates" ON storage.objects;
CREATE POLICY "CRM staff read PDF templates"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'roofing-proposals'
  AND (storage.foldername(name))[1] = 'pdf-templates'
  AND public.has_any_role(auth.uid(), ARRAY['admin','office','sales','production_manager']::public.app_role[]));
DROP POLICY IF EXISTS "CRM staff upload PDF templates" ON storage.objects;
CREATE POLICY "CRM staff upload PDF templates"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'roofing-proposals'
  AND (storage.foldername(name))[1] = 'pdf-templates'
  AND public.has_any_role(auth.uid(), ARRAY['admin','office','sales','production_manager']::public.app_role[]));
DROP POLICY IF EXISTS "CRM staff update PDF templates" ON storage.objects;
CREATE POLICY "CRM staff update PDF templates"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'roofing-proposals'
  AND (storage.foldername(name))[1] = 'pdf-templates'
  AND public.has_any_role(auth.uid(), ARRAY['admin','office','sales','production_manager']::public.app_role[]))
WITH CHECK (bucket_id = 'roofing-proposals'
  AND (storage.foldername(name))[1] = 'pdf-templates'
  AND public.has_any_role(auth.uid(), ARRAY['admin','office','sales','production_manager']::public.app_role[]));
DROP POLICY IF EXISTS "CRM staff delete PDF templates" ON storage.objects;
CREATE POLICY "CRM staff delete PDF templates"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'roofing-proposals'
  AND (storage.foldername(name))[1] = 'pdf-templates'
  AND public.has_any_role(auth.uid(), ARRAY['admin','office','sales','production_manager']::public.app_role[]));

CREATE TRIGGER pdf_sign_templates_updated_at
BEFORE UPDATE ON public.pdf_sign_templates
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
