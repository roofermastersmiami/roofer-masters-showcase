import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SketchEditor } from "@/components/dashboard/SketchEditor";
import { detectedFacetsToDrawing } from "@/lib/roof-detection";
import type { RoofDrawing } from "@/lib/roof-geometry";
import {
  drawingPointToLatLon,
  latLonToDrawingPoint,
  latLonToWorldPx,
  worldPxToLatLon,
} from "@/lib/sketch-editor";

/**
 * Regression tests for two reported Edit Sketch problems:
 *
 * 1. "The roof drawing is on the street, not on the house." The editor
 *    must project an automated drawing onto the satellite tiles at the
 *    footprint's true lat/lon position — not at the geocoded address
 *    point (which sits at the street). This test builds a synthetic
 *    service payload whose house is offset ~15 ft north of the address
 *    point, converts it with the real converter, renders the real
 *    editor, and asserts the rendered outline matches the footprint's
 *    true position on the tile grid — at the default zoom AND at the
 *    deepest zoom.
 *
 * 2. "Allow me to zoom much closer." The editor must zoom to z24
 *    (16x closer than the old z20 cap — a single facet fills the view),
 *    keep the z20 tile mosaic as an upscaled backdrop, and keep vertex
 *    dragging exact at that depth.
 */

const ORIGIN = { lat: 25.979306, lon: -80.186822 }; // West Park test address
const M_PER_DEG_LAT = 110540;
const M_PER_DEG_LON = 111320 * Math.cos((ORIGIN.lat * Math.PI) / 180);

function toLatLon(eastM: number, northM: number) {
  return {
    lat: ORIGIN.lat + northM / M_PER_DEG_LAT,
    lon: ORIGIN.lon + eastM / M_PER_DEG_LON,
  };
}

// A 24 ft x 18 ft gable house (meters here), sitting north of the
// address point so the address point is ~6.5 ft south of the eave —
// the geometry behind the "drawing on the street" report.
const EAST = 3.6576; // half width (12 ft)
const NORTH_EAVE = 2.0;
const NORTH_RIDGE = 4.7432;
const NORTH_FAR_EAVE = 7.4864;
const EAVE_ELEV = 3.0;
const RIDGE_ELEV = 4.3716;

function boundary(corners: [number, number, number][]) {
  return corners.map(([east, north, elev]) => {
    const { lat, lon } = toLatLon(east, north);
    return [lat, lon, elev] as [number, number, number];
  });
}

const payload = {
  status: "lidar_facets",
  verification: "unverified_public_data",
  matched_address: "4311 Southwest 32nd Drive, West Park, FL 33023",
  location: ORIGIN,
  footprint: {
    source: "synthetic-test",
    area_sqft: 432,
    polygon_geojson: {
      type: "Polygon",
      coordinates: [
        [
          [toLatLon(-EAST, NORTH_EAVE).lon, toLatLon(-EAST, NORTH_EAVE).lat],
          [toLatLon(EAST, NORTH_EAVE).lon, toLatLon(EAST, NORTH_EAVE).lat],
          [toLatLon(EAST, NORTH_FAR_EAVE).lon, toLatLon(EAST, NORTH_FAR_EAVE).lat],
          [toLatLon(-EAST, NORTH_FAR_EAVE).lon, toLatLon(-EAST, NORTH_FAR_EAVE).lat],
          [toLatLon(-EAST, NORTH_EAVE).lon, toLatLon(-EAST, NORTH_EAVE).lat],
        ],
      ],
    },
  },
  roof: {
    facet_count: 2,
    area_sqft: 483,
    total_squares: 4.83,
    dominant_pitch_rise_per_12: 6,
    facets: [
      {
        id: "facet-south",
        point_count: 400,
        fit_rmse_m: 0.02,
        pitch_degrees: 26.565,
        pitch_rise_per_12: 6,
        azimuth_degrees: 180,
        area_sqft: 241.5,
        squares: 2.42,
        plane_model: { z_equals_ax_plus_by_plus_c: [0, 0.5, 2.0] as [number, number, number] },
        boundary_latlon: boundary([
          [-EAST, NORTH_EAVE, EAVE_ELEV],
          [EAST, NORTH_EAVE, EAVE_ELEV],
          [EAST, NORTH_RIDGE, RIDGE_ELEV],
          [-EAST, NORTH_RIDGE, RIDGE_ELEV],
        ]),
      },
      {
        id: "facet-north",
        point_count: 400,
        fit_rmse_m: 0.02,
        pitch_degrees: 26.565,
        pitch_rise_per_12: 6,
        azimuth_degrees: 0,
        area_sqft: 241.5,
        squares: 2.42,
        plane_model: { z_equals_ax_plus_by_plus_c: [0, -0.5, 6.7432] as [number, number, number] },
        boundary_latlon: boundary([
          [-EAST, NORTH_RIDGE, RIDGE_ELEV],
          [EAST, NORTH_RIDGE, RIDGE_ELEV],
          [EAST, NORTH_FAR_EAVE, EAVE_ELEV],
          [-EAST, NORTH_FAR_EAVE, EAVE_ELEV],
        ]),
      },
    ],
    edge_lengths_lf: { ridge: 24, hip: 0, valley: 0, eave: 48, rake: 40.25, pitch_change: 0 },
    drawing_ready: true,
  },
  fallback: { available: false, mode: null, footprint_area_sqft: 432, message: null },
  disclaimer: "Synthetic test payload.",
};

