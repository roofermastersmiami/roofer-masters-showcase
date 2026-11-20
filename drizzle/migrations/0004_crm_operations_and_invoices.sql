CREATE TABLE public.crm_tasks (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL, title text NOT NULL, due_at timestamptz NOT NULL, completed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_tasks TO authenticated;
GRANT ALL ON public.crm_tasks TO service_role;
ALTER TABLE public.crm_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owner tasks" ON public.crm_tasks FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE INDEX crm_tasks_lead_idx ON public.crm_tasks(lead_id);
CREATE TABLE public.roof_estimates (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL, title text NOT NULL, category text NOT NULL, inputs jsonb NOT NULL, total_cents bigint NOT NULL CHECK (total_cents >= 0), created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.roof_estimates TO authenticated;
GRANT ALL ON public.roof_estimates TO service_role;
ALTER TABLE public.roof_estimates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owner estimates" ON public.roof_estimates FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE INDEX roof_estimates_lead_idx ON public.roof_estimates(lead_id);
CREATE TABLE public.roof_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL, proposal_id uuid REFERENCES public.proposals(id) ON DELETE SET NULL, title text NOT NULL, status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','in_progress','completed','on_hold')), crew text NOT NULL DEFAULT '', inspection_at timestamptz, start_date date, permit_status text NOT NULL DEFAULT 'not_started' CHECK (permit_status IN ('not_started','submitted','approved','not_required')), notes text NOT NULL DEFAULT '', checklist jsonb NOT NULL DEFAULT '[]', photos jsonb NOT NULL DEFAULT '[]', created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.roof_jobs TO authenticated;
GRANT ALL ON public.roof_jobs TO service_role;
ALTER TABLE public.roof_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owner jobs" ON public.roof_jobs FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE INDEX roof_jobs_lead_idx ON public.roof_jobs(lead_id);
CREATE INDEX roof_jobs_proposal_idx ON public.roof_jobs(proposal_id);
CREATE TABLE public.crm_invoices (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), number bigint GENERATED ALWAYS AS IDENTITY UNIQUE, lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL, proposal_id uuid REFERENCES public.proposals(id) ON DELETE SET NULL, customer_name text NOT NULL, customer_email text NOT NULL DEFAULT '', customer_address text NOT NULL DEFAULT '', title text NOT NULL, items jsonb NOT NULL, subtotal_cents bigint NOT NULL CHECK(subtotal_cents >= 0), tax_cents bigint NOT NULL DEFAULT 0 CHECK(tax_cents >= 0), total_cents bigint NOT NULL CHECK(total_cents > 0), deposit_cents bigint NOT NULL DEFAULT 0 CHECK(deposit_cents >= 0 AND deposit_cents <= total_cents), paid_cents bigint NOT NULL DEFAULT 0 CHECK(paid_cents >= 0 AND paid_cents <= total_cents), status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','issued','void')), due_date date NOT NULL, notes text NOT NULL DEFAULT '', token uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE, expires_at timestamptz NOT NULL DEFAULT (now() + interval '90 days'), created_at timestamptz NOT NULL DEFAULT now(), CHECK(total_cents = subtotal_cents + tax_cents)
);
GRANT SELECT ON public.crm_invoices TO authenticated;
GRANT ALL ON public.crm_invoices TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.crm_invoices_number_seq TO service_role;
ALTER TABLE public.crm_invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owner invoice reads" ON public.crm_invoices FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE INDEX crm_invoices_lead_idx ON public.crm_invoices(lead_id);
CREATE INDEX crm_invoices_proposal_idx ON public.crm_invoices(proposal_id);
CREATE TABLE public.invoice_payments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), invoice_id uuid NOT NULL REFERENCES public.crm_invoices(id), amount_cents bigint NOT NULL CHECK(amount_cents > 0), method text NOT NULL CHECK(method IN ('cash','check','bank_transfer','card_external','stripe')), reference text NOT NULL DEFAULT '', provider_event_id text UNIQUE, received_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.invoice_payments TO authenticated;
GRANT ALL ON public.invoice_payments TO service_role;
ALTER TABLE public.invoice_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owner payment reads" ON public.invoice_payments FOR SELECT TO authenticated USING(public.has_role(auth.uid(), 'admin'));
CREATE INDEX invoice_payments_invoice_idx ON public.invoice_payments(invoice_id);
CREATE FUNCTION public.record_invoice_payment(p_invoice_id uuid, p_amount_cents bigint, p_method text, p_reference text, p_received_at timestamptz) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE inv public.crm_invoices; payment_id uuid;
BEGIN
 IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Owner access required'; END IF;
 IF p_method NOT IN ('cash','check','bank_transfer','card_external') OR p_amount_cents <= 0 OR p_received_at IS NULL THEN RAISE EXCEPTION 'Invalid payment'; END IF;
 SELECT * INTO inv FROM public.crm_invoices WHERE id = p_invoice_id FOR UPDATE;
 IF inv.id IS NULL OR inv.status <> 'issued' THEN RAISE EXCEPTION 'Issue the invoice before recording a payment'; END IF;
 IF p_amount_cents > inv.total_cents - inv.paid_cents THEN RAISE EXCEPTION 'Payment exceeds outstanding balance'; END IF;
 INSERT INTO public.invoice_payments(invoice_id, amount_cents, method, reference, received_at) VALUES(p_invoice_id,p_amount_cents,p_method,left(p_reference,200),p_received_at) RETURNING id INTO payment_id;
 UPDATE public.crm_invoices SET paid_cents = paid_cents + p_amount_cents WHERE id = p_invoice_id;
 RETURN payment_id;
END; $$;
REVOKE ALL ON FUNCTION public.record_invoice_payment(uuid,bigint,text,text,timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_invoice_payment(uuid,bigint,text,text,timestamptz) TO authenticated;
