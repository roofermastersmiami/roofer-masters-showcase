import { createServerFn } from "@tanstack/react-start";
import { setResponseHeader } from "@tanstack/react-start/server";
import type { Socket } from "node:net";
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

async function openSocket(host: string, port: number, secure: boolean): Promise<Socket> {
  const [{ createConnection }, { connect: tlsConnect }] = await Promise.all([
    import("node:net"), import("node:tls"),
  ]);
  return new Promise((resolve, reject) => {
    const socket = secure
      ? tlsConnect({ host, port, servername: host }, () => resolve(socket))
      : createConnection({ host, port }, () => resolve(socket));
    socket.once("error", reject);
    socket.setTimeout(30_000, () => socket.destroy(new Error("SMTP connection timed out")));
  });
}

async function upgradeTls(socket: Socket, host: string): Promise<Socket> {
  const { connect: tlsConnect } = await import("node:tls");
  return new Promise((resolve, reject) => {
    const secure = tlsConnect({ socket, servername: host }, () => resolve(secure));
    secure.once("error", reject);
  });
}

async function smtpReader(socket: Socket) {
  const { createInterface } = await import("node:readline");
  const lines = createInterface({ input: socket });
  const iterator = lines[Symbol.asyncIterator]();
  return {
    async reply(expected: number) {
      const response: string[] = [];
      while (true) {
        const next = await iterator.next();
        if (next.done) throw new Error("SMTP server closed the connection unexpectedly");
        response.push(next.value);
        if (/^\d{3} /.test(next.value)) break;
      }
      const code = Number(response[response.length - 1]?.slice(0, 3));
      if (code !== expected) throw new Error(`SMTP error: ${response.join(" ")}`);
      return response.join("\n");
    },
    close() { lines.close(); },
  };
}

async function sendSmtpMessage(input: {
  to: string; subject: string; message: string;
  attachments: Array<{ filename: string; content: Buffer }>;
}) {
  const host = process.env["SMTP_HOST"]!;
  const port = Number(process.env["SMTP_PORT"] || 587);
  const user = process.env["SMTP_USER"]!;
  const password = process.env["SMTP_PASSWORD"]!;
  const from = process.env["EMAIL_FROM"]!;
  const { Buffer } = await import("node:buffer");
  let socket = await openSocket(host, port, port === 465);
  let reader = await smtpReader(socket);
  const command = async (value: string, expected: number) => {
    socket.write(value + "\r\n");
    return reader.reply(expected);
  };
  try {
    await reader.reply(220);
    await command("EHLO roofermasters.local", 250);
    if (port !== 465) {
      await command("STARTTLS", 220);
      reader.close();
      socket = await upgradeTls(socket, host);
      reader = await smtpReader(socket);
      await command("EHLO roofermasters.local", 250);
    }
    await command("AUTH LOGIN", 334);
    await command(Buffer.from(user).toString("base64"), 334);
    await command(Buffer.from(password).toString("base64"), 235);
    await command(`MAIL FROM:<${from}>`, 250);
    await command(`RCPT TO:<${input.to}>`, 250);
    await command("DATA", 354);

    const boundary = `rm-${Buffer.from(crypto.randomUUID()).toString("hex")}`;
    const encodedSubject = `=?UTF-8?B?${Buffer.from(input.subject).toString("base64")}?=`;
    const body = [
      `From: ${from}`,
      `To: ${input.to}`,
      `Subject: ${encodedSubject}`,
      "MIME-Version: 1.0",
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      "",
      `--${boundary}`,
      'Content-Type: text/plain; charset="UTF-8"',
      "Content-Transfer-Encoding: base64",
      "",
      Buffer.from(input.message, "utf8").toString("base64").match(/.{1,76}/g)?.join("\r\n") ?? "",
      ...input.attachments.flatMap((file) => [
        `--${boundary}`,
        `Content-Type: application/pdf; name="${file.filename}"`,
        "Content-Transfer-Encoding: base64",
        `Content-Disposition: attachment; filename="${file.filename}"`,
        "",
        file.content.toString("base64").match(/.{1,76}/g)?.join("\r\n") ?? "",
      ]),
      `--${boundary}--`,
      "",
    ].join("\r\n").replace(/\n/g, "\r\n").replace(/\r\r\n/g, "\r\n");
    socket.write(body.replace(/(^|\r\n)\./g, "$1..") + "\r\n.\r\n");
    await reader.reply(250);
    await command("QUIT", 221);
  } finally {
    reader.close();
    socket.end();
  }
}

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

    const required = ["SMTP_HOST", "SMTP_USER", "SMTP_PASSWORD", "EMAIL_FROM"];
    const missing = required.filter((key) => !process.env[key]);
    if (missing.length) throw new Error(`Email is not configured on the server. Missing: ${missing.join(", ")}`);
    const port = Number(process.env["SMTP_PORT"] || 587);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("SMTP_PORT is invalid");

    const files: Array<{ filename: string; content: Buffer }> = [];
    let totalBytes = 0;
    for (const attachment of data.attachments) {
      const expectedPrefix = `${data.leadId}/${data.reportId}/`;
      if (!attachment.path.startsWith(expectedPrefix) || attachment.path.includes(".."))
        throw new Error("An attachment is not linked to this customer and roof report");
      const { data: blob, error } = await supabaseAdmin.storage.from("signed-contracts").download(attachment.path);
      if (error || !blob) throw new Error(`Could not load ${attachment.filename}`);
      const bytes = Buffer.from(await blob.arrayBuffer());
      totalBytes += bytes.byteLength;
      if (totalBytes > 20 * 1024 * 1024) throw new Error("Email attachments must total 20 MB or less");
      if (bytes.subarray(0, 5).toString("ascii") !== "%PDF-") throw new Error(`${attachment.filename} is not a valid PDF`);
      files.push({ filename: attachment.filename, content: bytes });
    }
    await sendSmtpMessage({ to: data.to, subject: data.subject, message: data.message, attachments: files });
    return { sent: true, attachmentCount: files.length };
  });
