CREATE TABLE public.roof_drawings(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),property_id uuid NOT NULL REFERENCES public.crm_properties(id),title text NOT NULL,geometry jsonb NOT NULL,measurements jsonb NOT NULL,revision integer NOT NULL DEFAULT 1,parent_id uuid REFERENCES public.roof_drawings(id),media jsonb NOT NULL DEFAULT '[]',created_at timestamptz NOT NULL DEFAULT now());
GRANT SELECT,INSERT ON public.roof_drawings TO authenticated; GRANT ALL ON public.roof_drawings TO service_role;
ALTER TABLE public.roof_drawings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owner reads drawings" ON public.roof_drawings FOR SELECT TO authenticated USING(public.has_role(auth.uid(),'admin'));
CREATE POLICY "Owner saves drawing revisions" ON public.roof_drawings FOR INSERT TO authenticated WITH CHECK(public.has_role(auth.uid(),'admin'));
ALTER TABLE public.roof_estimates ADD COLUMN drawing_id uuid REFERENCES public.roof_drawings(id);
ALTER TABLE public.roof_jobs ADD COLUMN drawing_id uuid REFERENCES public.roof_drawings(id);
ALTER TABLE public.proposals ADD COLUMN drawing_id uuid REFERENCES public.roof_drawings(id);
CREATE INDEX roof_drawings_property_idx ON public.roof_drawings(property_id,created_at DESC);