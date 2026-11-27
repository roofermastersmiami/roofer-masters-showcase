# Two-company isolation test plan

Status: **blocked on the Lovable-managed tenant schema and deployed-policy implementation**. This plan defines the release gate; it is not evidence that isolation currently exists.

## Test fixture contract

Create an isolated test database or transaction-scoped fixtures with:

- Company A and Company B.
- Owner, office/sales, production-manager, accounting, and crew users for each company.
- One lead, customer, property, job, estimate, proposal, invoice, expense, roof report, drawing, activity item, and photo/file per company.
- A Company A crew assignment and a separate Company B crew assignment.
- One issued invoice capability token per company and one public booking configuration per company.

Never use production customer data or production payment credentials. Tests must run with the same database roles and JWT claims used by the application, not only as a database superuser. Where possible, run negative cases in separate transactions so one expected denial does not hide another.

## Required isolation matrix

| Surface                      | Company A expected behavior                                                                       | Cross-company denial                                                                                    |
| ---------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Leads, customers, properties | A members read and update A rows within their role                                                | A cannot select, update, delete, or infer B rows                                                        |
| Customer/lead relationship   | A customer can link only to an A lead; lead/customer synchronization stays within A               | Reject A customer ↔ B lead links in either direction                                                    |
| Property relationship        | A property can link only to an A customer                                                         | Reject A property ↔ B customer and B property ↔ A customer                                              |
| Jobs                         | A authorized staff can read and update A jobs                                                     | A cannot read, update, delete, export, or attach B job IDs                                              |
| Job relationships            | A job can reference only A lead, property, and proposal                                           | Reject any mixed-company parent references                                                              |
| Crew assignments             | A job can be assigned only to active A crew members                                               | Reject B crew IDs and users without an A crew membership, even if their UUID is supplied                |
| Estimates/proposals          | A users see only A records and A customer-safe projections                                        | B record IDs cannot be attached to A leads/jobs or exposed by a guessed URL                             |
| Invoices/payments            | A accounting/owner roles manage A financial rows; customers can use A's issued-invoice capability | A CRM user cannot read B financial rows; A invoice capability cannot resolve or pay B invoice           |
| Expenses/allocation links    | A expenses and invoice-project links resolve only to A jobs/invoices/customers/properties         | Reject every mixed-company link, including indirect invoice-to-job joins                                |
| Roof reports/drawings        | A report and immutable drawing revisions resolve only through A customer/property                 | A cannot read, save, revise, or delete B report/drawing records                                         |
| Activity/tasks/messages      | A activity and task views contain only A records                                                  | No B activity, task, or lead-message visibility through joins or search                                 |
| Public booking               | A public booking page returns only A availability and books only A appointments                   | A public configuration/token cannot query or reserve B calendar slots                                   |
| Signed URLs                  | A authorized member can create a short-lived URL for an A object                                  | A cannot sign, download, overwrite, or delete B object paths by guessing UUIDs                          |
| Storage listing              | A sees only A objects under allowed parent records                                                | Listing prefixes or object names cannot enumerate B files                                               |
| RPC execution                | A role-appropriate RPC succeeds for A records                                                     | Every RPC denies B IDs, including SECURITY DEFINER functions and direct RPC invocation                  |
| Exports/search               | A exports and search results include only A data                                                  | B rows must not leak through aggregate totals, CSV/PDF exports, counts, autocomplete, or error messages |

## Authorization variants to run for each applicable surface

1. Anonymous caller.
2. Authenticated user with no company membership.
3. A owner/admin.
4. A office/sales user.
5. A production manager.
6. A accounting user.
7. A crew user assigned to the A job.
8. A crew user not assigned to the A job.
9. B owner/admin attempting to access A data, and A owner/admin attempting to access B data.
10. Service-role/webhook execution, verifying it is not exposed to browser roles and that trusted server code derives the correct company.

For each row, test SELECT, INSERT, UPDATE, DELETE, RPC execution, storage SELECT, INSERT, UPDATE, DELETE, list, and signed-URL creation where the operation exists. Assert both the returned data and the absence of side effects after a denied request.

## Existing Roofer Masters compatibility gate

Before enabling company-aware authorization, create a one-time, reviewed mapping of existing authenticated user IDs to the Roofer Masters company. Do not infer membership from email alone. Verify:

