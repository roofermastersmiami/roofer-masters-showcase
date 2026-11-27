import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RoofMeasurements } from "@/components/dashboard/RoofMeasurements";
import {
  PLAN_ROTATION_STEP_DEG,
  dragPlanRotationDeg,
  normalizePlanAngleDeg,
  planRotationFitFactor,
  pointerAngleDeg,
  rotatePlanPointDeg,
} from "@/lib/plan-rotation";
import {
  addressMarkerPosition,
  addressPinPosition,
  roofPreset,
  type RoofDrawing,
} from "@/lib/roof-geometry";
import type { RoofOrder } from "@/components/dashboard/roof-orders-data";
import type { Database } from "@/integrations/supabase/types";

const aerialFetchMock = vi.fn();
const signedUrlMock = vi.fn();
const downloadMock = vi.fn();
const uploadMock = vi.fn();

vi.mock("@tanstack/react-start", () => ({
  useServerFn: (fn: unknown) => fn,
}));

vi.mock("@/lib/report-aerial.functions", () => ({
  loadReportAerial: (input: unknown) => aerialFetchMock(input),
}));

vi.mock("@/lib/roof-drawing.functions", () => ({
  saveRoofDrawing: vi.fn(async () => ({ id: "drawing-2", revision: 2 })),
}));

vi.mock("@/lib/roof-orders.functions", () => ({
  attachRoofOrderPdf: vi.fn(async () => ({})),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    storage: {
      from: (bucket: string) =>
        bucket === "roof-job-photos"
          ? { createSignedUrl: signedUrlMock }
          : { download: downloadMock, upload: uploadMock },
    },
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn(async () => ({ data: null, error: null })),
    })),
  },
}));

vi.mock("@/components/dashboard/foundation-data", () => ({
  propertiesQuery: { queryKey: ["properties"], queryFn: async () => [] },
  customersQuery: { queryKey: ["customers"], queryFn: async () => [] },
}));

vi.mock("@/components/dashboard/CrmContext", () => ({
  useCrm: () => ({ go: vi.fn() }),
}));

vi.mock("@/components/dashboard/AutomatedRoofReport", () => ({
  AutomatedRoofReport: () => null,
}));

