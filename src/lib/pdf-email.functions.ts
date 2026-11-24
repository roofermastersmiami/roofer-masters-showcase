import { createServerFn } from "@tanstack/react-start";
import { setResponseHeader } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const requestSchema = z.object({
  leadId: z.string().uuid(),
  reportId: z.string().uuid(),
  to: z.string().email().max(254),
  subject: z.string().trim().min(2).max(180),
  message: z.string().trim().min(1).max(12000),
  attachments: z.array(z.object({
    path: z.string().min(1).max(500),
    filename: z.string().min(1).max(180).regex(/^[a-zA-Z0-9._ -]+$/),
  })).min(1).max(10),
});

export const emailRoofReportPdfs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => requestSchema.parse(input))
  .handler(async ({ data, context }) => {
    setResponseHeader("Cache-Control", "private, no-store");
    const { data: allowed, error: roleError } = await context.supabase.rpc("has_any_role", {
      _user_id: context.userId,
      _roles: ["admin", "office", "sales", "production_manager"],
    });
    if (roleError || !allowed) throw new Error("You do not have permission to email roof documents");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: report, error: reportError } = await supabaseAdmin
      .from("roof_report_orders")
      .select("id, customer_id")
      .eq("id", data.reportId)
      .maybeSingle();
    if (reportError || !report?.customer_id)
      throw new Error("Could not verify the roof report customer");
    const { data: customer, error: customerError } = await supabaseAdmin
      .from("crm_customers")
      .select("source_lead_id")
      .eq("id", report.customer_id)
      .maybeSingle();
    if (customerError || customer?.source_lead_id !== data.leadId)
      throw new Error("The selected roof report does not belong to this customer");

    const maxBytes = 20 * 1024 * 1024;
    const files: Array<{ filename: string; content: Buffer }> = [];
    let totalBytes = 0;
    for (const attachment of data.attachments) {
      const expectedPrefix = `${data.leadId}/${data.reportId}/`;
      if (!attachment.path.startsWith(expectedPrefix) || attachment.path.includes(".."))
        throw new Error("An attachment is not linked to this customer and roof report");
      const { data: blob, error } = await supabaseAdmin.storage
        .from("signed-contracts")
        .download(attachment.path);
      if (error || !blob) throw new Error(`Could not load ${attachment.filename}`);
      const bytes = Buffer.from(await blob.arrayBuffer());
      totalBytes += bytes.byteLength;
      if (totalBytes > maxBytes) throw new Error("Email attachments must total 20 MB or less");
      if (bytes.subarray(0, 5).toString("ascii") !== "%PDF-")
        throw new Error(`${attachment.filename} is not a valid PDF`);
      files.push({ filename: attachment.filename, content: bytes });
    }

    const required = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASSWORD", "EMAIL_FROM"];
    const missing = required.filter((key) => !process.env[key]);
    if (missing.length) {
      throw new Error(`Email is not configured on the server. Missing: ${missing.join(", ")}`);
    }
    const { default: nodemailer } = await import("nodemailer");
    const transporter = nodemailer.createTransport({
      host: process.env["SMTP_HOST"],
      port: Number(process.env["SMTP_PORT"]),
      secure: Number(process.env["SMTP_PORT"]) === 465,
      auth: {
        user: process.env["SMTP_USER"],
        pass: process.env["SMTP_PASSWORD"],
      },
    });
    await transporter.sendMail({
      from: process.env["EMAIL_FROM"],
      to: data.to,
      subject: data.subject,
      text: data.message,
      attachments: files.map((file) => ({
        filename: file.filename,
        content: file.content,
        contentType: "application/pdf",
      })),
    });
    return { sent: true, attachmentCount: files.length };
  });
