-- Do not allow authenticated CRM users to mark a change order approved by typing a customer name.
-- A future verified customer-signature workflow can replace this guard with a dedicated RPC.
CREATE OR REPLACE FUNCTION public.prevent_unverified_change_order_approval()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status = 'approved'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'approved') THEN
    RAISE EXCEPTION 'Customer approval must be verified before approving a change order';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prevent_unverified_change_order_approval ON public.job_change_orders;
CREATE TRIGGER prevent_unverified_change_order_approval
BEFORE INSERT OR UPDATE OF status ON public.job_change_orders
FOR EACH ROW EXECUTE FUNCTION public.prevent_unverified_change_order_approval();

COMMENT ON FUNCTION public.prevent_unverified_change_order_approval() IS
  'Blocks unverified transitions into approved; only a future verified customer-signature workflow may enable approval.';
