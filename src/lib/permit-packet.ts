import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export interface PermitPacketData {
  jobTitle: string;
  propertyAddress: string;
  jurisdiction: string;
  permitType: string;
  permitNumber?: string | null;
  status: string;
  portalUrl?: string | null;
  submittedAt?: string | null;
  issuedAt?: string | null;
  expiresAt?: string | null;
  feeCents?: number | null;
  applicationNotes?: string | null;
  inspections: Array<{
    type: string;
    status: string;
    scheduledAt?: string | null;
    completedAt?: string | null;
    confirmationNumber?: string | null;
    notes?: string | null;
  }>;
}

function display(value?: string | null) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

/**
 * Permit expiration dates are PostgreSQL DATE values, not timestamps.
 * Parse their calendar components directly so the date cannot shift to the
 * previous day when a browser is in a timezone west of UTC.
 */
export function displayPermitDate(value?: string | null) {
  if (!value) return "Not recorded";
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;
  const [, year, month, day] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day), 12);
  if (
    date.getFullYear() !== Number(year) ||
    date.getMonth() !== Number(month) - 1 ||
    date.getDate() !== Number(day)
  )
    return value;
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
}

export async function createPermitPacketPdf(data: PermitPacketData): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const pageSize: [number, number] = [612, 792];
  const margin = 48;
  const lineHeight = 16;
  let page = pdf.addPage(pageSize);
  let y = page.getHeight() - margin;

  const addPage = () => {
    page = pdf.addPage(pageSize);
    y = page.getHeight() - margin;
  };
  const ensureSpace = (height = lineHeight) => {
    if (y - height < margin) addPage();
  };
  const write = (
    value: string,
    options: { strong?: boolean; size?: number; color?: ReturnType<typeof rgb> } = {},
  ) => {
    const size = options.size ?? 10;
    const font = options.strong ? bold : regular;
    const maxWidth = page.getWidth() - margin * 2;
    const tokens = value.split(/\s+/).flatMap((word) => {
      if (font.widthOfTextAtSize(word, size) <= maxWidth) return [word];
      const chunks: string[] = [];
      let chunk = "";
      for (const character of word) {
        const candidate = chunk + character;
        if (chunk && font.widthOfTextAtSize(candidate, size) > maxWidth) {
          chunks.push(chunk);
          chunk = character;
        } else {
          chunk = candidate;
        }
      }
      if (chunk) chunks.push(chunk);
      return chunks;
    });
    let line = "";
    for (const token of tokens) {
      const candidate = line ? line + " " + token : token;
      if (font.widthOfTextAtSize(candidate, size) > maxWidth && line) {
        ensureSpace(size + 5);
        page.drawText(line, {
          x: margin,
          y,
          size,
          font,
          color: options.color ?? rgb(0.12, 0.16, 0.22),
        });
        y -= lineHeight;
        line = token;
      } else line = candidate;
    }
    ensureSpace(size + 5);
    page.drawText(line, {
      x: margin,
      y,
      size,
      font,
      color: options.color ?? rgb(0.12, 0.16, 0.22),
    });
    y -= lineHeight;
  };
  const gap = (amount = 8) => {
    y -= amount;
  };

  write("ROOFER MASTERS | PERMIT RECORD SUMMARY", { strong: true, size: 16 });
  write(
    "CRM-generated summary — NOT an official municipal permit, approval, or inspection certificate.",
    {
      strong: true,
      size: 9,
      color: rgb(0.65, 0.16, 0.12),
    },
  );
  gap(10);
  write("PROPERTY & JOB", { strong: true, size: 12 });
  write(`Job: ${data.jobTitle || "Not recorded"}`);
  write(`Property address: ${data.propertyAddress || "Not recorded"}`);
  gap();
  write("PERMIT APPLICATION", { strong: true, size: 12 });
  write(`Jurisdiction: ${data.jurisdiction}`);
  write(`Permit type: ${data.permitType}`);
  write(`Permit number: ${data.permitNumber || "Not recorded"}`);
  write(`CRM status: ${data.status.replaceAll("_", " ")}`);
  write(`Submission recorded: ${display(data.submittedAt)}`);
  write(`Issue date recorded: ${display(data.issuedAt)}`);
  write(`Expiration date: ${displayPermitDate(data.expiresAt)}`);
  write(
    `Fee recorded: ${data.feeCents == null ? "Not recorded" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(data.feeCents / 100)}`,
  );
  write(`Portal URL entered: ${data.portalUrl || "Not recorded"}`);
  gap();
  write("INSPECTIONS", { strong: true, size: 12 });
  if (!data.inspections.length) write("No inspection records are attached to this application.");
  for (const item of data.inspections) {
    write(`${item.type} — ${item.status.replaceAll("_", " ")}`, { strong: true });
    write(`Scheduled: ${display(item.scheduledAt)} | Completed: ${display(item.completedAt)}`);
    write(`Confirmation number: ${item.confirmationNumber || "Not recorded"}`);
    if (item.notes) write(`Notes: ${item.notes}`);
    gap(4);
  }
  gap();
  write("APPLICATION NOTES", { strong: true, size: 12 });
  write(data.applicationNotes || "No application notes recorded.");
  gap(12);
  write(`Generated from the Roofer Masters CRM on ${new Date().toLocaleString()}.`, { size: 8 });
  write(
    "Verify all permit numbers, dates, fees, and inspection outcomes against the issuing authority's original records.",
    { size: 8 },
  );
  return pdf.save();
}
