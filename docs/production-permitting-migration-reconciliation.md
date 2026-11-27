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

| Table                | Observed rows | `company_id` observed |
| -------------------- | ------------: | --------------------- |
| `leads`              |            10 | absent                |
| `crm_customers`      |            21 | absent                |
| `crm_properties`     |            18 | absent                |
| `roof_report_orders` |             3 | absent                |

**Count discrepancy:** the implementation note attached to PR #181 records 12 `roof_report_orders`, while the later read-only count query returned 3. This discrepancy is recorded on PR #181. Re-run an exact `SELECT count(*)` and compare project/connection, schema, filters, and query timestamp before using the count in a backfill preflight. Do not infer that either count is correct without that reconciliation.

### Migration-by-migration disposition

| Migration | Repository change                                            | Production observation                                                                                                                     | Safe next step                                                                                                                                    |
| --------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0031      | Production-manager roof-report storage policy                | No matching production policy was found in the inspected storage policy list                                                               | Compare all policies and role semantics; add only a narrowly scoped missing policy after review                                                   |
| 0032      | `delete_crm_customer(uuid)` SECURITY DEFINER RPC             | Function was not present in the inspected public routine inventory                                                                         | Review current app callers, grants, FK behavior, and tenant scope before creating/replacing                                                       |
| 0033      | Four-argument address-first `create_roof_report_request` RPC | A four-argument overload exists, alongside other overloads                                                                                 | Compare full function definitions, ownership, grants, and behavior; do not overwrite by signature alone                                           |
| 0034      | Six-argument report RPC and contact columns                  | Six-argument overload exists; verify exact column definitions and function body before considering satisfied                               | Compare exact schema/function definitions and grants                                                                                              |
| 0035      | Private signed-contract bucket and object policies           | `signed-contracts` bucket was absent                                                                                                       | Design company-aware object paths and authorization before creating; legacy lead/report path assumptions are not sufficient for SaaS              |
| 0036      | `appointments`, `receptionist_logs`, scheduling RPCs/trigger | Both tables were absent in the inspected production catalog                                                                                | Build only after company ownership and appointment tenant authorization are designed                                                              |
| 0037      | `pdf_sign_templates` and template storage policies           | Table was absent; policies were not found                                                                                                  | Reconcile storage and ownership model before creating                                                                                             |
| 0038      | Owner-user keyed branding table and policies                 | Existing branding is company-ID keyed and has a different column set; bucket already exists with company path policies                     | Treat migration 0038 as superseded by live schema; do not replay; document intended final schema                                                  |
| 0039      | Company table, membership enum/table, helpers and policies   | Tables/helpers already exist; membership role is text with CHECK; company table includes slug; policies already exist with different names | Compare full DDL, function definitions, grants, RLS flags and policy expressions; create only a forward repair if a specific invariant is missing |
| 0040      | Add accent and replace theme palette constraint              | `theme_accent` exists with default `magenta`; exact check constraints were not fully verified in the snapshot                              | Verify constraints and allowed palette/accent values before applying; avoid replacing a working constraint blindly                                |
| 0041      | `crm_company_permit_settings` with FORCE RLS                 | Table was absent                                                                                                                           | Reconcile company schema first; apply only after its helper functions and owner/admin policies pass PostgreSQL integration tests                  |

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


---

## Read-only production refresh — 2026-11-26 (evening refresh)

**Project:** Roofer Masters CRM and its connected Supabase database.  
**Method:** SELECT-only inspection through the project's connected database. No DDL, DML, migration execution, storage changes, or deployment was performed.

### Current migration ledger

