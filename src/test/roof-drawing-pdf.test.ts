import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { detectedFacetsToDrawing, type RoofDetectionResponse } from "@/lib/roof-detection";
import { ROOF_REPORT_THEMES, roofDrawingPdf, type RoofReportThemeId } from "@/lib/roof-drawing-pdf";

const origin = { lat: 25.998, lon: -80.3995 };
const lonScale = 111320 * Math.cos((origin.lat * Math.PI) / 180) * (1 / 0.3048);
const latScale = 110540 * (1 / 0.3048);
const ring = (points: [number, number, number][]) =>
  points.map(([x, z, elevation]) => [
    origin.lat - z / latScale,
    origin.lon + x / lonScale,
    elevation,
  ]) as [number, number, number][];
const facet = (id: string, points: [number, number, number][]) => ({
  id,
  point_count: 900,
  pitch_degrees: 26.57,
  pitch_rise_per_12: 6,
  azimuth_degrees: 180,
  area_sqft: 500,
  squares: 5,
  boundary_latlon: ring([...points, points[0]!]),
});
const E = 10;
const R = 12.743;
const response = {
  status: "lidar_facets",
  verification: "unverified_public_data",
  matched_address: "3062 Southwest 189th Avenue, Miramar, FL 33029",
  location: origin,
  footprint: {
    source: "Broward County Building Footprints",
    area_sqft: 1800,
    polygon_geojson: {
      type: "Polygon",
      coordinates: [
        [
          [-80.3996, 25.9979],
          [-80.3994, 25.9979],
          [-80.3994, 25.9981],
          [-80.3996, 25.9981],
          [-80.3996, 25.9979],
        ],
      ],
    },
  },
  roof: {
    facet_count: 4,
    area_sqft: 2012,
    total_squares: 20.12,
    dominant_pitch_rise_per_12: 6,
    edge_lengths_lf: { ridge: 14, hip: 108, valley: 0, eave: 172, rake: 0, pitch_change: 0 },
    facets: [
      facet("facet-1", [
        [0, 0, E],
        [50, 0, E],
        [32, 18, R],
        [18, 18, R],
      ]),
      facet("facet-2", [
        [50, 36, E],
        [0, 36, E],
        [18, 18, R],
        [32, 18, R],
      ]),
      facet("facet-3", [
        [0, 36, E],
        [0, 0, E],
        [18, 18, R],
      ]),
      facet("facet-4", [
        [50, 0, E],
        [50, 36, E],
        [32, 18, R],
      ]),
    ],
  },
  fallback: { available: false, mode: null, footprint_area_sqft: 1800, message: null },
  disclaimer: "Preliminary public-data result.",
} as unknown as RoofDetectionResponse;

describe("service edge totals in the report (step 8)", () => {
  it("carries the service totals into the drawing and still renders", async () => {
    const drawing = detectedFacetsToDrawing(response, "Metal Roof");
    expect(drawing.service_edge_lengths_lf).toEqual({
      ridge: 14,
      hip: 108,
      valley: 0,
      eave: 172,
      rake: 0,
      pitch_change: 0,
    });
    const withService = await roofDrawingPdf(
      "Sketch Report",
      drawing,
      "Ricardo Rodriguez",
      "3062 Southwest 189th Avenue, Miramar, FL 33029",
      [],
      {},
      { theme: "roofsnap" },
    );
    const withoutService = await roofDrawingPdf(
      "Sketch Report",
      { ...drawing, service_edge_lengths_lf: undefined },
      "Ricardo Rodriguez",
      "3062 Southwest 189th Avenue, Miramar, FL 33029",
      [],
      {},
      { theme: "roofsnap" },
    );
    const pagesWith = (await PDFDocument.load(withService)).getPageCount();
    const pagesWithout = (await PDFDocument.load(withoutService)).getPageCount();
    expect(pagesWith).toBe(pagesWithout);
    expect(pagesWith).toBeGreaterThanOrEqual(5);
  });
});

describe("sketch report themes", () => {
  it("renders every theme with the same structure and a resizable logo", async () => {
    const drawing = detectedFacetsToDrawing(response, "Metal Roof");
    const themeIds = Object.keys(ROOF_REPORT_THEMES) as RoofReportThemeId[];
    expect(themeIds.length).toBeGreaterThanOrEqual(4);
    let expectedPages: number | null = null;
    for (const theme of themeIds) {
      const bytes = await roofDrawingPdf(
        "Sketch Report",
        drawing,
        "Ricardo Rodriguez",
        "3062 Southwest 189th Avenue, Miramar, FL 33029",
        [],
        {},
        { theme, logoScale: theme === "navy" ? 1.3 : 1 },
      );
      expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
      const doc = await PDFDocument.load(bytes);
      if (expectedPages === null) expectedPages = doc.getPageCount();
      expect(doc.getPageCount()).toBe(expectedPages);
      expect(doc.getPageCount()).toBeGreaterThanOrEqual(5);
    }
  });
});
