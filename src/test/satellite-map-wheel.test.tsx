import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SatelliteMap, type SatelliteMapPin } from "@/components/dashboard/SatelliteMap";
import { latLonAtViewportOffset } from "@/lib/satellite-map";

// 4311 SW 32nd Dr, West Park, FL 33023 (the bug-report address).
const LAT = 25.979306;
const LON = -80.186822;
const CENTER = { lat: LAT, lon: LON };

// Deterministic viewport for the pointer math: jsdom reports a
// 0×0 box, so the component falls back to the size this stub
// reports (800×600) — its centre is (400, 300).
class ResizeObserverStub {
  constructor(private callback: ResizeObserverCallback) {}
  observe() {
    this.callback(
      [{ contentRect: { width: 800, height: 600 } } as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    );
  }
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** jsdom has no PointerEvent constructor, so RTL's fireEvent
 * builds pointer events as plain Events and drops clientX/button.
 * Dispatch MouseEvents under the pointer type names instead —
 * React keys its synthetic pointer handlers off the type string. */
function pointer(el: Element, type: string, init: MouseEventInit) {
  fireEvent(el, new MouseEvent(type, { bubbles: true, cancelable: true, ...init }));
}

function renderMap({
  zoom = 19,
  pins = [] as SatelliteMapPin[],
  onZoomChange = vi.fn(),
  onCenterChange = vi.fn(),
  onPinMove = vi.fn(),
  onMapClick = vi.fn(),
  onPinDoubleClick = vi.fn(),
} = {}) {
  const utils = render(
    <SatelliteMap
      center={CENTER}
      zoom={zoom}
      pins={pins}
      label="Satellite map"
      onZoomChange={onZoomChange}
      onCenterChange={onCenterChange}
      onPinMove={onPinMove}
      onMapClick={onMapClick}
      onPinDoubleClick={onPinDoubleClick}
    />,
  );
  return {
    ...utils,
    onZoomChange,
    onCenterChange,
    onPinMove,
    onMapClick,
    onPinDoubleClick,
    map: screen.getByRole("img", { name: "Satellite map" }),
  };
}

describe("SatelliteMap wheel zoom", () => {
  it("zooms in on scroll up and prevents the page scrolling instead", () => {
    const { map, onZoomChange } = renderMap();
    const notPrevented = fireEvent.wheel(map, { deltaY: -100 });
    expect(onZoomChange).toHaveBeenCalledTimes(1);
    expect(onZoomChange).toHaveBeenCalledWith(20);
    // dispatchEvent returns false when a cancelable event was
    // preventDefaulted — the dialog behind the map must not scroll.
    expect(notPrevented).toBe(false);
  });

  it("zooms out on scroll down", () => {
    const { map, onZoomChange } = renderMap();
    fireEvent.wheel(map, { deltaY: 100 });
    expect(onZoomChange).toHaveBeenCalledTimes(1);
    expect(onZoomChange).toHaveBeenCalledWith(18);
  });

  it("accumulates small Magic Mouse deltas before stepping", () => {
    const { map, onZoomChange } = renderMap();
    fireEvent.wheel(map, { deltaY: -30 });
    expect(onZoomChange).not.toHaveBeenCalled();
    fireEvent.wheel(map, { deltaY: -30 });
    expect(onZoomChange).toHaveBeenCalledTimes(1);
    expect(onZoomChange).toHaveBeenCalledWith(20);
  });

  it("never zooms past the same bounds as the + / − buttons", () => {
    const atMax = renderMap({ zoom: 24 });
    fireEvent.wheel(atMax.map, { deltaY: -200 });
    expect(atMax.onZoomChange).not.toHaveBeenCalled();
    cleanup();
    const atMin = renderMap({ zoom: 17 });
    fireEvent.wheel(atMin.map, { deltaY: 200 });
    expect(atMin.onZoomChange).not.toHaveBeenCalled();
  });

  it("zooms past the last real tile level, up to z24", () => {
    const { map, onZoomChange } = renderMap({ zoom: 20 });
    fireEvent.wheel(map, { deltaY: -100 });
    expect(onZoomChange).toHaveBeenCalledTimes(1);
    expect(onZoomChange).toHaveBeenCalledWith(21);
    cleanup();
    const deepest = renderMap({ zoom: 23 });
    fireEvent.wheel(deepest.map, { deltaY: -100 });
    expect(deepest.onZoomChange).toHaveBeenCalledWith(24);
  });

  it("treats trackpad pinch (ctrlKey wheel) as zoom", () => {
    const { map, onZoomChange } = renderMap();
    fireEvent.wheel(map, { deltaY: -30, ctrlKey: true });
    expect(onZoomChange).toHaveBeenCalledWith(20);
  });

  it("does not zoom or block scrolling when no handler is attached", () => {
    render(<SatelliteMap center={CENTER} zoom={19} pins={[]} label="Satellite map" />);
    const map = screen.getByRole("img", { name: "Satellite map" });
    expect(fireEvent.wheel(map, { deltaY: -100 })).toBe(true);
  });
});

describe("SatelliteMap pan, click-to-drop and pins", () => {
  it("drops a pin where the map is clicked", () => {
    const { map, onMapClick, onCenterChange } = renderMap();
    pointer(map, "pointerdown", { clientX: 400, clientY: 300, button: 0 });
    pointer(map, "pointerup", { clientX: 400, clientY: 300, button: 0 });
    expect(onMapClick).toHaveBeenCalledTimes(1);
    const point = onMapClick.mock.calls[0]?.[0] as { lat: number; lon: number };
    expect(point.lat).toBeCloseTo(LAT, 6);
    expect(point.lon).toBeCloseTo(LON, 6);
    expect(onCenterChange).not.toHaveBeenCalled();
  });

  it("pans instead of dropping a pin when the map is dragged", () => {
    const { map, onMapClick, onCenterChange } = renderMap();
    pointer(map, "pointerdown", { clientX: 400, clientY: 300, button: 0 });
    pointer(map, "pointermove", { clientX: 500, clientY: 300, button: 0 });
    pointer(map, "pointerup", { clientX: 500, clientY: 300, button: 0 });
    expect(onMapClick).not.toHaveBeenCalled();
    expect(onCenterChange).toHaveBeenCalledTimes(1);
    const next = onCenterChange.mock.calls[0]?.[0] as { lat: number; lon: number };
    // Dragging the imagery east moves the centre west.
    expect(next.lon).toBeLessThan(LON);
    expect(next.lat).toBeCloseTo(LAT, 6);
  });

  it("renders numbered pins and drags a pin to a new building", () => {
    const pins: SatelliteMapPin[] = [{ id: 0, lat: LAT, lon: LON }];
    const { onPinMove, onMapClick } = renderMap({ pins });
    const pin = screen.getByRole("button", { name: /Building pin 1/ });
    expect(pin.textContent).toContain("1");
    pointer(pin, "pointerdown", { clientX: 400, clientY: 300, button: 0 });
    pointer(pin, "pointermove", { clientX: 500, clientY: 300, button: 0 });
    pointer(pin, "pointerup", { clientX: 500, clientY: 300, button: 0 });
    expect(onPinMove).toHaveBeenCalled();
    const [id, point] = onPinMove.mock.calls.at(-1) as [number, { lat: number; lon: number }];
    expect(id).toBe(0);
    expect(point.lon).toBeGreaterThan(LON);
    expect(point.lat).toBeCloseTo(LAT, 6);
    // Dragging a pin never drops another pin.
    expect(onMapClick).not.toHaveBeenCalled();
  });

  it("removes a pin on double-click", () => {
    const pins: SatelliteMapPin[] = [{ id: 0, lat: LAT, lon: LON }];
    const { onPinDoubleClick } = renderMap({ pins });
    fireEvent.doubleClick(screen.getByRole("button", { name: /Building pin 1/ }));
    expect(onPinDoubleClick).toHaveBeenCalledWith(0);
  });
});

describe("SatelliteMap deep zoom (z21–z24)", () => {
  it("never requests tiles past z20 and draws them upscaled", () => {
    const { container } = renderMap({ zoom: 24 });
    const images = [...container.querySelectorAll("img")];
    expect(images.length).toBeGreaterThan(0);
    for (const img of images) {
      expect(img.getAttribute("src")).toContain("/tile/20/");
      expect(img.getAttribute("src")).not.toMatch(/\/tile\/2[1-9]\//);
    }
    // Imagery tiles are drawn at 256 * 2^(24-20) = 4096px: the
    // z20 mosaic upscaled to the z24 frame.
    const imagery = images.find((img) => img.getAttribute("src")?.includes("World_Imagery"));
    expect(imagery?.style.width).toBe("4096px");
    expect(imagery?.style.height).toBe("4096px");
  });

  it("drops a pin on the exact lat/lon under the cursor at z24", () => {
    const { map, onMapClick } = renderMap({ zoom: 24 });
    // Stub viewport is 800×600 with centre (400, 300): click
    // 100px east of centre.
    pointer(map, "pointerdown", { clientX: 500, clientY: 300, button: 0 });
    pointer(map, "pointerup", { clientX: 500, clientY: 300, button: 0 });
    expect(onMapClick).toHaveBeenCalledTimes(1);
    const point = onMapClick.mock.calls[0]?.[0] as { lat: number; lon: number };
    const expected = latLonAtViewportOffset(CENTER, 24, 100, 0);
    expect(point.lat).toBeCloseTo(expected.lat, 9);
    expect(point.lon).toBeCloseTo(expected.lon, 9);
    // The same 100px click at z20 lands 16x farther east — the
    // pin math follows the view zoom, never the tile zoom.
    const atTileZoom = latLonAtViewportOffset(CENTER, 20, 100, 0);
    expect(point.lon - LON).toBeCloseTo((atTileZoom.lon - LON) / 16, 9);
  });

  it("drags a pin by view-zoom math at z24", () => {
    const pins: SatelliteMapPin[] = [{ id: 0, lat: LAT, lon: LON }];
    const { onPinMove } = renderMap({ zoom: 24, pins });
    const pin = screen.getByRole("button", { name: /Building pin 1/ });
    pointer(pin, "pointerdown", { clientX: 400, clientY: 300, button: 0 });
    pointer(pin, "pointermove", { clientX: 500, clientY: 260, button: 0 });
    pointer(pin, "pointerup", { clientX: 500, clientY: 260, button: 0 });
    expect(onPinMove).toHaveBeenCalled();
    const [id, point] = onPinMove.mock.calls.at(-1) as [number, { lat: number; lon: number }];
    expect(id).toBe(0);
    const expected = latLonAtViewportOffset(CENTER, 24, 100, -40);
    expect(point.lat).toBeCloseTo(expected.lat, 9);
    expect(point.lon).toBeCloseTo(expected.lon, 9);
  });
});
