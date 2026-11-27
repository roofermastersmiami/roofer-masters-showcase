import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { drawingSchema, measureDrawing, type RoofDrawing } from "@/lib/roof-geometry";
import {
  detectedFacetsToDrawing,
  roofDetectionResponseSchema,
  structureToDrawing,
  type RoofDetectionResponse,
  type RoofStructure,
} from "@/lib/roof-detection";
import {
  combinedStructureDrawing,
  pickedStructureDrawing,
  structureEntries,
  structurePdfTitle,
  sumServiceEdges,
} from "@/lib/roof-structures";
import { roofDrawingPdf } from "@/lib/roof-drawing-pdf";
import { parseIncludeOutbuilding } from "@/lib/roof-order-notes";

/** A two-structure property: a main house (one 6/12 facet) and a
 * detached garage (one 4/12 facet) standing east of it, in the same
 * shape the detection service returns in multi-structure mode. */
const mainStructure: RoofStructure = {
  role: "main",
  label: "Main house",
  candidate_id: "candidate-main",
  status: "lidar_facets",
  distance_to_main_m: 0,
  location: { lat: 25.47, lon: -80.48 },
  footprint: {
    source: "OpenStreetMap",
    area_sqft: 1200,
    polygon_geojson: {
      type: "Polygon",
      coordinates: [
        [
          [-80.4801, 25.4699],
          [-80.4799, 25.4699],
          [-80.4799, 25.4701],
          [-80.4801, 25.4701],
          [-80.4801, 25.4699],
        ],
      ],
    },
  },
  roof: {
    facet_count: 1,
    area_sqft: 1200,
    total_squares: 12,
    dominant_pitch_rise_per_12: 6,
    edge_lengths_lf: { ridge: 10, hip: 0, valley: 0, eave: 40, rake: 20, pitch_change: 0 },
    facets: [
      {
        id: "facet-1",
        point_count: 200,
        pitch_degrees: 26.57,
        pitch_rise_per_12: 6,
        azimuth_degrees: 180,
        area_sqft: 1200,
        squares: 12,
        boundary_latlon: [
          [25.4699, -80.4801, 10],
          [25.4699, -80.4799, 11],
          [25.4701, -80.4799, 12],
          [25.4701, -80.4801, 11],
          [25.4699, -80.4801, 10],
        ],
      },
    ],
  },
};

const detachedStructure: RoofStructure = {
  role: "detached",
  label: "Detached structure 1",
  candidate_id: "candidate-shed",
  status: "lidar_facets",
  distance_to_main_m: 12.4,
  location: { lat: 25.47, lon: -80.4796 },
  footprint: {
    source: "OpenStreetMap",
    area_sqft: 300,
    polygon_geojson: {
      type: "Polygon",
      coordinates: [
        [
          [-80.47965, 25.46995],
          [-80.47955, 25.46995],
          [-80.47955, 25.47005],
          [-80.47965, 25.47005],
          [-80.47965, 25.46995],
        ],
      ],
    },
  },
  roof: {
    facet_count: 1,
    area_sqft: 300,
    total_squares: 3,
    dominant_pitch_rise_per_12: 4,
    edge_lengths_lf: { ridge: 5, hip: 0, valley: 0, eave: 20, rake: 10, pitch_change: 0 },
    facets: [
      {
        id: "facet-1",
        point_count: 90,
        pitch_degrees: 18.43,
        pitch_rise_per_12: 4,
        azimuth_degrees: 180,
        area_sqft: 300,
        squares: 3,
        boundary_latlon: [
          [25.46995, -80.47965, 8],
          [25.46995, -80.47955, 8],
          [25.47005, -80.47955, 11.68],
          [25.47005, -80.47965, 11.68],
          [25.46995, -80.47965, 8],
        ],
      },
    ],
  },
};

const response: RoofDetectionResponse = {
  status: "lidar_facets",
  verification: "unverified_public_data",
  matched_address: "100 Main Street",
  location: { lat: 25.47, lon: -80.48 },
  footprint: mainStructure.footprint,
  roof: mainStructure.roof,
  structures: [mainStructure, detachedStructure],
  fallback: { available: false, mode: null, footprint_area_sqft: 1200, message: null },
  disclaimer: "Preliminary public-data result.",
};

function mainDrawingWithDetached(): RoofDrawing {
  const main = detectedFacetsToDrawing(response, "Shingle Roof");
  const detached = structureToDrawing(response, detachedStructure, "Shingle Roof");
  return {
    ...main,
    detached_structures: [
      { label: detachedStructure.label, candidate_id: "candidate-shed", drawing: detached },
    ],
  };
}

describe("multi-structure response contract", () => {
  it("parses the additive structures array and keeps headline numbers on the main house", () => {
    const parsed = roofDetectionResponseSchema.parse(response);
    expect(parsed.structures).toHaveLength(2);
    expect(parsed.structures?.[0]?.role).toBe("main");
    expect(parsed.structures?.[1]?.label).toBe("Detached structure 1");
    expect(parsed.roof.area_sqft).toBe(1200);
  });

  it("converts a detached structure with the shared origin so positions stay relative", () => {
    const main = detectedFacetsToDrawing(response, "Shingle Roof");
    const detached = structureToDrawing(response, detachedStructure, "Shingle Roof");
    expect(detached.geo_reference?.originLatitude).toBe(response.location.lat);
    expect(detached.geo_reference?.originLongitude).toBe(response.location.lon);
    // The garage stands east of the house: its plan points sit at a
    // clearly greater x than the house's, in the same frame.
    const mainMaxX = Math.max(...main.planes.flatMap((p) => p.points.map((pt) => pt.x)));
    const detachedMinX = Math.min(...detached.planes.flatMap((p) => p.points.map((pt) => pt.x)));
    expect(detachedMinX).toBeGreaterThan(mainMaxX);
    expect(detached.service_edge_lengths_lf?.eave).toBe(20);
  });
});

