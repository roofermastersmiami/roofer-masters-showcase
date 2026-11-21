CREATE TABLE public.invoice_project_links (invoice_id uuid PRIMARY KEY REFERENCES public.crm_invoices(id) ON DELETE CASCADE, job_id uuid NOT NULL REFERENCES public.roof_jobs(id) ON DELETE CASCADE, created_at timestamptz NOT NULL DEFAULT now());
GRANT SELECT,INSERT,UPDATE,DELETE ON public.invoice_project_links TO authenticated;
GRANT ALL ON public.invoice_project_links TO service_role;
ALTER TABLE public.invoice_project_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owner invoice allocations" ON public.invoice_project_links FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE FUNCTION public.validate_invoice_project_link() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE invoice_lead uuid; job_lead uuid; invoice_property uuid; job_property uuid;
BEGIN
 SELECT lead_id,property_id INTO invoice_lead,invoice_property FROM public.crm_invoices WHERE id=NEW.invoice_id;
 SELECT lead_id,property_id INTO job_lead,job_property FROM public.roof_jobs WHERE id=NEW.job_id;
 IF invoice_lead IS NULL OR job_lead IS NULL OR invoice_lead<>job_lead THEN RAISE EXCEPTION 'Invoice and project must have the same customer'; END IF;
 IF invoice_property IS NOT NULL AND job_property IS NOT NULL AND invoice_property<>job_property THEN RAISE EXCEPTION 'Invoice and project properties do not match'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER validate_invoice_project_link BEFORE INSERT OR UPDATE ON public.invoice_project_links FOR EACH ROW EXECUTE FUNCTION public.validate_invoice_project_link();