import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { MaterialLine, RoofReport } from "./material-order";

export type MaterialTakeoffPdfInput = {
  title: string;
  source: string;
  report: RoofReport;
  lines: MaterialLine[];
  warnings?: string[];
};

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const LEFT = 48;
const RIGHT = PAGE_WIDTH - 48;
const NAVY = rgb(0.055, 0.16, 0.27);
const BLUE = rgb(0.08, 0.32, 0.52);
const MUTED = rgb(0.4, 0.45, 0.5);
const LIGHT = rgb(0.94, 0.96, 0.98);
const INK = rgb(0.13, 0.17, 0.21);

function safeText(value: string) {
  return value.replace(/[\u2013\u2014\u2022\u00a0]/g, "-").replace(/[^\x20-\x7e]/g, "");
}

export async function materialTakeoffPdf(input: MaterialTakeoffPdfInput): Promise<Uint8Array> {
  if (!input.lines.length) {
    throw new Error("A material takeoff cannot be generated until the required measurements and product specifications are complete.");
  }
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - 52;
  const pages: ReturnType<typeof pdf.addPage>[] = [page];

  const addPage = () => {
    page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    pages.push(page);
    y = PAGE_HEIGHT - 52;
    drawHeader();
  };
  const drawHeader = () => {
    page.drawRectangle({ x: 0, y: PAGE_HEIGHT - 76, width: PAGE_WIDTH, height: 76, color: NAVY });
    page.drawText("ROOFING MATERIAL TAKEOFF", {
      x: LEFT, y: PAGE_HEIGHT - 43, size: 16, font: bold, color: rgb(1, 1, 1),
    });
    page.drawText(safeText(input.title).slice(0, 90), {
      x: LEFT, y: PAGE_HEIGHT - 61, size: 8, font: regular, color: rgb(0.88, 0.92, 0.95),
    });
  };
  const ensureSpace = (height: number) => {
    if (y - height < 58) addPage();
  };
  const wrap = (value: string, maxWidth: number, size: number) => {
    const words = safeText(value).split(/\s+/);
    const rows: string[] = [];
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (line && regular.widthOfTextAtSize(candidate, size) > maxWidth) {
        rows.push(line);
        line = word;
      } else line = candidate;
    }
    if (line) rows.push(line);
    return rows;
  };

  drawHeader();
  y = PAGE_HEIGHT - 105;
  page.drawText("PROJECT DETAILS", { x: LEFT, y, size: 9, font: bold, color: BLUE });
  y -= 18;
  const details = [
    [ "Roof system", input.report.roof_type ],
    [ "Report source", input.source ],
    [ "Measured area", `${input.report.area_sqft.toLocaleString("en-US")} sq ft` ],
    [ "Waste allowance", `${input.report.waste_pct ?? 0}%` ],
  ];
  const colW = (RIGHT - LEFT) / 2;
  details.forEach(([label, value], index) => {
    const x = LEFT + (index % 2) * colW;
    const rowY = y - Math.floor(index / 2) * 34;
    page.drawText(safeText(label.toUpperCase()), { x, y: rowY, size: 7, font: bold, color: MUTED });
    page.drawText(safeText(value), { x, y: rowY - 13, size: 10, font: regular, color: INK });
  });
  y -= 76;
  if (input.warnings?.length) {
    const warningLines = input.warnings.flatMap((warning) => wrap(`REVIEW: ${warning}`, RIGHT - LEFT - 20, 8));
    const warningHeight = warningLines.length * 12 + 18;
    ensureSpace(warningHeight);
    page.drawRectangle({ x: LEFT, y: y - warningHeight + 5, width: RIGHT - LEFT, height: warningHeight, color: LIGHT });
    let wy = y - 10;
    warningLines.forEach((line) => {
      page.drawText(line, { x: LEFT + 10, y: wy, size: 8, font: regular, color: BLUE });
      wy -= 12;
    });
    y -= warningHeight + 12;
  }
  ensureSpace(54);
  page.drawText("MATERIALS & QUANTITIES", { x: LEFT, y, size: 10, font: bold, color: BLUE });
  y -= 20;
  const itemX = LEFT + 8;
  const qtyX = RIGHT - 105;
  const unitX = RIGHT - 42;
  const drawTableHeader = () => {
    page.drawRectangle({ x: LEFT, y: y - 7, width: RIGHT - LEFT, height: 24, color: NAVY });
    page.drawText("MATERIAL / ITEM", { x: itemX, y, size: 7, font: bold, color: rgb(1, 1, 1) });
    page.drawText("QUANTITY", { x: qtyX, y, size: 7, font: bold, color: rgb(1, 1, 1) });
    page.drawText("UNIT", { x: unitX, y, size: 7, font: bold, color: rgb(1, 1, 1) });
    y -= 24;
  };
  drawTableHeader();
  input.lines.forEach((line, index) => {
    const itemRows = wrap(line.item, qtyX - itemX - 16, 8);
    const rowHeight = Math.max(24, itemRows.length * 11 + 10);
    const pageCountBeforeRow = pages.length;
    ensureSpace(rowHeight + 4);
    if (pages.length > pageCountBeforeRow) {
      // Repeat the table heading after moving to a new page.
      y -= 53;
      drawTableHeader();
    }
    if (index % 2 === 0) {
      page.drawRectangle({ x: LEFT, y: y - rowHeight + 5, width: RIGHT - LEFT, height: rowHeight, color: LIGHT });
    }
    itemRows.forEach((row, rowIndex) => {
      page.drawText(row, { x: itemX, y: y - 9 - rowIndex * 11, size: 8, font: regular, color: INK });
    });
    page.drawText(String(line.qty), { x: qtyX, y: y - 9, size: 8, font: bold, color: INK });
    page.drawText(safeText(line.unit), { x: unitX, y: y - 9, size: 8, font: regular, color: INK });
    y -= rowHeight;
  });
  ensureSpace(68);
  y -= 12;
  const note = "Planning quantities only - not a purchase order. Verify field dimensions, product coverage, manufacturer instructions, packaging, fastening schedules, code requirements and supplier quantities before ordering. Missing or unverified inputs must be resolved by the roofing contractor.";
  const noteRows = wrap(note, RIGHT - LEFT, 8);
  noteRows.forEach((line) => {
    ensureSpace(12);
    page.drawText(line, { x: LEFT, y, size: 8, font: regular, color: MUTED });
    y -= 12;
  });
  pages.forEach((p, index) => {
    p.drawLine({ start: { x: LEFT, y: 38 }, end: { x: RIGHT, y: 38 }, thickness: 0.5, color: rgb(0.82, 0.85, 0.88) });
    p.drawText(`Generated ${new Date().toLocaleDateString("en-US")}  |  Page ${index + 1} of ${pages.length}`, {
      x: LEFT, y: 24, size: 7, font: regular, color: MUTED,
    });
  });
  return pdf.save();
}
