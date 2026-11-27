# Roofer Masters Permitting Release Readiness

**Updated:** 2026-11-27  
**Purpose:** preserve the verified implementation status and the remaining release gates for the permitting module.  
**Scope:** repository and CI readiness only. This document does not authorize production DDL, data migration, tenant onboarding, or deployment.

## Implementation completed in the current stacked development work

The following PRs have been merged into their respective stacked development base branches:

| PR | Work | Merge result | CI |
|---|---|---|---|
| #197 | Company-scoped permit applications and inspections | Merged into `feat/company-scoped-team-policy-0048` | Passed |
| #198 | Permit application and inspection management workflows | Merged into `feat/permit-records-and-inspections-0048` | Passed |
| #204 | Source-backed Miami-Dade and Broward jurisdiction checklists | Merged into `feat/permit-management-workflows-0049` | Passed |
| #205 | Company-scoped roof product approval register | Merged into `feat/permit-jurisdiction-checklists-0050` | Passed |
| #206 | Company-scoped Notice of Commencement tracking | Merged into `feat/permit-product-approvals-0051` | Passed |
| #207 | Product approval code-edition evidence | Merged into `feat/permit-noc-tracking-0052` | Passed |

CI run references at the time of this update:
- #197: `45910380413`
- #198: `45930784096`
- #204: `45928469905`
- #205: `45929543841`
- #206: `45930446669`
- #207: `45930453072`

The latest passing pipelines included migration journal validation, privileged-code tenant review, PostgreSQL RLS integration tests, lint, application tests, and production build. The NOC integration test specifically passed after changing its upsert to use the composite `(permit_application_id, company_id)` key.

**Important:** these are merges into stacked feature branches, not a merge of the entire permitting release into `main`. The branch stack still depends on the company ownership and authorization foundation.

## Schema changes in this feature stack

The migration journal on the permitting branch contains these entries:

| Migration | Purpose |
|---|---|
| 0042 | CRM company ownership foundation |
| 0043 | Company-aware lead/customer synchronization |
| 0044 | Company-scoped customer save |
| 0045 | Trusted company assignment for public lead intake |
| 0046 | Company-scoped customer deletion |
| 0047 | Company-owned roof jobs |
| 0048 | Company permit applications and inspections |
| 0049 | Company-scoped permit document storage |
| 0050 | Company roof product approvals |
| 0051 | Company NOC assessment and recording evidence |
| 0052 | Product approval code-edition evidence |

The jurisdiction checklist feature also includes source-backed jurisdiction references and must be maintained as reviewed reference data, not represented as an official municipal determination.

## Functional and legal-safety boundaries

- Jurisdiction checklist content is a staff reference. Verify current instructions with the relevant building department before submission.
- Permit submission, permit issuance, and inspection appointment confirmation remain manual facts unless a supported official portal integration is implemented and explicitly verified.
- NOC requirement is not inferred from a universal dollar amount. Staff must cite the current jurisdiction source and document the assessment.
- An NOC may be marked recorded only after county, instrument number, and recording date are entered as Clerk evidence.
- Product approval records capture NOA/FPA/UL references, HVHZ status, and the edition stated by the cited source. The code-edition field defaults to unknown and does not establish assembly compatibility.
- Staff must independently verify approval validity, HVHZ applicability, assembly details, design pressures, fastening schedules, and installation instructions before permit submission.

## Production release blocker — do not bypass

The repository's production drift audit records a read-only snapshot from 2026-11-26 in which production's Drizzle migration ledger had 30 entries, while repository migrations 0031–0041 were pending. Several production objects already existed with materially different definitions, and other objects were absent.

The audit also records an unresolved discrepancy in the observed `roof_report_orders` count (3 in one read-only query versus 12 in an implementation note). That must be reconciled from the correct production project/schema before any ownership backfill.

Therefore:

1. **Do not run `drizzle-kit migrate` against production.**
2. Do not fabricate ledger rows or rewrite historical migrations to skip them.
3. Repeat a read-only production preflight immediately before release: active project identity, migration ledger, row counts, constraints, indexes, triggers, function bodies, grants, RLS flags, policy expressions, and storage buckets/policies.
4. Classify migrations 0031–0041 as satisfied, partially satisfied, superseded, or missing. Produce reviewed forward-only repair migrations for actual gaps.
5. Reconcile and validate the company foundation before applying 0042–0047. Confirm the company/member mapping and every existing record's backfill assignment; resolve the report-count discrepancy.
6. Apply 0048–0052 only after the foundation and application authorization path are verified in a production-like database.
7. Keep external-company onboarding disabled until two-company adversarial tests cover direct table access, RPCs, server functions, composite relationships, and storage objects.
8. Deploy the application only after the database changes are approved and applied in the documented order. Verify the actual live commit, health checks, logs, and real permitting workflows.

## Next work, in strict order

- [ ] Reconcile the open company-ownership dependency chain and ensure the permitting branch is based on the reviewed, non-conflicting foundation.
- [ ] Repeat and attach the read-only production schema/ledger preflight evidence.
- [ ] Author and test forward-only production reconciliation migrations; do not replay 0031–0041 blindly.
- [ ] Run all company isolation and permit integration tests against the reconciled production-like schema.
- [ ] Consolidate the stacked permitting changes into the intended release branch and obtain final CI success on that exact commit.
- [ ] Apply the approved database migrations in order.
- [ ] Deploy the exact verified release commit to Render and verify the running service.
- [ ] Exercise a real permit workflow end-to-end: create application, attach required documents, verify product approval evidence, track inspection milestones, and record NOC evidence when applicable.

## Current release status

**Implementation and feature-branch CI:** completed for PRs #197, #198, and #204–#207.  
**Integration into main:** not completed.  
**Production schema reconciliation:** blocked pending repeat read-only evidence and forward-only migration plan.  
**Production migrations applied:** none as part of this work.  
**Permitting release deployed:** not verified; do not claim it is live.
