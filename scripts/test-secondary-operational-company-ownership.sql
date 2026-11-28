\set ON_ERROR_STOP on
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA auth;
DO $role$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $role$;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $auth_uid$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
$auth_uid$;
GRANT USAGE ON SCHEMA auth TO authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
CREATE TABLE auth.users(id uuid PRIMARY KEY);
INSERT INTO auth.users VALUES('00000000-0000-0000-0000-000000000001');
CREATE TABLE crm_companies(id uuid PRIMARY KEY,name text,slug text UNIQUE,created_by uuid REFERENCES auth.users(id),created_at timestamptz DEFAULT now());
CREATE TABLE crm_company_memberships(id uuid DEFAULT gen_random_uuid(),company_id uuid REFERENCES crm_companies(id),user_id uuid REFERENCES auth.users(id),role text);
INSERT INTO crm_companies(id,name,slug,created_by) VALUES('10000000-0000-0000-0000-000000000001','Roofer Masters','roofer-masters','00000000-0000-0000-0000-000000000001');
INSERT INTO crm_company_memberships(company_id,user_id,role) VALUES('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','owner');
CREATE TABLE leads(id uuid PRIMARY KEY,company_id uuid NOT NULL,UNIQUE(id,company_id));
CREATE TABLE crm_properties(id uuid PRIMARY KEY,company_id uuid NOT NULL,UNIQUE(id,company_id));
CREATE TABLE roof_jobs(id uuid PRIMARY KEY,company_id uuid NOT NULL,UNIQUE(id,company_id));
CREATE TABLE roof_drawings(id uuid PRIMARY KEY,property_id uuid);
CREATE TABLE roof_report_orders(id uuid PRIMARY KEY,property_id uuid,company_id uuid,UNIQUE(id,company_id));
CREATE TABLE proposals(id uuid PRIMARY KEY,lead_id uuid,property_id uuid,drawing_id uuid);
CREATE TABLE crm_invoices(id uuid PRIMARY KEY,lead_id uuid,proposal_id uuid,property_id uuid);
CREATE TABLE client_portal_links(id uuid PRIMARY KEY,lead_id uuid);
CREATE TABLE crm_activity(id uuid PRIMARY KEY,lead_id uuid);
CREATE TABLE crm_expenses(id uuid PRIMARY KEY,job_id uuid);
CREATE TABLE crm_tasks(id uuid PRIMARY KEY,lead_id uuid);
CREATE TABLE invoice_checkouts(id uuid PRIMARY KEY,invoice_id uuid);
CREATE TABLE invoice_payments(id uuid PRIMARY KEY,invoice_id uuid);
CREATE TABLE invoice_project_links(invoice_id uuid,job_id uuid);
CREATE TABLE job_change_orders(id uuid PRIMARY KEY,job_id uuid);
CREATE TABLE lead_messages(id uuid PRIMARY KEY,lead_id uuid,sender text NOT NULL DEFAULT 'customer');
CREATE TABLE proposal_shares(id uuid PRIMARY KEY,proposal_id uuid);
CREATE TABLE roof_estimates(id uuid PRIMARY KEY,lead_id uuid,property_id uuid,drawing_id uuid,report_order_id uuid);
INSERT INTO leads VALUES('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001');
INSERT INTO crm_properties VALUES('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001');
INSERT INTO roof_jobs VALUES('40000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001');
INSERT INTO roof_drawings VALUES('50000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001');
INSERT INTO roof_report_orders VALUES('60000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001');
INSERT INTO proposals VALUES('70000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001'),('70000000-0000-0000-0000-000000000002',NULL,NULL,NULL);
INSERT INTO crm_invoices VALUES('80000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001');
INSERT INTO client_portal_links VALUES('90000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001');
INSERT INTO crm_activity VALUES('91000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001');
INSERT INTO crm_expenses VALUES('92000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001');
INSERT INTO crm_tasks VALUES('93000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001');
INSERT INTO invoice_checkouts VALUES('94000000-0000-0000-0000-000000000001','80000000-0000-0000-0000-000000000001');
INSERT INTO invoice_payments VALUES('95000000-0000-0000-0000-000000000001','80000000-0000-0000-0000-000000000001');
INSERT INTO invoice_project_links VALUES('80000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001');
INSERT INTO job_change_orders VALUES('96000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001');
INSERT INTO lead_messages VALUES('97000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001');
INSERT INTO proposal_shares VALUES('98000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000001');
INSERT INTO roof_estimates VALUES('99000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000001');
\ir ../drizzle/migrations/0056_secondary_operational_company_ownership.sql
\ir ../drizzle/migrations/0063_company_owned_drawing_references.sql
\ir ../drizzle/migrations/0064_prevent_drawing_parent_reassignment.sql
\ir ../drizzle/migrations/0065_replace_secondary_operational_rls.sql
\ir ../drizzle/migrations/0066_prevent_unverified_change_order_approval.sql
DO $$ BEGIN
 IF (SELECT count(*) FROM proposals)<>2 OR NOT EXISTS(SELECT 1 FROM proposals WHERE id='70000000-0000-0000-0000-000000000002' AND lead_id IS NULL AND property_id IS NULL AND drawing_id IS NULL) THEN RAISE EXCEPTION 'Parentless proposal not preserved'; END IF;
 IF EXISTS(SELECT 1 FROM client_portal_links WHERE company_id IS NULL) OR EXISTS(SELECT 1 FROM crm_activity WHERE company_id IS NULL) OR EXISTS(SELECT 1 FROM crm_expenses WHERE company_id IS NULL) OR EXISTS(SELECT 1 FROM crm_invoices WHERE company_id IS NULL) OR EXISTS(SELECT 1 FROM crm_tasks WHERE company_id IS NULL) OR EXISTS(SELECT 1 FROM invoice_checkouts WHERE company_id IS NULL) OR EXISTS(SELECT 1 FROM invoice_payments WHERE company_id IS NULL) OR EXISTS(SELECT 1 FROM invoice_project_links WHERE company_id IS NULL) OR EXISTS(SELECT 1 FROM job_change_orders WHERE company_id IS NULL) OR EXISTS(SELECT 1 FROM lead_messages WHERE company_id IS NULL) OR EXISTS(SELECT 1 FROM proposal_shares WHERE company_id IS NULL) OR EXISTS(SELECT 1 FROM proposals WHERE company_id IS NULL) OR EXISTS(SELECT 1 FROM roof_estimates WHERE company_id IS NULL) THEN RAISE EXCEPTION 'Missing company ownership'; END IF;
