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

  it("shows a clear setup error when automatic analysis has no service URL", async () => {
    render(<AutomatedRoofReport address="123 Main Street, Miami, FL" onApply={vi.fn()} />);

    expect(
      await screen.findByRole("alert"),
    ).toHaveTextContent("The free roof-detection service is not connected");
    expect(fetch).not.toHaveBeenCalled();
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
