# Secondary CRM tenant-scope audit — 2026-11-27

**Source:** read-only catalog queries against the connected Roofer Masters production Supabase database.
**Purpose:** define the remaining operational ownership and RLS cutover scope after the core company/permit integration.
**Safety:** no production DDL, DML, policy changes, storage changes, migration-ledger edits, or deployment were performed.

## Confirmed live gap

The following 13 operational tables have no `company_id` column and still have legacy global-role RLS policies. These policies are permissive and PostgreSQL combines permissive policies with OR semantics; adding company policies without removing the legacy policies will not isolate tenants.

| Table | Tenant parent candidates from live columns | Existing policy family |
|---|---|---|
| `client_portal_links` | `lead_id` | office/sales and admin |
| `crm_activity` | optional `lead_id` | admin, office, sales, production |
| `crm_expenses` | optional `job_id` | accounting and admin |
| `crm_invoices` | optional `lead_id`, `proposal_id`, `property_id` | accounting and admin read |
| `crm_tasks` | optional `lead_id` | office, sales, production, admin |
| `invoice_checkouts` | `invoice_id` | accounting/admin read |
| `invoice_payments` | `invoice_id` | accounting/admin read |
| `invoice_project_links` | `invoice_id`, `job_id` | accounting and admin |
| `job_change_orders` | `job_id` | accounting and admin |
| `lead_messages` | `lead_id` | office/sales and admin |
| `proposal_shares` | `proposal_id` | office/sales and admin read |
| `proposals` | optional `lead_id`, `property_id`, `drawing_id` | office/sales and admin |
| `roof_estimates` | optional `lead_id`, `property_id`, `drawing_id`, `report_order_id` | office/sales and admin |

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
