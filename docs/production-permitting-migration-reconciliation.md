# Production migration drift audit for permitting

**Audit date:** 2026-11-26  
**Base revision reviewed:** `388e80e1fbdbdf5313a3c68378fdb3a595cc430c`  
**Purpose:** record the known production/repository schema drift before permitting schema work proceeds.

This is a documentation-only audit. It does not execute or authorize DDL, DML, migration replay, tenant onboarding, or a production deployment. Production observations below came from read-only catalog and count queries during the CRM review. Re-run the documented checks with a read-only database role immediately before any migration is approved.

## Release decision

**Do not run `drizzle-kit migrate` against production.** Production has 30 rows in `drizzle.__drizzle_migrations`, while the repository journal contains later migrations 0031–0041 (and proposed 0042–0044 on open PRs). The pending migrations are not a safe blind replay: several objects are already present with materially different definitions, and others are missing.

Keep the Permitting UI owner-only and keep external-company onboarding disabled until the coordinated authorization release gate passes.

## Production observations

### Company identity and branding

- `public.crm_companies` exists with `id`, `name`, `slug`, `created_by`, and `created_at`. It has a unique slug and a creator FK.
- `public.crm_company_memberships` exists with `id`, `company_id`, `user_id`, `role text`, and `created_at`. Its role is constrained by a text CHECK, not the `crm_company_role` enum assumed by migration 0039.
- One company and one owner membership were observed in the reviewed snapshot. Reconfirm counts and identities immediately before any data migration.
- `is_crm_company_member(uuid)` and `is_crm_company_admin(uuid)` exist in production and are SECURITY DEFINER functions.
- `crm_companies`, `crm_company_memberships`, and `crm_company_branding` already have company-aware RLS policies. Existing policy names differ from migration 0039, so compare definitions rather than relying on names.
- `public.crm_company_branding` exists keyed by `company_id`, with `logo_path`, `updated_by`, `updated_at`, `theme_palette`, `theme_accent`, and `sidebar_appearance`. This differs from migration 0038's `owner_user_id`-keyed table with `company_name`.
- The private `crm-company-branding` storage bucket exists, with company-ID-prefixed object policies already present.

**Implication:** do not replay 0038 or 0039 as if the production database were empty. A future forward-only reconciliation must preserve the existing company/branding records, slug, text role constraint, helper functions, and working RLS/storage policies. Do not drop/recreate the company tables or cast the role column without an explicit data and application compatibility plan.

### Operational records

The reviewed production snapshot contained:

| Table | Observed rows | `company_id` observed |
|---|---:|---|
| `leads` | 10 | absent |
| `crm_customers` | 21 | absent |
| `crm_properties` | 18 | absent |
| `roof_report_orders` | 3 | absent |

**Count discrepancy:** the implementation note attached to PR #181 records 12 `roof_report_orders`, while the later read-only count query returned 3. This discrepancy is recorded on PR #181. Re-run an exact `SELECT count(*)` and compare project/connection, schema, filters, and query timestamp before using the count in a backfill preflight. Do not infer that either count is correct without that reconciliation.

### Migration-by-migration disposition

