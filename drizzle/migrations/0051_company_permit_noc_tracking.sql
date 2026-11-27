-- Company-scoped Notice of Commencement tracking.
-- This records a staff assessment and clerk-recording evidence only. It does not
-- calculate a statutory threshold or decide whether an NOC is legally required.

CREATE TABLE public.roof_permit_noc_tracking (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.crm_companies(id) ON DELETE RESTRICT,
  permit_application_id uuid NOT NULL UNIQUE,
  assessment_status text NOT NULL DEFAULT 'not_assessed'
    CHECK (assessment_status IN ('not_assessed','required','not_required')),
  recording_status text NOT NULL DEFAULT 'not_started'
    CHECK (recording_status IN ('not_started','draft','recorded')),
  contract_value_cents bigint CHECK (contract_value_cents IS NULL OR contract_value_cents >= 0),
  threshold_amount_cents bigint CHECK (threshold_amount_cents IS NULL OR threshold_amount_cents >= 0),
  assessment_basis text NOT NULL DEFAULT '' CHECK (char_length(assessment_basis) <= 3000),
  threshold_source_url text CHECK (threshold_source_url IS NULL OR (char_length(threshold_source_url) <= 2048 AND threshold_source_url ~* '^https?://')),
  recording_county text NOT NULL DEFAULT '' CHECK (char_length(recording_county) <= 100),
  instrument_number text CHECK (instrument_number IS NULL OR char_length(instrument_number) <= 120),
  recorded_on date,
  clerk_receipt_url text CHECK (clerk_receipt_url IS NULL OR (char_length(clerk_receipt_url) <= 2048 AND clerk_receipt_url ~* '^https?://')),
  notes text NOT NULL DEFAULT '' CHECK (char_length(notes) <= 4000),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT roof_permit_noc_application_company_key UNIQUE (permit_application_id, company_id),
  CONSTRAINT roof_permit_noc_assessment_evidence_guard
    CHECK (
      assessment_status = 'not_assessed'
      OR (nullif(trim(assessment_basis), '') IS NOT NULL AND threshold_source_url IS NOT NULL)
    ),
  CONSTRAINT roof_permit_noc_required_value_guard
    CHECK (
      assessment_status <> 'required'
      OR (contract_value_cents IS NOT NULL AND threshold_amount_cents IS NOT NULL)
    ),
  CONSTRAINT roof_permit_noc_application_company_fkey
    FOREIGN KEY (permit_application_id, company_id)
    REFERENCES public.roof_permit_applications(id, company_id) ON DELETE CASCADE,
  CONSTRAINT roof_permit_noc_recorded_evidence_guard
    CHECK (recording_status <> 'recorded' OR (
      assessment_status = 'required'
      AND nullif(trim(recording_county), '') IS NOT NULL
      AND nullif(trim(instrument_number), '') IS NOT NULL
      AND recorded_on IS NOT NULL
    )),
  CONSTRAINT roof_permit_noc_not_required_guard
    CHECK (assessment_status <> 'not_required' OR recording_status <> 'recorded')
);

CREATE INDEX roof_permit_noc_company_status_idx
  ON public.roof_permit_noc_tracking(company_id, assessment_status, recording_status);

ALTER TABLE public.roof_permit_noc_tracking ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roof_permit_noc_tracking FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.roof_permit_noc_tracking FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.roof_permit_noc_tracking TO authenticated;
GRANT ALL ON public.roof_permit_noc_tracking TO service_role;

CREATE POLICY "Company members read NOC tracking"
  ON public.roof_permit_noc_tracking FOR SELECT TO authenticated
  USING (public.is_crm_company_member(company_id));
CREATE POLICY "Company admins create NOC tracking"
  ON public.roof_permit_noc_tracking FOR INSERT TO authenticated
  WITH CHECK (public.is_crm_company_admin(company_id));
CREATE POLICY "Company admins update NOC tracking"
  ON public.roof_permit_noc_tracking FOR UPDATE TO authenticated
  USING (public.is_crm_company_admin(company_id))
  WITH CHECK (public.is_crm_company_admin(company_id));
CREATE POLICY "Company admins delete NOC tracking"
  ON public.roof_permit_noc_tracking FOR DELETE TO authenticated
  USING (public.is_crm_company_admin(company_id));

CREATE TRIGGER roof_permit_noc_tracking_updated_at
  BEFORE UPDATE ON public.roof_permit_noc_tracking
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.roof_permit_noc_tracking IS
  'Company-owned NOC assessment and recording evidence. Threshold and requirement are staff-entered from a cited current authority; the CRM does not infer legal applicability.';
