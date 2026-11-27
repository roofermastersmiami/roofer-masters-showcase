# Public lead intake company routing

Unauthenticated website lead forms, instant estimates, and website chat cannot derive a tenant from `auth.uid()`. They must not accept a company ID from browser input.

## Required server configuration

Set `CRM_PUBLIC_COMPANY_ID` on the server to the UUID of the intended company. For the initial Roofer Masters deployment, use the existing Roofer Masters company UUID from the verified database. Do not put this value in a `VITE_*` variable or expose it to browser code.

The server resolver fails closed when the value is absent or malformed. Migration 0045 also verifies that the supplied UUID belongs to an existing company before writing an instant-estimate lead.

## Deployment order

This change is stacked after migrations 0042–0044. Deploy the server variable and code only as part of the coordinated release in which 0042 adds `leads.company_id` and 0045 updates the instant-estimate RPC. Do not deploy this application code alone against the pre-0042 schema.

## Scope

- Contact form, callback form, instant estimate, and chat-start lead rows receive the server-configured company ID.
- Rate limiting is scoped to that company.
- Chat messages remain linked through the created lead ID.
- Existing chat follow-up operations resolve the lead by its opaque chat token; they do not accept a company ID from the browser.

This is a single-company public-intake routing mechanism, not domain-based multi-tenant routing. External-company onboarding remains disabled until trusted host-to-company routing and the broader authorization cutover are implemented and adversarially tested.