| Migration | Repository change | Production observation | Safe next step |
|---|---|---|---|
| 0031 | Production-manager roof-report storage policy | No matching production policy was found in the inspected storage policy list | Compare all policies and role semantics; add only a narrowly scoped missing policy after review |
| 0032 | `delete_crm_customer(uuid)` SECURITY DEFINER RPC | Function was not present in the inspected public routine inventory | Review current app callers, grants, FK behavior, and tenant scope before creating/replacing |
| 0033 | Four-argument address-first `create_roof_report_request` RPC | A four-argument overload exists, alongside other overloads | Compare full function definitions, ownership, grants, and behavior; do not overwrite by signature alone |
| 0034 | Six-argument report RPC and contact columns | Six-argument overload exists; verify exact column definitions and function body before considering satisfied | Compare exact schema/function definitions and grants |
| 0035 | Private signed-contract bucket and object policies | `signed-contracts` bucket was absent | Design company-aware object paths and authorization before creating; legacy lead/report path assumptions are not sufficient for SaaS |
| 0036 | `appointments`, `receptionist_logs`, scheduling RPCs/trigger | Both tables were absent in the inspected production catalog | Build only after company ownership and appointment tenant authorization are designed |
| 0037 | `pdf_sign_templates` and template storage policies | Table was absent; policies were not found | Reconcile storage and ownership model before creating |
| 0038 | Owner-user keyed branding table and policies | Existing branding is company-ID keyed and has a different column set; bucket already exists with company path policies | Treat migration 0038 as superseded by live schema; do not replay; document intended final schema |
| 0039 | Company table, membership enum/table, helpers and policies | Tables/helpers already exist; membership role is text with CHECK; company table includes slug; policies already exist with different names | Compare full DDL, function definitions, grants, RLS flags and policy expressions; create only a forward repair if a specific invariant is missing |
| 0040 | Add accent and replace theme palette constraint | `theme_accent` exists with default `magenta`; exact check constraints were not fully verified in the snapshot | Verify constraints and allowed palette/accent values before applying; avoid replacing a working constraint blindly |
| 0041 | `crm_company_permit_settings` with FORCE RLS | Table was absent | Reconcile company schema first; apply only after its helper functions and owner/admin policies pass PostgreSQL integration tests |

## Proposed forward-only sequence

1. **Repeat read-only preflight.** Confirm the active production project, migration ledger rows and timestamps, company/membership identities, operational row counts, constraints, triggers, policies, grants, helper function definitions, and storage buckets/policies. Record exact SQL and outputs in a dated artifact.
2. **Resolve migrations 0031–0040 individually.** Classify each as already satisfied, partially satisfied, superseded, or missing. Do not manufacture ledger rows to skip migrations; do not rewrite historical migration files.
3. **Reconcile company foundation.** Preserve existing `crm_companies`, `crm_company_memberships`, `crm_company_branding`, storage paths, and working policies. If 0039's intended invariants are missing, add a new sequential forward migration with idempotent preflight checks.
4. **Validate 0042 backfill prerequisites.** Confirm exactly one verified legacy company and creator owner membership; confirm every operational row can be assigned under that explicit single-company assumption; resolve the 3-vs-12 report-count discrepancy; validate existing FKs/triggers and duplicate/nullable parent links.
5. **Review 0042–0044 as a dependency chain.** These PRs add ownership columns/backfill/composite FKs, company-aware lead fan-out, and company-scoped customer save. They are currently open/draft in the reviewed snapshot. CI success is not production deployment approval. Confirm all write paths (public lead intake, customer save/delete, report request, drawing saves, server/service-role paths) before any RLS cutover.
6. **Implement tenant authorization as one coordinated release.** Replace permissive global-role policies rather than layering additional permissive policies (PostgreSQL permissive policies OR together). Review SECURITY DEFINER RPCs and grants, storage object paths/policies, server functions, and generated types. Preserve the current role matrix and public lead intake behavior.
7. **Apply permit settings 0041 only after its company helpers and RLS are verified.** Keep the CCC license string exactly as entered; no global license env var or fabricated qualifier identity.
8. **Build permit records, inspection milestones, packet generation, and jurisdiction portal workflow only on the verified company-scoped foundation.** Inspection dates are planning defaults, not confirmed municipal appointments. Portal submission remains user-confirmed unless a supported official API exists.

## Outstanding evidence required

- Exact repeat of the `roof_report_orders` count and explanation of 3 vs 12.
- Full production definitions for every pending RPC overload, trigger, constraint, grant, RLS flag, policy, and storage policy touched by 0031–0040.
- Full inventory of legacy `user_roles` users and verified membership mapping (including staff accounts); the one-owner observation is not proof that no other staff identities exist.
- Verification that public lead intake and every privileged CRM write path can assign/validate company ownership without trusting browser-supplied company IDs.
- Two-company adversarial PostgreSQL tests covering direct table access, RPCs, server functions, composite relationships, and storage before external-company onboarding.

## Current status

- Permitting navigation and preliminary job/NOC view are already integrated; do not rebuild them.
- Company qualifier settings migration 0041 exists in the repository but is not verified in production.
- PR #181/#182/#183 CI workflows were observed completed successfully in the reviewed snapshot; all three remained open/draft and their mergeability does not imply deployment readiness.
- No production DDL/DML or migration runner was executed as part of this audit.
