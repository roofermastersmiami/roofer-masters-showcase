CREATE TABLE public.proposals (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 title text NOT NULL,
 category text NOT NULL,
 is_template boolean NOT NULL DEFAULT false,
 lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
 scope text NOT NULL DEFAULT '',
 terms text NOT NULL DEFAULT '',
 amount numeric(12,2),
 file_path text,
 CONSTRAINT proposal_category CHECK (category IN ('Metal Roof','Tile Roof','Shingle Roof','TPO','Flat Roof','Roof Replacement','Roof Repairs','Gutters','Other'))
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.proposals TO authenticated;
GRANT ALL ON public.proposals TO service_role;
ALTER TABLE public.proposals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners manage proposals" ON public.proposals FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER proposals_updated_at BEFORE UPDATE ON public.proposals FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TABLE public.proposal_shares (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 proposal_id uuid NOT NULL REFERENCES public.proposals(id) ON DELETE CASCADE,
 token uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
 created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
 revoked_at timestamptz
);
GRANT SELECT ON public.proposal_shares TO authenticated;
GRANT ALL ON public.proposal_shares TO service_role;
ALTER TABLE public.proposal_shares ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners read proposal shares" ON public.proposal_shares FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Owners read proposal files" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'roofing-proposals' AND public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Owners upload proposal files" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'roofing-proposals' AND public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Owners update proposal files" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'roofing-proposals' AND public.has_role(auth.uid(), 'admin')) WITH CHECK (bucket_id = 'roofing-proposals' AND public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Owners delete proposal files" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'roofing-proposals' AND public.has_role(auth.uid(), 'admin'));