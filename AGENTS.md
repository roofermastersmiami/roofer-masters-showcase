<!-- LOVABLE:BEGIN -->

> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.

## What Lovable manages

Rules outside this block are the project's own. Change the pieces below in
Lovable, not by hand. With the [Lovable MCP](https://mcp.lovable.dev)
connected, `send_message` asks Lovable to do it; otherwise ask the user to
use the editor.

- **Database.** Do not add or edit `supabase/migrations/` or `drizzle/`.
  Ask Lovable to change the schema.
- **Generated files.** Do not edit a file whose header says it is automatically
  generated.
- **AI gateway.** Keep model calls on Lovable's gateway, and keep
  `LOVABLE_API_KEY` out of browser code.
- **Connectors.** Lovable provides native connectors. `list_connectors` shows
  which are enabled; `add_connector` only returns the dashboard link. When a
  connector is enabled, calls go through the connector gateway and need
  `LOVABLE_API_KEY`. When Lovable does not provide one, users can bring their
  own key and store it in Secrets.
- **Secrets.** Lovable manages them. Do not put secret values in the repo.

<!-- LOVABLE:END -->

## Project rules

- Public forms and chat write leads only through server functions in `src/lib/leads.functions.ts` (service-role client, zod-validated); browsers have no insert access to `leads`/`lead_messages`, so validation and abuse checks can't be bypassed.
- Lead form rules (required fields, pipeline stages) live in `src/lib/lead-schema.ts` and are shared by client and server; tests in `src/test/lead-rules.test.ts` cover them.
- Owner access = `admin` row in `user_roles` (trigger on business-email confirmation). Team roles (office, sales, production_manager, crew, accounting) are enforced by `has_any_role` in RLS, storage policies, RPCs and server functions; `src/lib/team-roles.ts` mirrors them for navigation only. Money tables are owner/accounting only; crew read assigned jobs solely through a server projection.
- Editable site text lives in `site_content` and is read via `getSiteContent` (publishable client) in the root loader; the browser-safe `optional-content` caller catches RPC failures as well as server defaults so optional text cannot block sign-in.
- Visitor chat uses a per-lead `chat_token` kept in localStorage; replies are polled, not realtime, to keep the chat simple.
- Proposals and reusable templates share an admin-only library with private PDF storage; new revisions use unique object paths so saved edits cannot expose another document.
- PDF rendering is dynamically imported in the browser; pdf-lib performs additive annotations, form filling and page operations, never claims to replace existing PDF text or securely redact it.
- Customer proposal access uses server-issued expiring, revocable capability tokens checked before signing a short-lived file URL; public responses never expose lead records or the library.
- Proposal sharing opens an email draft or WhatsApp message, not an automatic send; no delivery or pipeline transition is claimed without a verified sending service.
- CRM operations use admin-only task, estimate and job records; job photos stay in private owner-only storage so customer data never becomes public media.
- Invoices are validated server-side, snapshot customer details and store integer cents; customer capability links expose issued invoices only, and issued invoice amounts are immutable.
- Invoice checkout uses embedded payments through the shared gateway client, with server-derived deposit/balance amounts and inclusive tax; test and live records must never mix.
- Invoice payment settlement is row-locked and idempotent per checkout session, confirmed with the provider rather than a redirect; manual payments cannot overlap a pending online checkout.
- Sales reporting counts each signed proposal once and uses only the latest active proposal per lead for open proposal value, avoiding duplicated revisions.
- Instant estimates use only owner-enabled installed rates; lead, qualification, preliminary estimate and unscheduled on-hold job capture are atomic through a service-only RPC called by validated lead server functions.
- Change orders record independent scope, price and schedule deltas with explicit manually recorded approval; they never mutate issued invoices or imply a customer signature.
- Roof report AI extraction runs in a role-checked (office, sales, production_manager) server function (`src/lib/roof-report.functions.ts`) via the AI Gateway SDK; results only prefill the editable material calculator and are never saved without owner review.
- Client portals use owner-issued expiring, revocable per-lead capability links; server projections exclude private notes, addresses, material costs and other customers, and expose only active signed proposal shares and issued matching-environment invoices to preserve customer isolation.
- CRM customer/property records retain source-lead relationships and additive pipeline stages so existing lead, document and payment workflows remain compatible.
- Roof drawings are immutable property-linked revisions; reviewed geometry feeds measured takeoffs while Three.js remains dynamically imported to keep browser rendering outside SSR.
- Report-linked drawing saves go through one owner-checked database function so drawing and report never diverge. Address reports link customers/properties to drawing revisions; address entry never invents roof dimensions, calibrated aerial traces remain unverified until explicit owner review, and measurement edits clear review state.
- Isolate optional roof-renderer failures with a local boundary; install preload recovery before route loading and recover explicit route-import failures at the root boundary, with a shared reload limit to prevent loops.
- Detailed estimates snapshot integer-cent cost lines and comparison options; customer proposal projections omit unit costs, overhead and internal profit.
- Project financial revenue uses unique explicit invoice-to-job allocations validated against customer/property relationships, never inferred from a shared lead, to prevent double counting.
- Recorded expense analytics stay payment-environment isolated and distinguish cash collections from invoice sales; Excel/PDF exports are browser-only imports to keep server bundles compatible.
- Free aerial import uses only keyless public-domain sources (Census geocoder, USGS National Map) via an owner-only server function; imagery-derived measurements carry an accuracy basis and image credit and are never labeled survey-grade.

- Aerial import validates Census coordinates and USGS PNG size/dimensions server-side; decode image bytes locally and report request vs storage failures without logging customer data.
- Agent access uses OAuth-verified caller clients and explicit field projections in `src/lib/mcp`; read-only tools retain RLS and role checks. Browser tools stay in the CRM shell with fail-open static telemetry; consent returns use canonical local paths to avoid redirects outside the app.
