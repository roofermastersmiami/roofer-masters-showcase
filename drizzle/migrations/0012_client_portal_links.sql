CREATE TABLE public.client_portal_links (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE, token uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(), expires_at timestamptz NOT NULL DEFAULT (now() + interval '90 days'), revoked_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
GRANT SELECT, INSERT, UPDATE ON public.client_portal_links TO authenticated;
GRANT ALL ON public.client_portal_links TO service_role;
ALTER TABLE public.client_portal_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owner manages client portal links" ON public.client_portal_links FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));
CREATE INDEX client_portal_links_lead_idx ON public.client_portal_links(lead_id);