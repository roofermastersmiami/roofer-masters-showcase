-- PostgreSQL integration test for migration 0068 (crm_notifications).
-- Run with: psql -v ON_ERROR_STOP=1 -f scripts/test-permit-notifications-rls.sql
\set ON_ERROR_STOP on
\ir ../scripts/test-company-permit-records-rls.sql
\ir ../drizzle/migrations/0068_permit_notifications.sql

-- Seed one notification per company as the (RLS-bypassing) test harness.
INSERT INTO public.crm_notifications(
 company_id,kind,title,body,permit_application_id,dedupe_key
) VALUES (
 '10000000-0000-0000-0000-000000000001','permit_expiring_soon',
 'Permit expiring soon: Roof replacement permit (City of Miramar)',
 'Roof replacement permit (City of Miramar) expires within 14 days or less.',
 '50000000-0000-0000-0000-000000000001',
 'permit-expiry:50000000-0000-0000-0000-000000000001:14d'
),(
 '10000000-0000-0000-0000-000000000002','permit_status_changed',
 'Permit issued: Roof replacement permit (City of Miami)',
 'Permit status changed from submitted to issued.',
 '50000000-0000-0000-0000-000000000002',NULL
);

DO $$ BEGIN
 IF NOT (SELECT relforcerowsecurity FROM pg_class WHERE oid='public.crm_notifications'::regclass) THEN
   RAISE EXCEPTION 'Notifications table must FORCE RLS';
 END IF;
 IF has_table_privilege('anon','public.crm_notifications','SELECT') THEN
   RAISE EXCEPTION 'anon unexpectedly has notification SELECT';
 END IF;
 -- The dedupe index must reject a second row for the same company + key.
 BEGIN
   INSERT INTO public.crm_notifications(company_id,kind,title,dedupe_key)
   VALUES ('10000000-0000-0000-0000-000000000001','permit_expiring_soon','duplicate',
           'permit-expiry:50000000-0000-0000-0000-000000000001:14d');
   RAISE EXCEPTION 'Duplicate dedupe key unexpectedly accepted';
 EXCEPTION WHEN unique_violation THEN NULL;
 END;
 -- ...while the same key remains available to another company, and
 -- event notifications without a dedupe key are never blocked.
 INSERT INTO public.crm_notifications(company_id,kind,title,dedupe_key)
 VALUES ('10000000-0000-0000-0000-000000000002','permit_expiring_soon','Company B reminder',
         'permit-expiry:50000000-0000-0000-0000-000000000001:14d');
 INSERT INTO public.crm_notifications(company_id,kind,title)
 VALUES ('10000000-0000-0000-0000-000000000001','permit_status_changed','No dedupe key A'),
        ('10000000-0000-0000-0000-000000000001','permit_status_changed','No dedupe key B');
 -- A notification cannot point at another company's permit application.
 BEGIN
   INSERT INTO public.crm_notifications(company_id,kind,title,permit_application_id)
   VALUES ('10000000-0000-0000-0000-000000000001','permit_status_changed','forged link',
           '50000000-0000-0000-0000-000000000002');
   RAISE EXCEPTION 'Cross-company application link unexpectedly accepted';
 EXCEPTION WHEN foreign_key_violation THEN NULL;
 END;
END $$;

-- Company A owner: sees only Company A rows, can create and mark read.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
DO $$ BEGIN
 IF (SELECT count(*) FROM public.crm_notifications) <> 3 THEN
   RAISE EXCEPTION 'Company A owner must see only Company A notifications';
 END IF;
 INSERT INTO public.crm_notifications(company_id,kind,title,body)
 VALUES ('10000000-0000-0000-0000-000000000001','inspection_result','Dry-in inspection passed','');
 UPDATE public.crm_notifications SET read_at=now()
 WHERE dedupe_key='permit-expiry:50000000-0000-0000-0000-000000000001:14d';
 IF NOT EXISTS (SELECT 1 FROM public.crm_notifications
                WHERE dedupe_key='permit-expiry:50000000-0000-0000-0000-000000000001:14d'
                  AND read_at IS NOT NULL) THEN
   RAISE EXCEPTION 'Company A owner could not mark a notification read';
 END IF;
 BEGIN
   INSERT INTO public.crm_notifications(company_id,kind,title)
   VALUES ('10000000-0000-0000-0000-000000000002','permit_status_changed','forged');
   RAISE EXCEPTION 'Company A owner unexpectedly created a Company B notification';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $$;
RESET ROLE;

-- Company A office member: notifications are owner/admin-only, so no reads.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',false);
DO $$ BEGIN
 IF (SELECT count(*) FROM public.crm_notifications) <> 0 THEN
   RAISE EXCEPTION 'Office member unexpectedly read notifications';
 END IF;
 BEGIN
   INSERT INTO public.crm_notifications(company_id,kind,title)
   VALUES ('10000000-0000-0000-0000-000000000001','permit_status_changed','office insert');
   RAISE EXCEPTION 'Office member unexpectedly created a notification';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $$;
RESET ROLE;

-- Company B owner: sees only Company B rows.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false);
DO $$ BEGIN
 IF (SELECT count(*) FROM public.crm_notifications) <> 2 THEN
   RAISE EXCEPTION 'Company B owner must see only Company B notifications';
 END IF;
END $$;
RESET ROLE;

-- Signed-in user with no membership: sees nothing.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000004',false);
DO $$ BEGIN
 IF (SELECT count(*) FROM public.crm_notifications) <> 0 THEN
   RAISE EXCEPTION 'Nonmember unexpectedly read notifications';
 END IF;
END $$;
RESET ROLE;
