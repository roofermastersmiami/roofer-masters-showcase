import logoMark from "@/assets/logo-mark.webp";
import { PDFDocument, StandardFonts, degrees, rgb, type PDFPage } from "pdf-lib";
import {
  auditRoofReport,
  measureDrawing,
  roofPlaneTakeoff,
  type EdgeType,
  type RoofDrawing,
  toMaterialReport,
} from "./roof-geometry";
import { materialOrder } from "./material-order";

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 42;
const BLACK = rgb(0.05, 0.05, 0.06);
const NAVY = rgb(0.055, 0.16, 0.27);
const BLUE = rgb(0.08, 0.32, 0.52);
const FOOTER_BLUE = rgb(0.04, 0.27, 0.52);
const FOOTER_DARK = rgb(0.02, 0.18, 0.38);
const SILVER = rgb(0.88, 0.9, 0.92);
const LIGHT = rgb(0.96, 0.97, 0.98);
const FACET_FILL = rgb(0.87, 0.93, 0.98);
const INK = rgb(0.13, 0.17, 0.21);
const MUTED = rgb(0.4, 0.45, 0.5);
const WHITE = rgb(1, 1, 1);

/** RoofSnap-style edge colors, keyed by the drawing's edge types. */
const EDGE_COLORS: Record<EdgeType, ReturnType<typeof rgb>> = {
  eave: rgb(0.85, 0.15, 0.15),
  rake: rgb(0.45, 0.45, 0.45),
  ridge: rgb(0.5, 0.2, 0.55),
  hip: rgb(0.45, 0.35, 0.15),
  valley: rgb(0.9, 0.35, 0.65),
  other: rgb(0.85, 0.7, 0.1),
};
const LEGEND_EXTRA: Array<{ label: string; color: ReturnType<typeof rgb> }> = [
  { label: "Step", color: rgb(0.1, 0.3, 0.85) },
  { label: "Wall", color: rgb(0.2, 0.75, 0.85) },
  { label: "Pitch Change", color: rgb(0.8, 0.6, 0.35) },
];

export type RoofReportThemeId = "roofsnap" | "navy" | "charcoal" | "emerald";

export type RoofReportTheme = {
  label: string;
  header: ReturnType<typeof rgb>;
  footer: ReturnType<typeof rgb>;
  footerDark: ReturnType<typeof rgb>;
  accent: ReturnType<typeof rgb>;
  facetFill: ReturnType<typeof rgb>;
};

/** Selectable sketch-report themes; "roofsnap" is the default. */
export const ROOF_REPORT_THEMES: Record<RoofReportThemeId, RoofReportTheme> = {
  roofsnap: {
    label: "RoofSnap Classic (black & blue)",
    header: rgb(0.05, 0.05, 0.06),
    footer: rgb(0.04, 0.27, 0.52),
    footerDark: rgb(0.02, 0.18, 0.38),
    accent: rgb(0.08, 0.32, 0.52),
    facetFill: rgb(0.87, 0.93, 0.98),
  },
  navy: {
    label: "Roofer Masters Navy",
    header: rgb(0.055, 0.16, 0.27),
    footer: rgb(0.05, 0.22, 0.38),
    footerDark: rgb(0.03, 0.13, 0.24),
    accent: rgb(0.1, 0.38, 0.62),
    facetFill: rgb(0.88, 0.92, 0.97),
  },
  charcoal: {
    label: "Charcoal & Orange",
    header: rgb(0.13, 0.13, 0.14),
    footer: rgb(0.17, 0.17, 0.18),
    footerDark: rgb(0.08, 0.08, 0.09),
    accent: rgb(0.9, 0.45, 0.1),
    facetFill: rgb(0.93, 0.93, 0.92),
  },
  emerald: {
    label: "Emerald",
    header: rgb(0.04, 0.3, 0.22),
    footer: rgb(0.05, 0.36, 0.26),
    footerDark: rgb(0.03, 0.23, 0.16),
    accent: rgb(0.05, 0.45, 0.3),
    facetFill: rgb(0.89, 0.95, 0.91),
  },
};

export type RoofReportOptions = {
  theme?: RoofReportThemeId;
  /** Page-1 logo size multiplier (0.5–1.6). Default 1. */
  logoScale?: number;
};

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

