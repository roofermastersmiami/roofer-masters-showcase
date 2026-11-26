import { createServerFn } from "@tanstack/react-start";
import { setResponseHeader } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { missingSmtpConfig, sendSmtpMessage } from "@/lib/smtp.server";

/**
 * General-purpose CRM email: send a message with file attachments (for
 * example a proposal or a PDF produced by the PDF Tools section) from
 * the business mailbox. Uses the same SMTP configuration as the roof
 * report email function. Delivery is confirmed by the mail server
 * accepting the message; the function returns only after that.
 */

const requestSchema = z.object({
  to: z.string().email().max(254),
  subject: z.string().trim().min(2).max(180),
  message: z.string().trim().min(1).max(12000),
  attachments: z
    .array(
      z.object({
        filename: z
          .string()
          .min(1)
          .max(180)
          .regex(/^[a-zA-Z0-9._ -]+$/),
        contentBase64: z.string().min(1).max(28_000_000),
        contentType: z.string().max(80).optional(),
      }),
    )
    .max(5)
    .default([]),
});

// tenant-audit: reviewed — new authenticated staff email sender.
// requireSupabaseAuth middleware plus an explicit has_any_role check
// (admin, office, sales, production_manager) run before any work. The
// function reads and writes no tenant data; it only sends caller-supplied
// content through the server-side SMTP transport. Input is zod-bounded:
// one recipient, subject/message length caps, at most 5 attachments and
// 20 MB total, with a %PDF- magic check on .pdf attachments. SMTP secrets
// come from server env only and are never returned to the caller.
export const sendCrmEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => requestSchema.parse(input))
  .handler(async ({ data, context }) => {
    setResponseHeader("Cache-Control", "private, no-store");
    const { data: allowed, error: roleError } = await context.supabase.rpc("has_any_role", {
      _user_id: context.userId,
      _roles: ["admin", "office", "sales", "production_manager"],
    });
    if (roleError || !allowed) throw new Error("You do not have permission to send email");

    const missing = missingSmtpConfig();
    if (missing.length)
      throw new Error(`Email is not configured on the server. Missing: ${missing.join(", ")}`);
    const port = Number(process.env["SMTP_PORT"] || 587);
    if (!Number.isInteger(port) || port < 1 || port > 65535)
      throw new Error("SMTP_PORT is invalid");

    const { Buffer } = await import("node:buffer");
    let totalBytes = 0;
    const attachments = data.attachments.map((attachment) => {
      const content = Buffer.from(attachment.contentBase64, "base64");
      totalBytes += content.byteLength;
      if (attachment.filename.toLowerCase().endsWith(".pdf")) {
        if (content.subarray(0, 5).toString("ascii") !== "%PDF-")
          throw new Error(`${attachment.filename} is not a valid PDF`);
      }
      return {
        filename: attachment.filename,
        content,
        contentType: attachment.contentType,
      };
    });
    if (totalBytes > 20 * 1024 * 1024)
      throw new Error("Email attachments must total 20 MB or less");

    await sendSmtpMessage({
      to: data.to,
      subject: data.subject,
      message: data.message,
      attachments,
    });
    return { sent: true, attachmentCount: attachments.length };
  });
