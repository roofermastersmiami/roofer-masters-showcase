import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  HousePhotoView,
  NAIP_AERIAL_SOURCE_LABEL,
  WorkspaceViewTabs,
  defaultWorkspaceView,
  type WorkspaceView,
} from "@/components/dashboard/HousePhotoView";
import { RoofMeasurements } from "@/components/dashboard/RoofMeasurements";
import { roofPreset, type RoofDrawing } from "@/lib/roof-geometry";
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
  default: ({ view }: { view: string }) => <div data-testid="roof-scene">scene-{view}</div>,
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const GEO = {
  addressLatitude: 25.9802,
  addressLongitude: -80.3995,
  originLatitude: 25.9802,
  originLongitude: -80.3995,
};

function drawingWithGeo(media: unknown = []): Database["public"]["Tables"]["roof_drawings"]["Row"] {
  const geometry: RoofDrawing = { ...roofPreset("gable"), geo_reference: GEO };
  return {
    id: "drawing-1",
    geometry:
      geometry as unknown as Database["public"]["Tables"]["roof_drawings"]["Row"]["geometry"],
    media: media as Database["public"]["Tables"]["roof_drawings"]["Row"]["media"],
  } as Database["public"]["Tables"]["roof_drawings"]["Row"];
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

function renderWorkspace(initialDrawing: ReturnType<typeof drawingWithGeo>) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <RoofMeasurements report={report} initialDrawing={initialDrawing} />
    </QueryClientProvider>,
  );
}

function tabOrder() {
  return screen
    .getAllByRole("button", { name: /^(House photo|3D House|2D Plan)$/ })
    .map((button) => button.textContent);
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
  URL.createObjectURL = vi.fn(() => "blob:aerial-photo");
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("WorkspaceViewTabs", () => {
  it("renders House photo, 3D House, 2D Plan in that order and reports picks", () => {
    const onChange = vi.fn();
    let view: WorkspaceView = "photo";
    const { rerender } = render(
      <WorkspaceViewTabs
        view={view}
        onChange={(next) => {
          onChange(next);
          view = next;
          rerender(<WorkspaceViewTabs view={view} onChange={onChange} />);
        }}
      />,
    );
    expect(tabOrder()).toEqual(["House photo", "3D House", "2D Plan"]);
    expect(screen.getByRole("button", { name: "House photo" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    fireEvent.click(screen.getByRole("button", { name: "2D Plan" }));
    expect(onChange).toHaveBeenCalledWith("plan");
    expect(screen.getByRole("button", { name: "2D Plan" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
  });
});

describe("defaultWorkspaceView", () => {
  it("opens on the house photo unless no photo is available", () => {
    expect(defaultWorkspaceView("loading")).toBe("photo");
    expect(defaultWorkspaceView("ready")).toBe("photo");
    expect(defaultWorkspaceView("unavailable")).toBe("3d");
  });
});

describe("HousePhotoView", () => {
  it("shows the photo with its source caption", () => {
    render(
      <HousePhotoView
        photo={{ status: "ready", url: "blob:photo", source: NAIP_AERIAL_SOURCE_LABEL }}
        zoomDirection="in"
        zoomKey={0}
        fitKey={0}
      />,
    );
    const img = screen.getByAltText("Aerial photo of this property") as HTMLImageElement;
    expect(img.src).toContain("blob:photo");
    expect(screen.getByText(/USDA National Agriculture Imagery Program \(NAIP\)/)).toBeTruthy();
  });

  it("shows an honest empty state when no photo is available", () => {
    render(
      <HousePhotoView
        photo={{ status: "unavailable" }}
        zoomDirection="in"
        zoomKey={0}
        fitKey={0}
      />,
    );
    expect(screen.getByText(/No aerial photo available for this property/)).toBeTruthy();
    expect(screen.queryByAltText("Aerial photo of this property")).toBeNull();
  });

  it("zooms with the toolbar zoom signal and resets on fit", () => {
    const view = (zoomKey: number, fitKey: number, direction: "in" | "out" = "in") => (
      <HousePhotoView
        photo={{ status: "ready", url: "blob:photo", source: "Test source" }}
        zoomDirection={direction}
        zoomKey={zoomKey}
        fitKey={fitKey}
      />
    );
    const { rerender } = render(view(0, 0));
    const img = screen.getByAltText("Aerial photo of this property");
    expect(img.style.transform).toContain("scale(1)");
    rerender(view(1, 0));
    expect(img.style.transform).toContain("scale(1.3)");
    rerender(view(1, 1));
    expect(img.style.transform).toContain("scale(1)");
  });
});

describe("RoofMeasurements workspace views", () => {
  it("opens on the House photo fetched like the report cover, and caches it with the report", async () => {
    aerialFetchMock.mockResolvedValue({
      imageBase64: btoa("fake-jpeg-bytes"),
      mime: "image/jpeg",
      source: NAIP_AERIAL_SOURCE_LABEL,
      latitude: GEO.originLatitude,
      longitude: GEO.originLongitude,
    });
    renderWorkspace(drawingWithGeo());
    expect(tabOrder()).toEqual(["House photo", "3D House", "2D Plan"]);
    const img = (await screen.findByAltText("Aerial photo of this property")) as HTMLImageElement;
    expect(img.src).toContain("blob:aerial-photo");
    expect(screen.getByRole("button", { name: "House photo" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(aerialFetchMock).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(uploadMock).toHaveBeenCalledWith(
        "roof-report/report-1/aerial-cover.jpg",
        expect.anything(),
        expect.objectContaining({ upsert: true }),
      ),
    );
    // The drawing views are one click away, in order.
    fireEvent.click(screen.getByRole("button", { name: "3D House" }));
    expect(await screen.findByTestId("roof-scene")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "2D Plan" }));
    expect(screen.getByTestId("roof-scene").textContent).toBe("scene-plan");
  });

  it("prefers a stored aerial saved with the drawing over a fresh fetch", async () => {
    renderWorkspace(
      drawingWithGeo([
        {
          path: "roof-media/property-1/aerial.png",
          name: "Property aerial",
          category: "aerial",
          source: "USGS National Map NAIP imagery",
          latitude: GEO.originLatitude,
          longitude: GEO.originLongitude,
        },
      ]),
    );
    const img = (await screen.findByAltText("Aerial photo of this property")) as HTMLImageElement;
    expect(img.src).toBe("https://signed.example/aerial.jpg");
    expect(aerialFetchMock).not.toHaveBeenCalled();
  });

  it("falls back to the 3D house when no aerial photo is available, and says so on the photo tab", async () => {
    aerialFetchMock.mockResolvedValue({
      error: "USGS NAIP imagery returned HTTP 404.",
      stage: "imagery",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    renderWorkspace(drawingWithGeo());
    // Default view moves off the photo on its own…
    expect(await screen.findByTestId("roof-scene")).toBeTruthy();
    expect(screen.getByRole("button", { name: "3D House" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    // …and the photo tab shows the honest empty state, never a blank box.
    fireEvent.click(screen.getByRole("button", { name: "House photo" }));
    expect(await screen.findByText(/No aerial photo available for this property/)).toBeTruthy();
  });
});
