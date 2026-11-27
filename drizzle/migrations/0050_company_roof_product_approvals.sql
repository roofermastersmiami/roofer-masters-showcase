-- Company-scoped Florida Product Approval / Miami-Dade NOA register.
-- Approval records are evidence references, not a determination that a product is
-- approved for a specific assembly, building pressure, or installation condition.

CREATE TABLE public.roof_product_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.crm_companies(id) ON DELETE RESTRICT,
  permit_application_id uuid NOT NULL,
  approval_kind text NOT NULL CHECK (approval_kind IN ('miami_dade_noa','florida_product_approval','ul_listing','fire_directory')),
  approval_number text NOT NULL CHECK (char_length(trim(approval_number)) BETWEEN 1 AND 120),
  manufacturer text NOT NULL CHECK (char_length(trim(manufacturer)) BETWEEN 1 AND 160),
  product_name text NOT NULL CHECK (char_length(trim(product_name)) BETWEEN 1 AND 200),
  product_category text NOT NULL DEFAULT '' CHECK (char_length(product_category) <= 120),
  approval_status text NOT NULL DEFAULT 'unverified'
    CHECK (approval_status IN ('unverified','verified','expired','revoked')),
  issued_on date,
  expires_on date,
  hvhz_status text NOT NULL DEFAULT 'unknown' CHECK (hvhz_status IN ('yes','no','unknown')),
  system_description text NOT NULL DEFAULT '' CHECK (char_length(system_description) <= 4000),
  installation_limitations text NOT NULL DEFAULT '' CHECK (char_length(installation_limitations) <= 4000),
  source_url text CHECK (source_url IS NULL OR (char_length(source_url) <= 2048 AND source_url ~* '^https?://')),
  verified_at timestamptz,
  verified_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT roof_product_approvals_id_company_key UNIQUE (id, company_id),
  CONSTRAINT roof_product_approvals_application_company_fkey
    FOREIGN KEY (permit_application_id, company_id)
    REFERENCES public.roof_permit_applications(id, company_id) ON DELETE CASCADE,
  CONSTRAINT roof_product_approvals_verification_guard
    CHECK (approval_status <> 'verified' OR (verified_at IS NOT NULL AND verified_by IS NOT NULL)),
  CONSTRAINT roof_product_approvals_expiry_guard
    CHECK (approval_status <> 'expired' OR expires_on IS NOT NULL)
);

CREATE INDEX roof_product_approvals_company_application_idx
  ON public.roof_product_approvals(company_id, permit_application_id, updated_at DESC);
CREATE INDEX roof_product_approvals_number_idx
  ON public.roof_product_approvals(company_id, approval_kind, approval_number);

ALTER TABLE public.roof_product_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roof_product_approvals FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.roof_product_approvals FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.roof_product_approvals TO authenticated;
GRANT ALL ON public.roof_product_approvals TO service_role;

CREATE POLICY "Company members read roof product approvals"
  ON public.roof_product_approvals FOR SELECT TO authenticated
  USING (public.is_crm_company_member(company_id));
CREATE POLICY "Company admins create roof product approvals"
  ON public.roof_product_approvals FOR INSERT TO authenticated
  WITH CHECK (public.is_crm_company_admin(company_id));
CREATE POLICY "Company admins update roof product approvals"
  ON public.roof_product_approvals FOR UPDATE TO authenticated
  USING (public.is_crm_company_admin(company_id))
  WITH CHECK (public.is_crm_company_admin(company_id));
CREATE POLICY "Company admins delete roof product approvals"
  ON public.roof_product_approvals FOR DELETE TO authenticated
  USING (public.is_crm_company_admin(company_id));

CREATE TRIGGER roof_product_approvals_updated_at
  BEFORE UPDATE ON public.roof_product_approvals
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.roof_product_approvals IS
  'Company-owned product approval evidence linked to a permit application. Verify current approval status, HVHZ scope, system details, and installation limitations against official source documents before use.';
