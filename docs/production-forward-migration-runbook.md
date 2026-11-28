# Production Forward Migration — Runbook (Permit Release)

**Status: PREPARED AND REHEARSED — NOT EXECUTED. Execution requires
Fredy's explicit release approval (work-order step 9). Nothing in this
document authorizes touching the production database.**

Artifact: `scripts/production-forward-migration.sql` (this branch,
`release/production-forward-migration-20261128`, stacked on PR #257's
branch `fix/tenant-isolation-rebased-20261128` @ 85ab179).

## What it does

Production's Drizzle ledger stops at migration 0029, while parts of
0030–0055 were applied out-of-band and 0056–0067 exist only on the
tenant-isolation branch. This script brings production forward in ONE
transaction, applying exactly the migrations production is missing,
in order, with preflight aborts and post-assertions:

- **S0 preflight** — requires exactly 1 company and the company
  foundation helpers; snapshots row counts of all owned tables.
- **S1 verify-only** — confirms the 0033/0034 `create_roof_report_request`
  overloads and `roof_report_orders.customer_phone` already exist
  (applied out-of-band); ABORTS for manual review if they do not.
- **S2** — applies 0031, 0032, 0035, 0036, 0037, 0040, 0041 verbatim.
  Skips 0030 (effects present), 0033/0034 (verified in S1), 0038/0039
  (superseded by production's own company foundation — replaying them
  would corrupt it).
- **S3** — applies 0042–0055 verbatim (core company ownership + permit
  schema foundation).
- **S4 repairs** —
  - **R-1:** adds `roof_report_orders_id_company_id_key
    UNIQUE (id, company_id)`. Migration 0056 references this composite
    key but no migration creates it; without R-1, 0056 fails on any
    journal-built database (the repo CI fixture masks this by creating
    the constraint by hand). Found in rehearsal.
  - **R-2:** drops the 0031 storage policy "Production manager roof
    report files", which grants ANY global `production_manager` full
    access to every company's `roof-report/%` files and silently
    defeats the company-scoped policies from 0054/0067. The scoped
    policies preserve legitimate in-company production-manager access.
    Found in rehearsal (step-3 verification), proven by probe S6/S7.
- **S5** — applies 0056–0067 verbatim (secondary operational tenant
  scope + core role matrix).
- **S6 post-assertions** — row counts unchanged vs the S0 snapshot;
  no NULL `company_id` on any owned table (drawings resolve ownership
  through their property — asserted separately); anon EXECUTE revoked
  on the company/role helper functions; `permit-documents` bucket
  exists; the R-2 policy is gone; no policy on the 18 tenant tables
  still references the global `has_role`/`has_any_role` helpers.
  ANY failure raises and rolls the entire transaction back.

The script never touches the Drizzle ledger (production's ledger is
already divergent by design) and contains no destructive statements
beyond the R-2 policy drop.

## Prerequisites (all must be true before the approval ask)

1. PR #257 merged to main (it carries migrations 0056–0067; this
   release branch is stacked on it). PR #257 CI is green as of
   2026-11-28 (head 85ab179, both Roof Calculation Tests SUCCESS).
2. This release PR merged (or the script checked out from this branch).
3. A verified production backup / PITR point confirmed in Supabase
   immediately before execution. **There is no down-migration; the
   recovery path is restore-from-backup.** The single-transaction
   design means a failed run changes nothing; a *successful* run that
   later proves wrong is recovered by restore.
4. Maintenance window: brief; the script runs in seconds-to-minutes,
   but schedule it when no proposals/invoices are being edited.

## Execution (only after Fredy's approval — step 9)

1. Run the read-only preflight from the merged main checkout:
   `scripts/production-permit-readonly-preflight.sql` against
   production. Expected BEFORE: ledger at 0029, permit relations
   absent, buckets = roofing-proposals / roof-job-photos /
   crm-company-branding. Any surprise = STOP.
2. Capture live branding values (palette + theme_accent) from
   `crm_company_branding` for the record (migration 0040 normalizes
   the accent check; values are preserved, but record them first).
3. Confirm the backup from Prerequisites-3 exists.
4. From this branch's checkout, run:
   `psql <production-connection> -f scripts/production-forward-migration.sql`
   Expected final output: `FORWARD MIGRATION COMPLETE`.
   Any `ABORT:` exception = full rollback, nothing changed; STOP and
   report the message verbatim.
5. Re-run the read-only preflight. Expected AFTER: all 5 permit
   relations present; buckets now also include permit-documents and
   signed-contracts; `company_id` present on leads / crm_customers /
   crm_properties / roof_report_orders / roof_jobs; anon EXECUTE on
   `is_crm_company_member` / `is_crm_company_admin` revoked.
6. Smoke tests in the live CRM (Fredy or agent, in order): sign in;
   open Leads, Customers, Properties, Roof Reports, Jobs, Invoices
   (counts must match the preflight snapshot); open one proposal and
   one roof report PDF; open Permit Settings and save a no-op change;
   create one test roof report order and delete it via the normal UI
   flow (service-role path).

## Rehearsal evidence (2026-11-28)

- Production-like PostgreSQL **17.12** (exact production version)
  built from: Supabase platform shim → migrations 0000–0029 →
  0030/0033/0034 modeled as applied out-of-band → production-shaped
  company foundation (text role + CHECK, company-keyed branding,
  helpers WITH the live anon-EXECUTE exposure) → production volumes
  per the 2026-11-28 audit (9 leads, 23 customers, 20 properties,
  3 report orders, 4 jobs, 1 company).
- Forward script: **clean single-transaction apply**; all S6
  assertions passed. Record counts identical pre/post (the 9 extra
  crm_activity rows in the seed are produced by the pre-existing 0013
  lead-insert trigger at seed time, not by the migration).
- Two-company isolation suite (34 probes: tables, RPCs, triggers,
  storage): **33 PASS + 1 verified rejection** (save_crm_customer
  foreign-customer attempt rejected, record intact). Includes the
  R-2 regression probe: a global-role production manager from
  Company A can no longer read Company B's roof-report files, while
  his own company's files still open.
- Rehearsal assets: `~/workspace/permit-release-20261127/rehearsal/`
  (shims, seed, fixture, probes). Migration chain defect R-1 and
  storage hole R-2 were both found by this rehearsal, not by CI.

## Known residuals (NOT fixed by this migration — Fredy's call)

- `appointments`, `receptionist_logs`, `pdf_sign_templates` (and
  their storage policies) still use global staff roles — they were
  outside the tenant-isolation cutover scope. With a second company
  onboard, any company's staff could see all appointments. Recommend
  a follow-up scoping migration before onboarding company #2.
- Trigger functions `guard_roof_appointment` and
  `prevent_unverified_change_order_approval` retain default PUBLIC
  execute grants. They can only run in trigger context (direct calls
  error), so this is cosmetic hardening, not an exposure.
- `get_available_slots` is intentionally callable by anon — it backs
  the public booking page and returns availability only.
