import logoMark from "@/assets/logo-mark.webp";
import { PDFDocument, StandardFonts, rgb, type PDFPage } from "pdf-lib";
import {
  addressPinPosition,
  measureDrawing,
  type RoofDrawing,
  toMaterialReport,
} from "./roof-geometry";
import { materialOrder } from "./material-order";

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 42;
const NAVY = rgb(0.055, 0.16, 0.27);
const BLUE = rgb(0.08, 0.32, 0.52);
const SILVER = rgb(0.88, 0.9, 0.92);
const LIGHT = rgb(0.96, 0.97, 0.98);
const INK = rgb(0.13, 0.17, 0.21);
const MUTED = rgb(0.4, 0.45, 0.5);
const WHITE = rgb(1, 1, 1);

export type RoofPdfLayout = {
  brand: { x: number; y: number };
  tagline: { x: number; y: number };
  contact: { x: number; y: number };
  heading: { x: number; y: number };
};

export const defaultRoofPdfLayout: RoofPdfLayout = {
  brand: { x: 7, y: 24 },
  tagline: { x: 7, y: 49 },
  contact: { x: 7, y: 78 },
  heading: { x: 62, y: 25 },
};

type Photo = {
  bytes: Uint8Array;
  mime: string;
  category: string;
  name: string;
  source?: string;
  matchedAddress?: string;
  latitude?: number;
  longitude?: number;
};