vi.mock("@/components/dashboard/RoofScene", () => ({
  default: ({ view, planRotationDeg }: { view: string; planRotationDeg?: number }) => (
    <div data-testid="roof-scene" data-plan-rotation={planRotationDeg ?? 0}>
      scene-{view}
    </div>
  ),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

describe("normalizePlanAngleDeg", () => {
  it("keeps angles inside (−180, 180]", () => {
    expect(normalizePlanAngleDeg(0)).toBe(0);
    expect(normalizePlanAngleDeg(45)).toBe(45);
    expect(normalizePlanAngleDeg(180)).toBe(180);
    expect(normalizePlanAngleDeg(190)).toBe(-170);
    expect(normalizePlanAngleDeg(-190)).toBe(170);
    expect(normalizePlanAngleDeg(360)).toBe(0);
    expect(normalizePlanAngleDeg(540)).toBe(180);
    expect(normalizePlanAngleDeg(-180)).toBe(180);
  });
});

describe("rotatePlanPointDeg", () => {
  it("is the identity at 0°", () => {
    expect(rotatePlanPointDeg({ x: 12, z: -7 }, { x: 3, z: 4 }, 0)).toEqual({ x: 12, z: -7 });
  });

  it("rotates around the centre using the three.js rotation-Y convention", () => {
    // +90° takes +x toward −z (east point ends up north of centre).
    const quarter = rotatePlanPointDeg({ x: 10, z: 0 }, { x: 0, z: 0 }, 90);
    expect(quarter.x).toBeCloseTo(0);
    expect(quarter.z).toBeCloseTo(-10);
    const half = rotatePlanPointDeg({ x: 10, z: 0 }, { x: 0, z: 0 }, 180);
    expect(half.x).toBeCloseTo(-10);
    expect(half.z).toBeCloseTo(0);
    // Around a non-origin centre.
    const shifted = rotatePlanPointDeg({ x: 15, z: 5 }, { x: 5, z: 5 }, 90);
    expect(shifted.x).toBeCloseTo(5);
    expect(shifted.z).toBeCloseTo(-5);
  });

  it("a full turn returns the point to itself", () => {
    const spun = rotatePlanPointDeg({ x: 8, z: 9 }, { x: 1, z: 2 }, 360);
    expect(spun.x).toBeCloseTo(8);
    expect(spun.z).toBeCloseTo(9);
  });
});

describe("pointerAngleDeg + dragPlanRotationDeg", () => {
  const center = { x: 100, y: 100 };

  it("measures screen angles counter-clockwise from east", () => {
    expect(pointerAngleDeg(center, { x: 200, y: 100 })).toBeCloseTo(0);
    expect(pointerAngleDeg(center, { x: 100, y: 0 })).toBeCloseTo(90);
    expect(pointerAngleDeg(center, { x: 100, y: 200 })).toBeCloseTo(-90);
    expect(Math.abs(pointerAngleDeg(center, { x: 0, y: 100 }))).toBeCloseTo(180);
  });

  it("drags add the pointer's travel to the starting rotation", () => {
    expect(dragPlanRotationDeg(30, 10, 40)).toBe(60);
    expect(dragPlanRotationDeg(0, 0, -45)).toBe(-45);
    // Wrapping past ±180 normalizes instead of spinning away.
    expect(dragPlanRotationDeg(170, 0, 30)).toBe(-160);
  });
});

describe("planRotationFitFactor", () => {
  it("is 1 unrotated and ~1.41 at 45°", () => {
    expect(planRotationFitFactor(0)).toBeCloseTo(1);
    expect(planRotationFitFactor(45)).toBeCloseTo(Math.SQRT2);
    expect(planRotationFitFactor(90)).toBeCloseTo(1);
    expect(planRotationFitFactor(30)).toBeCloseTo(Math.cos(Math.PI / 6) + 0.5);
  });
});

describe("addressMarkerPosition", () => {
  // Origin at the measured building; the geocoded address point sits
  // ~33 ft east and ~36 ft south of it — on the street, as Fredy saw.
  const GEO = {
    originLatitude: 25.98,
    originLongitude: -80.4,
    addressLatitude: 25.9799,
    addressLongitude: -80.3999,
  };
  const squarePlane = (
    id: string,
    cx: number,
    cz: number,
    halfW: number,
    halfD: number,
  ): RoofDrawing["planes"][number] => ({
    id,
    name: id,
    points: [
      { x: cx - halfW, y: 10, z: cz - halfD },
      { x: cx + halfW, y: 10, z: cz - halfD },
      { x: cx + halfW, y: 10, z: cz + halfD },
      { x: cx - halfW, y: 10, z: cz + halfD },
    ],
    edges: ["eave", "rake", "eave", "rake"],
  });

  it("anchors the marker to the measured footprint centroid, not the street geocode", () => {
    const drawing = {
      ...roofPreset("gable"),
      planes: [squarePlane("main", 0, 0, 20, 15)],
      geo_reference: GEO,
    } as RoofDrawing;
    const geocoded = addressPinPosition(GEO);
    expect(Math.abs(geocoded.x)).toBeGreaterThan(20);
    expect(Math.abs(geocoded.z)).toBeGreaterThan(20);
    const marker = addressMarkerPosition(drawing);
    expect(marker).not.toBeNull();
    expect(marker!.x).toBeCloseTo(0);
    expect(marker!.z).toBeCloseTo(0);
  });

  it("weights each plane's centroid by its outline area", () => {
    const drawing = {
      ...roofPreset("gable"),
      planes: [squarePlane("big", 0, 0, 20, 15), squarePlane("small", 100, 0, 5, 5)],
      geo_reference: GEO,
    } as RoofDrawing;
    const marker = addressMarkerPosition(drawing);
    // (1200·0 + 100·100) / 1300 ≈ 7.69
    expect(marker!.x).toBeCloseTo(10000 / 1300);
    expect(marker!.z).toBeCloseTo(0);
  });

  it("falls back to the geocoded point when there is no measured geometry", () => {
    const drawing = {
      ...roofPreset("gable"),
      planes: [],
      geo_reference: GEO,
    } as unknown as RoofDrawing;
    expect(addressMarkerPosition(drawing)).toEqual(addressPinPosition(GEO));
  });

  it("returns null when the drawing has neither geometry nor a geo reference", () => {
    const drawing = { ...roofPreset("gable"), planes: [] } as unknown as RoofDrawing;
    expect(addressMarkerPosition(drawing)).toBeNull();
  });
});

/** jsdom has no PointerEvent constructor, so RTL's fireEvent
 * builds pointer events as plain Events and drops clientX/Y.
 * Dispatch MouseEvents under the pointer type names instead —
 * React keys its synthetic pointer handlers off the type string
 * (same pattern as satellite-map-wheel.test.tsx). */
function pointer(el: Element, type: string, init: MouseEventInit) {
  fireEvent(el, new MouseEvent(type, { bubbles: true, cancelable: true, ...init }));
}

const GEO = {
  addressLatitude: 25.9802,
  addressLongitude: -80.3995,
  originLatitude: 25.9802,
  originLongitude: -80.3995,
};

function drawingWithGeo(): Database["public"]["Tables"]["roof_drawings"]["Row"] {
  const geometry: RoofDrawing = { ...roofPreset("gable"), geo_reference: GEO };
  return {
    id: "drawing-1",
    geometry:
      geometry as unknown as Database["public"]["Tables"]["roof_drawings"]["Row"]["geometry"],
    media: [],
  } as unknown as Database["public"]["Tables"]["roof_drawings"]["Row"];
}

const report = {
  id: "report-1",
  title: "Roof measurement report",
  property_id: "property-1",
  address: "3062 SW 189th Ave, Miramar, FL 33029",
  notes: "",
  status: "received",
  created_at: "2026-11-27T12:00:00.000Z",
  customer_phone: "",
  customer_email: "",
} as unknown as RoofOrder;

function renderWorkspace() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <RoofMeasurements report={report} initialDrawing={drawingWithGeo()} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  aerialFetchMock.mockReset();
  signedUrlMock.mockReset();
  downloadMock.mockReset();
  uploadMock.mockReset();
  downloadMock.mockResolvedValue({ data: null, error: new Error("not cached") });
  uploadMock.mockResolvedValue({ error: null });
  signedUrlMock.mockResolvedValue({
    data: { signedUrl: "https://signed.example/aerial.jpg" },
    error: null,
  });
  aerialFetchMock.mockResolvedValue({
    imageBase64: btoa("fake-jpeg-bytes"),
    mime: "image/jpeg",
    source: "Test source",
    latitude: GEO.originLatitude,
    longitude: GEO.originLongitude,
  });
  URL.createObjectURL = vi.fn(() => "blob:aerial-photo");
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("RoofMeasurements 2D Plan rotation controls", () => {
  it("shows rotate controls only in the 2D Plan, steps by 15°, and resets to 0°", async () => {
    renderWorkspace();
    await screen.findByAltText("Aerial photo of this property");
    // Not in the photo view…
    expect(screen.queryByRole("button", { name: "Rotate plan by +15 degrees" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "2D Plan" }));
    const scene = await screen.findByTestId("roof-scene");
    expect(scene.dataset.planRotation).toBe("0");
    expect(screen.getByLabelText("Current plan rotation").textContent).toBe("0°");

    fireEvent.click(screen.getByRole("button", { name: "Rotate plan by +15 degrees" }));
    fireEvent.click(screen.getByRole("button", { name: "Rotate plan by +15 degrees" }));
    expect(scene.dataset.planRotation).toBe("30");
    expect(screen.getByLabelText("Current plan rotation").textContent).toBe("30°");

    fireEvent.click(screen.getByRole("button", { name: "Rotate plan by -15 degrees" }));
    expect(scene.dataset.planRotation).toBe("15");

    fireEvent.click(screen.getByRole("button", { name: "Reset plan rotation" }));
    expect(scene.dataset.planRotation).toBe("0");
    expect(screen.getByLabelText("Current plan rotation").textContent).toBe("0°");

    // …and not in the 3D view either.
    fireEvent.click(screen.getByRole("button", { name: "3D House" }));
    expect(screen.queryByRole("button", { name: "Rotate plan by +15 degrees" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reset plan rotation" })).toBeNull();
  });

  it("steps wrap past 180° instead of running away", async () => {
    renderWorkspace();
    await screen.findByAltText("Aerial photo of this property");
    fireEvent.click(screen.getByRole("button", { name: "2D Plan" }));
    await screen.findByTestId("roof-scene");
    const plus = screen.getByRole("button", { name: "Rotate plan by +15 degrees" });
    for (let i = 0; i < 13; i++) fireEvent.click(plus); // 13 × 15° = 195° → −165°
    expect(screen.getByTestId("roof-scene").dataset.planRotation).toBe("-165");
    expect(screen.getByLabelText("Current plan rotation").textContent).toBe("-165°");
  });

  it("drag mode rotates the plan by dragging around the viewport centre", async () => {
    renderWorkspace();
    await screen.findByAltText("Aerial photo of this property");
    fireEvent.click(screen.getByRole("button", { name: "2D Plan" }));
    await screen.findByTestId("roof-scene");
    expect(screen.queryByTestId("plan-rotate-overlay")).toBeNull();

    const toggle = screen.getByRole("button", { name: "Rotate plan by dragging" });
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    const overlay = screen.getByTestId("plan-rotate-overlay");
    vi.spyOn(overlay, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      width: 200,
      height: 200,
      right: 200,
      bottom: 200,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);

    // Grab east of centre (angle 0°), drag to north of centre (90°).
    pointer(overlay, "pointerdown", { clientX: 200, clientY: 100 });
    pointer(overlay, "pointermove", { clientX: 100, clientY: 0 });
    expect(Number(screen.getByTestId("roof-scene").dataset.planRotation)).toBeCloseTo(90);
    expect(screen.getByLabelText("Current plan rotation").textContent).toBe("90°");
    pointer(overlay, "pointerup", { clientX: 100, clientY: 0 });

    // Leaving the plan view turns drag mode back off.
    fireEvent.click(screen.getByRole("button", { name: "3D House" }));
    fireEvent.click(screen.getByRole("button", { name: "2D Plan" }));
    await screen.findByTestId("roof-scene");
    expect(screen.queryByTestId("plan-rotate-overlay")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Rotate plan by dragging" }).getAttribute("aria-pressed"),
    ).toBe("false");
    // The chosen rotation itself is kept for the session.
    expect(Number(screen.getByTestId("roof-scene").dataset.planRotation)).toBeCloseTo(90);
  });
});

describe("PLAN_ROTATION_STEP_DEG", () => {
  it("is 15 degrees", () => {
    expect(PLAN_ROTATION_STEP_DEG).toBe(15);
  });
});
