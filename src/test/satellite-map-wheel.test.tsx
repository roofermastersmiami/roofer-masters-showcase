import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SatelliteMap } from "@/components/dashboard/SatelliteMap";

// 4311 SW 32nd Dr, West Park, FL 33023 (the bug-report address).
const LAT = 25.979306;
const LON = -80.186822;

afterEach(cleanup);

function renderMap(zoom: number, onZoomChange = vi.fn()) {
  const utils = render(
    <SatelliteMap
      latitude={LAT}
      longitude={LON}
      zoom={zoom}
      label="Satellite map"
      onZoomChange={onZoomChange}
    />,
  );
  return { ...utils, onZoomChange, map: screen.getByRole("img", { name: "Satellite map" }) };
}

describe("SatelliteMap wheel zoom", () => {
  it("zooms in on scroll up and prevents the page scrolling instead", () => {
    const { map, onZoomChange } = renderMap(19);
    const notPrevented = fireEvent.wheel(map, { deltaY: -100 });
    expect(onZoomChange).toHaveBeenCalledTimes(1);
    expect(onZoomChange).toHaveBeenCalledWith(20);
    // dispatchEvent returns false when a cancelable event was
    // preventDefaulted — the dialog behind the map must not scroll.
    expect(notPrevented).toBe(false);
  });

  it("zooms out on scroll down", () => {
    const { map, onZoomChange } = renderMap(19);
    fireEvent.wheel(map, { deltaY: 100 });
    expect(onZoomChange).toHaveBeenCalledTimes(1);
    expect(onZoomChange).toHaveBeenCalledWith(18);
  });

  it("accumulates small Magic Mouse deltas before stepping", () => {
    const { map, onZoomChange } = renderMap(19);
    fireEvent.wheel(map, { deltaY: -30 });
    expect(onZoomChange).not.toHaveBeenCalled();
    fireEvent.wheel(map, { deltaY: -30 });
    expect(onZoomChange).toHaveBeenCalledTimes(1);
    expect(onZoomChange).toHaveBeenCalledWith(20);
  });

  it("never zooms past the same bounds as the + / − buttons", () => {
    const atMax = renderMap(20);
    fireEvent.wheel(atMax.map, { deltaY: -200 });
    expect(atMax.onZoomChange).not.toHaveBeenCalled();
    cleanup();
    const atMin = renderMap(17);
    fireEvent.wheel(atMin.map, { deltaY: 200 });
    expect(atMin.onZoomChange).not.toHaveBeenCalled();
  });

  it("treats trackpad pinch (ctrlKey wheel) as zoom", () => {
    const { map, onZoomChange } = renderMap(19);
    fireEvent.wheel(map, { deltaY: -30, ctrlKey: true });
    expect(onZoomChange).toHaveBeenCalledWith(20);
  });

  it("does not zoom or block scrolling when no handler is attached", () => {
    render(<SatelliteMap latitude={LAT} longitude={LON} zoom={19} label="Satellite map" />);
    const map = screen.getByRole("img", { name: "Satellite map" });
    expect(fireEvent.wheel(map, { deltaY: -100 })).toBe(true);
  });
});
