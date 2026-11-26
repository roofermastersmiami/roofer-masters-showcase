-- Company-scoped qualifier and Florida CCC license profile for permitting.
-- Values are nullable and intentionally have no company-wide/global defaults.
-- The CCC number is stored as supplied; do not coerce it to a number or format it.
CREATE TABLE IF NOT EXISTS public.crm_company_permit_settings (
  company_id uuid PRIMARY KEY
    REFERENCES public.crm_companies(id) ON DELETE CASCADE,
  qualifier_name text
    CHECK (qualifier_name IS NULL OR char_length(qualifier_name) <= 160),
  ccc_license_number text
    CHECK (ccc_license_number IS NULL OR char_length(ccc_license_number) <= 64),
  qualifier_phone text
    CHECK (qualifier_phone IS NULL OR char_length(qualifier_phone) <= 40),
  qualifier_email text
    CHECK (qualifier_email IS NULL OR char_length(qualifier_email) <= 254),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.crm_company_permit_settings IS
  'Private-to-company qualifier and CCC details used to prepare roofing permit documents.';
COMMENT ON COLUMN public.crm_company_permit_settings.ccc_license_number IS
  'Exact company-entered CCC license string; intentionally not numeric or globally configured.';

ALTER TABLE public.crm_company_permit_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_company_permit_settings FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public.crm_company_permit_settings FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE ON public.crm_company_permit_settings TO authenticated;
GRANT ALL ON public.crm_company_permit_settings TO service_role;

CREATE POLICY "Company members read permit qualifier settings"
  ON public.crm_company_permit_settings
  FOR SELECT TO authenticated
  USING (public.is_crm_company_member(company_id));

CREATE POLICY "Company admins create permit qualifier settings"
  ON public.crm_company_permit_settings
  FOR INSERT TO authenticated
  WITH CHECK (public.is_crm_company_admin(company_id));

CREATE POLICY "Company admins update permit qualifier settings"
  ON public.crm_company_permit_settings
  FOR UPDATE TO authenticated
  USING (public.is_crm_company_admin(company_id))
  WITH CHECK (public.is_crm_company_admin(company_id));

CREATE TRIGGER crm_company_permit_settings_updated_at
  BEFORE UPDATE ON public.crm_company_permit_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Deliberately no DELETE policy/grant: permit identity details are retained.
