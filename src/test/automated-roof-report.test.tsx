import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AutomatedRoofReport } from "@/components/dashboard/AutomatedRoofReport";

describe("AutomatedRoofReport automatic analysis", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_ROOF_DETECTION_API_URL", "");
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("uses the published Render service when no frontend environment override is configured", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({ detail: "Service temporarily unavailable" }),
    } as Response);

    render(<AutomatedRoofReport address="123 Main Street, Miami, FL" onApply={vi.fn()} />);

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "https://roofer-masters-roof-detection-w909.onrender.com/v1/roof/analyze",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ street_address: "123 Main Street, Miami, FL" }),
        }),
      );
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("Service temporarily unavailable");
  });

  it("starts analysis automatically when an address and service URL are available", async () => {
    vi.stubEnv("VITE_ROOF_DETECTION_API_URL", "https://roof-detection.example.com/");
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({ detail: "Service temporarily unavailable" }),
    } as Response);

    render(<AutomatedRoofReport address="456 Oak Avenue, Miami, FL" onApply={vi.fn()} />);

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "https://roof-detection.example.com/v1/roof/analyze",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ street_address: "456 Oak Avenue, Miami, FL" }),
        }),
      );
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("Service temporarily unavailable");
  });

  it("does not start an address analysis when no property address is selected", () => {
    render(<AutomatedRoofReport address=" " onApply={vi.fn()} />);
    expect(fetch).not.toHaveBeenCalled();
  });
});

const FOOTPRINT_ONLY_RESULT = {
  status: "footprint_only",
  verification: "unverified_public_data",
  matched_address: "123 Main Street, Miami, FL",
  location: { lat: 25.7, lon: -80.3 },
  footprint: {
    source: "Test footprints",
    area_sqft: 1200,
    polygon_geojson: {
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 1],
          [0, 0],
        ],
      ],
    },
  },
  roof: {
    facet_count: 0,
    area_sqft: null,
    total_squares: null,
    dominant_pitch_rise_per_12: null,
    facets: [],
    edge_lengths_lf: null,
  },
  fallback: {
    available: true,
    mode: "manual_pitch_and_facet_review",
    footprint_area_sqft: 1200,
    message: "No LiDAR coverage for this address.",
  },
  disclaimer: "Preliminary public-data result.",
};

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe("AutomatedRoofReport background job analysis", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_ROOF_DETECTION_API_URL", "https://roof-detection.example.com");
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("submits a background job and polls it to completion", async () => {
    const calls: string[] = [];
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (url.endsWith("/v1/roof/analyze/jobs")) {
        return jsonResponse(202, { job_id: "job-1", status: "queued" });
      }
      if (url.endsWith("/v1/roof/analyze/jobs/job-1")) {
        return jsonResponse(200, {
          job_id: "job-1",
          status: "complete",
          result: FOOTPRINT_ONLY_RESULT,
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    });

    render(<AutomatedRoofReport address="123 Main Street, Miami, FL" onApply={vi.fn()} />);

    expect(
      await screen.findByText("Footprint found; roof facets were not measurable"),
    ).toBeTruthy();
    expect(calls[0]).toBe("POST https://roof-detection.example.com/v1/roof/analyze/jobs");
  });

  it("resubmits automatically when the service loses the job (restart)", async () => {
    let submits = 0;
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/v1/roof/analyze/jobs") && init?.method === "POST") {
        submits += 1;
        return jsonResponse(202, { job_id: `job-${submits}`, status: "queued" });
      }
      if (url.endsWith("/v1/roof/analyze/jobs/job-1")) {
        return jsonResponse(404, {
          detail: { code: "job_not_found", message: "resubmit" },
        });
      }
      if (url.endsWith("/v1/roof/analyze/jobs/job-2")) {
        return jsonResponse(200, {
          job_id: "job-2",
          status: "complete",
          result: FOOTPRINT_ONLY_RESULT,
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    });

    render(<AutomatedRoofReport address="123 Main Street, Miami, FL" onApply={vi.fn()} />);

    expect(
      await screen.findByText("Footprint found; roof facets were not measurable"),
    ).toBeTruthy();
    expect(submits).toBe(2);
  });

  it("shows live download progress while the job runs", async () => {
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/v1/roof/analyze/jobs") && init?.method === "POST") {
        return jsonResponse(202, { job_id: "job-1", status: "queued" });
      }
      if (url.endsWith("/v1/roof/analyze/jobs/job-1")) {
        return jsonResponse(200, {
          job_id: "job-1",
          status: "running",
          stage: "downloading_tiles",
          detail: "Downloading USGS LiDAR tiles — 42 MB of 178 MB",
          download_fraction: 0.24,
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    });

    render(<AutomatedRoofReport address="123 Main Street, Miami, FL" onApply={vi.fn()} />);

    expect(await screen.findByText(/Downloading USGS LiDAR tiles — 42 MB of 178 MB/)).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("24%");
  });
});
