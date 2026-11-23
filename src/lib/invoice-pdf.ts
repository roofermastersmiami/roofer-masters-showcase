import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { itemSchema, money } from "./crm-schema";
import { z } from "zod";
import type { Json } from "@/integrations/supabase/types";
export async function generateInvoicePdf(
  invoice: {
    number: number;
    title: string;
    customer_name: string;
    items: Json;
    subtotal_cents: number;
    tax_cents: number;
    total_cents: number;
    paid_cents: number;
    deposit_cents: number;
    due_date: string;
    notes: string;
  },
  address = "",
) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let page = doc.addPage([612, 792]);
  let y = 740;
  const line = (raw: string, heading = false) => {
    const text = raw.replace(/[^\x20-\x7E\n\u00A0-\u00FF]/g, "-");
    for (const paragraph of text.split("\n")) {
      let row = "";
      for (const char of paragraph) {
        if (font.widthOfTextAtSize(row + char, 11) > 500) {
          draw(row);
          row = "";
        }
        row += char;
      }
      draw(row);
    }
    function draw(text: string) {
      if (y < 55) {
        page = doc.addPage([612, 792]);
        y = 740;
      }
      page.drawText(text, {
        x: 50,
        y,
        size: heading ? 13 : 11,
        font: heading ? bold : font,
        color: heading ? rgb(0, 0.247, 0.416) : rgb(0.1, 0.12, 0.15),
      });
      y -= 21;
    }
  };
  line("ROOFER MASTERS", true);
  line("YOUR ROOF, OUR MASTERPIECE");
  line("305-942-3093 | roofermasters@gmail.com");
  y -= 15;
  line(`INVOICE RM-${invoice.number}`, true);
  line(invoice.title);
  line(`Bill to: ${invoice.customer_name}`);
  if (address) line(address);
  line(`Due: ${invoice.due_date}`);
  y -= 15;
  for (const item of z.array(itemSchema).parse(invoice.items))
    line(
      `${item.description} | ${item.quantity} x ${money(item.unit_cents)} = ${money(Math.round(item.quantity * item.unit_cents))}`,
    );
  y -= 15;
  line(`Subtotal: ${money(invoice.subtotal_cents)}`);
  line(`Included tax: ${money(invoice.tax_cents)}`);
  line(`Invoice total: ${money(invoice.total_cents)}`, true);
  line(`Deposit requested: ${money(invoice.deposit_cents)}`);
  line(`Payments recorded: ${money(invoice.paid_cents)}`);
  line(`Balance due: ${money(invoice.total_cents - invoice.paid_cents)}`, true);
  if (invoice.notes) {
    y -= 15;
    line(invoice.notes);
  }
  return doc.save();
}
