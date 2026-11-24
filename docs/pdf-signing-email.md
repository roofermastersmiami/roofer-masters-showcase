# PDF Fill & Sign email configuration

The editor stores reusable blank templates in the private `roofing-proposals` bucket and saves their field placements in `pdf_sign_templates`. Signed PDFs and customer email attachments are stored privately in `signed-contracts` under `{lead_id}/{roof_report_id}/`.

To enable the CRM's multi-PDF email action, configure these **server-side** environment variables in the hosting environment (never expose them as `VITE_*` variables):

- `SMTP_HOST`: your mailbox provider's SMTP host (Gmail: `smtp.gmail.com`)
- `SMTP_PORT`: `587` for STARTTLS or `465` for implicit TLS (default: `587`)
- `SMTP_USER`: mailbox login
- `SMTP_PASSWORD`: mailbox app password (Gmail requires 2-Step Verification and an App Password)
- `EMAIL_FROM`: the sender email address, normally the same mailbox as `SMTP_USER`

The server sends email directly over SMTP using Node's built-in networking and TLS modules; no email API, Twilio, paid provider, or client-side mailbox secret is used. The server verifies the staff role, customer-to-report relationship, each attachment's lead/report storage path, PDF file signature, and a 20 MB combined attachment limit before sending. A mailbox provider may still apply its own sending quotas and terms.

If SMTP variables are not configured, the editor will display a clear configuration error rather than pretending the email was sent.
