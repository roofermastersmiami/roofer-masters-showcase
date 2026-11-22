
import { PDFDocument, StandardFonts, rgb, type PDFPage, type PDFFont } from 'pdf-lib';
import { measureDrawing, type RoofDrawing, toMaterialReport } from './roof-geometry';
import { materialOrder } from './material-order';

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 42;
const NAVY = rgb(0.055, 0.16, 0.27);
const BLUE = rgb(0.08, 0.32, 0.52);
const SILVER = rgb(0.88, 0.90, 0.92);
const LIGHT = rgb(0.96, 0.97, 0.98);
const INK = rgb(0.13, 0.17, 0.21);
const MUTED = rgb(0.40, 0.45, 0.50);
const WHITE = rgb(1, 1, 1);

type Photo = {
  bytes: Uint8Array;
  mime: string;
  category: string;
  name: string;
};

export async function roofDrawingPdf(
  title: string,
  d: RoofDrawing,
  customer: string,
  address: string,
  photos: Photo[] = [],
) {
  const m = measureDrawing(d);
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${title} - Roofer Masters`);
  pdf.setAuthor('Roofer Masters');
  pdf.setSubject('Roof measurement and material report');

  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  let page: PDFPage;
  let y = 0;
  let pageNumber = 0;

  const safe = (value: unknown) =>
    String(value ?? '')
      .replace(/[^\x20-\x7e]/g, ' ')
      .trim();

  const addPage = () => {
    page = pdf.addPage([PAGE_W, PAGE_H]);
    pageNumber++;
    y = PAGE_H - 55;
    return page;
  };

  const drawHeader = (p: PDFPage, heading = 'ROOF MEASUREMENT REPORT') => {
    p.drawRectangle({
      x: 0, y: PAGE_H - 78, width: PAGE_W, height: 78, color: NAVY,
    });
    p.drawText('ROOFER MASTERS', {
      x: MARGIN, y: PAGE_H - 34, size: 20, font: bold, color: WHITE,
    });
    p.drawText('YOUR ROOF, OUR MASTERPIECE', {
      x: MARGIN, y: PAGE_H - 53, size: 8, font, color: SILVER,
    });
    p.drawText(heading, {
      x: PAGE_W - MARGIN - bold.widthOfTextAtSize(heading, 9),
      y: PAGE_H - 35, size: 9, font: bold, color: WHITE,
    });
    p.drawText('(305) 942-3093  |  roofermasters@gmail.com', {
      x: MARGIN, y: PAGE_H - 68, size: 8, font, color: SILVER,
    });
  };

  const drawFooter = (p: PDFPage, number: number, total: number) => {
    p.drawLine({
      start: { x: MARGIN, y: 38 },
      end: { x: PAGE_W - MARGIN, y: 38 },
      thickness: 0.7,
      color: SILVER,
    });
    p.drawText('ROOFER MASTERS  |  Roofing measurement report', {
      x: MARGIN, y: 23, size: 7, font, color: MUTED,
    });
    const label = `Page ${number} of ${total}`;
    p.drawText(label, {
      x: PAGE_W - MARGIN - font.widthOfTextAtSize(label, 7),
      y: 23, size: 7, font, color: MUTED,
    });
  };

  const ensureSpace = (height: number) => {
    if (y - height < 55) {
      addPage();
      drawHeader(page);
    }
  };

  const section = (heading: string) => {
    ensureSpace(35);
    page.drawRectangle({
      x: MARGIN, y: y - 20, width: PAGE_W - MARGIN * 2,
      height: 23, color: LIGHT,
    });
    page.drawRectangle({
      x: MARGIN, y: y - 20, width: 4, height: 23, color: BLUE,
    });
    page.drawText(safe(heading), {
      x: MARGIN + 12, y: y - 13, size: 10, font: bold, color: NAVY,
    });
    y -= 34;
  };

  const paragraph = (
    value: string,
    size = 9,
    strong = false,
    color = INK,
    indent = 0,
  ) => {
    const selectedFont = strong ? bold : font;
    const maxWidth = PAGE_W - MARGIN * 2 - indent;
    const words = safe(value).split(/\s+/);
    let line = '';

    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (
        selectedFont.widthOfTextAtSize(candidate, size) > maxWidth &&
        line
      ) {
        ensureSpace(size + 7);
        page.drawText(line, {
          x: MARGIN + indent, y, size, font: selectedFont, color,
        });
        y -= size + 5;
        line = word;
      } else {
        line = candidate;
      }
    }

    if (line) {
      ensureSpace(size + 7);
      page.drawText(line, {
        x: MARGIN + indent, y, size, font: selectedFont, color,
      });
      y -= size + 5;
    }
  };

  const row = (label: string, value: string, alternate = false) => {
    ensureSpace(22);
    if (alternate) {
      page.drawRectangle({
        x: MARGIN, y: y - 5, width: PAGE_W - MARGIN * 2,
        height: 19, color: LIGHT,
      });
    }
    page.drawText(safe(label), {
      x: MARGIN + 8, y, size: 8.5, font, color: MUTED,
    });
    const val = safe(value);
    const maxWidth = PAGE_W - MARGIN * 2 - 190;
    const shortened = bold.widthOfTextAtSize(val, 8.5) > maxWidth
      ? val.slice(0, 55) + '...'
      : val;
    page.drawText(shortened, {
      x: MARGIN + 180, y, size: 8.5, font: bold, color: INK,
    });
    y -= 20;
  };

  const tableHeader = (columns: { label: string; x: number }[]) => {
    ensureSpace(27);
    page.drawRectangle({
      x: MARGIN, y: y - 6, width: PAGE_W - MARGIN * 2,
      height: 22, color: NAVY,
    });
    for (const col of columns) {
      page.drawText(col.label, {
        x: col.x, y, size: 8, font: bold, color: WHITE,
      });
    }
    y -= 27;
  };

  const tableRow = (
    values: string[],
    columns: { x: number; width?: number }[],
    index: number,
  ) => {
    ensureSpace(21);
    if (index % 2 === 0) {
      page.drawRectangle({
        x: MARGIN, y: y - 5, width: PAGE_W - MARGIN * 2,
        height: 19, color: LIGHT,
      });
    }
    values.forEach((value, i) => {
      const col = columns[i];
      if (!col) return;
      const max = col.width ?? 120;
      let output = safe(value);
      while (font.widthOfTextAtSize(output, 8) > max && output.length > 4) {
        output = output.slice(0, -4) + '...';
      }
      page.drawText(output, {
        x: col.x, y, size: 8, font, color: INK,
      });
    });
    y -= 20;
  };

  const firstPage = addPage();
  drawHeader(firstPage);

  // Project information
  section('PROJECT INFORMATION');
  paragraph(title, 15, true, NAVY);
  row('Customer', customer || 'Not provided');
  row('Property address', address || 'Not provided', true);
  row('Roofing system', d.roof_type);
  row('Review status', d.verified ? 'Owner-reviewed drawing' : 'Not owner-reviewed', true);

  const accuracyLabels = {
    photo_estimate: 'Estimated from photo / public aerial',
    scaled: 'Scaled from a known measured distance',
    site_verified: 'Verified on site',
  } as const;

  row(
    'Measurement basis',
    accuracyLabels[d.accuracy ?? 'photo_estimate'],
  );

  paragraph(
    'IMPORTANT: Owner review does not by itself certify measurements. Verify dimensions and site conditions before ordering materials or beginning installation.',
    8, true, BLUE,
  );

  if (d.image_credit) {
    paragraph(`Image credit: ${d.image_credit}`, 7, false, MUTED);
  }

  // Measurement summary
  section('ROOF MEASUREMENT SUMMARY');
  row('Total roof area', `${m.area.toFixed(2)} sq ft`);
  row('Roofing squares', `${m.squares.toFixed(2)} squares`, true);
  row('Waste allowance', `${d.waste}%`);
  row('Area including waste', `${m.withWaste.toFixed(2)} sq ft`, true);
  row('Total perimeter', `${m.perimeter.toFixed(2)} ft`);

  // Roof diagram
  section('ROOF PLAN DIAGRAM');

  const pts = d.planes.flatMap(p => p.points);
  if (pts.length) {
    const minX = Math.min(...pts.map(p => p.x));
    const maxX = Math.max(...pts.map(p => p.x));
    const minZ = Math.min(...pts.map(p => p.z));
    const maxZ = Math.max(...pts.map(p => p.z));

    const availableW = PAGE_W - MARGIN * 2 - 40;
    const availableH = Math.min(185, Math.max(90, y - 85));
    const scale = Math.min(
      availableW / Math.max(1, maxX - minX),
      availableH / Math.max(1, maxZ - minZ),
    );

    const drawingW = (maxX - minX) * scale;
    const drawingH = (maxZ - minZ) * scale;
    const originX = (PAGE_W - drawingW) / 2;
    const top = y - 8;

    ensureSpace(drawingH + 30);

    for (const plane of d.planes) {
      const planePoints = plane.points.map(p => ({
        x: originX + (p.x - minX) * scale,
        y: top - (p.z - minZ) * scale,
      }));

      for (let i = 0; i < planePoints.length; i++) {
        const a = planePoints[i];
        const b = planePoints[(i + 1) % planePoints.length];
        if (!a || !b) continue;

        page.drawLine({
          start: a,
          end: b,
          thickness: 1.8,
          color: BLUE,
        });
      }

      const centerX = planePoints.reduce((s, p) => s + p.x, 0) / planePoints.length;
      const centerY = planePoints.reduce((s, p) => s + p.y, 0) / planePoints.length;
      const label = safe(plane.name).slice(0, 24);

      if (label) {
        page.drawText(label, {
          x: centerX - font.widthOfTextAtSize(label, 7) / 2,
          y: centerY,
          size: 7,
          font: bold,
          color: NAVY,
        });
      }
    }

    y = top - drawingH - 20;
  }

  // Plane measurements
  section('ROOF PLANE MEASUREMENTS');
  const planeColumns = [
    { label: 'Roof plane', x: MARGIN + 8 },
    { label: 'Area (sq ft)', x: 330 },
    { label: 'Pitch', x: 455 },
  ];
  tableHeader(planeColumns);

  const planeCols = [
    { x: MARGIN + 8, width: 245 },
    { x: 330, width: 100 },
    { x: 455, width: 90 },
  ];

  m.planes.forEach((p, i) => {
    tableRow(
      [p.name, p.area.toFixed(2), `${p.pitch.toFixed(2)}:12`],
      planeCols,
      i,
    );
  });

  // Edge measurements
  section('EDGE MEASUREMENTS');
  const edgeColumns = [
    { label: 'Edge type', x: MARGIN + 8 },
    { label: 'Length (ft)', x: 330 },
  ];
  tableHeader(edgeColumns);

  const edgeCols = [
    { x: MARGIN + 8, width: 245 },
    { x: 330, width: 100 },
  ];

  Object.entries(m.edges).forEach(([name, length], i) => {
    tableRow([name.toUpperCase(), length.toFixed(2)], edgeCols, i);
  });

  // Penetrations and condition
  section('ROOF DETAILS');
  row('Number of penetrations', String(d.penetrations.length));

  if (d.penetrations.length) {
    const penetrationColumns = [
      { label: 'Type', x: MARGIN + 8 },
      { label: 'Size (ft)', x: 235 },
      { label: 'Location (x, z)', x: 365 },
    ];
    tableHeader(penetrationColumns);

    const penetrationCols = [
      { x: MARGIN + 8, width: 160 },
      { x: 235, width: 100 },
      { x: 365, width: 145 },
    ];

    d.penetrations.forEach((p, i) => {
      tableRow(
        [
          p.kind,
          `${p.width} x ${p.length}`,
          `${p.x}, ${p.z}`,
        ],
        penetrationCols,
        i,
      );
    });
  }

  if (d.condition) {
    paragraph('Roof condition', 9, true, NAVY);
    paragraph(d.condition);
  }

  if (d.notes) {
    section('INSPECTION NOTES');
    for (const line of d.notes.split('\n')) {
      paragraph(line || ' ');
    }
  }

  // Material takeoff
  section('MATERIAL TAKEOFF');
  paragraph(
    'Calculated planning quantities. Confirm product specifications, actual field dimensions, manufacturer requirements, and supplier packaging before ordering.',
    8, false, MUTED,
  );

  tableHeader([
    { label: 'Material / item', x: MARGIN + 8 },
    { label: 'Quantity', x: 430 },
    { label: 'Unit', x: 510 },
  ]);

  const materialCols = [
    { x: MARGIN + 8, width: 345 },
    { x: 430, width: 65 },
    { x: 510, width: 55 },
  ];

  const materials = materialOrder(toMaterialReport(d));
  materials.forEach((item, i) => {
    tableRow(
      [item.item, String(item.qty), item.unit],
      materialCols,
      i,
    );
  });

  paragraph(
    'Material quantities are estimates, not purchase orders or guarantees. Final quantities must be confirmed by the roofing contractor and material supplier.',
    8, true, BLUE,
  );

  // Photos
  for (const photo of photos) {
    addPage();
    drawHeader(page, 'PROJECT PHOTO');

    paragraph(photo.category.toUpperCase(), 13, true, NAVY);
    paragraph(photo.name, 9, false, MUTED);

    try {
      const image = photo.mime === 'image/png'
        ? await pdf.embedPng(photo.bytes)
        : await pdf.embedJpg(photo.bytes);

      const fit = image.scaleToFit(PAGE_W - MARGIN * 2, 570);
      page.drawImage(image, {
        x: (PAGE_W - fit.width) / 2,
        y: 95 + (570 - fit.height) / 2,
        width: fit.width,
        height: fit.height,
      });
    } catch {
      paragraph('This photo could not be embedded in the PDF.', 9, false, MUTED);
    }
  }

  // Add page numbers after all pages have been created.
  const pages = pdf.getPages();
  pages.forEach((p, index) => {
    drawFooter(p, index + 1, pages.length);
  });

  return pdf.save();
}
