import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { MapPin, Minus, MousePointer2, Plus, RotateCcw, Search, Satellite } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { planeInfo, type RoofPlane, type Point } from "@/lib/roof-geometry";

type GeocodeResult = { lat: string; lon: string; display_name: string };
type TracePoint = { lat: number; lon: number };

const MAP_WIDTH = 1024;
const MAP_HEIGHT = 640;
const TILE_SPAN = 0.0015;
const METERS_TO_FEET = 1 / 0.3048;

export function nextSatelliteZoom(current: number, direction: "in" | "out"): number {
  const factor = direction === "in" ? 1.5 : 1 / 1.5;
  return Math.max(0.5, Math.min(8, Number((current * factor).toFixed(3))));
}

export function satelliteTraceToPlane(points: TracePoint[], pitch: number): RoofPlane {
  if (points.length < 3 || points.length > 100) {
    throw new Error("A roof trace needs between 3 and 100 corners.");
  }
  if (!Number.isFinite(pitch) || pitch < 0 || pitch > 24) {
    throw new Error("Roof pitch must be between 0:12 and 24:12.");
  }
  if (points.some((p) => !Number.isFinite(p.lat) || !Number.isFinite(p.lon) || Math.abs(p.lat) > 90 || Math.abs(p.lon) > 180)) {
    throw new Error("The trace contains an invalid map coordinate.");
  }
  const unique = new Set(points.map((p) => `${p.lat.toFixed(8)},${p.lon.toFixed(8)}`));
  if (unique.size !== points.length) {
    throw new Error("Each roof corner must be in a different location.");
  }
  const lat0 = points.reduce((sum, p) => sum + p.lat, 0) / points.length;
  const lon0 = points.reduce((sum, p) => sum + p.lon, 0) / points.length;
  const cos = Math.cos((lat0 * Math.PI) / 180);
  // The map projection produces meters, but the roof geometry engine stores feet.
  const local = points.map((p) => ({
    x: (p.lon - lon0) * 111320 * cos * METERS_TO_FEET,
    z: (lat0 - p.lat) * 110540 * METERS_TO_FEET,
  }));
  const minZ = Math.min(...local.map((p) => p.z));
  const vertices: Point[] = local.map((p) => ({
    x: p.x,
    z: p.z,
    y: 10 + ((p.z - minZ) * pitch) / 12,
  }));
  const plane: RoofPlane = {
    id: `satellite-${globalThis.crypto?.randomUUID?.() ?? Date.now()}`,
    name: "Satellite traced roof plane",
    points: vertices,
    // A traced polygon does not reveal which sides are eaves, rakes, or ridges.
    // Keep them unclassified until a user verifies each edge in the measurement editor.
    edges: vertices.map(() => "other"),
  };
  // Reject crossed, collapsed, or otherwise non-planar outlines before they enter the drawing.
  planeInfo(plane);
  return plane;
}

