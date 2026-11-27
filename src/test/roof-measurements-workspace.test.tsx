import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RoofMeasurements } from "@/components/dashboard/RoofMeasurements";
import type { RoofOrder } from "@/components/dashboard/roof-orders-data";

// Guards for the simplified workspace (PR following #232/#236):
//  - the old system's manual "Download PDF" header button is gone;
//  - the property address is rendered exactly once (address-created
//    reports are titled by their address, and the header subtitle
//    used to print it a second time — the tab header printed it
//    twice more on top of that);
//  - the hands-off chain still runs end to end: an applied automatic
//    measurement saves, generates + attaches the report PDF, and
//    builds the automatic material list with its Takeoff PDF export.

const ADDRESS = "4311 SW 32nd Dr, West Park, FL 33023";

const saveDrawingMock = vi.fn(async (_input?: unknown) => ({ id: "drawing-2", revision: 2 }));
const attachPdfMock = vi.fn(async (_input?: unknown) => ({ id: "report-1" }));
const storageUploadMock = vi.fn(async (..._args: unknown[]) => ({ error: null }));

vi.mock("@tanstack/react-start", () => ({
  useServerFn: (fn: unknown) => fn,
}));

vi.mock("@/lib/report-aerial.functions", () => ({
  loadReportAerial: vi.fn(async () => ({ error: "no imagery in test", stage: "imagery" })),
}));

vi.mock("@/lib/roof-drawing.functions", () => ({
  saveRoofDrawing: (input: unknown) => saveDrawingMock(input),
}));

vi.mock("@/lib/roof-orders.functions", () => ({
  attachRoofOrderPdf: (input: unknown) => attachPdfMock(input),
}));

vi.mock("@/lib/roof-drawing-pdf", () => ({
  roofDrawingPdf: vi.fn(async () => new Uint8Array([37, 80, 68, 70])),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    storage: {
      from: () => ({
        createSignedUrl: vi.fn(async () => ({
          data: { signedUrl: "https://signed.example/aerial.jpg" },
          error: null,
        })),
        download: vi.fn(async () => ({ data: null, error: new Error("not stored in test") })),
        upload: storageUploadMock,
        remove: vi.fn(async () => ({ data: [], error: null })),
      }),
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: { updated_at: "2026-11-27T12:00:00.000Z" },
            error: null,
          }),
        }),
      }),
    }),
  },
}));

vi.mock("@/components/dashboard/foundation-data", () => ({
  propertiesQuery: {
    queryKey: ["properties"],
    queryFn: async () => [
      {
        id: "property-1",
        customer_id: "customer-1",
        address: "4311 SW 32nd Dr, West Park, FL 33023",
      },
    ],
  },
  customersQuery: {
    queryKey: ["customers"],
    queryFn: async () => [{ id: "customer-1", name: "West Park Owner", source_lead_id: "lead-1" }],
  },
}));

// Stands in for the automatic measurement: one click applies a
// measured gable drawing, exactly like a finished LiDAR run does.
vi.mock("@/components/dashboard/AutomatedRoofReport", async () => {
  const { createElement } = await import("react");
  const plane = (id: string, name: string, points: { x: number; y: number; z: number }[]) => ({
    id,
    name,
    points,
    edges: ["eave", "rake", "ridge", "rake"],
  });
  const detectedDrawing = {
    planes: [
      plane("front", "Front slope", [
        { x: 0, y: 0, z: 15 },
        { x: 40, y: 0, z: 15 },
        { x: 40, y: 7.5, z: 0 },
        { x: 0, y: 7.5, z: 0 },
      ]),
      plane("back", "Back slope", [
        { x: 40, y: 0, z: -15 },
        { x: 0, y: 0, z: -15 },
        { x: 0, y: 7.5, z: 0 },
        { x: 40, y: 7.5, z: 0 },
      ]),
    ],
    penetrations: [],
    waste: 10,
    roof_type: "Shingle Roof",
    notes: "",
    condition: "",
    verified: false,
  };
  return {
    AutomatedRoofReport: ({ onApply }: { onApply: (drawing: typeof detectedDrawing) => boolean }) =>
      createElement(
        "button",
        { onClick: () => onApply(detectedDrawing) },
        "Apply automatic measurement",
      ),
  };
});

vi.mock("@/components/dashboard/RoofScene", () => ({
  default: ({ view }: { view: string }) => <div data-testid="roof-scene">scene-{view}</div>,
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// An address-created report: its title IS the property address.
const report = {
  id: "report-1",
  title: ADDRESS,
  property_id: "property-1",
  address: ADDRESS,
  notes: "",
  status: "requested",
  created_at: "2026-11-27T12:00:00.000Z",
  customer_phone: "",
  customer_email: "",
  file_path: null,
} as unknown as RoofOrder;

function renderWorkspace() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <RoofMeasurements report={report} initialDrawing={null} />
    </QueryClientProvider>,
  );
}

function addressOccurrences(container: HTMLElement) {
  return (container.textContent ?? "").split(ADDRESS).length - 1;
}

beforeEach(() => {
  saveDrawingMock.mockClear();
  attachPdfMock.mockClear();
  storageUploadMock.mockClear();
  // Applying a measurement over the starter preset asks for
  // confirmation in the real UI; accept it here.
  vi.stubGlobal("confirm", () => true);
  URL.createObjectURL = vi.fn(() => "blob:test");
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("RoofMeasurements workspace header", () => {
  it("renders no Download PDF action and shows the address exactly once", async () => {
    const { container } = renderWorkspace();
    // The views still render.
    expect(
      screen
        .getAllByRole("button", { name: /^(House photo|3D House|2D Plan)$/ })
        .map((button) => button.textContent),
    ).toEqual(["House photo", "3D House", "2D Plan"]);
    // The old system's manual download is gone.
    expect(screen.queryByRole("button", { name: /Download PDF/i })).toBeNull();
    // The title is the address; the subtitle must not repeat it.
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe(ADDRESS);
    await waitFor(() => expect(addressOccurrences(container)).toBe(1));
  });

  it("still finishes hands-off: saves, attaches the report PDF, and builds the material list", async () => {
    const { container } = renderWorkspace();
    fireEvent.click(screen.getByRole("button", { name: "Apply automatic measurement" }));
    // The automatic chain runs without any further click.
    expect(await screen.findByText("Material list — generated automatically")).toBeTruthy();
    await waitFor(() => expect(saveDrawingMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(attachPdfMock).toHaveBeenCalledTimes(1));
    expect(attachPdfMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: "report-1",
        path: expect.stringMatching(/^roof-report\/report-1\//),
      }),
    });
    // The material list's own Takeoff PDF export survives.
    await waitFor(() => expect(screen.getByRole("button", { name: /Takeoff PDF/i })).toBeTruthy());
    // And still: no workspace Download PDF, address shown once.
    expect(screen.queryByRole("button", { name: /Download PDF/i })).toBeNull();
    expect(addressOccurrences(container)).toBe(1);
  });
});
