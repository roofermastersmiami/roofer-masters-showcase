import logoMark from "@/assets/logo-mark.webp";
import { PDFDocument, StandardFonts, rgb, type PDFPage } from "pdf-lib";
import {
  addressPinPosition,
  auditRoofReport,
  measureDrawing,
  roofPlaneTakeoff,
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
  const reportAudit = auditRoofReport(d);
  const layout = defaultRoofPdfLayout;
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${title} - Roofer Masters`);
  pdf.setAuthor("Roofer Masters");
  pdf.setSubject("Roof measurement and material report");

  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  // Shared plan-view mapping for every sketch diagram (cover, pitch,
  // measurements, area) so all pages draw the same house the same way.
  const planPoints = d.planes.flatMap((plane) => plane.points);
  const planMinX = planPoints.length ? Math.min(...planPoints.map((point) => point.x)) : 0;
  const planMaxX = planPoints.length ? Math.max(...planPoints.map((point) => point.x)) : 1;
  const planMinZ = planPoints.length ? Math.min(...planPoints.map((point) => point.z)) : 0;
  const planMaxZ = planPoints.length ? Math.max(...planPoints.map((point) => point.z)) : 1;
  const makeMapPoint =
    (box: { x: number; y: number; width: number; height: number }) =>
    (point: { x: number; z: number }) => {
      const scale = Math.min(
        box.width / Math.max(1, planMaxX - planMinX),
        box.height / Math.max(1, planMaxZ - planMinZ),
      );
      return {
        x: box.x + (point.x - planMinX) * scale + (box.width - (planMaxX - planMinX) * scale) / 2,
        y: box.y + (point.z - planMinZ) * scale + (box.height - (planMaxZ - planMinZ) * scale) / 2,
      };
    };
  const facetPath = (pts: { x: number; y: number }[]) => {
    const center = pts.reduce(
      (acc, point) => ({ x: acc.x + point.x / pts.length, y: acc.y + point.y / pts.length }),
      { x: 0, y: 0 },
    );
    // pdf-lib draws SVG paths with the y axis pointing down, so the y
    // offsets are negated to keep fills aligned with the PDF-space outlines.
    const path =
      pts
        .map(
          (point, index) =>
            `${index === 0 ? "M" : "L"} ${(point.x - center.x).toFixed(2)} ${(-(point.y - center.y)).toFixed(2)}`,
        )
        .join(" ") + " Z";
    return { path, center };
  };
  const formatPitch = (pitch: number) => {
    const rounded = Math.round(pitch * 10) / 10;
    return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)}/12`;
  };

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
    p.drawText(
      `${safe(address).slice(0, 66) || "Property address not provided"}  |  PRELIMINARY - FIELD VERIFY`,
      {
        x: MARGIN,
        y: 11,
        size: 6,
        font,
        color: MUTED,
      },
    );
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

  // First page, RoofSnap-style: the house sketch is the hero. Property and
  // prepared-by details sit in the header block, a pitch label rides on each
  // facet, and the company logo sits big at the bottom right.
  const firstPage = addPage();
  firstPage.drawText("SKETCH REPORT", {
    x: MARGIN,
    y: 748,
    size: 20,
    font: bold,
    color: NAVY,
  });
  firstPage.drawText("ROOF MEASUREMENT REPORT", {
    x: MARGIN,
    y: 731,
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
  const coverLabel = (label: string, x: number, yTop: number) =>
    firstPage.drawText(label, { x, y: yTop, size: 7, font: bold, color: MUTED });
  const coverValue = (value: string, x: number, yTop: number) =>
    firstPage.drawText(safe(value || "Not provided").slice(0, 58), {
      x,
      y: yTop,
      size: 9.5,
      font: bold,
      color: INK,
    });
  coverLabel("PROPERTY", MARGIN, 706);
  coverValue(customer, MARGIN, 692);
  coverValue(address, MARGIN, 678);
  coverLabel("PREPARED BY", 400, 706);
  coverValue("ROOFER MASTERS", 400, 692);
  coverLabel("PROJECT DATE", 400, 672);
  coverValue(
    new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }),
    400,
    658,
  );
  // The sketch: facet outlines with a pitch label on every facet.
  firstPage.drawRectangle({
    x: MARGIN,
    y: 138,
    width: PAGE_W - MARGIN * 2,
    height: 492,
    color: LIGHT,
    borderColor: SILVER,
    borderWidth: 0.8,
  });
  const sketchMap = makeMapPoint({
    x: MARGIN + 14,
    y: 152,
    width: PAGE_W - MARGIN * 2 - 28,
    height: 464,
  });
  d.planes.forEach((plane) => {
    const pts = plane.points.map((point) => sketchMap(point));
    const { path, center } = facetPath(pts);
    firstPage.drawSvgPath(path, {
      x: center.x,
      y: center.y,
      color: rgb(0.9, 0.94, 0.98),
      borderColor: NAVY,
      borderWidth: 1.1,
    });
    pts.forEach((point, index) => {
      const next = pts[(index + 1) % pts.length];
      if (next) firstPage.drawLine({ start: point, end: next, thickness: 1.4, color: NAVY });
    });
    const pitch = m.planes.find((item) => item.id === plane.id)?.pitch ?? 0;
    const label = formatPitch(pitch);
    firstPage.drawText(label, {
      x: center.x - bold.widthOfTextAtSize(label, 11) / 2,
      y: center.y - 4,
      size: 11,
      font: bold,
      color: NAVY,
    });
  });
  firstPage.drawText("PRELIMINARY REPORT - VERIFY FIELD CONDITIONS", {
    x: MARGIN,
    y: 108,
    size: 7,
    font: bold,
    color: MUTED,
  });
  firstPage.drawText(
    "Pitch labels show each plane's modeled rise over 12. Diagrams and measurements follow inside.",
    {
      x: MARGIN,
      y: 94,
      size: 7,
      font,
      color: MUTED,
    },
  );
  // Company logo, big, at the bottom right of the first page.
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
      const fit = logo.scaleToFit(200, 66);
      firstPage.drawImage(logo, {
        x: PAGE_W - MARGIN - fit.width,
        y: 52,
        width: fit.width,
        height: fit.height,
      });
      logoEmbedded = true;
    } catch (error) {
      console.warn("Roof report logo could not be embedded; using text fallback.", error);
    }
  }
  if (!logoEmbedded) {
    const brandText = "ROOFER MASTERS";
    firstPage.drawText(brandText, {
      x: PAGE_W - MARGIN - bold.widthOfTextAtSize(brandText, 17),
      y: 84,
      size: 17,
      font: bold,
      color: NAVY,
    });
    const taglineText = "YOUR ROOF, OUR MASTERPIECE";
    firstPage.drawText(taglineText, {
      x: PAGE_W - MARGIN - font.widthOfTextAtSize(taglineText, 8),
      y: 68,
      size: 8,
      font,
      color: MUTED,
    });
  }

  // Dedicated pitch diagram page: facets shaded by pitch, RoofSnap-style.
  addPage();
  drawHeader(page, "SKETCH REPORT | PITCH DIAGRAM");
  y = PAGE_H - 112;
  section("ROOF PITCH DIAGRAM");
  paragraph(
    "Each roof plane is shaded by its modeled pitch. Pitch is calculated from the modeled roof planes; a plane with assumed or preliminary geometry is not a field-verified pitch measurement.",
    8,
    false,
    MUTED,
  );
  const pitchPalette = [
    rgb(0.16, 0.45, 0.75),
    rgb(0.88, 0.48, 0.12),
    rgb(0.25, 0.62, 0.35),
    rgb(0.58, 0.32, 0.72),
    rgb(0.8, 0.22, 0.27),
    rgb(0.08, 0.58, 0.62),
  ];
  const pitchKey = (pitch: number) => pitch.toFixed(1);
  const distinctPitches = [...new Set(m.planes.map((plane) => pitchKey(plane.pitch)))].sort(
    (a, b) => Number(a) - Number(b),
  );
  const pitchColor = (pitch: number) =>
    pitchPalette[distinctPitches.indexOf(pitchKey(pitch)) % pitchPalette.length] ?? BLUE;
  const pitchBox = { x: MARGIN + 28, y: 300, width: PAGE_W - MARGIN * 2 - 56, height: 320 };
  const pitchMap = makeMapPoint(pitchBox);
  d.planes.forEach((plane) => {
    const measured = m.planes.find((item) => item.id === plane.id);
    const pts = plane.points.map((point) => pitchMap(point));
    const { path, center } = facetPath(pts);
    page.drawSvgPath(path, {
      x: center.x,
      y: center.y,
      color: pitchColor(measured?.pitch ?? 0),
      borderColor: NAVY,
      borderWidth: 1.1,
      opacity: 0.55,
    });
    pts.forEach((point, index) => {
      const next = pts[(index + 1) % pts.length];
      if (next) page.drawLine({ start: point, end: next, thickness: 1.4, color: NAVY });
    });
    const label = formatPitch(measured?.pitch ?? 0);
    page.drawText(label, {
      x: center.x - bold.widthOfTextAtSize(label, 11) / 2,
      y: center.y - 4,
      size: 11,
      font: bold,
      color: INK,
    });
  });
  let pitchLegendY = 268;
  distinctPitches.forEach((key) => {
    const planesAtPitch = m.planes.filter((plane) => pitchKey(plane.pitch) === key);
    const area = planesAtPitch.reduce((sum, plane) => sum + plane.area, 0);
    page.drawRectangle({
      x: MARGIN,
      y: pitchLegendY - 2,
      width: 14,
      height: 9,
      color: pitchColor(Number(key)),
      opacity: 0.55,
    });
    page.drawText(
      `${formatPitch(Number(key))}  -  ${area.toFixed(1)} sq ft  |  ${(area / 100).toFixed(2)} squares  |  ${planesAtPitch.length} plane${planesAtPitch.length === 1 ? "" : "s"}`,
      { x: MARGIN + 22, y: pitchLegendY, size: 8.5, font: bold, color: INK },
    );
    pitchLegendY -= 18;
  });

  // Dedicated measurements diagram page
  addPage();
  drawHeader(page, "SKETCH REPORT | MEASUREMENTS DIAGRAM");
  y = PAGE_H - 112;
  section("ROOF EDGE CLASSIFICATION DIAGRAM");
  const diagram = { x: MARGIN + 28, y: 235, width: PAGE_W - MARGIN * 2 - 56, height: 390 };
  const mapPoint = makeMapPoint(diagram);
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
  // Edge length labels, RoofSnap-style: every unique physical edge is
  // labeled once at its midpoint with its true 3D length in feet.
  const labeledSegments = new Map<string, { mid: { x: number; y: number }; length: number }>();
  d.planes.forEach((plane) =>
    plane.points.forEach((point, index) => {
      const next = plane.points[(index + 1) % plane.points.length];
      if (!next) return;
      const key = [point, next]
        .map((p) => `${p.x.toFixed(1)},${p.z.toFixed(1)}`)
        .sort()
        .join("|");
      if (labeledSegments.has(key)) return;
      const a = mapPoint(point);
      const b = mapPoint(next);
      labeledSegments.set(key, {
        mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        length: Math.hypot(next.x - point.x, next.y - point.y, next.z - point.z),
      });
    }),
  );
  labeledSegments.forEach(({ mid, length }) => {
    const label = length.toFixed(1);
    const width = bold.widthOfTextAtSize(label, 6.5) + 5;
    page.drawRectangle({
      x: mid.x - width / 2,
      y: mid.y - 3.5,
      width,
      height: 9.5,
      color: WHITE,
      opacity: 0.85,
    });
    page.drawText(label, {
      x: mid.x - bold.widthOfTextAtSize(label, 6.5) / 2,
      y: mid.y - 2.2,
      size: 6.5,
      font: bold,
      color: NAVY,
    });
  });
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
    public_lidar_estimate: "Preliminary estimate from public LiDAR elevation data",
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
  section("AUTOMATED REPORT QUALITY CHECK");
  paragraph(
    reportAudit.status === "ready"
      ? "READY FOR REPORT REVIEW - geometry and required review metadata passed the automated checks."
      : reportAudit.status === "review"
        ? "REVIEW REQUIRED - measurements can be reported, but the following items need attention."
        : "REPORT BLOCKED - geometry validation did not pass. Correct the listed issues before relying on quantities.",
    8,
    true,
    reportAudit.status === "ready" ? BLUE : NAVY,
  );
  reportAudit.blockers.forEach((item) => paragraph(`BLOCKER: ${item}`, 7.5, true, INK));
  reportAudit.warnings.forEach((item) => paragraph(`REVIEW: ${item}`, 7.5, false, MUTED));
  paragraph(
    `Automated check summary: ${reportAudit.planeCount} roof plane(s), ${reportAudit.unclassifiedEdges} unclassified edge(s). This check validates drawing consistency and metadata only; it does not independently verify roof dimensions or pitch from imagery.`,
    7,
    false,
    MUTED,
  );
  section("AREA MEASUREMENTS");
  row("Total roof area", `${m.area.toFixed(2)} sq ft`);
  row("Roofing squares", `${m.squares.toFixed(2)} squares`, true);
  row("Selected waste allowance", `${d.waste}%`);
  row("Area including selected waste", `${m.withWaste.toFixed(2)} sq ft`, true);
  row("Total perimeter", `${m.perimeter.toFixed(2)} ft`);
  const shingleWasteEligible = d.roof_type === "Shingle Roof" && m.area > 0;
  const suggestedExtraSqFt =
    m.area * 0.05 + m.edges.valley * 2.3 + m.edges.hip * 0.7 + m.edges.rake * 0.25;
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
  if (suggestedWastePct !== null)
    wasteRow[3] = `${suggestedWastePct.toFixed(1)}% / ${(m.area + suggestedExtraSqFt).toFixed(0)} SF`;
  page.drawRectangle({ x: MARGIN, y: y - 5, width: PAGE_W - MARGIN * 2, height: 20, color: LIGHT });
  wasteRow.forEach((value, index) => {
    let output = value;
    while (font.widthOfTextAtSize(output, 7) > wasteWidths[index]! && output.length > 5)
      output = output.slice(0, -4) + "...";
    page.drawText(output, {
      x: wasteXs[index],
      y,
      size: 7,
      font: index === 0 ? bold : font,
      color: INK,
    });
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
    const { path: localPath, center } = facetPath(pts);
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
    const areaLabel = `${area.toFixed(1)} SF`;
    page.drawText(areaLabel, {
      x: center.x - bold.widthOfTextAtSize(areaLabel, 9) / 2,
      y: center.y + 1,
      size: 9,
      font: bold,
      color: NAVY,
    });
    const squaresLabel = `${(area / 100).toFixed(2)} SQ`;
    page.drawText(squaresLabel, {
      x: center.x - font.widthOfTextAtSize(squaresLabel, 7) / 2,
      y: center.y - 9,
      size: 7,
      font,
      color: MUTED,
    });
  });
  // Plane-level takeoff keeps each slope traceable to its drawn geometry.
  section("ROOF PLANE TAKEOFF");
  paragraph(
    "Per-plane surface area, pitch, and classified edge lengths. Shared edges are shown on each adjoining plane for layout reference; roof-wide totals are deduplicated in the summary.",
    7.5,
    false,
    MUTED,
  );
  const planeTakeoff = roofPlaneTakeoff(d);
  tableHeader([
    { label: "Roof plane", x: MARGIN + 8 },
    { label: "Area SF", x: 245 },
    { label: "SQ", x: 300 },
    { label: "Pitch", x: 345 },
    { label: "Eave LF", x: 390 },
    { label: "Rake LF", x: 445 },
    { label: "Ridge/Hip/Valley LF", x: 500 },
  ]);
  const planeTakeoffCols = [
    { x: MARGIN + 8, width: 165 },
    { x: 245, width: 48 },
    { x: 300, width: 38 },
    { x: 345, width: 38 },
    { x: 390, width: 48 },
    { x: 445, width: 48 },
    { x: 500, width: 70 },
  ];
  planeTakeoff.forEach((plane, index) => {
    const combined = plane.edges_lf.ridge + plane.edges_lf.hip + plane.edges_lf.valley;
    tableRow(
      [
        plane.name,
        plane.area_sqft.toFixed(1),
        plane.squares.toFixed(2),
        `${plane.pitch_rise_per_12.toFixed(1)}:12`,
        plane.edges_lf.eave.toFixed(1),
        plane.edges_lf.rake.toFixed(1),
        combined.toFixed(1),
      ],
      planeTakeoffCols,
      index,
    );
  });
  paragraph(
    `Waste allowance: ${d.waste}% applied independently to each plane's surface area for planning. Pitch and edge lengths are derived from the saved drawing geometry and inherit its measurement verification status.`,
    7,
    false,
    MUTED,
  );

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

  let materials: ReturnType<typeof materialOrder> = [];
  try {
    materials = materialOrder(toMaterialReport(d));
  } catch (error) {
    if (d.roof_type !== "Metal Roof") throw error;
    paragraph(
      "Architectural metal takeoff omitted: add measured eave-to-ridge runs for every roof plane and the selected product coverage / fastening specifications in Material Order before generating an order-ready cut list.",
      8,
      true,
      BLUE,
    );
  }
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
