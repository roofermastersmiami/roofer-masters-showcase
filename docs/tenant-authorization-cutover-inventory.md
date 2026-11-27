# Tenant authorization cutover inventory

Status: read-only discovery; no production writes. Verified 2026-11-26.

## Production identity and membership result

The live `user_roles` inventory currently returns one row:

| User ID                                | Legacy role | Company memberships | Membership role |
| -------------------------------------- | ----------- | ------------------: | --------------- |
| `1c633ded-fb54-455c-939a-9af3321c6016` | `admin`     |                   1 | `owner`         |

The membership belongs to the existing Roofer Masters company. This supports the owner identity mapping for the currently observed account only. It is not evidence that there are no other staff identities in external identity providers or pending invitations. Repeat this inventory immediately before any production cutover.

## Existing core-table policy behavior

Read-only `pg_policies` inspection returned the following policies:

- `leads`: owner SELECT/UPDATE/DELETE; office/sales/production_manager/accounting SELECT; office/sales UPDATE.
- `crm_customers`: owner ALL; office/sales/production_manager/accounting SELECT; office/sales UPDATE.
- `crm_properties`: owner ALL; office/sales INSERT/UPDATE; office/sales/production_manager/accounting SELECT.
- `roof_report_orders`: owner SELECT; office/sales/production_manager SELECT.

These are permissive PostgreSQL policies and combine with OR. A membership-aware policy must not be added while these global-role policies remain active; doing so would not provide tenant isolation. The cutover must replace the complete policy set for each table in one reviewed migration and preserve the effective role matrix above.

## Application write-path blockers

Repository inspection found that:

- `src/lib/company-context.ts` intentionally resolves exactly one authenticated membership and explicitly warns not to enable company switching before database isolation exists.
- `src/lib/customers.functions.ts` calls `save_crm_customer` and `delete_crm_customer`; both RPCs must derive company ownership from the authenticated membership and validate parent relationships in SQL.
- `src/lib/leads.functions.ts` has public website/chat lead creation paths using a service-role client. These must assign the verified Roofer Masters company server-side after migration 0042, never accept a browser-supplied company ID. Public lead/chat behavior must remain functional.
- `src/components/dashboard/Customers.tsx` does not send a company ID (correctly); the server RPC should derive it.
- `src/integrations/supabase/types.ts` currently omits `company_id` from the generated row/insert/update types for the four newly owned tables and must be regenerated or updated alongside the schema release.

## Safe implementation sequence

1. Preserve public lead/chat intake with server-derived company ownership.
2. Update customer/property/lead/report write RPCs to derive company from authenticated membership (or explicitly trusted service-role context), and validate all linked records use that company.
3. Update generated Supabase types and app query/write paths; do not accept company IDs from untrusted clients.
4. In the same coordinated database release, backfill any verified staff memberships, replace all global-role policies on the four core tables with company+role policies, and test the exact old permission matrix.
5. Add two-company tests for SELECT, INSERT, UPDATE, DELETE, composite relationships, and RPC execution.
6. Only then permit external-company onboarding.

Do not deploy an RLS-only migration before steps 1–3. That could break existing data-entry flows; adding new permissive policies without removing old ones would fail to isolate tenants.
