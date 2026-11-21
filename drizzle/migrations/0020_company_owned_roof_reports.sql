ALTER TABLE public.roof_report_orders ADD COLUMN drawing_id uuid REFERENCES public.roof_drawings(id) ON DELETE SET NULL;
ALTER TABLE public.roof_drawings ADD COLUMN report_order_id uuid REFERENCES public.roof_report_orders(id) ON DELETE SET NULL;
COMMENT ON TABLE public.roof_report_orders IS 'Company-owned address-based reports; legacy provider fields never imply an active paid integration.';