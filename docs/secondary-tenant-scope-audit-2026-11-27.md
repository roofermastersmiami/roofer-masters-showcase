# Secondary CRM tenant-scope audit — 2026-11-27

**Source:** read-only catalog queries against the connected Roofer Masters production Supabase database.
**Purpose:** define the remaining operational ownership and RLS cutover scope after the core company/permit integration.
**Safety:** no production DDL, DML, policy changes, storage changes, migration-ledger edits, or deployment were performed.

## Confirmed live gap

The following 13 operational tables have no `company_id` column and still have legacy global-role RLS policies. These policies are permissive and PostgreSQL combines permissive policies with OR semantics; adding company policies without removing the legacy policies will not isolate tenants.

| Table                   | Tenant parent candidates from live columns                         | Existing policy family           |
| ----------------------- | ------------------------------------------------------------------ | -------------------------------- |
| `client_portal_links`   | `lead_id`                                                          | office/sales and admin           |
| `crm_activity`          | optional `lead_id`                                                 | admin, office, sales, production |
| `crm_expenses`          | optional `job_id`                                                  | accounting and admin             |
| `crm_invoices`          | optional `lead_id`, `proposal_id`, `property_id`                   | accounting and admin read        |
| `crm_tasks`             | optional `lead_id`                                                 | office, sales, production, admin |
| `invoice_checkouts`     | `invoice_id`                                                       | accounting/admin read            |
| `invoice_payments`      | `invoice_id`                                                       | accounting/admin read            |
| `invoice_project_links` | `invoice_id`, `job_id`                                             | accounting and admin             |
| `job_change_orders`     | `job_id`                                                           | accounting and admin             |
| `lead_messages`         | `lead_id`                                                          | office/sales and admin           |
| `proposal_shares`       | `proposal_id`                                                      | office/sales and admin read      |
| `proposals`             | optional `lead_id`, `property_id`, `drawing_id`                    | office/sales and admin           |
| `roof_estimates`        | optional `lead_id`, `property_id`, `drawing_id`, `report_order_id` | office/sales and admin           |

## Migration design requirements

1. Add ownership to these records only after their parent relationships are checked for missing and conflicting references.
2. Derive ownership from authoritative company-owned parents wherever a parent exists. For rows with multiple parents, require all resolved parents to agree on one company.
3. For parentless legacy records, use the explicit one-company bootstrap mapping only while the verified company count is exactly one. This is a migration-time backfill, not a runtime authorization rule.
4. Preserve the existing orphan proposal as Roofer Masters demonstration data; do not delete it or infer ownership from customer text.
5. Add composite same-company foreign keys for every relationship that can cross company boundaries, especially invoice/project links, proposals, proposal shares, estimates, tasks, activities, messages, portal links, and expenses/jobs.
6. Replace—not layer over—the global-role policies. Keep role behavior explicit: owner/admin; office/sales; production_manager; crew assignment; accounting. Do not grant all-company-member read access by default.
7. Review public share tokens and portal links separately. A valid unexpired token may be a narrowly scoped public capability, but it must not expose unrelated rows or become an authenticated cross-tenant bypass.
8. Review invoice checkout/payment service-role webhooks separately. Resolve invoice ownership server-side from the trusted invoice row; never accept a browser-supplied company ID.
9. Move accounting receipt storage from legacy `expense-*` keys to a path that resolves through a company-owned expense row before restoring access. The current fail-closed denial is safer than global access.
10. Test two-company adversarial access for direct table operations, RPCs, token links, webhooks, and storage before production release.

## Required preflight SQL checks

- For each candidate parent: count missing parents, duplicate/mismatched parent paths, and rows with parents belonging to different companies after the core ownership foundation is applied.
- Confirm exact FK definitions and delete actions before adding composite FKs.
- Inventory every function, trigger, edge/server caller, storage path, and payment webhook touching these tables.
- Capture exact policy names and expressions immediately before cutover; drop the inventoried legacy policies and assert no global-role policy remains on these 13 tables.
- Compare row counts before and after migration and verify no demonstration record was lost.

## Current status

- Core permitting implementation: integrated in repository main.
- Core company ownership and permit schema migrations: present in repository, not applied to production.
- Secondary operational tables: live schema audit complete; ownership/RLS conversion remains unimplemented.
- Production database: unchanged by this audit.

## Application write-path inventory (read-only source scan)