END $$;
INSERT INTO auth.users VALUES('00000000-0000-0000-0000-000000000002');
INSERT INTO crm_companies(id,name,slug,created_by) VALUES('10000000-0000-0000-0000-000000000002','Company B','company-b','00000000-0000-0000-0000-000000000002');
INSERT INTO leads VALUES('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002');
DO $$ BEGIN
 BEGIN INSERT INTO crm_tasks(id,lead_id,company_id) VALUES('a3000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001'); RAISE EXCEPTION 'Cross-company task accepted'; EXCEPTION WHEN foreign_key_violation THEN NULL; END;
 BEGIN INSERT INTO proposal_shares(id,proposal_id,company_id) VALUES('a6000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002'); RAISE EXCEPTION 'Cross-company share accepted'; EXCEPTION WHEN foreign_key_violation THEN NULL; END;
 BEGIN INSERT INTO crm_tasks(id,lead_id,company_id) VALUES('a9000000-0000-0000-0000-000000000001',NULL,NULL); RAISE EXCEPTION 'Missing company_id accepted'; EXCEPTION WHEN not_null_violation THEN NULL; END;
END $$;

-- Exercise the composite tenant foreign keys across every secondary parent relation.
DO $tenant_fks$
BEGIN
 BEGIN INSERT INTO client_portal_links(id,lead_id,company_id) VALUES('a1000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002'); RAISE EXCEPTION 'Cross-company portal link accepted'; EXCEPTION WHEN foreign_key_violation THEN NULL; END;
 BEGIN INSERT INTO crm_activity(id,lead_id,company_id) VALUES('a2000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002'); RAISE EXCEPTION 'Cross-company activity accepted'; EXCEPTION WHEN foreign_key_violation THEN NULL; END;
 BEGIN INSERT INTO crm_expenses(id,job_id,company_id) VALUES('a3000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002'); RAISE EXCEPTION 'Cross-company expense accepted'; EXCEPTION WHEN foreign_key_violation THEN NULL; END;
 BEGIN INSERT INTO crm_invoices(id,lead_id,company_id) VALUES('a4000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002'); RAISE EXCEPTION 'Cross-company invoice accepted'; EXCEPTION WHEN foreign_key_violation THEN NULL; END;
 BEGIN INSERT INTO crm_tasks(id,lead_id,company_id) VALUES('a5000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002'); RAISE EXCEPTION 'Cross-company task accepted'; EXCEPTION WHEN foreign_key_violation THEN NULL; END;
 BEGIN INSERT INTO invoice_checkouts(id,invoice_id,company_id) VALUES('a6000000-0000-0000-0000-000000000002','80000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002'); RAISE EXCEPTION 'Cross-company checkout accepted'; EXCEPTION WHEN foreign_key_violation THEN NULL; END;
 BEGIN INSERT INTO invoice_payments(id,invoice_id,company_id) VALUES('a7000000-0000-0000-0000-000000000001','80000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002'); RAISE EXCEPTION 'Cross-company payment accepted'; EXCEPTION WHEN foreign_key_violation THEN NULL; END;
 BEGIN INSERT INTO invoice_project_links(invoice_id,job_id,company_id) VALUES('80000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002'); RAISE EXCEPTION 'Cross-company invoice/job allocation accepted'; EXCEPTION WHEN foreign_key_violation THEN NULL; END;
 BEGIN INSERT INTO job_change_orders(id,job_id,company_id) VALUES('a8000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002'); RAISE EXCEPTION 'Cross-company change order accepted'; EXCEPTION WHEN foreign_key_violation THEN NULL; END;
 BEGIN INSERT INTO lead_messages(id,lead_id,company_id) VALUES('a9000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002'); RAISE EXCEPTION 'Cross-company lead message accepted'; EXCEPTION WHEN foreign_key_violation THEN NULL; END;
 BEGIN INSERT INTO roof_estimates(id,lead_id,company_id) VALUES('aa000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002'); RAISE EXCEPTION 'Cross-company estimate accepted'; EXCEPTION WHEN foreign_key_violation THEN NULL; END;