- \`drizzle.__drizzle_migrations\` contains **30 rows**.
- Latest recorded migration timestamp: \`2026-11-21T03:35:20.000Z\`.
- The live catalog still has no \`company_id\` column on \`leads\`, \`crm_customers\`, \`crm_properties\`, \`roof_report_orders\`, or \`roof_jobs\`.
- Live \`crm_company_memberships.role\` remains \`text\` with a CHECK constraint, not the repository enum shape assumed by an earlier historical migration.

### Current company and operational record counts

| Object | Live count / state |
| --- | ---: |
| Companies | 1 |
| Company memberships | 1 (owner) |
| Legacy \`user_roles\` users | 1 (admin role) |
| Leads | 11 |
| CRM customers | 22 |
| CRM properties | 19 |
| Roof report orders | 4 |
| Roof jobs | 4 |

**Count drift is only partially reconciled.** PR #181's baseline note reported 12 roof-report orders; the 2026-11-26 earlier audit recorded 3; the evening read-only refresh returned 4. A privacy-minimized date-bucket query shows one order created on each of 2026-11-21, 2026-11-24, 2026-11-25, and 2026-11-26, so the 3 → 4 change is consistent with a new order created on 2026-11-26. The older 12 → 4 discrepancy remains unexplained and may reflect a different project, schema, filter, or earlier data state. Do not use 12 or 4 as a backfill assumption until that discrepancy is resolved against source records.

### Current permit-related production objects

The following relations are absent from the live \`public\` schema:

- \`crm_company_permit_settings\`
- \`roof_permit_applications\`
- \`roof_permit_inspections\`
- \`roof_product_approvals\`
- \`roof_permit_noc_tracking\`

The \`storage.buckets\` inventory contains \`crm-company-branding\`, \`roof-job-photos\`, and \`roofing-proposals\`; there is no \`permit-documents\` bucket.

### Current security and privileged-path observations

- RLS is enabled on the existing core CRM tables and \`roof_jobs\`, but the inspected operational tables are not FORCE-RLS.
- The current \`leads\`, \`crm_customers\`, \`crm_properties\`, \`roof_jobs\`, and \`roof_report_orders\` policies still authorize through legacy global \`has_role\` / \`has_any_role\` checks.
- The existing company tables use \`is_crm_company_member\` and \`is_crm_company_admin\` helpers. Both helpers are SECURITY DEFINER and are granted to authenticated roles (and anon); their current bodies check \`auth.uid()\` against \`crm_company_memberships\`.
- \`save_crm_customer(jsonb)\` is still SECURITY DEFINER and authorizes through global \`has_any_role\`; its current body has no company membership lookup or company predicate.
- Three \`create_roof_report_request\` overloads exist. All three are SECURITY DEFINER and authorize with global roles; their queries and writes are not company-scoped.
- \`delete_crm_customer(uuid)\` was not present in the inspected public routine inventory.
- Existing service-role, public intake, report-order, team, invoice, change-order, and storage paths still require the coordinated review recorded in the tenant-isolation PR comments.

**Release consequence:** the new permit application and product-approval migrations depend on a company-owned roof-job/application foundation that is not present in production. The CI two-company fixtures prove the new migrations in an isolated test database; they do not prove the live production schema has the prerequisites or that all legacy privileged write paths are tenant-safe.

### Permitting feature branch status

The following stacked feature PRs have successful CI runs, including PostgreSQL security tests, unit tests, lint, and application build:

| PR | Scope | CI |
| --- | --- | --- |
| #198 | Permit application / inspection management | Passed |
| #204 | Miami-Dade and Broward jurisdiction checklists | Passed |
| #205 | NOA / Florida Product Approval register | Passed |
| #206 | NOC assessment and recording tracker | Passed |
| #207 | Product-approval code-edition evidence | Passed |

They remain open, draft, and stacked by dependency. Their successful CI does not mean the migrations have been merged or applied to production.

### Required production release gate

1. Repeat the read-only ledger, object, row-count, constraint, trigger, function, grant, RLS, policy, and storage inventory immediately before release. Resolve the roof-report count drift (12 → 3 → 4) from source records.
2. Reconcile migrations 0031–0041 against the live schema. Do not replay historical migrations blindly and do not manufacture ledger entries to skip them.
3. Complete the company ownership and membership-aware authorization chain. In particular, replace global-role policies and secure every SECURITY DEFINER/service-role path, including customer delete, report request overloads, team/job assignment, invoices, change orders, public intake, and storage.
4. Confirm the existing staff/user membership mapping and preserve the current role matrix and public lead-intake behavior.
5. Apply reviewed forward-only migrations in dependency order: company ownership and roof-job foundation first; then permit applications/inspections; then private permit documents; then product approvals; NOC tracking; and code-edition evidence.
6. Run the migration chain against a production-like clone and execute two-company adversarial tests before approving any production DDL.
7. Deploy only after the production schema and app version are aligned. Then run a read-only/live smoke test for application creation, document access, product approvals, NOC tracking, and inspection status.

**Current decision: NO PRODUCTION MIGRATION OR DEPLOYMENT.** The feature build is CI-validated, but the production database prerequisites and tenant-isolation release gate remain incomplete.


---

## Live Supabase read-only verification — 2026-11-27

**Execution:** read-only SELECT queries through the Roofer Masters Lovable project's connected Supabase database. No DDL, DML, migration execution, storage mutation, or deployment was performed.

**Application/source alignment:** the published Lovable project currently reports source commit `9a9185e73df1734c5df596c050a6ecb73d4faa36` (current `main` at the time of inspection). The consolidated permitting candidate in PR #216 is not the deployed source.

### Confirmed live database state

- Migration ledger: **30 rows**; latest migration timestamp **2026-11-21 03:35:20 UTC**.
- Company records: **1 company**, **1 membership**.
- Operational records: **11 leads**, **22 customers**, **19 properties**, **4 roof report orders**, **4 roof jobs**.
- None of `leads`, `crm_customers`, `crm_properties`, `roof_report_orders`, or `roof_jobs` currently has a `company_id` column.
- Permit-specific relations are absent: `crm_company_permit_settings`, `roof_permit_applications`, `roof_permit_inspections`, `roof_permit_documents`, `roof_product_approvals`, and `roof_permit_noc_tracking`.
- RLS is enabled but not FORCE-enabled on the existing company, customer, property, lead, roof-job, and roof-report tables inspected.
- Existing customer, property, lead, job, and roof-report policies still authorize through legacy global `has_role` / `has_any_role` predicates. The company membership helper policies exist on company tables, but that does not scope the operational tables.
- Live `save_crm_customer(jsonb)` remains SECURITY DEFINER and checks legacy global roles. The live schema still exposes three SECURITY DEFINER `create_roof_report_request` overloads; their current definitions perform legacy role checks and do not derive or enforce company ownership. The two-argument company helper functions are also SECURITY DEFINER and executable by anon as observed in their ACLs; review before broader exposure.
- Storage buckets include `crm-company-branding`, `roof-job-photos`, and `roofing-proposals`; `permit-documents` is absent.
- Existing legacy storage policies for job photos and proposal files remain role-based rather than parent-company scoped.

### Release decision after live verification

**NO PRODUCTION MIGRATION, NO MERGE-TO-PRODUCTION, AND NO DEPLOYMENT YET.**

The CI-validated candidate proves the new migrations and tenant-isolation fixtures in an isolated test database. The live Supabase database still lacks the ownership columns and all permit relations on which the candidate depends. The existing operational tables also retain legacy global-role policies and privileged RPCs. Applying 0042–0052 as a blind migration sequence would be unsafe and could break current workflows or leave authorization gaps.

### Required next work

1. Produce a forward-only reconciliation plan for the live 0031–0041 drift; preserve the existing company and branding objects and do not manufacture migration ledger rows.
2. Resolve the historical roof-report count discrepancy (12 in an older implementation note, 3 in an earlier audit, 4 in this live read-only check) against source records before any backfill.
3. Review and secure every privileged legacy write path and remove/replace permissive global-role policies as part of one coordinated release. The roof-report RPC overloads and server-side service-role mutations are explicitly not tenant-safe yet.
4. Validate the exact 0042–0052 chain against a production-like clone with current live schema and data shape, then run the two-company adversarial and Roofer Masters compatibility suites.
5. Only after approval, perform a staged forward-only migration and deploy a matching app commit; then verify permit creation, document storage, product approval evidence, NOC tracking, and inspection workflow in production.

**This live snapshot supersedes the older row-count observations above for current counts, but does not resolve the historical discrepancy or authorize a write.**


### Additional 0042/0043/0047 prerequisite checks — 2026-11-27

The live read-only checks also verified the immediate ownership-backfill preconditions:

- Exactly one company exists, and its creator has an `owner` membership.
- All current CRM parent links inspected are non-orphaned: customer/source-lead, lead/customer, property/customer, report/customer, report/property, and roof-job/lead/property checks returned zero missing references.
- No duplicate normalized property-address groups per customer were found.
- The existing unique constraint `crm_properties(customer_id, address)` is present, which is the conflict target used by the 0043 lead/property synchronization function.
- The current lead synchronization trigger exists for INSERT and UPDATE, so 0043's function replacement has an existing trigger to update.

These checks reduce uncertainty for the data-integrity portions of 0042, 0043, and 0047, but they do **not** authorize running those migrations. They do not reconcile pending historical migrations 0031–0041, validate every constraint/trigger/function changed by those migrations, prove the full authorization cutover, or establish two-company compatibility. Keep production writes blocked.