describe("structure picker data", () => {
  it("round-trips detached structures through the drawing schema", () => {
    const drawing = mainDrawingWithDetached();
    const parsed = drawingSchema.parse(drawing);
    expect(parsed.detached_structures).toHaveLength(1);
    expect(parsed.detached_structures?.[0]?.label).toBe("Detached structure 1");
    // The main drawing's own planes remain the main house only.
    expect(parsed.planes).toHaveLength(1);
  });

  it("lists main first, then detached entries keyed by candidate", () => {
    const entries = structureEntries(mainDrawingWithDetached());
    expect(entries.map((entry) => entry.key)).toEqual(["main", "candidate-shed"]);
    expect(entries.map((entry) => entry.label)).toEqual(["Main house", "Detached structure 1"]);
  });

  it("swaps the displayed drawing and measurements when a structure is picked", () => {
    const drawing = mainDrawingWithDetached();
    const entries = structureEntries(drawing);
    expect(pickedStructureDrawing(entries, "main")).toBeNull();
    const picked = pickedStructureDrawing(entries, "candidate-shed");
    expect(picked?.label).toBe("Detached structure 1");
    const mainArea = measureDrawing(drawing).area;
    const pickedArea = measureDrawing(picked!.drawing).area;
    expect(pickedArea).toBeGreaterThan(0);
    expect(pickedArea).toBeLessThan(mainArea);
    // The pick measures the garage's own pitch, not the house's.
    expect(picked!.drawing.planes[0]?.id).toBeTruthy();
    expect(measureDrawing(picked!.drawing).planes[0]?.pitch).toBeCloseTo(4, 0);
  });

  it("combines all structures: totals equal the sum of the parts", () => {
    const drawing = mainDrawingWithDetached();
    const entries = structureEntries(drawing);
    const all = pickedStructureDrawing(entries, "all");
    expect(all?.label).toBe("All structures");
    const mainMeasure = measureDrawing(drawing);
    const detachedMeasure = measureDrawing(entries[1]!.drawing);
    const combinedMeasure = measureDrawing(all!.drawing);
    expect(combinedMeasure.area).toBeCloseTo(mainMeasure.area + detachedMeasure.area, 1);
    expect(combinedMeasure.planes).toHaveLength(
      mainMeasure.planes.length + detachedMeasure.planes.length,
    );
    // Plane ids stay unique and names carry the structure label.
    const ids = all!.drawing.planes.map((plane) => plane.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(all!.drawing.planes.some((plane) => plane.name.startsWith("Detached structure 1"))).toBe(
      true,
    );
    // Authoritative service edge totals are summed, not dropped.
    expect(all!.drawing.service_edge_lengths_lf?.eave).toBe(60);
    expect(all!.drawing.service_edge_lengths_lf?.ridge).toBe(15);
  });

  it("sums service edge totals field by field", () => {
    const total = sumServiceEdges([
      { ridge: 1, hip: 2, valley: 3, eave: 4, rake: 5, pitch_change: 6 },
      { ridge: 10, hip: 20, valley: 30, eave: 40, rake: 50, pitch_change: 60 },
    ]);
    expect(total).toEqual({ ridge: 11, hip: 22, valley: 33, eave: 44, rake: 55, pitch_change: 66 });
  });

  it("combined drawing of a single structure is that structure", () => {
    const drawing = detectedFacetsToDrawing(response, "Shingle Roof");
    const combined = combinedStructureDrawing(structureEntries(drawing));
    expect(combined).toBe(drawing);
  });
});

describe("structure PDF labeling", () => {
  it("composes a title that names the structure", () => {
    expect(structurePdfTitle("Roof measurement report", "Detached structure 1")).toBe(
      "Roof measurement report — Detached structure 1",
    );
  });

  it("stamps the structure label into the generated PDF metadata", async () => {
    const drawing = structureToDrawing(response, detachedStructure, "Shingle Roof");
    const bytes = await roofDrawingPdf(
      structurePdfTitle("Roof measurement report", "Detached structure 1"),
      drawing,
      "Test Customer",
      "100 Main Street",
      [],
      {},
      { theme: "roofsnap", logoScale: 1, structureLabel: "Detached structure 1" },
    );
    const doc = await PDFDocument.load(bytes);
    expect(doc.getTitle()).toContain("Detached structure 1");
    expect(doc.getSubject()).toContain("Detached structure 1");
    // The unlabeled default stays clean for the main house.
    const mainBytes = await roofDrawingPdf(
      "Roof measurement report",
      detectedFacetsToDrawing(response, "Shingle Roof"),
      "Test Customer",
      "100 Main Street",
      [],
      {},
      { theme: "roofsnap", logoScale: 1 },
    );
    expect((await PDFDocument.load(mainBytes)).getSubject()).toBe(
      "Roof measurement and material report",
    );
  });
});

describe("include-outbuilding order flag", () => {
  it("reads the labelled notes line the order form writes", () => {
    expect(parseIncludeOutbuilding("Building type: Single Family\nInclude outbuilding: Yes")).toBe(
      true,
    );
    expect(parseIncludeOutbuilding("Building type: Single Family\nInclude outbuilding: No")).toBe(
      false,
    );
    expect(parseIncludeOutbuilding("some older notes")).toBe(false);
    expect(parseIncludeOutbuilding(null)).toBe(false);
    expect(parseIncludeOutbuilding(undefined)).toBe(false);
  });
});