END
$tenant_fks$;


-- Add valid Company B parents, then exercise the remaining parent-company links.
INSERT INTO crm_properties(id,company_id)
VALUES('b3000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002');
INSERT INTO roof_report_orders(id,property_id,company_id)
VALUES('b6000000-0000-0000-0000-000000000001','b3000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002');
INSERT INTO proposals(id,lead_id,property_id,company_id)
VALUES('b7000000-0000-0000-0000-000000000001',NULL,NULL,'10000000-0000-0000-0000-000000000002');

DO $remaining_tenant_fks$
BEGIN
 BEGIN
  INSERT INTO crm_invoices(id,property_id,company_id)
  VALUES('b8000000-0000-0000-0000-000000000001','b3000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001');
  RAISE EXCEPTION 'Cross-company invoice/property reference accepted';
 EXCEPTION WHEN foreign_key_violation THEN NULL; END;
 BEGIN
  INSERT INTO crm_invoices(id,proposal_id,company_id)
  VALUES('b8000000-0000-0000-0000-000000000002','b7000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001');
  RAISE EXCEPTION 'Cross-company invoice/proposal reference accepted';
 EXCEPTION WHEN foreign_key_violation THEN NULL; END;
 BEGIN
  INSERT INTO proposals(id,lead_id,company_id)
  VALUES('b7000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002');
  RAISE EXCEPTION 'Cross-company proposal/lead reference accepted';
 EXCEPTION WHEN foreign_key_violation THEN NULL; END;
 BEGIN
  INSERT INTO proposals(id,property_id,company_id)
  VALUES('b7000000-0000-0000-0000-000000000003','30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002');
  RAISE EXCEPTION 'Cross-company proposal/property reference accepted';
 EXCEPTION WHEN foreign_key_violation THEN NULL; END;
 BEGIN
  INSERT INTO roof_estimates(id,property_id,company_id)
  VALUES('b9000000-0000-0000-0000-000000000001','b3000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001');
  RAISE EXCEPTION 'Cross-company roof estimate/property reference accepted';
 EXCEPTION WHEN foreign_key_violation THEN NULL; END;
 BEGIN
  INSERT INTO roof_estimates(id,report_order_id,company_id)
  VALUES('b9000000-0000-0000-0000-000000000002','b6000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001');
  RAISE EXCEPTION 'Cross-company roof estimate/report reference accepted';
 EXCEPTION WHEN foreign_key_violation THEN NULL; END;
END
$remaining_tenant_fks$;


-- Drawing ownership is inherited through the drawing's property and must
-- match both the record company and any explicit record property.
INSERT INTO roof_drawings(id,property_id)
VALUES('b5000000-0000-0000-0000-000000000001','b3000000-0000-0000-0000-000000000001');

