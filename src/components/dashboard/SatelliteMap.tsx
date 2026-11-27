import { useEffect, useRef } from "react";
import {
  SATELLITE_MAX_ZOOM,
  SATELLITE_MIN_ZOOM,
  SATELLITE_TILE_PX,
  SATELLITE_VIEW_HEIGHT,
  SATELLITE_VIEW_WIDTH,
  satelliteMapTiles,
} from "@/lib/satellite-map";

/**
 * Satellite view for the "Confirm building location" step: a
 * mosaic of Esri World Imagery tiles (see src/lib/satellite-map.ts
 * for why tiles replaced the MapServer export image) centred
 * exactly on the address point, so the pin overlay in the parent
 * stays on the property at every zoom.
 */
export function SatelliteMap({
  latitude,
  longitude,
  zoom,
  label,
  onZoomChange,
}: {
  latitude: number;
  longitude: number;
  zoom: number;
  label: string;
  /** Enables mouse-wheel / Magic Mouse scroll zoom (and trackpad
   * pinch, which browsers deliver as ctrlKey wheel events) between
   * SATELLITE_MIN_ZOOM and SATELLITE_MAX_ZOOM. The layout is
   * centre-based, so the address point — and the pin on it — stays
   * centred at every zoom. */
  onZoomChange?: (zoom: number) => void;
}) {
  const tiles = satelliteMapTiles(latitude, longitude, zoom);
  const layerRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const onZoomChangeRef = useRef(onZoomChange);
  onZoomChangeRef.current = onZoomChange;
  const scrollAccumRef = useRef(0);

  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    const stepZoom = (direction: 1 | -1) => {
      const next = Math.min(
        SATELLITE_MAX_ZOOM,
        Math.max(SATELLITE_MIN_ZOOM, zoomRef.current + direction),
      );
      if (next !== zoomRef.current) {
        zoomRef.current = next;
        onZoomChangeRef.current?.(next);
      }
    };
    const handleWheel = (event: WheelEvent) => {
      if (!onZoomChangeRef.current) return;
      // Stop the dialog/page scrolling behind the map. React's
      // synthetic wheel listener is passive at the root, so this
      // must be a native listener registered with passive: false.
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
    layer.addEventListener("wheel", handleWheel, { passive: false });
    return () => layer.removeEventListener("wheel", handleWheel);
  }, []);

  return (
    <div
      ref={layerRef}
      role="img"
      aria-label={label}
      className="absolute left-1/2 top-1/2"
      style={{
        width: SATELLITE_VIEW_WIDTH,
        height: SATELLITE_VIEW_HEIGHT,
        transform: "translate(-50%, -50%)",
      }}
    >
      {tiles.map((tile) => (
        <img
          key={tile.key}
          src={tile.src}
          alt=""
          draggable={false}
          className="absolute max-w-none select-none"
          style={{
            left: tile.left,
            top: tile.top,
            width: SATELLITE_TILE_PX,
            height: SATELLITE_TILE_PX,
          }}
        />
      ))}
    </div>
  );
}