afterEach(() => cleanup());

// jsdom quirks (same as sketch-editor-edge-actions.test.tsx): no
// PointerEvent constructor, and setPointerCapture throws for
// synthetic ids.
Element.prototype.setPointerCapture = () => {};
Element.prototype.releasePointerCapture = () => {};
function pointer(el: Element, type: string, init: MouseEventInit) {
  fireEvent(el, new MouseEvent(type, { bubbles: true, cancelable: true, ...init }));
}

function makeDrawing(): RoofDrawing {
  return detectedFacetsToDrawing(payload, "Shingle Roof");
}

function renderedOutlineBbox(container: HTMLElement) {
  const polygons = [...container.querySelectorAll("polygon")].filter(
    (el) => !el.getAttribute("points")?.includes("0,0 24,0"),
  );
  const pts = polygons.flatMap((el) =>
    (el.getAttribute("points") ?? "")
      .trim()
      .split(/\s+/)
      .map((pair) => {
        const [x, y] = pair.split(",").map(Number);
        return { x: x ?? 0, y: y ?? 0 };
      }),
  );
  return {
    minX: Math.min(...pts.map((p) => p.x)),
    maxX: Math.max(...pts.map((p) => p.x)),
    minY: Math.min(...pts.map((p) => p.y)),
    maxY: Math.max(...pts.map((p) => p.y)),
  };
}

/** Where the footprint ring truly falls on screen, given the editor
 * camera starts centred on the drawing centroid at `zoom`. */
function footprintBbox(drawing: RoofDrawing, zoom: number, w: number, h: number) {
  const points = drawing.planes.flatMap((plane) => plane.points);
  const centroid = {
    x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
    z: points.reduce((sum, p) => sum + p.z, 0) / points.length,
  };
  const ref = drawing.geo_reference;
  if (!ref) throw new Error("converted drawing lost its geo reference");
  const center = drawingPointToLatLon(centroid, ref);
  const cam = latLonToWorldPx(center.lat, center.lon, zoom);
  const ring = payload.footprint.polygon_geojson.coordinates[0] as [number, number][];
  const screenPts = ring.map(([lon, lat]) => {
    const world = latLonToWorldPx(lat, lon, zoom);
    return { x: world.x - cam.x + w / 2, y: world.y - cam.y + h / 2 };
  });
  return {
    minX: Math.min(...screenPts.map((p) => p.x)),
    maxX: Math.max(...screenPts.map((p) => p.x)),
    minY: Math.min(...screenPts.map((p) => p.y)),
    maxY: Math.max(...screenPts.map((p) => p.y)),
  };
}

function expectAligned(
  container: HTMLElement,
  drawing: RoofDrawing,
  zoom: number,
  tolerancePx: number,
) {
  const svg = container.querySelector('svg[aria-label^="Roof sketch"]');
  if (!svg) throw new Error("editor canvas svg not found");
  const w = Number(svg.getAttribute("width"));
  const h = Number(svg.getAttribute("height"));
  const outline = renderedOutlineBbox(container);
  const truth = footprintBbox(drawing, zoom, w, h);
  for (const side of ["minX", "maxX", "minY", "maxY"] as const) {
    expect(
      Math.abs(outline[side] - truth[side]),
      `${side} at z${zoom}: outline ${outline[side].toFixed(1)} vs footprint ${truth[side].toFixed(1)}`,
    ).toBeLessThanOrEqual(tolerancePx);
  }
  return { w, h };
}

