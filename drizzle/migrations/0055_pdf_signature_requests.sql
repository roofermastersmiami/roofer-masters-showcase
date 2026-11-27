-- PDF Studio signature requests (Acrobat-style "Request signatures").
-- Forward-only migration. A request stores one uploaded PDF, up to two
-- signers (each with their own capability token, mirroring proposal_shares),
-- the fields the owner placed in PDF Studio (PDF points, bottom-left origin),
-- and the values each signer submitted. Documents live in a private bucket
-- that is only reachable through service-role server functions, so no
-- storage policies are created for anon/authenticated on purpose.
-- tenant-audit: reviewed — table is company-scoped (company_id NOT NULL,
-- membership-checked SELECT policy); all writes run through server
-- functions that derive the company from crm_company_memberships and never
-- accept a caller-supplied company id. Public signing endpoints authorize
-- solely by the per-signer token and only touch the matching request row.

CREATE TABLE public.pdf_signature_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.crm_companies(id) ON DELETE RESTRICT,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  document_name text NOT NULL,
  document_path text NOT NULL,
  signed_path text,
  signers jsonb NOT NULL DEFAULT '[]'::jsonb,
  fields jsonb NOT NULL DEFAULT '[]'::jsonb,
  field_values jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed')),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  revoked_at timestamptz,
  completed_at timestamptz
);
CREATE INDEX pdf_signature_requests_company_created_idx
  ON public.pdf_signature_requests (company_id, created_at DESC);

GRANT SELECT ON public.pdf_signature_requests TO authenticated;
GRANT ALL ON public.pdf_signature_requests TO service_role;
ALTER TABLE public.pdf_signature_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Company members read signature requests"
  ON public.pdf_signature_requests FOR SELECT TO authenticated
  USING (public.is_crm_company_member(company_id));
CREATE TRIGGER pdf_signature_requests_updated_at
  BEFORE UPDATE ON public.pdf_signature_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('pdf-signature-documents', 'pdf-signature-documents', false, 31457280, ARRAY['application/pdf'])
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = 31457280,
  allowed_mime_types = ARRAY['application/pdf'];
