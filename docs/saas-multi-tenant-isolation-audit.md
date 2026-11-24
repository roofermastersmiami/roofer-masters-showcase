# Multi-company SaaS isolation audit

Status: **not ready for external-company onboarding**.

This document records the current security boundary and the work required before this CRM can safely serve multiple independent roofing businesses. Company accounts and memberships are only an identity foundation; they do not isolate operational records yet.

## Confirmed current behavior

- `user_roles` is a global user-to-role table. Team Access finds users by confirmed email and grants/removes global roles. There is no company identifier in that role assignment.
- `has_role` and `has_any_role` authorize by global user role, not by company membership.
- `TeamAccess.tsx` and `team.functions.ts` use this global model. Crew assignment validates the global crew role.
- Several database functions use `SECURITY DEFINER` and must be checked for tenant scope independently of table RLS.
- Storage policies use global roles and existing bucket/path conventions. Company-scoped table policies alone would not isolate uploaded files.
- The existing company-branding row is account-owner scoped. It is not yet shared through company membership.

## Current application tables requiring a tenant decision

The following tables are present in the generated Supabase database types. Every operational or private table must either gain a `company_id` (with a safe backfill) or be explicitly classified as global/reference data.

| Area | Tables |
| --- | --- |
| Leads and customer records | `leads`, `crm_customers`, `crm_properties`, `crm_activity`, `crm_tasks`, `lead_messages` |
| Sales and documents | `roof_estimates`, `proposals`, `proposal_shares`, `client_portal_links`, `pdf_sign_templates` |
| Production and measurement | `roof_jobs`, `job_change_orders`, `roof_drawings`, `roof_report_orders` |
| Financial records | `crm_invoices`, `invoice_payments`, `invoice_checkouts`, `invoice_project_links`, `crm_expenses`, `roof_cost_catalog` |
| Company and access | `crm_companies`, `crm_company_memberships`, `crm_company_branding`, `user_roles` |
| Configuration/reference | `instant_roof_rates`, `site_content` |

## Required migration sequence

1. **Choose a canonical company context.** Every authenticated CRM request must resolve an active company membership server-side. Never accept a client-supplied company ID as proof of access.
2. **Backfill before enforcing.** Create the Roofer Masters company and map the existing owner and confirmed team users to it. Preserve existing role assignments during the transition. Do not create a second company for the same legacy dataset.
3. **Move authorization from global roles to memberships.** Replace role checks with membership-aware helpers that require both `auth.uid()` and `company_id`. Update Team Access and server functions so user lookup and role changes are restricted to the active company.
4. **Scope parent records first.** Migrate leads/customers/properties and then child records. Validate foreign-key relationships so a record from Company A cannot be attached to a parent from Company B.
5. **Audit every security-definer RPC.** Include lead capture, customer save, roof drawing/report save, invoice payment/status/checkout, job assignment, change-order approval, and any function that reads or writes operational rows. A safe RLS policy can be bypassed by an unsafe definer function.
6. **Scope storage.** Define company-first object paths and policies for every private bucket (proposals, receipts, job photos, signed contracts, report files, logo assets). Verify reads, uploads, updates, and deletes.
7. **Add adversarial tests.** Create two companies with separate users and prove Company A cannot select, mutate, reference, export, or download Company B data through direct table queries, server functions, RPCs, signed URLs, or storage.
8. **Only then enable onboarding and billing.** Subscription state must be attached to a company, not an individual user. Company switching, invitations, ownership transfer, and account deletion require explicit lifecycle rules.

## Safe implementation constraints

- Do not turn on multi-company onboarding or company switching while any operational table remains globally accessible.
- Do not remove legacy role policies until equivalent membership-aware policies are deployed and tested.
- Do not backfill by email alone without resolving exact authenticated user IDs and preserving current roles.
- Do not claim the application is multi-tenant because `crm_companies` and `crm_company_memberships` exist.
- Database changes must be made through the connected Lovable workflow per AGENTS.md; do not add further Drizzle migration files directly.
- Keep all new external integrations optional and avoid paid APIs unless explicitly approved.

## Release gate

A release is blocked until the two-company isolation suite passes against a migrated database and a manual review confirms all security-definer functions and storage policies enforce the same company boundary.