export function SatelliteRoofTrace({
  onAdd,
  initialAddress = "",
}: {
  onAdd: (plane: RoofPlane) => void;
  initialAddress?: string;
}) {
  const [address, setAddress] = useState("");
  const [location, setLocation] = useState<GeocodeResult | null>(null);
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [points, setPoints] = useState<TracePoint[]>([]);
  const [pitch, setPitch] = useState("6");
  const [zoom, setZoom] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const initialLookupStarted = useRef(false);
  const skipNextAddressSearch = useRef(false);
  const draggingPoint = useRef<number | null>(null);
  const suppressNextMapClick = useRef(false);
  const center = location ? { lat: Number(location.lat), lon: Number(location.lon) } : null;
  const bounds = useMemo(
    () =>
      center
        ? {
            west: center.lon - TILE_SPAN / zoom,
            east: center.lon + TILE_SPAN / zoom,
            south: center.lat - (TILE_SPAN * 0.7) / zoom,
            north: center.lat + (TILE_SPAN * 0.7) / zoom,
          }
        : null,
    [center, zoom],
  );
  const imageryUrl = bounds
    ? `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export?bbox=${bounds.west},${bounds.south},${bounds.east},${bounds.north}&bboxSR=4326&imageSR=4326&size=${MAP_WIDTH},${MAP_HEIGHT}&format=jpg&f=image`
    : "";

  useEffect(() => {
    if (skipNextAddressSearch.current) {
      skipNextAddressSearch.current = false;
      setResults([]);
      return;
    }
    if (!address.trim()) {
      setResults([]);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(
          `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&q=${encodeURIComponent(address)}`,
          { signal: controller.signal, headers: { Accept: "application/json" } },
        );
        if (!response.ok) throw new Error("Address search is temporarily unavailable");
        setResults((await response.json()) as GeocodeResult[]);
      } catch (e) {
        if (!(e instanceof DOMException && e.name === "AbortError"))
          setError("Could not search this address. Try again.");
      }
    }, 1100);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [address]);

  function selectLocation(result: GeocodeResult) {
    skipNextAddressSearch.current = true;
    setLocation(result);
    setAddress(result.display_name);
    setResults([]);
    setPoints([]);
    setZoom(1);
    setError("");
  }
  useEffect(() => {
    const query = initialAddress.trim();
    if (!query || initialLookupStarted.current) return;
    initialLookupStarted.current = true;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(
          `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(query)}`,
          { signal: controller.signal, headers: { Accept: "application/json" } },
        );
        if (!response.ok) throw new Error("Address lookup unavailable");
        const matches = (await response.json()) as GeocodeResult[];
        if (matches[0]) selectLocation(matches[0]);
        else
          setError("No map location was found for this report address. Search it manually below.");
      } catch (e) {
        if (!(e instanceof DOMException && e.name === "AbortError"))
          setError(
            "Could not locate the report address on the satellite map. Search it manually below.",
          );
      }
    })();
    return () => controller.abort();
  }, [initialAddress]);
  function tracePointFromPointer(clientX: number, clientY: number, rect: DOMRect): TracePoint | null {
    if (!bounds || rect.width <= 0 || rect.height <= 0) return null;
    const x = ((clientX - rect.left) / rect.width) * MAP_WIDTH;
    const y = ((clientY - rect.top) / rect.height) * MAP_HEIGHT;
    return {
      lon: bounds.west + (x / MAP_WIDTH) * (bounds.east - bounds.west),
      lat: bounds.north - (y / MAP_HEIGHT) * (bounds.north - bounds.south),
    };
  }
  function addMapPoint(event: MouseEvent<SVGSVGElement>) {
    if (suppressNextMapClick.current) {
      suppressNextMapClick.current = false;
      return;
    }
    const point = tracePointFromPointer(
      event.clientX,
      event.clientY,
      event.currentTarget.getBoundingClientRect(),
    );
    if (point) setPoints((current) => [...current, point]);
  }
  const polygon = points
    .map((p) => {
      if (!bounds) return "";
      return `${((p.lon - bounds.west) / (bounds.east - bounds.west)) * MAP_WIDTH},${((bounds.north - p.lat) / (bounds.north - bounds.south)) * MAP_HEIGHT}`;
    })
    .join(" ");
  const canAdd =
    points.length >= 3 &&
    Number.isFinite(Number(pitch)) &&
    Number(pitch) >= 0 &&
    Number(pitch) <= 24;

  return (
    <section className="space-y-3 rounded-xl border border-border p-4">
      <div className="flex items-center gap-2">
        <Satellite className="h-5 w-5 text-primary" />
        <div>
          <h3 className="font-semibold">Free satellite roof tracing</h3>
          <p className="text-xs text-muted-foreground">
            Search an address, trace the roof outline, and add it to this measurement
          </p>
        </div>
      </div>
      <div className="relative flex gap-2">
        <Input
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="Enter property address"
          aria-label="Property address"
        />
        <Button
          type="button"
          variant="outline"
          disabled={!results.length}
          onClick={() => selectLocation(results[0]!)}
        >
          <Search className="h-4 w-4" /> Use first match
        </Button>
      </div>
      {results.length > 0 && (
        <div className="max-h-40 overflow-auto rounded-md border border-border">
          {results.map((result) => (
            <button
              type="button"
              key={`${result.lat},${result.lon}`}
              className="block w-full border-b border-border p-2 text-left text-sm hover:bg-muted"
              onClick={() => selectLocation(result)}
            >
              {result.display_name}
            </button>
          ))}
        </div>
      )}
      {location && bounds && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">Zoom: {zoom.toFixed(zoom < 1 ? 2 : 1)}×</p>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={zoom <= 0.5}
                onClick={() => setZoom((value) => nextSatelliteZoom(value, "out"))}
                aria-label="Zoom out"
              >
                <Minus className="h-4 w-4" /> Zoom out
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={zoom >= 8}
                onClick={() => setZoom((value) => nextSatelliteZoom(value, "in"))}
                aria-label="Zoom in"
              >
                <Plus className="h-4 w-4" /> Zoom in
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={zoom === 1}
                onClick={() => setZoom(1)}
              >
                Reset zoom
              </Button>
            </div>
          </div>
          <div className="overflow-hidden rounded-lg border border-border bg-muted">
            <svg
              viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`}
              className="block aspect-[8/5] w-full cursor-crosshair touch-none"
              onClick={addMapPoint}
              onPointerMove={(event) => {
                const index = draggingPoint.current;
                if (index === null) return;
                const point = tracePointFromPointer(
                  event.clientX,
                  event.clientY,
                  event.currentTarget.getBoundingClientRect(),
                );
                if (point) setPoints((current) => current.map((item, i) => i === index ? point : item));
              }}
              onPointerUp={() => {
                if (draggingPoint.current !== null) {
                  draggingPoint.current = null;
                  suppressNextMapClick.current = true;
                }
              }}
              onPointerCancel={() => {
                draggingPoint.current = null;
                suppressNextMapClick.current = true;
              }}
              onWheel={(event) => {
                event.preventDefault();
                setZoom((value) => nextSatelliteZoom(value, event.deltaY < 0 ? "in" : "out"));
              }}
              onDoubleClick={(event) => {
                event.preventDefault();
                setZoom((value) => nextSatelliteZoom(value, "in"));
              }}
              role="img"
              aria-label="Satellite image. Click around the roof to trace its outline."
            >
              <image
                href={imageryUrl}
                x="0"
                y="0"
                width={MAP_WIDTH}
                height={MAP_HEIGHT}
                preserveAspectRatio="none"
              />
              {center && bounds && (
                <g
                  transform={`translate(${((center.lon - bounds.west) / (bounds.east - bounds.west)) * MAP_WIDTH},${((bounds.north - center.lat) / (bounds.north - bounds.south)) * MAP_HEIGHT})`}
                  pointerEvents="none"
                >
                  <path
                    d="M0 24 C-4 16 -18 4 -18 -7 A18 18 0 1 1 18 -7 C18 4 4 16 0 24Z"
                    fill="#dc2626"
                    stroke="white"
                    strokeWidth="3"
                  />
                  <circle cx="0" cy="-7" r="5" fill="white" />
                  <text
                    x="24"
                    y="-12"
                    fill="white"
                    stroke="#111827"
                    strokeWidth="4"
                    paintOrder="stroke"
                    fontSize="18"
                    fontWeight="700"
                  >
                    Address
                  </text>
                </g>
              )}
              {points.length > 2 && (
                <polygon
                  points={polygon}
                  fill="#0ea5e9"
                  fillOpacity="0.22"
                  stroke="#38bdf8"
                  strokeWidth="4"
                />
              )}
              {points.map((point, index) => (
                <circle
                  key={index}
                  onPointerDown={(event) => {
                    event.stopPropagation();
                    event.preventDefault();
                    draggingPoint.current = index;
                    event.currentTarget.ownerSVGElement?.setPointerCapture(event.pointerId);
                  }}
                  className="cursor-move"
                  cx={((point.lon - bounds.west) / (bounds.east - bounds.west)) * MAP_WIDTH}
                  cy={((bounds.north - point.lat) / (bounds.north - bounds.south)) * MAP_HEIGHT}
                  r="9"
                  fill="#f97316"
                  stroke="white"
                  strokeWidth="3"
                />
              ))}
              <text
                x="16"
                y="30"
                fill="white"
                stroke="#111827"
                strokeWidth="4"
                paintOrder="stroke"
                fontSize="20"
              >
                Click roof corners to trace · {points.length} points
              </text>
            </svg>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-sm">
              Roof pitch (rise / 12)
              <Input
                type="number"
                min="0"
                max="24"
                value={pitch}
                onChange={(e) => setPitch(e.target.value)}
                className="mt-1 w-28"
              />
            </label>
            <Button
              type="button"
              variant="outline"
              onClick={() => setPoints((current) => current.slice(0, -1))}
              disabled={!points.length}
            >
              <RotateCcw className="h-4 w-4" /> Undo point
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setPoints([])}
              disabled={!points.length}
            >
              Clear trace
            </Button>
            <Button
              type="button"
              disabled={!canAdd || busy}
              onClick={() => {
                setBusy(true);
                try {
                  onAdd(satelliteTraceToPlane(points, Number(pitch)));
                  setPoints([]);
                } catch {
                  setError("Could not convert this outline into a roof plane.");
                } finally {
                  setBusy(false);
                }
              }}
            >
              <MapPin className="h-4 w-4" /> Add traced plane
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Imagery: Esri World Imagery. Address lookup: OpenStreetMap Nominatim. Click corners in
            order around one roof plane.
          </p>
        </>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {!location && (
        <p className="text-xs text-muted-foreground">
          <MousePointer2 className="mr-1 inline h-3 w-3" />
          Select an address result to load the satellite view. This trace is an estimate and must be
          checked against field measurements.
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        Map data © Esri, Maxar, Earthstar Geographics, and the GIS User Community. © OpenStreetMap
        contributors.
      </p>
    </section>
  );
}