const feetInches = (feet: number) => {
  const totalInches = Math.round(feet * 12);
  return `${Math.floor(totalInches / 12)}'${totalInches % 12}"`;
};
const formatPitch = (pitch: number) => {
  const rounded = Math.round(pitch * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)}/12`;
};
const pitchRise = (pitch: number) => {
  const rounded = Math.round(pitch * 10) / 10;
  return Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1);
};

export async function roofDrawingPdf(
  title: string,
  d: RoofDrawing,
  customer: string,
  address: string,
  photos: Photo[] = [],
  clientContact: { phone?: string; email?: string } = {},
  options: RoofReportOptions = {},
) {
  const theme = ROOF_REPORT_THEMES[options.theme ?? "roofsnap"];
  const logoScale = Math.min(1.6, Math.max(0.5, options.logoScale ?? 1));
  const BLUE = theme.accent;
  const NAVY = theme.header;
  const FACET_FILL = theme.facetFill;
  const m = measureDrawing(d);
  const reportAudit = auditRoofReport(d);
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${title} - Roofer Masters`);
  pdf.setAuthor("Roofer Masters");
  pdf.setSubject("Roof measurement and material report");

  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const safe = (value: unknown) =>
    String(value ?? "")
      .replace(/[^\x20-\x7e]/g, " ")
      .trim();

  // Shared plan-view mapping for every diagram so all pages draw the same
  // house the same way.
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
    // pdf-lib draws SVG paths with the y axis pointing down; negate the y
    // offsets so fills align with the PDF-space outlines.
    const path =
      pts
        .map(
          (point, index) =>
            `${index === 0 ? "M" : "L"} ${(point.x - center.x).toFixed(2)} ${(-(point.y - center.y)).toFixed(2)}`,
        )
        .join(" ") + " Z";
    return { path, center };
  };
  const drawFacetOutlines = (
    p: PDFPage,
    mapPoint: (point: { x: number; z: number }) => { x: number; y: number },
    options: { fill: boolean; edgeWidth: number },
  ) => {
    d.planes.forEach((plane) => {
      const pts = plane.points.map((point) => mapPoint(point));
      if (options.fill) {
        const { path, center } = facetPath(pts);
        p.drawSvgPath(path, {
          x: center.x,
          y: center.y,
          color: FACET_FILL,
          borderColor: FACET_FILL,
          borderWidth: 0.5,
        });
      }
      pts.forEach((point, index) => {
        const next = pts[(index + 1) % pts.length];
        if (!next) return;
        p.drawLine({
          start: point,
          end: next,
          thickness: options.edgeWidth,
          color: EDGE_COLORS[plane.edges[index] ?? "other"],
        });
      });
    });
  };
  const facetCenter = (
    plane: RoofDrawing["planes"][number],
    mapPoint: (point: { x: number; z: number }) => { x: number; y: number },
  ) => {
    const pts = plane.points.map((point) => mapPoint(point));
    return pts.reduce(
      (acc, point) => ({ x: acc.x + point.x / pts.length, y: acc.y + point.y / pts.length }),
      { x: 0, y: 0 },
    );
  };

  const today = new Date();
  const projectShort = today.toLocaleDateString("en-US", {
    month: "numeric",
    day: "numeric",
    year: "2-digit",
  });
  const projectLong = today.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  let page: PDFPage;
  let pageNumber = 0;
  const addPage = () => {
    page = pdf.addPage([PAGE_W, PAGE_H]);
    pageNumber++;
    return page;
  };

  // RoofSnap chrome: black header bar on diagram/measurement pages.
  const drawBlackHeader = (p: PDFPage, heading: string) => {
    p.drawRectangle({ x: 0, y: PAGE_H - 52, width: PAGE_W, height: 52, color: theme.header });
    p.drawText(heading, { x: 30, y: PAGE_H - 34, size: 15, font: bold, color: WHITE });
  };
  // RoofSnap chrome: blue footer band with project/property/prepared-by.
  const drawBlueFooter = (p: PDFPage, heading: string, number: number) => {
    p.drawRectangle({ x: 0, y: 26, width: PAGE_W, height: 104, color: theme.footer });
    p.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: 26, color: theme.footerDark });
    p.drawText("Project from", { x: 30, y: 108, size: 11, font: bold, color: WHITE });
    p.drawText(projectShort, { x: 30, y: 92, size: 11, font: bold, color: WHITE });
    p.drawText(projectLong, { x: 30, y: 78, size: 7.5, font, color: SILVER });
    const block = (label: string, lines: string[], x: number) => {
      p.drawText(label, { x, y: 108, size: 8, font: bold, color: WHITE });
      lines.forEach((line, index) =>
        p.drawText(safe(line).slice(0, 44), {
          x,
          y: 94 - index * 11,
          size: 7.5,
          font,
          color: SILVER,
        }),
      );
    };
    block(
      "Property address",
      [
        customer || "Not provided",
        address || "Not provided",
        clientContact.phone ?? "",
        clientContact.email ?? "",
      ].filter(Boolean),
      218,
    );
    block("Prepared by", ["Roofer Masters", "(305) 942-3093", "roofermasters@gmail.com"], 428);
    p.drawText("ROOFER MASTERS", { x: 30, y: 10, size: 7, font: bold, color: SILVER });
    const centerLabel = heading;
    p.drawText(centerLabel, {
      x: (PAGE_W - font.widthOfTextAtSize(centerLabel, 7.5)) / 2,
      y: 10,
      size: 7.5,
      font,
      color: SILVER,
    });
    p.drawRectangle({ x: PAGE_W - 46, y: 0, width: 46, height: 26, color: BLACK });
    const numLabel = String(number);
    p.drawText(numLabel, {
      x: PAGE_W - 23 - bold.widthOfTextAtSize(numLabel, 10) / 2,
      y: 9,
      size: 10,
      font: bold,
      color: WHITE,
    });
  };

  const embedLogo = async (p: PDFPage, maxW: number, maxH: number, yBottom: number) => {
    if (typeof document === "undefined" || typeof createImageBitmap !== "function") return false;
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
      const fit = logo.scaleToFit(maxW, maxH);
      p.drawImage(logo, {
        x: PAGE_W - MARGIN - fit.width,
        y: yBottom,
        width: fit.width,
        height: fit.height,
      });
      return true;
    } catch (error) {
      console.warn("Roof report logo could not be embedded; using text fallback.", error);
      return false;
    }
  };

  // ---------- Page 1: cover with aerial photo (or the sketch) ----------
  const firstPage = addPage();
  const coverPhoto =
    photos.find((photo) => /aerial|exterior|property/i.test(photo.category)) ?? photos[0];
  const visualBox = { x: 0, y: 348, width: PAGE_W, height: 444 };
  let drewPhoto = false;
  if (coverPhoto) {
    try {
      const image =
        coverPhoto.mime === "image/png"
          ? await pdf.embedPng(coverPhoto.bytes)
          : await pdf.embedJpg(coverPhoto.bytes);
      const scale = Math.max(visualBox.width / image.width, visualBox.height / image.height);
      const width = image.width * scale;
      const height = image.height * scale;
      firstPage.drawImage(image, {
        x: visualBox.x + (visualBox.width - width) / 2,
        y: visualBox.y + (visualBox.height - height) / 2,
        width,
        height,
      });
      drewPhoto = true;
    } catch {
      drewPhoto = false;
    }
  }
  if (!drewPhoto) {
    // No photo: the house sketch fills the visual area, RoofSnap-diagram style.
    const sketchMap = makeMapPoint({
      x: 26,
      y: visualBox.y + 14,
      width: PAGE_W - 52,
      height: visualBox.height - 28,
    });
    drawFacetOutlines(firstPage, sketchMap, { fill: true, edgeWidth: 1.4 });
    d.planes.forEach((plane) => {
      const measured = m.planes.find((item) => item.id === plane.id);
      const center = facetCenter(plane, sketchMap);
      const label = pitchRise(measured?.pitch ?? 0);
      firstPage.drawText(label, {
        x: center.x - bold.widthOfTextAtSize(label, 9) / 2,
        y: center.y - 3,
        size: 9,
        font: bold,
        color: INK,
      });
    });
  }
  if (drewPhoto && coverPhoto?.source) {
    // Imagery attribution (required by the aerial source's terms),
    // small and unobtrusive at the photo's bottom-left corner.
    const attribution = `Aerial imagery: ${coverPhoto.source}`;
    const attributionWidth = font.widthOfTextAtSize(attribution, 6.5);
    firstPage.drawRectangle({
      x: 0,
      y: visualBox.y,
      width: attributionWidth + 12,
      height: 14,
      color: rgb(0, 0, 0),
      opacity: 0.55,
    });
    firstPage.drawText(attribution, {
      x: 6,
      y: visualBox.y + 4.5,
      size: 6.5,
      font,
      color: rgb(1, 1, 1),
    });
  }
  firstPage.drawText("SKETCH REPORT", { x: 30, y: 296, size: 27, font: bold, color: BLACK });
  firstPage.drawText(`Project from ${projectShort}`, {
    x: 30,
    y: 268,
    size: 13,
    font: bold,
    color: BLUE,
  });
  const infoBlock = (label: string, lines: string[], x: number, width: number) => {
    firstPage.drawText(label, { x, y: 232, size: 8, font: bold, color: BLUE });
    let lineY = 216;
    for (const rawLine of lines) {
      // Word-wrap each line to the column width so long addresses never
      // run under the neighboring column.
      let current = "";
      const wrapped: string[] = [];
      for (const word of safe(rawLine).split(/\s+/)) {
        const candidate = current ? `${current} ${word}` : word;
        if (font.widthOfTextAtSize(candidate, 8.5) > width && current) {
          wrapped.push(current);
          current = word;
        } else current = candidate;
      }
      if (current) wrapped.push(current);
      for (const segment of wrapped) {
        if (lineY < 130) break;
        firstPage.drawText(segment, { x, y: lineY, size: 8.5, font, color: MUTED });
        lineY -= 12;
      }
    }
  };
  infoBlock(
    "Property address",
    [
      customer || "Not provided",
      address || "Not provided",
      clientContact.phone ?? "",
      clientContact.email ?? "",
    ].filter(Boolean),
    30,
    176,
  );
  infoBlock(
    "Prepared by",
    ["Roofer Masters", "(305) 942-3093", "roofermasters@gmail.com"],
    218,
    150,
  );
  const logoDrawn = await embedLogo(firstPage, 185 * logoScale, 118 * logoScale, 120);
  if (!logoDrawn) {
    const brandText = "ROOFER MASTERS";
    firstPage.drawText(brandText, {
      x: PAGE_W - MARGIN - bold.widthOfTextAtSize(brandText, 18 * logoScale),
      y: 196,
      size: 18 * logoScale,
      font: bold,
      color: NAVY,
    });
    const taglineText = "YOUR ROOF, OUR MASTERPIECE";
    firstPage.drawText(taglineText, {
      x: PAGE_W - MARGIN - font.widthOfTextAtSize(taglineText, 8),
      y: 180,
      size: 8,
      font,
      color: MUTED,
    });
  }
  firstPage.drawText("ROOFER MASTERS  |  PRELIMINARY - FIELD VERIFY", {
    x: 30,
    y: 12,
    size: 6.5,
    font,
    color: MUTED,
  });
  firstPage.drawRectangle({ x: PAGE_W - 46, y: 0, width: 46, height: 26, color: BLACK });
  firstPage.drawText("1", {
    x: PAGE_W - 23 - bold.widthOfTextAtSize("1", 10) / 2,
    y: 9,
    size: 10,
    font: bold,
    color: WHITE,
  });

  // ---------- Page 2: pitch diagram ----------
  const pitchPage = addPage();
  drawBlackHeader(pitchPage, "SKETCH REPORT  |  PITCH DIAGRAM");
  const pitchMap = makeMapPoint({ x: 36, y: 158, width: PAGE_W - 72, height: 540 });
  drawFacetOutlines(pitchPage, pitchMap, { fill: true, edgeWidth: 1.3 });
  d.planes.forEach((plane) => {
    const measured = m.planes.find((item) => item.id === plane.id);
    const center = facetCenter(plane, pitchMap);
    const label = pitchRise(measured?.pitch ?? 0);
    pitchPage.drawText(label, {
      x: center.x - bold.widthOfTextAtSize(label, 9) / 2,
      y: center.y - 3,
      size: 9,
      font: bold,
      color: INK,
    });
  });
  drawBlueFooter(pitchPage, "SKETCH REPORT  |  PITCH DIAGRAM", pageNumber);

  // ---------- Page 3: measurements diagram ----------
  const measurePage = addPage();
  drawBlackHeader(measurePage, "SKETCH REPORT  |  MEASUREMENTS DIAGRAM");
  const diagramMap = makeMapPoint({ x: 46, y: 196, width: PAGE_W - 92, height: 500 });
  drawFacetOutlines(measurePage, diagramMap, { fill: false, edgeWidth: 1.6 });
  // Edge labels in feet/inches, rotated along each edge, RoofSnap-style.
  const labeled = new Map<
    string,
    { a: { x: number; y: number }; b: { x: number; y: number }; length: number }
  >();
  d.planes.forEach((plane) =>
    plane.points.forEach((point, index) => {
      const next = plane.points[(index + 1) % plane.points.length];
      if (!next) return;
      const key = [point, next]
        .map((p) => `${p.x.toFixed(1)},${p.z.toFixed(1)}`)
        .sort()
        .join("|");
      if (labeled.has(key)) return;
      labeled.set(key, {
        a: diagramMap(point),
        b: diagramMap(next),
        length: Math.hypot(next.x - point.x, next.y - point.y, next.z - point.z),
      });
    }),
  );
  labeled.forEach(({ a, b, length }) => {
    // Junction slivers (segments under 2 ft where facets meet) get
    // no label: a dozen near-zero lengths pile up illegibly at every
    // junction. Their lengths still count in the report totals.
    if (length < 2) return;
    const label = feetInches(length);
    let angle = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
    if (angle > 90) angle -= 180;
    if (angle < -90) angle += 180;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const width = font.widthOfTextAtSize(label, 7);
    measurePage.drawText(label, {
      x: mid.x - (Math.cos((angle * Math.PI) / 180) * width) / 2,
      y: mid.y - (Math.sin((angle * Math.PI) / 180) * width) / 2 + 2,
      size: 7,
      font,
      color: BLACK,
      rotate: degrees(angle),
    });
  });
  // Legend, RoofSnap's nine categories.
  const legendItems: Array<{ label: string; color: ReturnType<typeof rgb> }> = [
    { label: "Eave", color: EDGE_COLORS.eave },
    { label: "Hip", color: EDGE_COLORS.hip },
    { label: "Wall", color: LEGEND_EXTRA[1]!.color },
    { label: "Rake", color: EDGE_COLORS.rake },
    { label: "Valley", color: EDGE_COLORS.valley },
    { label: "Pitch Change", color: LEGEND_EXTRA[2]!.color },
    { label: "Ridge", color: EDGE_COLORS.ridge },
    { label: "Step", color: LEGEND_EXTRA[0]!.color },
    { label: "Unlabeled", color: EDGE_COLORS.other },
  ];
  legendItems.forEach((item, index) => {
    const col = index % 3;
    const rowIndex = Math.floor(index / 3);
    const x = 120 + col * 130;
    const y = 168 - rowIndex * 16;
    measurePage.drawRectangle({ x, y: y - 1, width: 18, height: 7, color: item.color });
    measurePage.drawText(item.label, { x: x + 24, y, size: 7.5, font, color: INK });
  });
  drawBlueFooter(measurePage, "SKETCH REPORT  |  MEASUREMENTS DIAGRAM", pageNumber);

  // ---------- Page 4: measurements ----------
  const numbersPage = addPage();
  drawBlackHeader(numbersPage, "SKETCH REPORT  |  MEASUREMENTS");
  numbersPage.drawText("Waste calculation", { x: 30, y: 706, size: 12, font: bold, color: BLACK });
  const edges = m.edges;
  const suggestedExtraSqFt =
    m.area * 0.05 + edges.valley * 2.3 + edges.hip * 0.7 + edges.rake * 0.25;
  const suggestedPct = m.area > 0 ? (suggestedExtraSqFt / m.area) * 100 : 0;
  const wasteColumns = [
    { label: "Actual", factor: 1 },
    { label: "+5%", factor: 1.05 },
    { label: "+10%", factor: 1.1 },
    { label: `+${suggestedPct.toFixed(2)}%`, factor: 1 + suggestedPct / 100 },
    { label: "+15%", factor: 1.15 },
    { label: "+20%", factor: 1.2 },
  ];
  const wasteX = [118, 196, 274, 352, 430, 508];
  const wasteTableY = 684;
  // Suggested-waste flag over the suggested column.
  numbersPage.drawRectangle({
    x: wasteX[3]! - 34,
    y: wasteTableY + 16,
    width: 104,
    height: 15,
    color: BLACK,
  });
  numbersPage.drawText("SUGGESTED WASTE", {
    x: wasteX[3]! - 34 + (104 - bold.widthOfTextAtSize("SUGGESTED WASTE", 7.5)) / 2,
    y: wasteTableY + 20.5,
    size: 7.5,
    font: bold,
    color: WHITE,
  });
  wasteColumns.forEach((col, index) => {
    numbersPage.drawText(col.label, {
      x: wasteX[index]! - bold.widthOfTextAtSize(col.label, 9.5) / 2,
      y: wasteTableY,
      size: 9.5,
      font: bold,
      color: BLACK,
    });
  });
  numbersPage.drawLine({
    start: { x: 30, y: wasteTableY - 6 },
    end: { x: PAGE_W - 30, y: wasteTableY - 6 },
    thickness: 0.6,
    color: SILVER,
  });
  const wasteRow = (label: string, values: string[], yPos: number) => {
    numbersPage.drawText(label, { x: 30, y: yPos, size: 9.5, font: bold, color: INK });
    values.forEach((value, index) =>
      numbersPage.drawText(value, {
        x: wasteX[index]! - font.widthOfTextAtSize(value, 9.5) / 2,
        y: yPos,
        size: 9.5,
        font,
        color: INK,
      }),
    );
    numbersPage.drawLine({
      start: { x: 30, y: yPos - 6 },
      end: { x: PAGE_W - 30, y: yPos - 6 },
      thickness: 0.6,
      color: SILVER,
    });
  };
  wasteRow(
    "Squares",
    wasteColumns.map((col) => ((m.area * col.factor) / 100).toFixed(2)),
    wasteTableY - 22,
  );
  wasteRow(
    "Area",
    wasteColumns.map((col) => `${Math.round(m.area * col.factor).toLocaleString("en-US")} ft.²`),
    wasteTableY - 40,
  );
  const wasteNote =
    "The suggested waste percentage applies when installing standard architectural shingles with a closed single-cut valley system. It includes 2.3 SF per LF of valley, 0.7 SF per LF of hip, 0.25 SF per LF of rake and 0.25 SF per LF of step, plus a 5% handling allowance. It covers field shingle waste only; ridge cap and starter bundles are accounted for separately.";
  {
    const words = wasteNote.split(/\s+/);
    let line = "";
    let noteY = wasteTableY - 58;
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, 6.5) > PAGE_W - 60 && line) {
        numbersPage.drawText(line, { x: 30, y: noteY, size: 6.5, font, color: MUTED });
        noteY -= 9;
        line = word;
      } else line = candidate;
    }
    if (line) numbersPage.drawText(line, { x: 30, y: noteY, size: 6.5, font, color: MUTED });
  }
  // Three measurement tables side by side.
  const tableSection = (
    heading: string,
    rows: Array<[string, string]>,
    x: number,
    width: number,
    yTop: number,
  ) => {
    numbersPage.drawText(heading, { x, y: yTop, size: 11, font: bold, color: BLACK });
    let rowY = yTop - 20;
    for (const [label, value] of rows) {
      numbersPage.drawText(label, { x, y: rowY, size: 8.5, font, color: INK });
      numbersPage.drawText(value, {
        x: x + width - font.widthOfTextAtSize(value, 8.5),
        y: rowY,
        size: 8.5,
        font,
        color: INK,
      });
      numbersPage.drawLine({
        start: { x, y: rowY - 5 },
        end: { x: x + width, y: rowY - 5 },
        thickness: 0.5,
        color: SILVER,
      });
      rowY -= 17;
    }
  };
  const ft = (value: number) => `${value.toFixed(1)} ft.`;
  const tableY = 596;
  tableSection(
    "Line measurements",
    [
      ["Eaves", ft(edges.eave)],
      ["Rakes", ft(edges.rake)],
      ["Ridges", ft(edges.ridge)],
      ["Hips", ft(edges.hip)],
      ["Valleys", ft(edges.valley)],
      ["Step", ft(0)],
      ["Wall", ft(0)],
      ["Pitch change", ft(0)],
    ],
    30,
    158,
    tableY,
  );
  tableSection(
    "Category measurements",
    [
      ["Ice & water shield", ft(0)],
      ["Ridge vent", ft(0)],
      ["Rake edge", ft(0)],
      ["Eave edge", ft(0)],
      ["Step flashing", ft(0)],
      ["Apron flashing", ft(0)],
      ["Gutters", ft(0)],
      ["Gutter toppers", ft(0)],
      ["Down spouts", ft(0)],
    ],
    218,
    168,
    tableY,
  );
  const pitchRows = new Map<string, number>();
  for (const plane of m.planes) {
    const key = formatPitch(plane.pitch);
    pitchRows.set(key, (pitchRows.get(key) ?? 0) + plane.area / 100);
  }
  tableSection(
    "Pitch measurements",
    [...pitchRows.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([pitch, squares]): [string, string] => [pitch, `${squares.toFixed(2)} sqs.`]),
    416,
    166,
    tableY,
  );
  drawBlueFooter(numbersPage, "SKETCH REPORT  |  MEASUREMENTS", pageNumber);

  // ---------- Page 5: area diagram ----------
  const areaPage = addPage();
  drawBlackHeader(areaPage, "SKETCH REPORT  |  AREA DIAGRAM");
  const areaMap = makeMapPoint({ x: 36, y: 158, width: PAGE_W - 72, height: 540 });
  drawFacetOutlines(areaPage, areaMap, { fill: true, edgeWidth: 1.3 });
  d.planes.forEach((plane) => {
    const measured = m.planes.find((item) => item.id === plane.id);
    const center = facetCenter(plane, areaMap);
    const label = `${((measured?.area ?? 0) / 100).toFixed(1)} Sq`;
    areaPage.drawText(label, {
      x: center.x - font.widthOfTextAtSize(label, 8.5) / 2,
      y: center.y - 3,
      size: 8.5,
      font,
      color: INK,
    });
  });
  drawBlueFooter(areaPage, "SKETCH REPORT  |  AREA DIAGRAM", pageNumber);

  // ---------- Extra CRM pages: details, takeoff, materials, photos ----------
  let y = 0;
  const section = (heading: string) => {
    if (y - 35 < 150) {
      addPage();
      drawBlackHeader(page, "SKETCH REPORT  |  REPORT DETAILS");
      drawBlueFooter(page, "SKETCH REPORT  |  REPORT DETAILS", pageNumber);
      y = PAGE_H - 84;
    }
    page.drawRectangle({
      x: MARGIN,
      y: y - 20,
      width: PAGE_W - MARGIN * 2,
      height: 23,
      color: LIGHT,
    });
    page.drawRectangle({ x: MARGIN, y: y - 20, width: 4, height: 23, color: BLUE });
    page.drawText(safe(heading), { x: MARGIN + 12, y: y - 13, size: 10, font: bold, color: NAVY });
    y -= 34;
  };
  const paragraph = (value: string, size = 9, strong = false, color = INK, indent = 0) => {
    const selectedFont = strong ? bold : font;
    const maxWidth = PAGE_W - MARGIN * 2 - indent;
    const words = safe(value).split(/\s+/);
    let line = "";
    const flush = () => {
      if (!line) return;
      if (y - (size + 7) < 150) {
        addPage();
        drawBlackHeader(page, "SKETCH REPORT  |  REPORT DETAILS");
        drawBlueFooter(page, "SKETCH REPORT  |  REPORT DETAILS", pageNumber);
        y = PAGE_H - 84;
      }
      page.drawText(line, { x: MARGIN + indent, y, size, font: selectedFont, color });
      y -= size + 5;
      line = "";
    };
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (selectedFont.widthOfTextAtSize(candidate, size) > maxWidth && line) {
        flush();
        line = word;
      } else line = candidate;
    }
    flush();
  };
  const row = (label: string, value: string, alternate = false) => {
    if (y - 22 < 150) {
      addPage();
      drawBlackHeader(page, "SKETCH REPORT  |  REPORT DETAILS");
      drawBlueFooter(page, "SKETCH REPORT  |  REPORT DETAILS", pageNumber);
      y = PAGE_H - 84;
    }
    if (alternate)
      page.drawRectangle({
        x: MARGIN,
        y: y - 5,
        width: PAGE_W - MARGIN * 2,
        height: 19,
        color: LIGHT,
      });
    page.drawText(safe(label), { x: MARGIN + 8, y, size: 8.5, font, color: MUTED });
    const val = safe(value);
    const maxWidth = PAGE_W - MARGIN * 2 - 190;
    const shortened = bold.widthOfTextAtSize(val, 8.5) > maxWidth ? val.slice(0, 55) + "..." : val;
    page.drawText(shortened, { x: MARGIN + 180, y, size: 8.5, font: bold, color: INK });
    y -= 20;
  };
  const tableHeader = (columns: { label: string; x: number }[]) => {
    if (y - 27 < 150) {
      addPage();
      drawBlackHeader(page, "SKETCH REPORT  |  REPORT DETAILS");
      drawBlueFooter(page, "SKETCH REPORT  |  REPORT DETAILS", pageNumber);
      y = PAGE_H - 84;
    }
    page.drawRectangle({
      x: MARGIN,
      y: y - 6,
      width: PAGE_W - MARGIN * 2,
      height: 22,
      color: NAVY,
    });
    for (const col of columns)
      page.drawText(col.label, { x: col.x, y, size: 8, font: bold, color: WHITE });
    y -= 27;
  };
  const tableRow = (values: string[], columns: { x: number; width?: number }[], index: number) => {
    if (y - 21 < 150) {
      addPage();
      drawBlackHeader(page, "SKETCH REPORT  |  REPORT DETAILS");
      drawBlueFooter(page, "SKETCH REPORT  |  REPORT DETAILS", pageNumber);
      y = PAGE_H - 84;
    }
    if (index % 2 === 0)
      page.drawRectangle({
        x: MARGIN,
        y: y - 5,
        width: PAGE_W - MARGIN * 2,
        height: 19,
        color: LIGHT,
      });
    values.forEach((value, i) => {
      const col = columns[i];
      if (!col) return;
      const max = col.width ?? 120;
      let output = safe(value);
      while (font.widthOfTextAtSize(output, 8) > max && output.length > 4)
        output = output.slice(0, -4) + "...";
      page.drawText(output, { x: col.x, y, size: 8, font, color: INK });
    });
    y -= 20;
  };

  addPage();
  drawBlackHeader(page, "SKETCH REPORT  |  REPORT DETAILS");
  drawBlueFooter(page, "SKETCH REPORT  |  REPORT DETAILS", pageNumber);
  y = PAGE_H - 84;
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
  row("Total roof area", `${m.area.toFixed(2)} sq ft`, true);
  row("Roofing squares", `${m.squares.toFixed(2)} squares`);
  row("Selected waste allowance", `${d.waste}%`, true);
  row("Area including selected waste", `${m.withWaste.toFixed(2)} sq ft`);
  row("Total perimeter", `${m.perimeter.toFixed(2)} ft`, true);
  if (d.geo_reference)
    row(
      "Geocoded address point",
      `${d.geo_reference.addressLatitude.toFixed(6)}, ${d.geo_reference.addressLongitude.toFixed(6)}`,
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
    BLUE,
  );
  reportAudit.blockers.forEach((item) => paragraph(`BLOCKER: ${item}`, 7.5, true, INK));
  reportAudit.warnings.forEach((item) => paragraph(`REVIEW: ${item}`, 7.5, false, MUTED));
  paragraph(
    `Automated check summary: ${reportAudit.planeCount} roof plane(s), ${reportAudit.unclassifiedEdges} unclassified edge(s). This check validates drawing consistency and metadata only; it does not independently verify roof dimensions or pitch from imagery.`,
    7,
    false,
    MUTED,
  );
  section("ROOF PLANE TAKEOFF");
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
        formatPitch(plane.pitch_rise_per_12),
        plane.edges_lf.eave.toFixed(1),
        plane.edges_lf.rake.toFixed(1),
        combined.toFixed(1),
      ],
      planeTakeoffCols,
      index,
    );
  });
  section("ROOF DETAILS");
  row("Number of penetrations", String(d.penetrations.length));
  if (d.penetrations.length) {
    tableHeader([
      { label: "Type", x: MARGIN + 8 },
      { label: "Size (ft)", x: 235 },
      { label: "Location (x, z)", x: 365 },
    ]);
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
    for (const line of d.notes.split("\n")) paragraph(line || " ");
  }
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
    drawBlackHeader(page, "PROJECT PHOTO");
    drawBlueFooter(page, "PROJECT PHOTO", pageNumber);
    y = PAGE_H - 84;
    paragraph(photo.category.toUpperCase(), 13, true, NAVY);
    paragraph(photo.name, 9, false, MUTED);
    if (photo.source) paragraph(`Source: ${photo.source}`, 8, false, MUTED);
    if (photo.matchedAddress) paragraph(`Address match: ${photo.matchedAddress}`, 8, false, MUTED);
    if (typeof photo.latitude === "number" && typeof photo.longitude === "number")
      paragraph(
        `Map coordinates: ${photo.latitude.toFixed(6)}, ${photo.longitude.toFixed(6)}`,
        8,
        false,
        MUTED,
      );
    try {
      const image =
        photo.mime === "image/png"
          ? await pdf.embedPng(photo.bytes)
          : await pdf.embedJpg(photo.bytes);
      const fit = image.scaleToFit(PAGE_W - MARGIN * 2, 480);
      page.drawImage(image, {
        x: (PAGE_W - fit.width) / 2,
        y: 150 + (480 - fit.height) / 2,
        width: fit.width,
        height: fit.height,
      });
    } catch {
      paragraph("This photo could not be embedded in the PDF.", 9, false, MUTED);
    }
  }

  return pdf.save();
}
