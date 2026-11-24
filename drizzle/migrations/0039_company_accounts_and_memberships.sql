-- Company account and membership foundation.
-- This migration deliberately does not alter operational-table RLS yet. Existing
-- CRM records remain on their current single-company access model until each
-- table and its dependent RPCs can be migrated together.

DO $$ BEGIN
  CREATE TYPE public.crm_company_role AS ENUM (
    'owner', 'admin', 'office', 'sales', 'production_manager', 'crew', 'accounting'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.crm_companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 2 AND 120),
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.crm_company_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.crm_companies(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.crm_company_role NOT NULL DEFAULT 'office',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, user_id)
);

CREATE INDEX IF NOT EXISTS crm_company_memberships_user_idx
  ON public.crm_company_memberships(user_id, company_id);

ALTER TABLE public.crm_companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_company_memberships ENABLE ROW LEVEL SECURITY;

GRANT SELECT, UPDATE ON public.crm_companies TO authenticated;
GRANT SELECT ON public.crm_company_memberships TO authenticated;
GRANT ALL ON public.crm_companies, public.crm_company_memberships TO service_role;

CREATE OR REPLACE FUNCTION public.is_crm_company_member(_company_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.crm_company_memberships m
    WHERE m.company_id = _company_id AND m.user_id = auth.uid()
  )
$$;

CREATE OR REPLACE FUNCTION public.is_crm_company_admin(_company_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.crm_company_memberships m
    WHERE m.company_id = _company_id
      AND m.user_id = auth.uid()
      AND m.role IN ('owner', 'admin')
  )
$$;

REVOKE ALL ON FUNCTION public.is_crm_company_member(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_crm_company_admin(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_crm_company_member(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_crm_company_admin(uuid) TO authenticated, service_role;

CREATE POLICY "Company members can read their companies"
  ON public.crm_companies FOR SELECT TO authenticated
  USING (public.is_crm_company_member(id));

CREATE POLICY "Company admins can update company profile"
  ON public.crm_companies FOR UPDATE TO authenticated
  USING (public.is_crm_company_admin(id))
  WITH CHECK (public.is_crm_company_admin(id));

CREATE POLICY "Members can read company membership"
  ON public.crm_company_memberships FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_crm_company_member(company_id));

CREATE TRIGGER crm_companies_updated_at
  BEFORE UPDATE ON public.crm_companies
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Company creation and owner membership are atomic. Membership writes remain
-- closed to clients; invitations/role changes will be added through audited RPCs.
CREATE OR REPLACE FUNCTION public.create_crm_company(p_name text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  company_uuid uuid;
  normalized_name text := btrim(coalesce(p_name, ''));
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF char_length(normalized_name) NOT BETWEEN 2 AND 120 THEN
    RAISE EXCEPTION 'Company name must be between 2 and 120 characters';
  END IF;

  INSERT INTO public.crm_companies(name, created_by)
  VALUES (normalized_name, auth.uid())
  RETURNING id INTO company_uuid;

  INSERT INTO public.crm_company_memberships(company_id, user_id, role)
  VALUES (company_uuid, auth.uid(), 'owner');

  RETURN company_uuid;
END;
$$;

REVOKE ALL ON FUNCTION public.create_crm_company(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_crm_company(text) TO authenticated, service_role;
