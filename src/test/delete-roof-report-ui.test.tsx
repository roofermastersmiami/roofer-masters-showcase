import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DeleteRoofReportButton } from "@/components/dashboard/DeleteRoofReport";

const deleteMock = vi.fn(async (_input: { data: { id: string } }) => ({
  id: "report-1",
  drawingsDeleted: 2,
  fileCleanupPending: false,
  drawingsCleanupPending: false,
}));

vi.mock("@/lib/roof-orders.functions", () => ({
  deleteRoofOrder: (input: { data: { id: string } }) => deleteMock(input),
}));

vi.mock("@tanstack/react-start", () => ({
  useServerFn: (fn: unknown) => fn,
}));

afterEach(() => {
  cleanup();
  deleteMock.mockClear();
});

function renderButton(onDeleted?: () => void) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <DeleteRoofReportButton
        reportId="report-1"
        address="4311 SW 32nd Dr, West Park, FL 33023"
        {...(onDeleted ? { onDeleted } : {})}
      />
    </QueryClientProvider>,
  );
}

describe("DeleteRoofReportButton", () => {
  it("shows a visible Delete button without any swipe or hover", () => {
    renderButton();
    expect(screen.getByRole("button", { name: /delete/i })).toBeTruthy();
  });

  it("confirms what will be removed, then calls deleteRoofOrder for that report", async () => {
    const onDeleted = vi.fn();
    renderButton(onDeleted);

    fireEvent.click(screen.getByRole("button", { name: /delete/i }));
    expect(await screen.findByText("Delete this roof report?")).toBeTruthy();
    expect(
      screen.getByText(/saved roof drawing revisions and measurements, and its generated PDF/),
    ).toBeTruthy();
    expect(screen.getByText(/customer and property records are kept/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Delete report" }));
    await waitFor(() => expect(deleteMock).toHaveBeenCalledTimes(1));
    expect(deleteMock).toHaveBeenCalledWith({ data: { id: "report-1" } });
    await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1));
  });

  it("does not delete when the confirmation is cancelled", async () => {
    renderButton();
    fireEvent.click(screen.getByRole("button", { name: /delete/i }));
    expect(await screen.findByText("Delete this roof report?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(deleteMock).not.toHaveBeenCalled();
  });
});