describe("SketchEditor satellite alignment (drawing on the house, not the street)", () => {
  it("projects the automated outline onto the footprint at the default zoom", () => {
    const drawing = makeDrawing();
    const { container } = render(
      <SketchEditor drawing={drawing} onDone={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(screen.getByText("z19")).toBeTruthy();
    expectAligned(container, drawing, 19, 4);
  });

  it("zooms to z24, stays aligned, upscales the z20 tiles, and drags a vertex exactly", () => {
    const onDone = vi.fn();
    const drawing = makeDrawing();
    const { container } = render(
      <SketchEditor drawing={drawing} onDone={onDone} onCancel={vi.fn()} />,
    );
    const zoomIn = screen.getByRole("button", { name: "Zoom in" });
    for (let i = 0; i < 5; i++) fireEvent.click(zoomIn);
    expect(screen.getByText("z24")).toBeTruthy();
    // The cap holds: one more click stays at z24.
    fireEvent.click(zoomIn);
    expect(screen.getByText("z24")).toBeTruthy();

    const { w, h } = expectAligned(container, drawing, 24, 8);

    // Backdrop: tiles are still requested at z20 (the deepest real
    // Esri level) and upscaled — never requested at z24, where they
    // would 404 and leave a blank map.
    const tileImgs = [...container.querySelectorAll("img")].filter((img) =>
      (img.getAttribute("src") ?? "").includes("/tile/"),
    );
    expect(tileImgs.length).toBeGreaterThan(0);
    for (const img of tileImgs) {
      expect(img.getAttribute("src")).toContain("/tile/20/");
    }
    const widths = tileImgs.map((img) => parseFloat(img.style.width || "0"));
    expect(Math.max(...widths)).toBeGreaterThanOrEqual(1024);

    // Vertex drag at max zoom lands where it is dropped. Use the
    // south facet's ridge-right corner (on screen at z24).
    const ref = drawing.geo_reference;
    if (!ref) throw new Error("converted drawing lost its geo reference");
    const plane = drawing.planes[0];
    if (!plane) throw new Error("no facet");
    const vertex = plane.points[2];
    if (!vertex) throw new Error("no vertex");
    const centroid = (() => {
      const points = drawing.planes.flatMap((p) => p.points);
      return {
        x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
        z: points.reduce((sum, p) => sum + p.z, 0) / points.length,
      };
    })();
    const centerLatLon = drawingPointToLatLon(centroid, ref);
    const cam = latLonToWorldPx(centerLatLon.lat, centerLatLon.lon, 24);
    const vertexLatLon = drawingPointToLatLon(vertex, ref);
    const vertexWorld = latLonToWorldPx(vertexLatLon.lat, vertexLatLon.lon, 24);
    const start = { x: vertexWorld.x - cam.x + w / 2, y: vertexWorld.y - cam.y + h / 2 };
    const drop = { x: start.x + 40, y: start.y + 30 };

    const circles = [...container.querySelectorAll("circle")];
    const handle = circles.find(
      (c) =>
        Math.abs(Number(c.getAttribute("cx")) - start.x) < 2 &&
        Math.abs(Number(c.getAttribute("cy")) - start.y) < 2,
    );
    if (!handle) throw new Error("vertex handle not found at its projected position");
    const svg = container.querySelector('svg[aria-label^="Roof sketch"]');
    if (!svg) throw new Error("editor canvas svg not found");
    pointer(handle, "pointerdown", { clientX: start.x, clientY: start.y });
    pointer(svg, "pointermove", { clientX: drop.x, clientY: drop.y });
    pointer(svg, "pointerup", { clientX: drop.x, clientY: drop.y });

    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onDone).toHaveBeenCalledTimes(1);
    const [next] = onDone.mock.calls[0] as [RoofDrawing, boolean];
    const moved = next.planes[0]?.points[2];
    if (!moved) throw new Error("moved vertex missing");
    const expectedLatLon = worldPxToLatLon(cam.x + drop.x - w / 2, cam.y + drop.y - h / 2, 24);
    const expected = latLonToDrawingPoint(expectedLatLon.lat, expectedLatLon.lon, ref, vertex.y);
    expect(Math.abs(moved.x - expected.x)).toBeLessThanOrEqual(0.3);
    expect(Math.abs(moved.z - expected.z)).toBeLessThanOrEqual(0.3);
    // And it actually moved roughly the dragged distance (40px at z24
    // is about 1.1 ft).
    expect(Math.hypot(moved.x - vertex.x, moved.z - vertex.z)).toBeGreaterThan(0.8);
  });

  it("zoom math round-trips exactly at z24 (project -> unproject)", () => {
    const drawing = makeDrawing();
    const ref = drawing.geo_reference;
    if (!ref) throw new Error("converted drawing lost its geo reference");
    for (const plane of drawing.planes) {
      for (const point of plane.points) {
        const latLon = drawingPointToLatLon(point, ref);
        const world = latLonToWorldPx(latLon.lat, latLon.lon, 24);
        const back = worldPxToLatLon(world.x, world.y, 24);
        const roundTripped = latLonToDrawingPoint(back.lat, back.lon, ref, point.y);
        expect(Math.abs(roundTripped.x - point.x)).toBeLessThanOrEqual(0.05);
        expect(Math.abs(roundTripped.z - point.z)).toBeLessThanOrEqual(0.05);
      }
    }
  });
});