export async function roofDrawingPdf(
  title: string,
  d: RoofDrawing,
  customer: string,
  address: string,
  photos: Photo[] = [],
  clientContact: { phone?: string; email?: string } = {},
) {
  const m = measureDrawing(d);
  const layout = defaultRoofPdfLayout;
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${title} - Roofer Masters`);
  pdf.setAuthor("Roofer Masters");
  pdf.setSubject("Roof measurement and material report");

  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  let page: PDFPage;
  let y = 0;
  let pageNumber = 0;

  const safe = (value: unknown) =>
    String(value ?? "")
      .replace(/[^\x20-\x7e]/g, " ")
      .trim();

  const addPage = () => {
    page = pdf.addPage([PAGE_W, PAGE_H]);
    pageNumber++;
    y = PAGE_H - 55;
    return page;
  };

  const drawHeader = (p: PDFPage, heading = "ROOF MEASUREMENT REPORT") => {
    p.drawRectangle({
      x: 0,
      y: PAGE_H - 78,
      width: PAGE_W,
      height: 78,
      color: NAVY,
    });
    const headerPoint = (point: { x: number; y: number }, size: number) => ({
      x: Math.max(8, Math.min(PAGE_W - MARGIN, (point.x / 100) * PAGE_W)),
      y: PAGE_H - Math.max(8, Math.min(70, (point.y / 100) * 78)) - size,
    });
    p.drawText("ROOFER MASTERS", {
      ...headerPoint(layout.brand, 20),
      size: 20,
      font: bold,
      color: WHITE,
    });
    p.drawText("YOUR ROOF, OUR MASTERPIECE", {
      ...headerPoint(layout.tagline, 8),
      size: 8,
      font,
      color: SILVER,
    });
    p.drawText(heading, {
      ...headerPoint(layout.heading, 9),
      size: 9,
      font: bold,
      color: WHITE,
    });
    p.drawText("(305) 942-3093  |  roofermasters@gmail.com", {
      ...headerPoint(layout.contact, 8),
      size: 8,
      font,
      color: SILVER,
    });
  };

  const drawFooter = (p: PDFPage, number: number, total: number) => {
    p.drawLine({
      start: { x: MARGIN, y: 38 },
      end: { x: PAGE_W - MARGIN, y: 38 },
      thickness: 0.7,
      color: SILVER,
    });
    p.drawText("ROOFER MASTERS  |  Roofing measurement report", {
      x: MARGIN,
      y: 23,
      size: 7,
      font,
      color: MUTED,
    });
    p.drawText(`${safe(address).slice(0, 66) || "Property address not provided"}  |  PRELIMINARY - FIELD VERIFY`, {
      x: MARGIN,
      y: 11,
      size: 6,
      font,
      color: MUTED,
    });
    const label = `Page ${number} of ${total}`;
    p.drawText(label, {
      x: PAGE_W - MARGIN - font.widthOfTextAtSize(label, 7),
      y: 23,
      size: 7,
      font,
      color: MUTED,
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
      x: MARGIN,
      y: y - 20,
      width: PAGE_W - MARGIN * 2,
      height: 23,
      color: LIGHT,
    });
    page.drawRectangle({
      x: MARGIN,
      y: y - 20,
      width: 4,
      height: 23,
      color: BLUE,
    });
    page.drawText(safe(heading), {
      x: MARGIN + 12,
      y: y - 13,
      size: 10,
      font: bold,
      color: NAVY,
    });
    y -= 34;
  };

  const paragraph = (value: string, size = 9, strong = false, color = INK, indent = 0) => {
    const selectedFont = strong ? bold : font;
    const maxWidth = PAGE_W - MARGIN * 2 - indent;
    const words = safe(value).split(/\s+/);
    let line = "";

    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (selectedFont.widthOfTextAtSize(candidate, size) > maxWidth && line) {
        ensureSpace(size + 7);
        page.drawText(line, {
          x: MARGIN + indent,
          y,
          size,
          font: selectedFont,
          color,
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
        x: MARGIN + indent,
        y,
        size,
        font: selectedFont,
        color,
      });
      y -= size + 5;
    }
  };

  const row = (label: string, value: string, alternate = false) => {
    ensureSpace(22);
    if (alternate) {
      page.drawRectangle({
        x: MARGIN,
        y: y - 5,
        width: PAGE_W - MARGIN * 2,
        height: 19,
        color: LIGHT,
      });
    }
    page.drawText(safe(label), {
      x: MARGIN + 8,
      y,
      size: 8.5,
      font,
      color: MUTED,
    });
    const val = safe(value);
    const maxWidth = PAGE_W - MARGIN * 2 - 190;
    const shortened = bold.widthOfTextAtSize(val, 8.5) > maxWidth ? val.slice(0, 55) + "..." : val;
    page.drawText(shortened, {
      x: MARGIN + 180,
      y,
      size: 8.5,
      font: bold,
      color: INK,
    });
    y -= 20;
  };

  const tableHeader = (columns: { label: string; x: number }[]) => {
    ensureSpace(27);
    page.drawRectangle({
      x: MARGIN,
      y: y - 6,
      width: PAGE_W - MARGIN * 2,
      height: 22,
      color: NAVY,
    });
    for (const col of columns) {
      page.drawText(col.label, {
        x: col.x,
        y,
        size: 8,
        font: bold,
        color: WHITE,
      });
    }
    y -= 27;
  };

  const tableRow = (values: string[], columns: { x: number; width?: number }[], index: number) => {
    ensureSpace(21);
    if (index % 2 === 0) {
      page.drawRectangle({
        x: MARGIN,
        y: y - 5,
        width: PAGE_W - MARGIN * 2,
        height: 19,
        color: LIGHT,
      });
    }
    values.forEach((value, i) => {
      const col = columns[i];
      if (!col) return;
      const max = col.width ?? 120;
      let output = safe(value);
      while (font.widthOfTextAtSize(output, 8) > max && output.length > 4) {
        output = output.slice(0, -4) + "...";
      }
      page.drawText(output, {
        x: col.x,
        y,
        size: 8,
        font,
        color: INK,
      });
    });
    y -= 20;
  };

  // Branded first-page property cover
  const firstPage = addPage();
  const coverPhoto =
    photos.find((photo) => /aerial|exterior|property/i.test(photo.category)) ?? photos[0];
  firstPage.drawText("ROOF MEASUREMENT REPORT", {
    x: MARGIN,
    y: 752,
    size: 17,
    font: bold,
    color: NAVY,
  });
  firstPage.drawText("PROPERTY OVERVIEW  |  MEASUREMENTS", {
    x: MARGIN,
    y: 733,
    size: 8,
    font: bold,
    color: BLUE,
  });
  firstPage.drawLine({
    start: { x: MARGIN, y: 722 },
    end: { x: PAGE_W - MARGIN, y: 722 },
    thickness: 1,
    color: SILVER,
  });
  let photoBottom = 548;
  if (coverPhoto) {
    try {
      const image =
        coverPhoto.mime === "image/png"
          ? await pdf.embedPng(coverPhoto.bytes)
          : await pdf.embedJpg(coverPhoto.bytes);
      const fit = image.scaleToFit(PAGE_W - MARGIN * 2, 155);
      const x = (PAGE_W - fit.width) / 2;
      const yPhoto = 558 + (155 - fit.height) / 2;
      firstPage.drawRectangle({
        x: MARGIN,
        y: 553,
        width: PAGE_W - MARGIN * 2,
        height: 165,
        color: LIGHT,
        borderColor: SILVER,
        borderWidth: 0.8,
      });
      firstPage.drawImage(image, { x, y: yPhoto, width: fit.width, height: fit.height });
      photoBottom = 540;
    } catch {
      firstPage.drawText("PROPERTY PHOTO UNAVAILABLE", {
        x: MARGIN + 12,
        y: 630,
        size: 9,
        font: bold,
        color: MUTED,
      });
    }
  } else {
    firstPage.drawRectangle({
      x: MARGIN,
      y: 553,
      width: PAGE_W - MARGIN * 2,
      height: 165,
      color: LIGHT,
      borderColor: SILVER,
      borderWidth: 0.8,
    });
    firstPage.drawText("PROPERTY PHOTO NOT PROVIDED", {
      x: MARGIN + 12,
      y: 630,
      size: 9,
      font: bold,
      color: MUTED,
    });
  }
  let coverY = photoBottom - 12;
  const coverLine = (label: string, value: string) => {
    firstPage.drawText(safe(label).toUpperCase(), {
      x: MARGIN,
      y: coverY,
      size: 7,
      font: bold,
      color: MUTED,
    });
    firstPage.drawText(safe(value || "Not provided").slice(0, 76), {
      x: MARGIN + 112,
      y: coverY - 1,
      size: 9,
      font: bold,
      color: INK,
    });
    coverY -= 17;
  };
  coverLine("Property address", address);
  coverLine("Prepared for", customer);
  coverLine("Prepared by", "ROOFER MASTERS");
  coverLine(
    "Report date",
    new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }),
  );
  // Keep the cover focused on the property and client details.
  let logoEmbedded = false;
  if (typeof document !== "undefined" && typeof createImageBitmap === "function") {
    try {
      const response = await fetch(logoMark);
      const bitmap = await createImageBitmap(await response.blob());
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Logo canvas unavailable");
      context.drawImage(bitmap, 0, 0);
      bitmap.close();
      const logoBlob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (blob) => (blob ? resolve(blob) : reject(new Error("Logo conversion failed"))),
          "image/png",
        ),
      );
      const logo = await pdf.embedPng(new Uint8Array(await logoBlob.arrayBuffer()));
      const fit = logo.scaleToFit(150, 48);
      firstPage.drawImage(logo, {
        x: PAGE_W - MARGIN - fit.width,
        y: 24,
        width: fit.width,
        height: fit.height,
      });
      logoEmbedded = true;
    } catch (error) {
      console.warn("Roof report logo could not be embedded; using text fallback.", error);
    }
  }
  if (!logoEmbedded) {
    firstPage.drawText("ROOFER MASTERS", { x: 390, y: 42, size: 12, font: bold, color: NAVY });
    firstPage.drawText("YOUR ROOF, OUR MASTERPIECE", {
      x: 390,
      y: 29,
      size: 6.5,
      font,
      color: MUTED,
    });
  }
  firstPage.drawText("PRELIMINARY REPORT - VERIFY FIELD CONDITIONS", {
    x: MARGIN,
    y: 45,
    size: 7,
    font: bold,
    color: MUTED,
  });

  // Dedicated pitch diagram page
  addPage();
  drawHeader(page, "SKETCH REPORT | PITCH DIAGRAM");
  y = PAGE_H - 112;
  section("ROOF PITCH SUMMARY");
  paragraph(
    "Pitch is calculated from the modeled roof planes. A plane with assumed or preliminary geometry is not a field-verified pitch measurement.",
    8,
    false,
    MUTED,
  );
  const pitchRows = m.planes.map(
    (plane) =>
      `${plane.name}: ${plane.pitch.toFixed(1)}:12  |  ${plane.area.toFixed(1)} sq ft  |  ${(plane.area / 100).toFixed(2)} squares`,
  );
  pitchRows.forEach((line, index) =>
    row(line.split(":")[0], line.slice(line.indexOf(":") + 1), index % 2 === 0),
  );
  const pitchLabel = m.planes.length ? `${m.planes[0]!.pitch.toFixed(1)}:12` : "Not available";
  paragraph(`Modeled plane pitch reference: ${pitchLabel}`, 10, true, BLUE);

  // Dedicated measurements diagram page
  addPage();
  drawHeader(page, "SKETCH REPORT | MEASUREMENTS DIAGRAM");
  y = PAGE_H - 112;
  section("ROOF EDGE CLASSIFICATION DIAGRAM");
  const allPoints = d.planes.flatMap((plane) => plane.points);
  const minX = Math.min(...allPoints.map((point) => point.x));
  const maxX = Math.max(...allPoints.map((point) => point.x));
  const minZ = Math.min(...allPoints.map((point) => point.z));
  const maxZ = Math.max(...allPoints.map((point) => point.z));
  const diagram = { x: MARGIN + 28, y: 235, width: PAGE_W - MARGIN * 2 - 56, height: 390 };
  const scale = Math.min(
    diagram.width / Math.max(1, maxX - minX),
    diagram.height / Math.max(1, maxZ - minZ),
  );
  const mapPoint = (point: { x: number; z: number }) => ({
    x: diagram.x + (point.x - minX) * scale + (diagram.width - (maxX - minX) * scale) / 2,
    y: diagram.y + (point.z - minZ) * scale + (diagram.height - (maxZ - minZ) * scale) / 2,
  });
  const edgeColors = {
    eave: rgb(0.1, 0.55, 0.2),
    rake: rgb(0.1, 0.35, 0.85),
    ridge: rgb(0.85, 0.1, 0.1),
    hip: rgb(0.65, 0.25, 0.7),
    valley: rgb(0.95, 0.5, 0.05),
    other: MUTED,
  } as const;
  d.planes.forEach((plane) =>
    plane.points.forEach((point, index) => {
      const next = plane.points[(index + 1) % plane.points.length];
      if (!next) return;
      const a = mapPoint(point);
      const b = mapPoint(next);
      page.drawLine({
        start: a,
        end: b,
        thickness: 2.4,
        color: edgeColors[plane.edges[index] ?? "other"],
      });
    }),
  );
  let legendY = 205;
  (["eave", "rake", "ridge", "hip", "valley", "other"] as const).forEach((type) => {
    const x =
      MARGIN +
      ((["eave", "rake", "ridge", "hip", "valley", "other"] as const).indexOf(type) % 3) * 175;
    const yPos =
      legendY -
      Math.floor((["eave", "rake", "ridge", "hip", "valley", "other"] as const).indexOf(type) / 3) *
        18;
    page.drawLine({
      start: { x, y: yPos + 3 },
      end: { x: x + 22, y: yPos + 3 },
      thickness: 3,
      color: edgeColors[type],
    });
    page.drawText(type.toUpperCase(), { x: x + 28, y: yPos, size: 7, font: bold, color: INK });
  });
  paragraph(
    "Edge colors reflect the saved roof-plane classifications. Unclassified edges are shown in gray; geometry-based suggestions must be reviewed before applying.",
    7,
    false,
    MUTED,
  );

  // Detailed measurement pages
  addPage();
  drawHeader(page, "SKETCH REPORT | MEASUREMENTS");
  section("PROPERTY & MEASUREMENT SUMMARY");
  row("Property address", address || "Not provided");
  row("Prepared for", customer || "Not provided", true);
  row("Roofing system", d.roof_type);
  row(
    "Measurement status",
    d.verified ? "Owner-reviewed drawing" : "Preliminary / not owner-reviewed",
    true,
  );
  const accuracyLabels = {
    photo_estimate: "Estimated from photo / public aerial",
    scaled: "Scaled from a known measured distance",
    site_verified: "Verified on site",
  } as const;
  row("Measurement basis", accuracyLabels[d.accuracy ?? "photo_estimate"]);
  paragraph(
    "IMPORTANT: Owner review does not by itself certify measurements. Verify dimensions and site conditions before ordering materials or beginning installation.",
    8,
    true,
    BLUE,
  );
  if (d.image_credit) paragraph(`Image credit: ${d.image_credit}`, 7, false, MUTED);
  section("AREA MEASUREMENTS");
  row("Total roof area", `${m.area.toFixed(2)} sq ft`);
  row("Roofing squares", `${m.squares.toFixed(2)} squares`, true);
  row("Selected waste allowance", `${d.waste}%`);
  row("Area including selected waste", `${m.withWaste.toFixed(2)} sq ft`, true);
  row("Total perimeter", `${m.perimeter.toFixed(2)} ft`);
  const shingleWasteEligible = d.roof_type === "Shingle Roof" && m.area > 0;
  const suggestedExtraSqFt = m.area * 0.05 + m.edges.valley * 2.3 + m.edges.hip * 0.7 + m.edges.rake * 0.25;
  const suggestedWastePct = shingleWasteEligible ? (suggestedExtraSqFt / m.area) * 100 : null;
  section("WASTE COMPARISON");
  paragraph(
    "Coverage scenarios are calculated from modeled roof area. Suggested waste is shown only for shingle roofs and is a planning estimate; verify the roof layout, valley method, and supplier recommendations.",
    7.5,
    false,
    MUTED,
  );
  const wasteHeaders = ["ACTUAL", "+5%", "+10%", "SUGGESTED", "+15%", "+20%"];
  const wasteXs = [MARGIN + 5, 137, 222, 307, 402, 487];
  const wasteWidths = [72, 72, 72, 84, 72, 72];
  page.drawRectangle({ x: MARGIN, y: y - 6, width: PAGE_W - MARGIN * 2, height: 24, color: NAVY });
  wasteHeaders.forEach((label, index) =>
    page.drawText(label, { x: wasteXs[index], y, size: 7, font: bold, color: WHITE }),
  );
  y -= 28;
  const wasteValues = [
    m.area,
    m.area * 1.05,
    m.area * 1.1,
    suggestedWastePct === null ? null : m.area + suggestedExtraSqFt,
    m.area * 1.15,
    m.area * 1.2,
  ];
  const wasteRow = wasteValues.map((area) =>
    area === null ? "Manual review" : `${area.toFixed(0)} SF`,
  );
  if (suggestedWastePct !== null) wasteRow[3] = `${suggestedWastePct.toFixed(1)}% / ${(m.area + suggestedExtraSqFt).toFixed(0)} SF`;
  page.drawRectangle({ x: MARGIN, y: y - 5, width: PAGE_W - MARGIN * 2, height: 20, color: LIGHT });
  wasteRow.forEach((value, index) => {
    let output = value;
    while (font.widthOfTextAtSize(output, 7) > wasteWidths[index]! && output.length > 5)
      output = output.slice(0, -4) + "...";
    page.drawText(output, { x: wasteXs[index], y, size: 7, font: index === 0 ? bold : font, color: INK });
  });
  y -= 24;
  paragraph(
    "Shingle suggested-waste estimate = 5% handling allowance + 2.3 SF/LF valley + 0.7 SF/LF hip + 0.25 SF/LF rake. This method is not applied to metal, tile, TPO, or flat roofs.",
    7,
    false,
    MUTED,
  );
  if (d.geo_reference)
    row(
      "Geocoded address point",
      `${d.geo_reference.addressLatitude.toFixed(6)}, ${d.geo_reference.addressLongitude.toFixed(6)}`,
    );

  // Plane measurements
  section("SKETCH REPORT | PITCH MEASUREMENTS");
  const planeColumns = [
    { label: "Roof plane", x: MARGIN + 8 },
    { label: "Area (sq ft)", x: 290 },
    { label: "Pitch", x: 410 },
    { label: "Squares", x: 500 },
  ];
  tableHeader(planeColumns);

  const planeCols = [
    { x: MARGIN + 8, width: 205 },
    { x: 290, width: 95 },
    { x: 410, width: 75 },
    { x: 500, width: 65 },
  ];

  m.planes.forEach((p, i) => {
    tableRow(
      [p.name, p.area.toFixed(2), `${p.pitch.toFixed(2)}:12`, (p.area / 100).toFixed(2)],
      planeCols,
      i,
    );
  });

  // Edge measurements
  section("SKETCH REPORT | LINE MEASUREMENTS / CATEGORY MEASUREMENTS");
  const edgeColumns = [
    { label: "Edge type", x: MARGIN + 8 },
    { label: "Length (ft)", x: 330 },
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
  section("ROOF DETAILS");
  row("Number of penetrations", String(d.penetrations.length));

  if (d.penetrations.length) {
    const penetrationColumns = [
      { label: "Type", x: MARGIN + 8 },
      { label: "Size (ft)", x: 235 },
      { label: "Location (x, z)", x: 365 },
    ];
    tableHeader(penetrationColumns);

    const penetrationCols = [
      { x: MARGIN + 8, width: 160 },
      { x: 235, width: 100 },
      { x: 365, width: 145 },
    ];

    d.penetrations.forEach((p, i) => {
      tableRow([p.kind, `${p.width} x ${p.length}`, `${p.x}, ${p.z}`], penetrationCols, i);
    });
  }

  if (d.condition) {
    paragraph("Roof condition", 9, true, NAVY);
    paragraph(d.condition);
  }

  if (d.notes) {
    section("INSPECTION NOTES");
    for (const line of d.notes.split("\n")) {
      paragraph(line || " ");
    }
  }

  // Dedicated area diagram page
  addPage();
  drawHeader(page, "SKETCH REPORT | AREA DIAGRAM");
  y = PAGE_H - 112;
  section("ROOF PLANE AREA DIAGRAM");
  paragraph(
    "Each shaded outline represents a modeled roof plane. Plane areas are calculated from the current 3D drawing.",
    8,
    false,
    MUTED,
  );
  d.planes.forEach((plane, index) => {
    ensureSpace(30);
    const pts = plane.points.map((point) => mapPoint(point));
    const center = pts.reduce(
      (acc, point) => ({ x: acc.x + point.x / pts.length, y: acc.y + point.y / pts.length }),
      { x: 0, y: 0 },
    );
    const localPath =
      pts
        .map(
          (point, pointIndex) =>
            `${pointIndex === 0 ? "M" : "L"} ${(point.x - center.x).toFixed(2)} ${(point.y - center.y).toFixed(2)}`,
        )
        .join(" ") + " Z";
    page.drawSvgPath(localPath, {
      x: center.x,
      y: center.y,
      color: rgb(0.82, 0.9, 0.97),
      borderColor: BLUE,
      borderWidth: 1.2,
      opacity: 0.72,
    });
    pts.forEach((point, pointIndex) => {
      const next = pts[(pointIndex + 1) % pts.length];
      if (next) page.drawLine({ start: point, end: next, thickness: 1.8, color: BLUE });
    });
    const area = m.planes.find((item) => item.id === plane.id)?.area ?? 0;
    page.drawText(`${plane.name}  |  ${area.toFixed(1)} SF  |  ${(area / 100).toFixed(2)} SQ`, {
      x: center.x - 34,
      y: center.y,
      size: 7,
      font: bold,
      color: NAVY,
    });
  });
  // Material takeoff
  section("MATERIAL TAKEOFF");
  paragraph(
    "Calculated planning quantities. Confirm product specifications, actual field dimensions, manufacturer requirements, and supplier packaging before ordering.",
    8,
    false,
    MUTED,
  );

  tableHeader([
    { label: "Material / item", x: MARGIN + 8 },
    { label: "Quantity", x: 430 },
    { label: "Unit", x: 510 },
  ]);

  const materialCols = [
    { x: MARGIN + 8, width: 345 },
    { x: 430, width: 65 },
    { x: 510, width: 55 },
  ];

  const materials = materialOrder(toMaterialReport(d));
  materials.forEach((item, i) => {
    tableRow([item.item, String(item.qty), item.unit], materialCols, i);
  });

  paragraph(
    "Material quantities are estimates, not purchase orders or guarantees. Final quantities must be confirmed by the roofing contractor and material supplier.",
    8,
    true,
    BLUE,
  );

  // Photos
  for (const photo of photos) {
    addPage();
    drawHeader(page, "PROJECT PHOTO");

    paragraph(photo.category.toUpperCase(), 13, true, NAVY);
    paragraph(photo.name, 9, false, MUTED);
    if (photo.source) paragraph(`Source: ${photo.source}`, 8, false, MUTED);
    if (photo.matchedAddress) paragraph(`Address match: ${photo.matchedAddress}`, 8, false, MUTED);
    if (typeof photo.latitude === "number" && typeof photo.longitude === "number") {
      paragraph(
        `Map coordinates: ${photo.latitude.toFixed(6)}, ${photo.longitude.toFixed(6)}`,
        8,
        false,
        MUTED,
      );
    }

    try {
      const image =
        photo.mime === "image/png"
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
      paragraph("This photo could not be embedded in the PDF.", 9, false, MUTED);
    }
  }

  // Add page numbers after all pages have been created.
  const pages = pdf.getPages();
  pages.forEach((p, index) => {
    drawFooter(p, index + 1, pages.length);
  });

  return pdf.save();
}
