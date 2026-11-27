-- Replace the legacy globally-authorized customer delete RPC.
-- Depends on 0042 company ownership and 0044 membership-scoped customer access.
-- tenant-audit: reviewed — derives one company from auth.uid(), restricts all
-- customer/child/lead operations to that company, and fails closed otherwise.
CREATE OR REPLACE FUNCTION public.delete_crm_customer(p_customer_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  actor_company_id uuid;
  actor_role text;
  membership_count integer;
  locked_customer_id uuid;
  deleted_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;

  SELECT count(*) INTO membership_count
  FROM public.crm_company_memberships WHERE user_id = auth.uid();
  IF membership_count <> 1 THEN
    RAISE EXCEPTION 'A single company membership is required';
  END IF;

  SELECT company_id, role::text INTO actor_company_id, actor_role
  FROM public.crm_company_memberships WHERE user_id = auth.uid();
  IF actor_company_id IS NULL THEN
    RAISE EXCEPTION 'A single company membership is required';
  END IF;
  IF actor_role NOT IN ('owner', 'admin', 'office', 'sales') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT id INTO locked_customer_id
  FROM public.crm_customers
  WHERE id = p_customer_id AND company_id = actor_company_id
  FOR UPDATE;
  IF locked_customer_id IS NULL THEN RAISE EXCEPTION 'Customer unavailable'; END IF;

  IF EXISTS (SELECT 1 FROM public.crm_properties
    WHERE customer_id = locked_customer_id AND company_id = actor_company_id) THEN
    RAISE EXCEPTION 'This customer has linked properties. Reassign or remove the properties before deleting the customer.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.roof_report_orders
    WHERE customer_id = locked_customer_id AND company_id = actor_company_id) THEN
    RAISE EXCEPTION 'This customer has roof measurement reports. Reassign or remove those reports before deleting the customer.';
  END IF;

  UPDATE public.leads SET customer_id = NULL
  WHERE customer_id = locked_customer_id AND company_id = actor_company_id;

  DELETE FROM public.crm_customers
  WHERE id = locked_customer_id AND company_id = actor_company_id
  RETURNING id INTO deleted_id;
  IF deleted_id IS NULL THEN RAISE EXCEPTION 'Customer unavailable'; END IF;
  RETURN deleted_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.delete_crm_customer(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.delete_crm_customer(uuid) TO authenticated;
COMMENT ON FUNCTION public.delete_crm_customer(uuid) IS
  'Company-scoped CRM customer delete; requires exactly one authorized company membership.';