- The existing owner retains owner access and can manage all current Roofer Masters workflows.
- Existing office, sales, production-manager, accounting, and crew users retain only their current intended permissions.
- Existing assigned crew can still see and upload photos for their assigned jobs.
- Customer creation/editing, lead-to-customer synchronization, property linking, estimates, proposals, roof reports/drawings, jobs, expenses, invoices, manual payments, and customer invoice payment still work.
- Existing private files remain readable by their authorized Roofer Masters users after path/policy migration.
- No existing record is silently orphaned, duplicated, reassigned, or exposed to a new company.

## RPC and storage verification

- Query effective EXECUTE grants for every overloaded function signature; test PUBLIC, anon, authenticated, and service_role separately.
- Confirm public intake, booking, and customer invoice-payment flows are narrowly capability-based and cannot accept a browser-supplied company identifier as authority.
- Confirm webhook settlement is service-only and the server verifies the provider event before invoking it.
- For each storage bucket, test read/list/upload/update/delete and signed URLs against both the parent record's company and the object path. A UUID or folder prefix alone is not authorization.
- Confirm storage paths cannot be moved or rewritten to change company ownership and that deleted/reassigned parent records do not leave downloadable orphan files.

## Release criteria

Do not enable company switching, invitations, external-company onboarding, or company billing until:

1. The Lovable-managed schema/backfill and all company-aware RLS, constraints, triggers, RPC bodies/grants, and storage policies are deployed.
2. Every negative cross-company case above is denied at the database/storage boundary, not merely hidden in the UI.
3. Every Roofer Masters compatibility case passes.
4. Automated tests run against a real migrated test database using separate authenticated identities.
5. CI passes on the exact PR head and a reviewer confirms the deployed schema matches the tested migration.

## Roof-report workflow isolation gate

The roof-report workflow is a priority blocker because its current server functions combine authenticated user-scoped reads with privileged service-role writes. Do not treat a successful user-scoped read as authorization for a later admin-client mutation.

Before enabling this workflow for multiple companies, verify all of the following against a migrated test database with separate Company A and Company B identities:

- **Create:** replace the address-first `create_roof_report_request` overloads with one unambiguous company-derived entry point. Derive company identity from the authenticated membership, never from browser input. Normalize address deduplication and advisory-lock keys within company scope. Property, customer, lead, and report creation must all use the same company and reject mixed-company relationships.
- **Read and update:** every report lookup and mutation must enforce the authenticated user's company at the database boundary. A Company A user guessing a Company B report UUID must receive the same not-found/denied behavior and cause no side effect.
- **PDF attachment:** verify the report belongs to the caller's company before accepting a file path. Storage authorization must resolve the report row and compare its company; the `roof-report/{report-id}/...` prefix alone is not authorization.
- **Delete and cleanup:** perform a company-scoped delete and ensure the file cleanup can only remove the PDF referenced by that same authorized report. A failed/denied database delete must never trigger storage deletion.
- **Transfer:** estimate and material handoffs must prove report, customer, lead, property, job, and estimate all belong to the same company. The job relationship must be protected by database constraints/RLS, not only matching IDs in application code.
- **Overloads and grants:** enumerate every deployed signature of `create_roof_report_request`; test EXECUTE grants separately for PUBLIC, anon, authenticated, and service_role. Remove obsolete overloads only after callers and deployed schema have been reconciled.
- **Compatibility:** verify current Roofer Masters users can create, update, attach, review, transfer, and delete reports, and that existing PDFs remain accessible to authorized users.

Required negative cases: A creates against B's address/property; A updates B's report; A attaches a PDF to B's report; A lists/signs/downloads/deletes B's PDF; A deletes B's report; A transfers B's report to an A job; and B performs the symmetric attempts against A. Assert zero database and storage side effects for every denial.

**Current implementation finding (reviewed 2026-11-26):** `createRoofOrder` calls the six-argument legacy RPC; `updateRoofOrder`, `attachRoofOrderPdf`, and `deleteRoofOrder` use `supabaseAdmin` for mutations without an explicit company predicate. The legacy create RPC performs address-based property lookup without company scope, and the current report storage policy is not parent-company scoped. These paths remain blocked until schema, RPC, RLS, storage policy, and two-company tests are implemented together.
