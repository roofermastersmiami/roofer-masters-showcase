# Roofer Masters CRM — Read-only audit and phased plan

No code, schema, data, settings or integrations were changed for this audit.

## 1. Is this the CRM or only the website?

It is both. This one project holds the public website and the full owner CRM.

- Public pages: home, services, gallery, about, reviews, service areas, contact, instant estimator, plus customer links for proposals, invoices and the client portal.
- Owner CRM: the signed-in dashboard (`/dashboard` and `/dashboard/<section>`), with about 45 dashboard components and about 30 server and data modules.
- The database is turned on. Live record counts: 13 leads, 13 customers, 12 properties, 3 estimates, 3 jobs, 1 invoice. There are 0 payments, proposals, roof reports, drawings and expenses. There is 1 login account, and it has the owner role. No QA test customers are left.

## 2. Working modules (with evidence)

| Module                           | Status               | Evidence                                                                                                                                                          |
| -------------------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dashboard and CRM shell          | Working              | Sidebar, mobile menu, search, light and dark modes, overview totals. Checked in the browser in earlier turns                                                      |
| Leads, customers, properties     | Working              | Server-checked lead capture, customer/property records with owner-only access rules, a database trigger that links leads to customers                             |
| Pipeline and follow-ups          | Working              | 13 sales stages, activity log, follow-up tasks and overdue alerts                                                                                                 |
| Roof reports by address and 3D   | Working, but manual  | Reports linked to customer and property, 3D roof planes, image tracing, PDF with photos, owner review step. Tested end to end, then the test records were removed |
| Estimator and cost catalog       | Working              | Instant estimator using your installed rates, detailed estimator with options, material takeoff, AI reading of uploaded reports                                   |
| Proposals, PDF tools, signatures | Working, with limits | Templates, PDF markup and form filling, expiring share links, one-time customer signing                                                                           |
| Jobs and production              | Basic                | 4 job statuses, checklist, private photos, material orders, change orders                                                                                         |
| Invoices and payments            | Working in test mode | Server-checked invoices, manual payments, test-mode online checkout with locked, one-time settlement. No real purchase has been made                              |
| Expenses and profit              | Working              | Expenses with receipts, invoice-to-job links, Excel/PDF export. No expenses have been entered yet                                                                 |
| Website leads and chat           | Working              | Forms and chat save to the CRM through server functions                                                                                                           |
| Client portal                    | Working              | Expiring, revocable links. Each customer sees only their own data                                                                                                 |

## 3. Missing, incomplete or broken

- **Missing:** calendar (day/week/month), team members with roles and permissions, inventory and suppliers, automation center, central file library, dedicated calculator suite, Google/Facebook/Instagram lead connectors.
- **Incomplete:**
  - Jobs have only 4 statuses; the brief asks for 14 production stages. Job timeline and daily logs are also missing.
  - Customers cannot approve an estimate or choose an option in the portal.
  - Progress billing and draft-invoice editing are missing.
  - Contract initials and versioned terms are missing.
  - The PDF editor cannot replace original text or securely black it out.
  - Roofs are not measured automatically from an address. A satellite or LiDAR service would be needed.
  - Email and text messages are not sent automatically. Drafts open in your mail app or WhatsApp instead.
- **External, not connected:** the AI phone receptionist (no phone service connected), live card payments (the payment account needs a business address and activation), automatic email (no verified sending domain).
- **Broken:** the newest build log has no errors. The earlier blank-screen problem has a recovery guard and was verified.

## 4. Data, auth and security risks

- Only one owner role exists. Adding employees today would give them full access or none, so team permissions must come before inviting staff.
- Saving a report-linked drawing is not one database step. If the report update fails after the drawing saves, the drawing can be left unlinked. This should become a single database function.
- Some old provider choices (EagleView and others) are still allowed in report data. The screen only offers your own reports, but the leftover choices should be cleaned up.
- The last security scan covered only third-party packages (no findings) and is out of date. A full security scan has not been run recently, so the app cannot be called secure yet. Run one from the Security tab.
- The roof-photos storage rules were written for job photos. Report photo upload and download worked in testing, but the rules should be reviewed.
- Secrets stay on the server. None were opened or shown during this audit.

## 5. Phased plan (each phase keeps existing data and is tested before the next)

1. **Hardening:** make the drawing-plus-report save one database step, tighten report choices and the photo storage rules, run a full security scan and fix its findings.
2. **Team and permissions:** employee profiles, roles (owner, office, sales, production manager, crew, accounting), per-section access. Update the owner-only access rules without breaking current owner access.
3. **Production:** extend the existing jobs table to 14 configurable stages, add daily logs, timeline, crew assignment, budget versus actual costs, and customer-visible photo updates.
4. **Calendar and tasks:** one calendar view built on existing follow-ups, inspections, job start dates and material deliveries. No duplicate task table.
5. **Inventory and suppliers:** supplier records, purchase orders created from material takeoffs, stock levels and reorder alerts.
6. **Documents and billing:** customer estimate approval and option choice, progress and final invoices, receipts, contract initials, and a central file library over the existing private storage.
7. **Automations:** a rules screen (new lead, proposal signed, payment received, stage changed) that creates tasks and alerts now. Email and text sending can be added once the services in section 6 are connected.

## 6. Decisions and approvals needed

- **Order of phases:** confirm the order above, or tell me which phases come first.
- **Team roles:** confirm the role list and who gets access to money and pricing.
- **Email sending:** to send automatic emails, verify a sending domain (for example roofermastersmiami.com).
- **Live payments:** add your business address in the payment account and activate live mode.
- **Phone receptionist and texts:** choose a phone/SMS service, approve connecting it, and accept its usage costs.
- **Automatic roof measurement (optional):** choose an aerial-imagery or LiDAR data service and accept its costs. Otherwise reports stay manual or traced from photos.
- **Social lead capture (optional):** approve connecting your Google, Facebook and Instagram accounts.
