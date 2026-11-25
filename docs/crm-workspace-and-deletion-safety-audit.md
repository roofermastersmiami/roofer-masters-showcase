# CRM workspace and deletion safety audit

## Company avatar storage blocker

The avatar uploader targets the Supabase Storage bucket `crm-company-branding`. The live project currently returns `Bucket not found` for that bucket. The application cannot create a bucket through the browser, and this repository's project rules reserve schema/storage configuration for an authorized project administrator.

Required administrator setup before avatar uploads can work:

- Create a bucket named `crm-company-branding`.
- Keep it **private**; do not enable public access.
- Add narrowly scoped policies for authenticated company members to upload and read only their own/company-authorized logo objects.
- Use short-lived signed URLs for display after the bucket and policies exist.
- Verify owner and non-owner access with separate accounts before enabling uploads in production.

No bucket, policy, or production database change is made by this code change. The UI now translates the missing-bucket error into an actionable setup message.

## Dashboard workspace

The dashboard already supports reordering its four summary metric cards by desktop drag-and-drop and by explicit move-earlier/move-later controls. The move controls work with touch and keyboard input. Card order, visibility, density, and style are stored in browser local storage; this is device-local, not company/account synchronized. The interface now explains the mobile/keyboard controls and labels reorderable cards for assistive technology.

The revenue chart and sales snapshot remain fixed; this change does not claim that every dashboard section is movable.

## Deletion safety findings

### Customer records

- Deletion is routed through the authenticated `deleteCustomer` server function and database RPC.
- The RPC permits only office/sales roles.
- It refuses deletion while the customer has linked properties or roof reports.
- It detaches the CRM customer link from the source lead, preserving the original lead record.
- The UI requires confirmation and provides swipe-to-reveal deletion on touch devices.

### Roof report records

- Deletion is routed through an authenticated server function with role checks.
- The file path is validated to remain within that report's expected storage prefix.
- The previous order removed the PDF before deleting the database row. If the row deletion then failed, the report record could remain while its only attached PDF had already been removed.
- This change deletes the database row first, then attempts private PDF cleanup. If cleanup fails, the UI warns that an orphaned private PDF may need administrator cleanup. This favors preserving the report file if the database deletion itself fails.

### Properties and leads

- Property records currently have no delete action. That is intentional until all report, drawing, job, estimate, and invoice relationships are reviewed and a safe archive/delete policy is implemented.
- Leads are not given a generic delete control in this pass; they are the source of customer and business history and may be referenced by proposals, jobs, invoices, messages, and analytics.
- No cascading delete or broad client-side delete was introduced.

## Remaining work

- Provision the private logo bucket and least-privilege policies through the authorized Supabase administration path.
- Decide whether dashboard preferences should be persisted per company after the tenant isolation and branding schema are deployed safely.
- Map every property/lead foreign-key dependency and implement reversible archive or guarded deletion only after those dependencies are covered by server-side authorization and tests.
- Audit report deletion against drawing revisions and any external references before considering broader deletion controls.
