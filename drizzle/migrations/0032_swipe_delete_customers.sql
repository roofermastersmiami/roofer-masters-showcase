CREATE OR REPLACE FUNCTION public.delete_crm_customer(p_customer_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  deleted_id uuid;
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['office','sales']::public.app_role[]) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.crm_customers WHERE id = p_customer_id) THEN
    RAISE EXCEPTION 'Customer not found';
  END IF;

  IF EXISTS (SELECT 1 FROM public.crm_properties WHERE customer_id = p_customer_id) THEN
    RAISE EXCEPTION 'This customer has linked properties. Reassign or remove the properties before deleting the customer.';
  END IF;

  IF EXISTS (SELECT 1 FROM public.roof_report_orders WHERE customer_id = p_customer_id) THEN
    RAISE EXCEPTION 'This customer has roof measurement reports. Reassign or remove those reports before deleting the customer.';
  END IF;

  -- Keep the original lead and its history; only detach its CRM customer link.
  UPDATE public.leads SET customer_id = NULL WHERE customer_id = p_customer_id;

  DELETE FROM public.crm_customers
  WHERE id = p_customer_id
  RETURNING id INTO deleted_id;

  RETURN deleted_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.delete_crm_customer(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_crm_customer(uuid) TO authenticated;
