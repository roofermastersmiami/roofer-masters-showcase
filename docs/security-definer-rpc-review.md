# Security-definer RPC review

Status: **review inventory only — multi-company release remains blocked**.

Reviewed SQL definitions on `feat/customizable-crm-dashboard`. This is a targeted first pass over high-impact functions, not a complete database security certification. The findings below describe the current global-role/account model; they must be re-evaluated after company membership becomes authoritative.

## Function inventory

| Function | Current authorization / boundary | Multi-company remediation |
| --- | --- | --- |
| `record_invoice_payment` | Requires global `admin`; locks the invoice and validates status, amount, and pending checkout state. | Resolve the invoice's company and require an owner/accounting membership in that same company before mutation. Keep the row lock and payment invariants. |
| `set_invoice_status` | Requires global `admin`; checks invoice state and pending checkout. | Same-company owner/accounting membership; retain state-transition and pending-checkout guards. |
| `settle_invoice_checkout` | No end-user role check; finds checkout by provider session/environment, locks checkout and invoice, checks amount/environment, and is idempotent after paid. | Keep as a trusted webhook-only operation. Verify the caller boundary in the server webhook before RPC invocation; bind checkout, invoice, and payment rows to the same company and retain idempotency/locking. Never expose this RPC as a browser capability. |
| `reserve_invoice_checkout` | Public capability-token flow; requires a valid issued, unexpired invoice token and matching environment, then locks the invoice and reserves one pending checkout. | Preserve token capability semantics, but enforce company consistency across invoice and checkout. Do not replace the public customer token with a user membership requirement. |
| `capture_instant_roof_lead` | Public lead-capture function; writes lead, optional estimate, and unscheduled job without a staff-role check. | Treat as an intentional public intake boundary. Validate every input and rate/abuse controls in the server function; stamp the resolved company server-side, never accept a company ID from the browser. |
| `create_roof_report_request` (legacy signature) | Requires global owner role; validates customer existence and request fields, then creates/links property and report. | Require membership in the same company as the customer/property; enforce company-consistent links in the database. |
| `create_roof_report_request` (address/contact signatures) | Requires global office/sales role; finds or creates customer/property based on address and creates report. | Resolve company from authenticated membership; address matching and advisory-lock keys must include company ID to prevent cross-company record reuse or lock contention. |
| `save_report_drawing` | Requires global owner role; locks report and checks report/property ID match before writing a drawing revision. | Require same-company owner membership and validate report, property, drawing, and parent revision all belong to that company. |
| `save_crm_customer` | Requires global office/sales role; updates customer by supplied ID after checking existence, then updates linked lead. | Require same-company membership and verify customer, source lead, and all linked records share the active company. |
| `get_available_slots` | Security-definer read of appointment schedule; returns unoccupied slots. | Decide whether availability is intentionally global/public or company-specific. If each company has its own calendar, filter by company and ensure public callers cannot infer another company's bookings. |
| `book_roof_appointment` | Public booking function; validates service/source and checks an available slot before inserting an appointment. | Stamp company from a server-controlled public booking configuration/token; validate lead ownership when a lead ID is supplied. Keep overlap protection and verify public input bounds. |
| `sync_lead_customer`, `log_crm_lead_activity` triggers | Security-definer triggers maintain customer/property and activity records after lead changes. | Derive company from the triggering lead and copy it to every child row. Reject mismatched company IDs; triggers must not infer company from caller-supplied JSON. |

## Confirmed strengths worth preserving

- Invoice writes use row locks and balance checks; online checkout settlement checks environment and amount and is idempotent for already-paid sessions.
- Customer invoice checkout is intentionally capability-based: a customer does not need a CRM login to pay an issued invoice.
- Roof report drawing save checks report/property identity before creating a revision.
- Crew job reads use an explicit projection and filter by the authenticated crew member's assigned user ID in the server function.

## Priority gaps before tenant rollout

1. **Company context is missing from these function contracts.** The current authorization helpers only establish a global role; they do not prove the caller belongs to the company owning the target record.
2. **Public and webhook functions need distinct trust boundaries.** Public intake/booking and customer payment flows should remain public only through narrowly validated capabilities; provider settlement must only be invoked after trusted webhook verification.
3. **Relationship checks must be tenant-aware.** A valid customer ID, property ID, report ID, invoice ID, or lead ID is not sufficient unless every related record belongs to the same company.
4. **Address-based deduplication must be company-scoped.** The address lookup and advisory-lock key in report creation must include the company identifier.
5. **Triggers need explicit propagation.** Definer triggers that create child rows must copy the parent company's ID and reject cross-company references.
6. **Function execution grants need review.** For each RPC, inspect `EXECUTE` grants for `anon`, `authenticated`, and service roles; a correct function body is not enough if an unintended caller can invoke it.

## Safe next step

Use the connected Lovable database workflow to implement schema and SQL changes only after the company backfill and tenant-context design are agreed. Do not add hand-written Drizzle/Supabase migration files in this repository. For each function, add database-level tests proving Company A cannot read or mutate Company B records, and add positive tests proving the existing Roofer Masters owner/team workflows still work. Do not enable company onboarding, switching, or subscription billing until the full release gate in `saas-multi-tenant-isolation-audit.md` passes.
