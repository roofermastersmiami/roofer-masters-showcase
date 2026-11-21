# Roofer Masters CRM — Read-only audit (second pass) and phased plan

No code, data, settings or integrations were changed. No sample records were created.

## Evidence collected
- **Project:** one project holds the public website and the owner CRM. The CRM is the signed-in dashboard; customers use separate links for proposals, invoices and the portal.
- **Checks:** 13 test files and 88 tests pass. The build log shows no errors and no runtime errors were recorded.
- **Database:** turned on. Live records: 13 leads, 13 customers, 12 properties, 3 estimates, 3 jobs, 1 invoice. There are 0 payments, proposals, roof reports, drawings and expenses. There is 1 login account (owner).
- **Linter:** 15 warnings. They are about database helper functions that can be called directly.
  - 5 of these are database triggers or the role check. Triggers refuse to run when called directly, and the role check only answers yes or no. These are low risk but should still be tidied.
  - The owner functions (save customer, record payment, invoice status, report request, report drawing save) all check for the owner role first, so other signed-in users are refused.
- **Security scan:** only the third-party package check exists, and it is out of date. A full scan has not been run.

## Feature status
| Area | Status | Evidence / gap |
|---|---|---|
| Dashboard, sidebar, dark mode, mobile | Working | CRM shell and overview; tested in the browser earlier |
| Leads, customers, multiple properties | Working | Customer/property records with a trigger that links leads to customers, owner-only rules, foundation tests |
| Pipeline and activity | Working | 13 stages with automatic activity log (CRM tests) |
| Follow-ups / tasks | Partial | Reminders and overdue alerts work; project tasks and employee tasks are missing |
| Own address-based roof reports (no paid provider) | Working, manual | Create a report by address, linked to customer and property; paid providers are blocked for new reports; drawing and report save in one step (report rules tests) |
| 3D measurement | Partial | 3D planes, pitch, area, edges, penetrations, image tracing, saved versions (geometry and trace tests). No automatic measurement from an address or satellite; no dragging corners in 3D |
| Report PDF with photos | Working | PDF includes measurements, materials and photos (verified earlier) |
| Estimator and cost catalog | Working | Instant estimator plus detailed estimator with options and margin (estimate tests). Customers cannot pick an option |
| Material takeoff / AI report reading | Working | Material calculation tests; AI reads uploaded reports and fills the editable form |
| Proposals, templates, signatures | Working | Proposal tests; one-time customer signing |
| PDF editing | Partial | Markup, form filling and page edits work; original text cannot be replaced or securely blacked out |
| Contract initials, document library | Missing | |
| Production / jobs | Partial | 4 statuses, checklist, private photos, change orders, material orders. The 14 stages, daily logs and timeline are missing |
| Invoices | Partial | Issue, void, deposits, PDF, customer link. Editing drafts and progress billing are missing |
| Payments | Blocked for live | Manual payments and test-mode online checkout work. Live payments need your business address and activation; no real purchase has been tested |
| Expenses and profit | Working | Receipts, invoice-to-job links, Excel/PDF export. No expenses have been entered yet |
| Website leads and chat | Working | Lead and CRM tests |
| Social / Google lead capture | Blocked | Not connected |
| Client portal | Working | Portal tests: links expire, can be turned off, and each customer sees only their own data. No approvals or messages in the portal yet |
| Calendar | Missing | Dates are stored but there is no calendar view |
| Team roles and permissions | Missing | Only the owner role exists |
| Inventory and suppliers | Missing | |
| Automations | Partial / blocked | Database activity logging only. No automatic email or text: they need a sending domain and a phone service |
| Phone receptionist | Blocked | No phone service connected |

## Risks
- Adding staff today would give them everything or nothing, so team roles must come before inviting anyone.
- Database helper functions are callable from outside the app. The ones that matter check for the owner role, but tidying them reduces the attack surface.
- The full security scan is missing, so the app cannot be called secure yet.
- Report measurements are only as accurate as the dimensions you enter or the photo you trace. Nothing has been compared against EagleView or Roofr.

## Phased plan (each phase keeps all existing records and is tested before the next)
1. **Lockdown:** block direct calls to the trigger and owner helper functions where safe, run the full security scan and fix its findings.
2. **Team roles:** office, sales, production manager, crew and accounting. Only owner and accounting see money. Each CRM section gets its own access setting.
3. **Production:** 14 stages added to the existing jobs, daily logs, timeline, crew assignment, budget versus actual costs.
4. **Calendar:** one view combining follow-ups, inspections, job dates and deliveries.
5. **Roof reports, part 2:** drag corners in 3D, more roof shapes, a stronger report PDF. Optional: automatic measurement from satellite or LiDAR data, only if you choose a data service.
6. **Documents and billing:** customer estimate approval in the portal, progress and final invoices, editing draft invoices, receipts, contract initials, a file library.
7. **Inventory and suppliers:** supplier records, purchase orders from material takeoffs, stock levels and reorder alerts.
8. **Automations:** rules that create tasks and alerts now; email and text sending once those services are connected.

## Decisions needed
- **Team roles:** confirm the roles and money access in Phase 2. The earlier role question closed without an answer.
- **Email:** verify a sending domain to turn on automatic email.
- **Live payments:** add your business address and activate live payments.
- **Phone and texts:** pick a phone/SMS service and approve its usage costs.
- **Automatic roof measurement (optional):** choose a satellite or LiDAR data service and approve its costs. Otherwise reports stay manual or traced from photos.
