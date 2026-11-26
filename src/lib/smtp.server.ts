import type { Socket } from "node:net";

/**
 * Minimal SMTP sender shared by the CRM's server-side email functions.
 * Configuration comes from server secrets (Lovable): SMTP_HOST,
 * SMTP_PORT (default 587), SMTP_USER, SMTP_PASSWORD, EMAIL_FROM.
 * For Roofer Masters this is Gmail: smtp.gmail.com, port 587, the
 * business Gmail address, and a Google app password.
 */

export type SmtpAttachment = {
  filename: string;
  content: Buffer;
  contentType?: string;
};

export function missingSmtpConfig(): string[] {
  const required = ["SMTP_HOST", "SMTP_USER", "SMTP_PASSWORD", "EMAIL_FROM"];
  return required.filter((key) => !process.env[key]);
}

async function openSocket(host: string, port: number, secure: boolean): Promise<Socket> {
  const [{ createConnection }, { connect: tlsConnect }] = await Promise.all([
    import("node:net"),
    import("node:tls"),
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
    close() {
      lines.close();
    },
  };
}

export async function sendSmtpMessage(input: {
  to: string;
  subject: string;
  message: string;
  attachments: SmtpAttachment[];
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
      Buffer.from(input.message, "utf8")
        .toString("base64")
        .match(/.{1,76}/g)
        ?.join("\r\n") ?? "",
      ...input.attachments.flatMap((file) => [
        `--${boundary}`,
        `Content-Type: ${file.contentType ?? "application/pdf"}; name="${file.filename}"`,
        "Content-Transfer-Encoding: base64",
        `Content-Disposition: attachment; filename="${file.filename}"`,
        "",
        file.content
          .toString("base64")
          .match(/.{1,76}/g)
          ?.join("\r\n") ?? "",
      ]),
      `--${boundary}--`,
      "",
    ]
      .join("\r\n")
      .replace(/\n/g, "\r\n")
      .replace(/\r\r\n/g, "\r\n");
    socket.write(body.replace(/(^|\r\n)\./g, "$1..") + "\r\n.\r\n");
    await reader.reply(250);
    await command("QUIT", 221);
  } finally {
    reader.close();
    socket.end();
  }
}
