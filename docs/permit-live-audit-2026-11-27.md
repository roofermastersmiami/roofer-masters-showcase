# Roofer Masters permitting — live production audit (2026-11-27)

**Audit time:** 2026-11-27 15:13 UTC  
**Source project:** Roofer Masters CRM (Lovable project connected to the Roofer Masters Supabase database)  
**Repository revision inspected:** `main` at `9bc3a802d316ad8fce5217cef3a4b34e24232c5e`  
**Method:** read-only SQL catalog and row-count inspection. No production DDL, DML, migration execution, storage mutation, or deployment was performed.

## Release decision

**NO PRODUCTION MIGRATION OR DEPLOYMENT.**

The permitting feature implementation is integrated into repository `main`, but the connected production database still has the legacy schema and authorization model. The current migration chain must not be run blindly. Keep external-company onboarding disabled until the full tenant conversion, production-like migration rehearsal, and adversarial tests pass.

## Corrected migration ledger comparison

The live Drizzle ledger contains **30 rows**. Its latest `created_at` value matches migration-journal entry `idx: 29`, `0029_accounting_checkout_reads`.

The repository journal on the inspected `main` revision contains **55 entries**, through `idx: 54`, `0054_replace_legacy_tenant_rls_and_storage`.

Therefore, the next unapplied journal entry is **idx 30 / migration 0030**, and the repository currently has **25 unapplied entries (0030–0054)**. Earlier readiness notes that described the pending range as starting at 0031 are off by one and must not be used as the migration execution plan.

Do not manufacture migration-ledger entries, rewrite historical migration files, or run `drizzle-kit migrate` against production before the historical drift has been reconciled.

## Current live database snapshot

| Check | Observed value |
|---|---:|
| PostgreSQL version | 17.12 |
| Companies | 1 |
| Company memberships | 1 owner |
| Legacy `user_roles` | 1 admin |
| Leads | 11 |
| CRM customers | 22 |
| CRM properties | 19 |
| Roof report orders | 5 |
| Roof jobs | 4 |
| Permit-specific relations present | 0 of 5 |
| Drizzle migration ledger rows | 30 |

The five absent permit relations are:

- `crm_company_permit_settings`
- `roof_permit_applications`
- `roof_permit_inspections`
- `roof_product_approvals`
- `roof_permit_noc_tracking`

The five current roof report orders are distributed as one record per day on November 21, 24, 25, 26, and 27, 2026. All five have valid customer and property references. Earlier notes recorded 12, 3, and 4 orders; those are historical snapshots and the old 12-row observation has not been independently reproduced. Use the current live count of five for a new preflight, while retaining the historical discrepancy in the audit trail.

Other current operational row counts:

| Table | Rows |
|---|---:|
| `crm_activity` | 13 |
| `crm_invoices` | 2 |
| `invoice_checkouts` | 1 |
| `lead_messages` | 4 |
| `proposal_shares` | 2 |
| `proposals` | 1 |
| `roof_drawings` | 1 |
| `client_portal_links`, `crm_expenses`, `crm_tasks`, `invoice_payments`, `invoice_project_links`, `job_change_orders`, `roof_estimates` | 0 |

The single existing proposal has no lead, property, or drawing parent. It must be explicitly classified and included in the ownership backfill plan; it must not be silently dropped or left unowned.

## Existing tenant and authorization state

- `company_id` is absent from `leads`, `crm_customers`, `crm_properties`, `roof_report_orders`, and `roof_jobs`.
- The existing company membership role is `text` with a CHECK constraint, not the historical enum shape assumed by one older migration.
- RLS is enabled on the inspected operational tables, but `FORCE ROW LEVEL SECURITY` is false.
- Core lead, customer, property, roof-job, and report policies still authorize through legacy global `has_role` / `has_any_role` predicates.
- The `is_crm_company_member(uuid)` and `is_crm_company_admin(uuid)` helpers are SECURITY DEFINER and still have EXECUTE granted to `anon`. Revoke anonymous execution in the reviewed forward cutover; grant only the roles that need the helpers.
- The private storage buckets currently present are `roofing-proposals`, `roof-job-photos`, and `crm-company-branding`. The `permit-documents` bucket is absent.

