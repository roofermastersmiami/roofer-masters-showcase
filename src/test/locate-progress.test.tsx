import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocateProgressIndicator, useLocateProgress } from "@/components/dashboard/LocateProgress";

function deferred() {
  let resolve!: () => void;
  let reject!: (cause?: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = () => res();
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Mirrors the order dialog's locate flow: start in the geocoding
 * phase, advance to the building phase once the address resolves,
 * complete when the building lookup lands, cancel on any failure. */
function LocateHarness({
  geocode,
  snap,
}: {
  geocode: () => Promise<void>;
  snap: () => Promise<void>;
}) {
  const progress = useLocateProgress();
  async function run() {
    progress.start("geocoding");
    try {
      await geocode();
      progress.advance("building");
      await snap();
      progress.complete();
    } catch {
      progress.cancel();
    }
  }
  return (
    <div>
      <button type="button" onClick={() => void run()}>
        Locate
      </button>
      {progress.state && <LocateProgressIndicator state={progress.state} />}
    </div>
  );
}

function shownPercent(): number {
  const status = screen.getByRole("status");
  const match = status.textContent?.match(/(\d+)%/);
  if (!match) throw new Error(`No percentage in: ${status.textContent ?? ""}`);
  return Number(match[1]);
}

describe("Locate progress in the order dialog flow", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows the percentage and bar while the locate is pending, advances phases, then clears after 100%", async () => {
    const geocode = deferred();
    const snap = deferred();
    render(<LocateHarness geocode={() => geocode.promise} snap={() => snap.promise} />);

    fireEvent.click(screen.getByRole("button", { name: "Locate" }));
    // Pending in the first phase: label, a percentage and a bar.
    expect(screen.getByText("Finding the address…")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    const initial = shownPercent();
    expect(initial).toBeLessThan(40);

    // The number visibly moves while the step is still in flight.
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(shownPercent()).toBeGreaterThan(initial);

    // Address found: the phase label switches to the building lookup
    // and the percent never drops below where phase one left it.
    const beforeAdvance = shownPercent();
    await act(async () => {
      geocode.resolve();
    });
    expect(screen.getByText("Finding the building on the map…")).toBeInTheDocument();
    expect(shownPercent()).toBeGreaterThanOrEqual(beforeAdvance);

    // Building lookup lands: exactly 100%, briefly, then gone.
    await act(async () => {
      snap.resolve();
    });
    expect(shownPercent()).toBe(100);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("clears immediately when the locate fails — no stuck percentage", async () => {
    const geocode = deferred();
    render(
      <LocateHarness geocode={() => geocode.promise} snap={() => new Promise<void>(() => {})} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Locate" }));
    expect(screen.getByRole("status")).toBeInTheDocument();

    await act(async () => {
      geocode.reject(new Error("lookup failed"));
    });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });
});
