import { useEffect, useRef, useState } from "react";
import { MapPin } from "lucide-react";
import {
  SATELLITE_MAX_VIEW_ZOOM,
  SATELLITE_MIN_ZOOM,
  SATELLITE_TILE_PX,
  latLonAtViewportOffset,
  projectToViewport,
  satelliteLabelTiles,
  satelliteMapTiles,
  satelliteTileZoom,
  satelliteUpscale,
  type LatLon,
} from "@/lib/satellite-map";

export type SatelliteMapPin = LatLon & { id: number };

type DragState = {
  kind: "pan" | "pin";
  pinId: number | null;
  startX: number;
  startY: number;
  dx: number;
  dy: number;
  moved: boolean;
};

/**
 * Interactive satellite map for the measurement-order form: a
 * mosaic of Esri World Imagery tiles with the Esri reference label
 * overlays (street names, places) on top — see
 * src/lib/satellite-map.ts for why tiles replaced the MapServer
 * export image. Interactions follow the order-form model Fredy
 * asked for: drag to pan, scroll to zoom, click the map to drop a
 * pin on another structure, drag a pin to move it onto the correct
 * building, double-click a pin to remove it. Each pin's final
 * coordinates steer that building's measurement.
 */
export function SatelliteMap({
  center,
  zoom,
  pins,
  label,
  onZoomChange,
  onCenterChange,
  onPinMove,
  onMapClick,
  onPinDoubleClick,
}: {
  center: LatLon;
  zoom: number;
  pins: SatelliteMapPin[];
  label: string;
  onZoomChange?: (zoom: number) => void;
  onCenterChange?: (center: LatLon) => void;
  onPinMove?: (id: number, point: LatLon) => void;
  onMapClick?: (point: LatLon) => void;
  onPinDoubleClick?: (id: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 960, height: 560 });
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const centerRef = useRef(center);
  centerRef.current = center;
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const callbacksRef = useRef({ onCenterChange, onPinMove, onMapClick });
  callbacksRef.current = { onCenterChange, onPinMove, onMapClick };
  const dragRef = useRef<DragState | null>(null);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });

  // The tile layer overscans the visible frame by two tiles on
  // every side so a pan drag never exposes an unpainted edge before
  // the drag commits a new centre.
  const layerWidth = size.width + SATELLITE_TILE_PX * 4;
  const layerHeight = size.height + SATELLITE_TILE_PX * 4;
  // Deep zoom (the Sketch Editor's PR #233 pattern): Esri serves
  // no tiles past z20, so past that the z20 mosaic is fetched for
  // the proportionally smaller viewport it has to cover and
  // upscaled on screen. Pins and pointer math below keep using
  // the VIEW zoom's exact Mercator projection, so a pin dropped
  // at z24 lands on the precise lat/lon under the cursor.
  const tileZoom = satelliteTileZoom(zoom);
  const upscale = satelliteUpscale(zoom);
  const tiles = satelliteMapTiles(
    center.lat,
    center.lon,
    tileZoom,
    layerWidth / upscale,
    layerHeight / upscale,
  );
  const labelLayers = satelliteLabelTiles(
    center.lat,
    center.lon,
    tileZoom,
    layerWidth / upscale,
    layerHeight / upscale,
  );

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) setSize({ width: rect.width, height: rect.height });
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry && entry.contentRect.width > 0 && entry.contentRect.height > 0)
        setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Mouse-wheel / Magic Mouse scroll zoom (and trackpad pinch,
  // which browsers deliver as ctrlKey wheel events), kept from the
  // original map fix: a native listener with passive: false,
  // because React's synthetic wheel listener is passive at the root
  // and cannot preventDefault the dialog scrolling behind the map.
  const onZoomChangeRef = useRef(onZoomChange);
  onZoomChangeRef.current = onZoomChange;
  const scrollAccumRef = useRef(0);
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const stepZoom = (direction: 1 | -1) => {
      const next = Math.min(
        SATELLITE_MAX_VIEW_ZOOM,
        Math.max(SATELLITE_MIN_ZOOM, zoomRef.current + direction),
      );
      if (next !== zoomRef.current) {
        zoomRef.current = next;
        onZoomChangeRef.current?.(next);
      }
    };
    const handleWheel = (event: WheelEvent) => {
      if (!onZoomChangeRef.current) return;
      event.preventDefault();
      // Normalise line/page-mode deltas (Firefox) to pixels.
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1;
      scrollAccumRef.current += event.deltaY * unit;
      // A Magic Mouse emits many tiny deltas and a mouse wheel a
      // few large ones; accumulate until a step is earned so both
      // feel smooth. Pinch gestures (ctrlKey) send rapid small
      // deltas, so they earn steps faster.
      const threshold = event.ctrlKey ? 12 : 60;
      while (scrollAccumRef.current <= -threshold) {
        scrollAccumRef.current += threshold;
        stepZoom(1);
      }
      while (scrollAccumRef.current >= threshold) {
        scrollAccumRef.current -= threshold;
        stepZoom(-1);
      }
    };
    element.addEventListener("wheel", handleWheel, { passive: false });
    return () => element.removeEventListener("wheel", handleWheel);
  }, []);

  /** Lat/lon under a pointer event, via the viewport-centre frame. */
  function pointAtPointer(event: React.PointerEvent): LatLon {
    const element = containerRef.current;
    const rect = element?.getBoundingClientRect();
    const width = rect && rect.width > 0 ? rect.width : sizeRef.current.width;
    const height = rect && rect.height > 0 ? rect.height : sizeRef.current.height;
    const offsetX = event.clientX - (rect?.left ?? 0) - width / 2;
    const offsetY = event.clientY - (rect?.top ?? 0) - height / 2;
    return latLonAtViewportOffset(centerRef.current, zoomRef.current, offsetX, offsetY);
  }

  function handlePointerDown(event: React.PointerEvent) {
    if (event.button !== 0) return;
    const pinElement = (event.target as HTMLElement).closest<HTMLElement>("[data-pin-id]");
    const pinId = pinElement ? Number(pinElement.dataset["pinId"]) : null;
    dragRef.current = {
      kind: pinId === null || Number.isNaN(pinId) ? "pan" : "pin",
      pinId,
      startX: event.clientX,
      startY: event.clientY,
      dx: 0,
      dy: 0,
      moved: false,
    };
    try {
      containerRef.current?.setPointerCapture(event.pointerId);
    } catch {
      // Capture only smooths fast drags; the handlers still work
      // without it (and some test DOMs do not implement it).
    }
  }

  function handlePointerMove(event: React.PointerEvent) {
    const drag = dragRef.current;
    if (!drag) return;
    drag.dx = event.clientX - drag.startX;
    drag.dy = event.clientY - drag.startY;
    if (Math.abs(drag.dx) + Math.abs(drag.dy) > 4) drag.moved = true;
    if (drag.kind === "pan") {
      if (drag.moved) setPanOffset({ x: drag.dx, y: drag.dy });
    } else if (drag.pinId !== null) {
      callbacksRef.current.onPinMove?.(drag.pinId, pointAtPointer(event));
    }
  }

  function handlePointerUp(event: React.PointerEvent) {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) return;
    if (drag.kind === "pan") {
      setPanOffset({ x: 0, y: 0 });
      if (!drag.moved) {
        // A click (not a drag) on the map drops the next pin.
        callbacksRef.current.onMapClick?.(pointAtPointer(event));
      } else if (drag.dx !== 0 || drag.dy !== 0) {
        // Content follows the pointer, so the centre moves the
        // opposite way by the drag distance.
        callbacksRef.current.onCenterChange?.(
          latLonAtViewportOffset(centerRef.current, zoomRef.current, -drag.dx, -drag.dy),
        );
      }
    }
  }

  function handlePointerCancel() {
    dragRef.current = null;
    setPanOffset({ x: 0, y: 0 });
  }

  return (
    <div
      ref={containerRef}
      role="img"
      aria-label={label}
      className="absolute inset-0 cursor-grab touch-none select-none overflow-hidden active:cursor-grabbing"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
    >
      <div
        className="pointer-events-none absolute left-1/2 top-1/2"
        style={{
          width: layerWidth,
          height: layerHeight,
          transform: `translate(-50%, -50%) translate(${panOffset.x}px, ${panOffset.y}px)`,
        }}
      >
        {tiles.map((tile) => (
          <img
            key={tile.key}
            src={tile.src}
            alt=""
            draggable={false}
            className="absolute max-w-none"
            style={{
              left: tile.left * upscale,
              top: tile.top * upscale,
              width: SATELLITE_TILE_PX * upscale,
              height: SATELLITE_TILE_PX * upscale,
            }}
          />
        ))}
        {labelLayers.flatMap((layerTiles) =>
          layerTiles.map((tile) => (
            <img
              key={tile.key}
              src={tile.src}
              alt=""
              draggable={false}
              className="absolute max-w-none"
              style={{
                left: tile.left * upscale,
                top: tile.top * upscale,
                width: SATELLITE_TILE_PX * upscale,
                height: SATELLITE_TILE_PX * upscale,
              }}
            />
          )),
        )}
      </div>
      {pins.map((pin) => {
        const offset = projectToViewport(pin, center, zoom);
        return (
          <button
            key={pin.id}
            type="button"
            data-pin-id={pin.id}
            aria-label={`Building pin ${pin.id + 1} — drag to move, double-click to remove`}
            title={`Building ${pin.id + 1} — drag to move, double-click to remove`}
            className="absolute z-10 h-10 w-10 cursor-move"
            style={{
              left: size.width / 2 + offset.x + panOffset.x,
              top: size.height / 2 + offset.y + panOffset.y,
              transform: "translate(-50%, -100%)",
            }}
            onDoubleClick={() => onPinDoubleClick?.(pin.id)}
          >
            <MapPin className="h-10 w-10 fill-red-600 text-white drop-shadow-lg" />
            <span className="pointer-events-none absolute inset-x-0 top-[7px] text-center text-[11px] font-bold leading-none text-white">
              {pin.id + 1}
            </span>
          </button>
        );
      })}
    </div>
  );
}