DO $drawing_tenant_guard$
BEGIN
  INSERT INTO proposals(id,lead_id,property_id,drawing_id,company_id)
  VALUES('c7000000-0000-0000-0000-000000000001',NULL,'b3000000-0000-0000-0000-000000000001',
    'b5000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002');
  INSERT INTO roof_estimates(id,property_id,drawing_id,company_id)
  VALUES('c9000000-0000-0000-0000-000000000001','b3000000-0000-0000-0000-000000000001',
    'b5000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002');

  BEGIN
    INSERT INTO proposals(id,lead_id,property_id,drawing_id,company_id)
    VALUES('c7000000-0000-0000-0000-000000000002',NULL,'30000000-0000-0000-0000-000000000001',
      'b5000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001');
    RAISE EXCEPTION 'Cross-company proposal drawing accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'Cross-company proposal drawing accepted' THEN RAISE; END IF;
  END;

  BEGIN
    INSERT INTO roof_estimates(id,property_id,drawing_id,company_id)
    VALUES('c9000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000001',
      'b5000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001');
    RAISE EXCEPTION 'Cross-company estimate drawing accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'Cross-company estimate drawing accepted' THEN RAISE; END IF;
  END;

  BEGIN
    INSERT INTO proposals(id,lead_id,property_id,drawing_id,company_id)
    VALUES('c7000000-0000-0000-0000-000000000003',NULL,'30000000-0000-0000-0000-000000000002',
      'b5000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002');
    RAISE EXCEPTION 'Mismatched proposal property/drawing accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'Mismatched proposal property/drawing accepted' THEN RAISE; END IF;
  END;
END
$drawing_tenant_guard$;

\echo 'Company-owned drawing reference tests passed.'


-- A proposal/estimate may rely on the drawing's property when its own
-- property_id is NULL. Parent updates must not invalidate that ownership.
INSERT INTO proposals(id,lead_id,property_id,drawing_id,company_id)
VALUES('c7000000-0000-0000-0000-000000000004',NULL,NULL,
  'b5000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002');
INSERT INTO roof_estimates(id,lead_id,property_id,drawing_id,company_id)
VALUES('c9000000-0000-0000-0000-000000000003',NULL,NULL,
  'b5000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002');

DO $parent_reassignment_guard$
BEGIN
  BEGIN
    UPDATE roof_drawings
    SET property_id='30000000-0000-0000-0000-000000000001'
    WHERE id='b5000000-0000-0000-0000-000000000001';
    RAISE EXCEPTION 'Referenced drawing reassignment accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'Referenced drawing reassignment accepted' THEN RAISE; END IF;
  END;

  BEGIN
    UPDATE crm_properties
    SET company_id='10000000-0000-0000-0000-000000000001'
    WHERE id='b3000000-0000-0000-0000-000000000001';
    RAISE EXCEPTION 'Referenced property company reassignment accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'Referenced property company reassignment accepted' THEN RAISE; END IF;
  END;

  IF (SELECT property_id FROM roof_drawings WHERE id='b5000000-0000-0000-0000-000000000001')
       IS DISTINCT FROM 'b3000000-0000-0000-0000-000000000001'::uuid THEN
    RAISE EXCEPTION 'Rejected drawing reassignment changed its property';
  END IF;
  IF (SELECT company_id FROM crm_properties WHERE id='b3000000-0000-0000-0000-000000000001')
       IS DISTINCT FROM '10000000-0000-0000-0000-000000000002'::uuid THEN
    RAISE EXCEPTION 'Rejected property reassignment changed its company';
  END IF;
END
$parent_reassignment_guard$;

\echo 'Drawing parent reassignment tests passed.'

-- Build one Company B record in every table governed by migration 0065.
INSERT INTO roof_jobs(id,company_id) VALUES
  ('b4000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002');
INSERT INTO client_portal_links(id,lead_id,company_id) VALUES
  ('d1000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002');
INSERT INTO crm_activity(id,lead_id,company_id) VALUES
  ('d2000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002');
INSERT INTO crm_expenses(id,job_id,company_id) VALUES
  ('d3000000-0000-0000-0000-000000000001','b4000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002');
INSERT INTO crm_invoices(id,lead_id,proposal_id,property_id,company_id) VALUES
  ('d4000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','b7000000-0000-0000-0000-000000000001','b3000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002');
INSERT INTO crm_tasks(id,lead_id,company_id) VALUES
  ('d5000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002');
INSERT INTO invoice_checkouts(id,invoice_id,company_id) VALUES
  ('d6000000-0000-0000-0000-000000000001','d4000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002');