The connected Lovable project revision `9bc3a802d316ad8fce5217cef3a4b34e24232c5e` was scanned for direct Supabase table access. This is an inventory, not proof that every dynamic or generated call site has been found.

| Table                   | Located callers / components                                                                                                                                                               | Cutover concern                                                                                                      |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `crm_expenses`          | `src/components/dashboard/Expenses.tsx`                                                                                                                                                    | Direct browser insert; optional job parent; receipt uploaded to legacy `roofing-proposals` bucket before row insert. |
| `crm_tasks`             | `src/components/dashboard/FollowUps.tsx`                                                                                                                                                   | Direct browser insert; optional lead parent.                                                                         |
| `roof_estimates`        | `AdvancedEstimator.tsx`, `Estimates.tsx`, `RoofMeasurements.tsx`, `roof-orders.functions.ts`, `client-portal.functions.ts`                                                                 | Multiple browser and server writes; optional lead/property/drawing/report parents.                                   |
| `proposals`             | `AdvancedEstimator.tsx`, `Estimates.tsx`, `ProposalComposer.tsx`, `Proposals.tsx`, `RoofMeasurements.tsx`, `proposals.functions.ts`, `invoices.functions.ts`, `client-portal.functions.ts` | Browser and server writes; proposal creation can be followed by file upload and cleanup.                             |
| `crm_invoices`          | `invoices.functions.ts`, `invoice-payments.functions.ts`, `client-portal.functions.ts`, `operations-data.ts`, `mcp/tools/list-invoices.ts`                                                 | Server-side creation/payment paths; invoice company must be resolved from trusted proposal/property relationships.   |
| `invoice_checkouts`     | `invoice-payments.functions.ts`, `invoice-payments.server.ts`, `routes/api/public/payments/webhook.ts`                                                                                     | Public webhook/service-role paths must resolve company from the stored invoice, not request payload.                 |
| `invoice_payments`      | `operations-data.ts`                                                                                                                                                                       | Read path located; writes may be mediated through payment functions/RPCs and need a separate RPC/trigger inventory.  |
| `crm_activity`          | `CustomerActivity.tsx`, `foundation-data.ts`                                                                                                                                               | Read paths located; activity creation may be trigger-driven or elsewhere and needs explicit scan.                    |
| `lead_messages`         | `ChatInbox.tsx`, `data.ts`, `leads.functions.ts`                                                                                                                                           | Authenticated and public lead-message flows need distinct authorization treatment.                                   |
| `proposal_shares`       | `proposal-data.ts`, `operations-data.ts`, `proposals.functions.ts`, `client-portal.functions.ts`                                                                                           | Share-token operations must inherit company from the proposal and remain narrowly scoped.                            |
| `client_portal_links`   | `ClientPortalShare.tsx`, `client-portal.functions.ts`                                                                                                                                      | Public capability token must inherit lead/company from trusted stored row.                                           |
| `job_change_orders`     | `change-orders.functions.ts`, `ChangeOrders.tsx`                                                                                                                                           | Server function currently writes supplied fields after a role check; job ownership must be checked server-side.      |
| `invoice_project_links` | No direct table caller found in this scan                                                                                                                                                  | Likely RPC/trigger or unused; inspect database functions and migrations before cutover.                              |

### Required next engineering sequence

1. Trace all RPCs, database triggers, edge functions, and payment webhook writes for the tables above; the UI grep is not exhaustive.
2. Change trusted server functions first: derive company from the parent row under the authenticated/service-role context and reject conflicting parent IDs.
3. For direct browser writes, either route through authenticated server functions or use narrowly scoped database triggers that derive company from trusted parents and reject caller-supplied mismatches. Never trust a client-provided `company_id`.
4. Add integration tests for direct inserts, updates that change parent IDs, parentless records, public token flows, and payment webhook retries before enforcing `NOT NULL` in production.
5. Only then combine the ownership backfill with the separate RLS policy replacement and storage cutover.

**Important:** migration 0055 remains a draft backfill/FK migration. The source scan confirms it would be unsafe to apply until these write paths and database-side writers are made compatible.

## Server-side authorization review (source revision 9bc3a802)

The following files were read directly at the project revision; this review found concrete gaps but intentionally did not patch them against a schema that is not yet deployed:

| File                                        | Observed behavior                                                                                                                                                                                                                       | Required correction / release dependency                                                                                                                                                                                                                       |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/invoices.functions.ts`             | `createInvoice` and `changeInvoiceStatus` authorize with global `has_any_role` checks (`admin` / `accounting`). Invoice creation reads lead and proposal relationship, then writes through service-role client.                         | Verify user membership and role against the specific lead/proposal company; derive invoice company from trusted parent; ensure status RPC independently scopes invoice to caller's company. Requires company ownership columns and scoped helper/RPC contract. |
| `src/lib/invoice-payments.functions.ts`     | Public checkout/confirmation are token-based and confirmation checks that session belongs to the invoice selected by token. Authenticated cancellation uses global `has_any_role` then service-role lookup by invoice ID.               | Preserve token capability checks. Cancellation must load invoice company and authorize membership/role for that company before using service role. Checkout/payment rows must inherit company from invoice in DB, not metadata/request.                        |
| `src/lib/invoice-payments.server.ts`        | Reconciliation retrieves Stripe session, validates amount/currency/environment and checks metadata invoice/checkout IDs against stored checkout before calling settlement RPC.                                                          | Settlement RPC must derive company from stored checkout/invoice and remain idempotent; webhook event updates must never accept company from Stripe metadata or request. Add tests for replay, mismatched metadata, and wrong environment.                      |
| `src/routes/api/public/payments/webhook.ts` | Verifies Stripe signature; completed events call reconciliation. Expired/failed events update pending checkout by session ID and environment.                                                                                           | Keep signature verification. Confirm checkout is tied to invoice in the DB-side update path; test replay/out-of-order events and never accept tenant identity from event metadata.                                                                             |
| `src/lib/proposals.functions.ts`            | Share creation/revocation use global `has_any_role` checks; creation reads proposal then inserts share using service role. Public get/sign endpoints use exact capability token and constrain operations to the matched share/proposal. | Scope office/sales authorization to the proposal's company. Keep exact-token public capability model; ensure share row company derives from proposal in DB and signed URL path is bound to that proposal.                                                      |
| `src/lib/change-orders.functions.ts`        | Global accounting role check then inserts supplied change-order fields through authenticated client.                                                                                                                                    | Load job by ID, resolve its company, check caller's membership/role for that company, and whitelist fields rather than spreading client data. Database must derive company from job.                                                                           |

### Why these source changes are gated

At the audited application revision, generated Supabase row/insert/update types and current migration state do not yet provide deployed `company_id` ownership on the parent operational tables. The live database audit also found the ownership migration entries pending. Adding application filters against columns that do not exist in production would break current flows; passing a browser-supplied company UUID would create a tenant-spoofing vulnerability. Therefore these server paths are recorded as release blockers rather than patched speculatively.

Before these functions can be safely tightened, the release must provide: (a) applied and verified core ownership schema; (b) membership/role helper that accepts a company UUID and checks `auth.uid()`; (c) company-scoped RPCs for invoice status and settlement; (d) service-role write functions that resolve company only from trusted stored parents; and (e) tests with at least two companies proving same-company success and cross-company denial.

**No code path in this review was represented as fixed. No production migration, deployment, or live data mutation was performed.**

## CI refresh — 2026-11-27

Workflow run **46026211638** on commit `ea8547650445bc6de751fa8e7ed18696f96c787c` completed the substantive pipeline successfully: dependency installation, migration journal validation, privileged-code tenant audit, the existing company/permit PostgreSQL integration suites, lint, application tests, and production build all reported success.

**Coverage limitation:** the current workflow does not execute migration `0055_secondary_operational_company_ownership.sql` against a dedicated fixture schema, and it does not run the required two-company tests for the 13 secondary operational tables. Therefore the green run validates the existing tested company/permit migrations and application baseline; it does **not** validate 0055's backfill, composite constraints, future insert/update behavior, or cross-company denial for invoices, expenses, tasks, proposals, shares, portal links, messages, checkouts, payments, project links, change orders, or estimates.

Before 0055 can be considered merge-ready, add a dedicated PostgreSQL integration test that builds the exact prerequisite schema, applies 0055, asserts all legacy rows survive and receive the expected company, then verifies same-company writes succeed and cross-company parent combinations fail. Also test inserts/updates with missing company_id: the current migration has no ownership-derivation triggers, so NOT NULL will reject legacy application write payloads that omit the field. Do not deploy this migration until those write paths and trigger/RPC behaviors are addressed.
