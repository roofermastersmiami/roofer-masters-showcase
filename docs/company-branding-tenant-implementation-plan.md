# Company-scoped branding implementation plan

Status: **design only — not deployed**. This plan is intentionally limited to branding and workspace preferences. It does not make operational CRM records multi-tenant.

## Existing contract

`crm_company_branding` is currently keyed by `owner_user_id`. The dashboard loads and saves one row for the authenticated user, and logo objects are stored under a user-ID prefix in the `crm-company-branding` bucket. Keep this behavior available during migration so existing accounts do not lose their logo or palette.

The `crm_companies` and `crm_company_memberships` tables provide the company identity foundation. Membership roles include owner, admin, office, sales, production_manager, crew, and accounting. Do not treat membership existence as proof of admin privileges.

## Target data model

Introduce a separate `crm_company_preferences` table rather than changing the primary key or semantics of the legacy account table in the first migration.

- `company_id uuid PRIMARY KEY REFERENCES crm_companies(id) ON DELETE CASCADE`
- `company_name text NULL`
- `logo_path text NULL`
- `theme_palette text NOT NULL DEFAULT 'executive-berry'`, constrained to the three supported palettes: `executive-berry`, `modern-enterprise`, `canyon-corporate`
- `sidebar_appearance text NOT NULL DEFAULT 'navy'`, constrained to the existing supported values
- `created_at`, `updated_at` timestamps
- Optional `updated_by uuid REFERENCES auth.users(id)` for auditability

Keep one row per company. Company membership is the authorization boundary; never use a client-provided company ID without checking membership server-side.

## Authorization contract

Use existing membership helpers only after reviewing their SQL definitions and execution grants. If a dedicated helper is needed, define stable, narrowly scoped functions:

- `is_crm_company_member(company_id)`: true only when `auth.uid()` has a membership in that company.
- `is_crm_company_admin(company_id)`: true only for membership roles `owner` or `admin`.

Enable RLS on `crm_company_preferences`:

- SELECT: `is_crm_company_member(company_id)`
- INSERT: `is_crm_company_admin(company_id)` in both USING/CHECK as applicable
- UPDATE: admin-only in USING and WITH CHECK
- DELETE: admin-only (or prohibit deletion and require company lifecycle RPC)

Do not grant broad table access through a SECURITY DEFINER function. If an RPC is used for saving, it must derive the actor from `auth.uid()`, verify owner/admin membership for the supplied company, validate palette values, and update only that company's row. Revoke execution from PUBLIC/anon and grant only to authenticated users as appropriate.

## Logo object paths and storage

Use a company-first path such as `<company_uuid>/company-logo.<extension>`. The first path segment must be parsed and cast safely; storage policy checks must verify membership in that exact company.

- Read/download: authenticated company members only (do not rely on a public bucket URL).
- Upload, replace, delete: company owner/admin only.
- Enforce the existing MIME allowlist and 2 MB limit.
- Do not allow a user to upload to a different company by supplying an arbitrary path.
- Keep legacy `<user_uuid>/...` objects readable during transition only by their original owner; do not reinterpret user UUID paths as company UUIDs.

The required bucket is private. The dashboard must use short-lived signed URLs created only after authenticated storage access; never use `getPublicUrl()` for this bucket. Migration `0038_company_branding_and_themes.sql` provisions the private bucket and an owner-scoped SELECT policy when it is deployed. The migration is repository code only until an authorized administrator applies it to the connected Supabase project. Do not create a public bucket as a workaround.

### Supabase administrator setup

Before uploads can work in the live CRM, an authorized Supabase administrator must verify the project reference and deploy the reviewed branding migration (or apply its equivalent through the approved database deployment process). Confirm all of the following in the Supabase dashboard:

1. Storage bucket ID and name are exactly `crm-company-branding`.
2. **Public bucket is OFF**.
3. Maximum file size is 2 MB; allowed MIME types are PNG, JPEG, and WebP.
4. Authenticated SELECT, INSERT, UPDATE, and DELETE policies constrain the first object-path folder to `auth.uid()::text`.
5. Test upload, signed-URL display, and cross-user denial using separate test accounts before enabling this for production users.

The current account-scoped storage path is `<auth-user-uuid>/company-logo.<extension>`. Do not replace it with a company UUID path until company membership authorization and a safe branding backfill are implemented.

## Safe backfill and rollout

1. Inspect existing company rows and branding rows in a read-only environment first. Resolve the exact company ID and owner membership for each legacy account; do not infer ownership from email.
2. For the Roofer Masters account, copy the existing branding row into the new company preferences row only after verifying the company-owner mapping. Preserve logo path and all palette settings exactly.
3. Do not overwrite a pre-existing company preference row. Use an explicit conflict report and manual resolution.
4. Deploy schema and RLS first, then test with two companies and at least one non-admin member in each.
5. Update the dashboard to resolve its active company from trusted membership data, read company preferences, and allow edits only to owner/admin. Members may view branding but not change it.
6. Upload new logos under the company UUID path. Keep legacy logo URLs as a fallback until a verified copy exists; only then consider deleting old objects.
7. Monitor read/write errors. Rollback should switch the dashboard back to legacy account branding without deleting either dataset.

## Required automated security tests

Create two isolated companies A and B with owner/admin/member users. Assert:

- A member can read A preferences; cannot read B preferences.
- A non-admin member cannot insert, update, or delete A preferences.
- A owner/admin can update A preferences but cannot update B.
- Forged company IDs are rejected for reads, writes, RPCs, and storage paths.
- Company A cannot list, download, overwrite, or delete Company B logo objects.
- An unauthenticated user cannot read private logos.
- Existing legacy account branding remains readable until migration is explicitly completed.
- Unsupported theme/sidebar values and oversized or disallowed logo uploads are rejected.

These tests must run against the actual migrated Supabase schema (or an equivalent isolated database), not merely mock client calls.

## Explicit non-goals

This change alone does not isolate leads, customers, jobs, estimates, proposals, invoices, expenses, payments, reports, drawings, or other operational records. Do not enable external-company onboarding, company switching, subscriptions, or billing until the broader multi-tenant isolation audit and release gate pass.