## Remaining operational tenant scope

Migration 0054 currently replaces policies for the five core tables, drawings, and selected storage paths. It does **not** replace legacy global-role policies on these additional operational tables:

- `client_portal_links`
- `crm_activity`
- `crm_expenses`
- `crm_invoices`
- `crm_tasks`
- `invoice_checkouts`
- `invoice_payments`
- `invoice_project_links`
- `job_change_orders`
- `lead_messages`
- `proposal_shares`
- `proposals`
- `roof_estimates`

Global reference/configuration tables such as `instant_roof_rates`, `roof_cost_catalog`, and `site_content` should be assessed separately; they are not automatically tenant-owned CRM records.

The replacement read policies in migration 0054 also use `is_crm_company_member(company_id)` for leads, customers, properties, jobs, and report records. That includes every membership role, including crew. This is broader than the legacy role matrix documented in `docs/tenant-authorization-cutover-inventory.md`. Tighten the replacement policies to preserve intended role access before production use. Do not trade global-role leakage for overbroad intra-company access.

## Migration implementation and CI status

Repository `main` contains migrations 0042–0054, including:

- Company ownership and same-company relationships (0042–0047)
- Permit applications, inspections, private permit documents, product approvals, NOC, and code-edition evidence (0048–0052)
- Company-scoped roof-report RPCs and initial tenant RLS/storage replacement (0053–0054)

GitHub Actions run `45937068330` completed successfully for its recorded commit, including migration-journal validation, privileged-code tenant audit, company/permit PostgreSQL integration tests, application tests, and production build. The recorded job list does not include a dedicated integration test for the complete 0053/0054 cutover against a production-like schema. A passing feature pipeline is not proof that the live schema is ready.

## Required release gates — in order

1. Repeat the read-only production preflight immediately before any migration work. Capture project identity, ledger rows/timestamps, row counts, company/member identities, constraints, indexes, triggers, function definitions/ACLs, RLS flags, policy expressions, and storage buckets/policies.
2. Reconcile migrations 0030–0041 individually against the live database. Classify each as satisfied, partially satisfied, superseded, or missing. Preserve the existing company, membership, branding, role CHECK, helpers, and working policies. Create reviewed forward-only repairs for actual gaps; do not replay incompatible historical DDL.
3. Resolve and document the proposal with no parent. Confirm every existing record's ownership and all same-company parent relationships before adding NOT NULL ownership columns and composite constraints.
4. Complete the operational tenant inventory above. Derive company identity from authenticated membership for user requests; service-role paths must use trusted server-side company resolution and never accept browser-supplied company IDs.
5. Correct the 0054 role matrix, revoke unnecessary anonymous helper grants, and add dedicated PostgreSQL integration coverage for 0053/0054 plus the remaining operational tables and storage paths.
6. Rehearse the complete forward-only migration sequence against a production-like clone. Test two-company SELECT/INSERT/UPDATE/DELETE isolation, cross-company foreign keys, RPCs, triggers, service-role writes, public lead intake, drawings, proposals, invoices/payments, job photos, contracts, and permit documents.
7. Only after review and explicit release approval, apply the approved database changes in order, deploy the exact verified application revision, and run live smoke tests for permit creation, document access, product approvals, NOC evidence, and inspection lifecycle.

## Current completion statement

- **Permitting feature code:** integrated into `main`.
- **Feature CI:** passing on the recorded CI commit; dedicated 0053/0054 production-like cutover coverage remains outstanding.
- **Live database schema:** not migrated; all five permit relations remain absent.
- **Tenant authorization:** incomplete; legacy global-role policies and unconverted operational tables remain.
- **Production migration/deployment:** not performed and not approved.

Do not report the permitting system as production-ready until all release gates above are verified.