INSERT INTO invoice_payments(id,invoice_id,company_id) VALUES
  ('d7000000-0000-0000-0000-000000000001','d4000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002');
INSERT INTO invoice_project_links(invoice_id,job_id,company_id) VALUES
  ('d4000000-0000-0000-0000-000000000001','b4000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002');
INSERT INTO job_change_orders(id,job_id,company_id) VALUES
  ('d8000000-0000-0000-0000-000000000001','b4000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002');
INSERT INTO lead_messages(id,lead_id,company_id,sender) VALUES
  ('d9000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','customer');
INSERT INTO proposal_shares(id,proposal_id,company_id) VALUES
  ('da000000-0000-0000-0000-000000000001','b7000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002');
INSERT INTO roof_estimates(id,lead_id,property_id,company_id) VALUES
  ('db000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','b3000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002');

INSERT INTO crm_company_memberships(company_id,user_id,role) VALUES
  ('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000002','owner');
GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.client_portal_links, public.crm_activity, public.crm_expenses,
  public.crm_invoices, public.crm_tasks, public.invoice_checkouts,
  public.invoice_payments, public.invoice_project_links, public.job_change_orders,
  public.lead_messages, public.proposal_shares, public.proposals,
  public.roof_estimates, public.crm_company_memberships
TO authenticated;

-- Company A cannot see Company B rows in any of the 13 protected tables.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
DO $rls_company_a$
BEGIN
  IF EXISTS (SELECT 1 FROM client_portal_links WHERE company_id='10000000-0000-0000-0000-000000000002')
    OR EXISTS (SELECT 1 FROM crm_activity WHERE company_id='10000000-0000-0000-0000-000000000002')
    OR EXISTS (SELECT 1 FROM crm_expenses WHERE company_id='10000000-0000-0000-0000-000000000002')
    OR EXISTS (SELECT 1 FROM crm_invoices WHERE company_id='10000000-0000-0000-0000-000000000002')
    OR EXISTS (SELECT 1 FROM crm_tasks WHERE company_id='10000000-0000-0000-0000-000000000002')
    OR EXISTS (SELECT 1 FROM invoice_checkouts WHERE company_id='10000000-0000-0000-0000-000000000002')
    OR EXISTS (SELECT 1 FROM invoice_payments WHERE company_id='10000000-0000-0000-0000-000000000002')
    OR EXISTS (SELECT 1 FROM invoice_project_links WHERE company_id='10000000-0000-0000-0000-000000000002')
    OR EXISTS (SELECT 1 FROM job_change_orders WHERE company_id='10000000-0000-0000-0000-000000000002')
    OR EXISTS (SELECT 1 FROM lead_messages WHERE company_id='10000000-0000-0000-0000-000000000002')
    OR EXISTS (SELECT 1 FROM proposal_shares WHERE company_id='10000000-0000-0000-0000-000000000002')
    OR EXISTS (SELECT 1 FROM proposals WHERE company_id='10000000-0000-0000-0000-000000000002')
    OR EXISTS (SELECT 1 FROM roof_estimates WHERE company_id='10000000-0000-0000-0000-000000000002') THEN
    RAISE EXCEPTION 'Company A can read Company B operational records';
  END IF;
  BEGIN
    INSERT INTO crm_tasks(id,lead_id,company_id)
    VALUES('dc000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002');
    RAISE EXCEPTION 'Company A inserted a Company B task';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END
$rls_company_a$;
RESET ROLE;

-- Company B can read its own task but not Company A's task.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false);
DO $rls_company_b$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM crm_tasks WHERE id='d5000000-0000-0000-0000-000000000001')
     OR EXISTS (SELECT 1 FROM crm_tasks WHERE id='93000000-0000-0000-0000-000000000001') THEN
    RAISE EXCEPTION 'Company B task visibility is incorrect';
  END IF;
END
$rls_company_b$;
RESET ROLE;


-- Even a same-company accounting user cannot claim customer approval by
-- writing approved_by/approved_at directly; only a future verified-signature
-- RPC may introduce that state.
DO $change_order_approval_guard$
BEGIN
  BEGIN
    UPDATE job_change_orders
    SET status='approved', approved_by='Typed customer name', approved_at=now()
    WHERE id='d8000000-0000-0000-0000-000000000001';
    RAISE EXCEPTION 'Unverified change order approval accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'Unverified change order approval accepted' THEN RAISE; END IF;
  END;
END
$change_order_approval_guard$;

\echo 'Secondary operational company RLS tests passed.'

