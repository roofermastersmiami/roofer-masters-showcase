-- Company-scoped permit applications and inspection appointments.
-- Depends on 0047_company_owned_roof_jobs and the existing company membership helpers.
-- This migration stores CRM workflow records only; it does not submit anything to a
-- municipality or represent a scheduled inspection as municipality-confirmed.

CREATE TABLE public.roof_permit_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.crm_companies(id) ON DELETE RESTRICT,
  roof_job_id uuid NOT NULL,
  jurisdiction_name text NOT NULL CHECK (char_length(trim(jurisdiction_name)) BETWEEN 1 AND 160),
  jurisdiction_code text CHECK (jurisdiction_code IS NULL OR char_length(jurisdiction_code) <= 80),
  permit_type text NOT NULL CHECK (char_length(trim(permit_type)) BETWEEN 1 AND 120),
  application_status text NOT NULL DEFAULT 'draft'
    CHECK (application_status IN ('draft','ready_to_submit','submitted','issued','rejected','expired','cancelled')),
  permit_number text CHECK (permit_number IS NULL OR char_length(permit_number) <= 120),
  portal_url text CHECK (portal_url IS NULL OR char_length(portal_url) <= 2048),
  submitted_at timestamptz,
  issued_at timestamptz,
  expires_at date,
  fee_cents bigint CHECK (fee_cents IS NULL OR fee_cents >= 0),
  notes text NOT NULL DEFAULT '' CHECK (char_length(notes) <= 10000),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT roof_permit_applications_id_company_key UNIQUE (id, company_id),
  CONSTRAINT roof_permit_applications_job_company_fkey
    FOREIGN KEY (roof_job_id, company_id)
    REFERENCES public.roof_jobs(id, company_id) ON DELETE RESTRICT,
  CONSTRAINT roof_permit_application_issue_requires_number
    CHECK (application_status <> 'issued' OR nullif(trim(permit_number), '') IS NOT NULL),
  CONSTRAINT roof_permit_application_submission_timestamp
    CHECK (application_status NOT IN ('submitted','issued','expired') OR submitted_at IS NOT NULL),
  CONSTRAINT roof_permit_application_issue_timestamp
    CHECK (application_status NOT IN ('issued','expired') OR issued_at IS NOT NULL)
);

CREATE INDEX roof_permit_applications_company_status_idx
  ON public.roof_permit_applications(company_id, application_status, updated_at DESC);
CREATE INDEX roof_permit_applications_job_idx
  ON public.roof_permit_applications(roof_job_id, company_id);

CREATE TABLE public.roof_permit_inspections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  application_id uuid NOT NULL,
  inspection_type text NOT NULL CHECK (char_length(trim(inspection_type)) BETWEEN 1 AND 120),
  scheduled_at timestamptz,
  scheduling_status text NOT NULL DEFAULT 'requested'
    CHECK (scheduling_status IN ('requested','scheduled','passed','failed','cancelled')),
  confirmation_number text CHECK (confirmation_number IS NULL OR char_length(confirmation_number) <= 120),
  completed_at timestamptz,
  notes text NOT NULL DEFAULT '' CHECK (char_length(notes) <= 5000),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT roof_permit_inspections_application_company_fkey
    FOREIGN KEY (application_id, company_id)
    REFERENCES public.roof_permit_applications(id, company_id) ON DELETE CASCADE,
  CONSTRAINT roof_permit_inspections_scheduled_timestamp
    CHECK (scheduling_status NOT IN ('scheduled','passed','failed') OR scheduled_at IS NOT NULL),
  CONSTRAINT roof_permit_inspections_completed_timestamp
    CHECK (scheduling_status NOT IN ('passed','failed') OR completed_at IS NOT NULL)
);

CREATE INDEX roof_permit_inspections_company_schedule_idx
  ON public.roof_permit_inspections(company_id, scheduled_at);
CREATE INDEX roof_permit_inspections_application_idx
  ON public.roof_permit_inspections(application_id, company_id);

ALTER TABLE public.roof_permit_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roof_permit_applications FORCE ROW LEVEL SECURITY;
ALTER TABLE public.roof_permit_inspections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roof_permit_inspections FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public.roof_permit_applications, public.roof_permit_inspections FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.roof_permit_applications, public.roof_permit_inspections TO authenticated;
GRANT ALL ON public.roof_permit_applications, public.roof_permit_inspections TO service_role;

CREATE POLICY "Company members read permit applications"
  ON public.roof_permit_applications FOR SELECT TO authenticated
  USING (public.is_crm_company_member(company_id));
CREATE POLICY "Company admins create permit applications"
  ON public.roof_permit_applications FOR INSERT TO authenticated
  WITH CHECK (public.is_crm_company_admin(company_id));
CREATE POLICY "Company admins update permit applications"
  ON public.roof_permit_applications FOR UPDATE TO authenticated
  USING (public.is_crm_company_admin(company_id))
  WITH CHECK (public.is_crm_company_admin(company_id));
CREATE POLICY "Company admins delete permit applications"
  ON public.roof_permit_applications FOR DELETE TO authenticated
  USING (public.is_crm_company_admin(company_id));

CREATE POLICY "Company members read permit inspections"
  ON public.roof_permit_inspections FOR SELECT TO authenticated
  USING (public.is_crm_company_member(company_id));
CREATE POLICY "Company admins create permit inspections"
  ON public.roof_permit_inspections FOR INSERT TO authenticated
  WITH CHECK (public.is_crm_company_admin(company_id));
CREATE POLICY "Company admins update permit inspections"
  ON public.roof_permit_inspections FOR UPDATE TO authenticated
  USING (public.is_crm_company_admin(company_id))
  WITH CHECK (public.is_crm_company_admin(company_id));
CREATE POLICY "Company admins delete permit inspections"
  ON public.roof_permit_inspections FOR DELETE TO authenticated
  USING (public.is_crm_company_admin(company_id));

CREATE TRIGGER roof_permit_applications_updated_at
  BEFORE UPDATE ON public.roof_permit_applications
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER roof_permit_inspections_updated_at
  BEFORE UPDATE ON public.roof_permit_inspections
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.roof_permit_applications IS
  'Company-owned permit application workflow linked to a same-company roof job. Submission and issuance fields are entered only after external confirmation.';
COMMENT ON TABLE public.roof_permit_inspections IS
  'Company-owned inspection request and outcome records. Scheduled/passed/failed states require timestamps; municipal confirmation remains an explicit manual entry.';
