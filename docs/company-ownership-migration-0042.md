# Core CRM company ownership foundation — migration 0042

Status: **PR implementation; not deployed**.

## Read-only production baseline verified 2026-11-26

The live Supabase project contains exactly one company, Roofer Masters, and one owner membership for the company creator. Current core record counts:

| Table | Existing rows |
| --- | ---: |
| leads | 10 |
| crm_customers | 21 |
| crm_properties | 18 |
| roof_report_orders | 12 |

The live schema has no `company_id` on those four tables. The live database also does not contain `appointments`, `receptionist_logs`, or `pdf_sign_templates`. This check was read-only.

## What 0042 does

- Requires exactly one existing company and verifies its creator has an owner membership before changing anything.
- Adds `company_id` to leads, customers, properties, and roof report orders.
- Backfills the existing single-company dataset to the one verified company; it does not infer ownership from email, addresses, or role names.
- Makes ownership non-null and references `crm_companies`.
- Adds composite foreign keys so customers, leads, properties, and roof reports cannot be linked across companies.
- Adds company lookup indexes.

## What 0042 deliberately does not do

- It does not change RLS policies, grants, storage policies, or SECURITY DEFINER functions.
- It does not make the CRM safe for external-company onboarding.
- It does not create appointments, receptionist logs, or PDF templates.
- It does not apply permit qualifier settings 0041.

Legacy global-role policies remain in place until the membership backfill and replacement RLS/RPC/storage policies are implemented together. This is a relational integrity step, not the multi-tenant security release gate.

## Required follow-up

1. Add membership-aware RLS to core tables and remove the legacy permissive policies only after matching role behavior is implemented.
2. Update customer-save/delete, roof-report request, drawing/report save, and other SECURITY DEFINER routines to derive and validate company scope.
3. Add company ownership and tenant-scoped availability to receptionist appointments/logs.
4. Move signed contract and PDF template objects to company-first paths and verify storage authorization.
5. Run real two-company integration tests across direct SQL, RPCs, server functions, and storage.
6. Only after those gates, reconcile and apply permit settings 0041 and build its UI.


## Migration-journal sequencing note (2026-11-27)

The NOC migration `0051_company_permit_noc_tracking.sql` belongs to the stacked permitting feature branch, where its journal entry and prerequisite permit-application schema are included together. It must not exist as a standalone SQL file on `main` or be registered there ahead of its prerequisites. The mainline orphan file was removed in PR #213 so migration-journal validation can run against a coherent base. No production migration was applied by that cleanup.

When the permitting stack is promoted, bring the NOC SQL and its matching journal entry forward together, after the company ownership and permit-application migrations. Do not run the general migration runner against production until the documented production drift reconciliation and forward-only rollout plan have been reviewed and approved.
