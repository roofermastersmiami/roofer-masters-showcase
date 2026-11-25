import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  MapPin,
  Minus,
  MousePointer2,
  Plus,
  RotateCcw,
  Search,
  Satellite,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  planeInfo,
  type RoofPlane,
  type Point,
  type GeoReference,
  type EdgeType,
} from "@/lib/roof-geometry";

type GeocodeResult = { lat: string; lon: string; display_name: string };
type PitchDirection = "north" | "south" | "east" | "west";
type TracePoint = { lat: number; lon: number };
type OSMBuildingWay = {
  type?: string;
  geometry?: Array<{ lat: number; lon: number }>;
  tags?: Record<string, string>;
};

export function nearestBuildingFootprint(
  elements: OSMBuildingWay[],
  center: TracePoint,
): TracePoint[] | null {
  if (
    !Number.isFinite(center.lat) ||
    !Number.isFinite(center.lon) ||
    Math.abs(center.lat) > 90 ||
    Math.abs(center.lon) > 180
  )
    return null;
  const metersPerLatDegree = 110540;
  const metersPerLonDegree = 111320 * Math.cos((center.lat * Math.PI) / 180);
  const candidates = elements.flatMap((element) => {
    if (element.type !== "way" || !Array.isArray(element.geometry)) return [];
    const ring = element.geometry.map(({ lat, lon }) => ({ lat, lon }));
    if (
      ring.length > 3 &&
      ring[0]?.lat === ring[ring.length - 1]?.lat &&
      ring[0]?.lon === ring[ring.length - 1]?.lon
    )
      ring.pop();
    if (
      ring.length < 3 ||
      ring.length > 200 ||
      ring.some(
        (point) =>
          !Number.isFinite(point.lat) ||
          !Number.isFinite(point.lon) ||
          Math.abs(point.lat) > 90 ||
          Math.abs(point.lon) > 180,
      )
    )
      return [];
    if (new Set(ring.map((point) => `${point.lat.toFixed(7)},${point.lon.toFixed(7)}`)).size < 3)
      return [];

    // Rank a footprint containing the geocoded address ahead of nearby
    // neighboring buildings; centroid-only ranking can select the wrong lot.
    let inside = false;
    let minimumEdgeDistance = Number.POSITIVE_INFINITY;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      const a = ring[j]!;
      const b = ring[i]!;
      const ax = (a.lon - center.lon) * metersPerLonDegree;
      const ay = (a.lat - center.lat) * metersPerLatDegree;
      const bx = (b.lon - center.lon) * metersPerLonDegree;
      const by = (b.lat - center.lat) * metersPerLatDegree;
      const dx = bx - ax;
      const dy = by - ay;
      const lengthSquared = dx * dx + dy * dy;
      const t =
        lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lengthSquared));
      minimumEdgeDistance = Math.min(minimumEdgeDistance, Math.hypot(ax + t * dx, ay + t * dy));
      const crossesLatitude = a.lat > center.lat !== b.lat > center.lat;
      if (
        crossesLatitude &&
        center.lon < ((b.lon - a.lon) * (center.lat - a.lat)) / (b.lat - a.lat) + a.lon
      )
        inside = !inside;
    }
    const distance = inside ? 0 : minimumEdgeDistance;
    return distance <= 50 ? [{ ring, distance, containsAddress: inside }] : [];
  });
  // Never guess the nearest neighboring building when the target is on a
  // street, driveway, or open space. The user must place the target inside
  // the intended building footprint before automatic tracing can proceed.
  candidates.sort((a, b) => a.distance - b.distance);
  return candidates.find((candidate) => candidate.containsAddress)?.ring ?? null;
}

const MAP_WIDTH = 2048;
const MAP_HEIGHT = 1280;
const TILE_SPAN = 0.0015;
const METERS_TO_FEET = 1 / 0.3048;

export function nextSatelliteZoom(current: number, direction: "in" | "out"): number {
  const factor = direction === "in" ? 1.4 : 1 / 1.4;
  return Math.max(0.5, Math.min(64, Number((current * factor).toFixed(3))));
}

export function zoomSatelliteByPinch(
  startZoom: number,
  startDistance: number,
  currentDistance: number,
): number {
  if (
    ![startZoom, startDistance, currentDistance].every(Number.isFinite) ||
    startZoom <= 0 ||
    startDistance <= 0 ||
    currentDistance <= 0
  ) {
    throw new Error("Valid pinch zoom measurements are required.");
  }
  return Math.max(
    0.5,
    Math.min(64, Number((startZoom * (currentDistance / startDistance)).toFixed(3))),
  );
}

export function panSatelliteCenter(
  center: TracePoint,
  direction: "north" | "south" | "east" | "west",
  zoom: number,
): TracePoint {
  if (
    !Number.isFinite(center.lat) ||
    !Number.isFinite(center.lon) ||
    !Number.isFinite(zoom) ||
    zoom <= 0 ||
    Math.abs(center.lat) > 90 ||
    Math.abs(center.lon) > 180
  )
    throw new Error("A valid map center and zoom are required.");
  const step = (TILE_SPAN / zoom) * 0.4;
  const latitudeStep = step * 0.7;
  return {
    lat: Math.max(
      -85,
      Math.min(
        85,
        center.lat +
          (direction === "north" ? latitudeStep : direction === "south" ? -latitudeStep : 0),
      ),
    ),
    lon: Math.max(
      -180,
      Math.min(180, center.lon + (direction === "east" ? step : direction === "west" ? -step : 0)),
    ),
  };
}

export function satelliteTraceToPlane(
  points: TracePoint[],
  pitch: number,
  direction: PitchDirection = "south",
): RoofPlane {
  if (points.length < 3 || points.length > 100) {
    throw new Error("A roof trace needs between 3 and 100 corners.");
  }
  if (!Number.isFinite(pitch) || pitch < 0 || pitch > 24) {
    throw new Error("Roof pitch must be between 0:12 and 24:12.");
  }
  if (
    points.some(
      (p) =>
        !Number.isFinite(p.lat) ||
        !Number.isFinite(p.lon) ||
        Math.abs(p.lat) > 90 ||
        Math.abs(p.lon) > 180,
    )
  ) {
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
  const riseAt = (p: { x: number; z: number }) =>
    direction === "north" ? -p.z : direction === "south" ? p.z : direction === "east" ? p.x : -p.x;
  const minRise = Math.min(...local.map(riseAt));
  const vertices: Point[] = local.map((p) => ({
    x: p.x,
    z: p.z,
    y: 10 + ((riseAt(p) - minRise) * pitch) / 12,
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

export type RidgeAxis = "north-south" | "east-west";

/**
 * Split a traced building outline into two candidate gable facets using a
 * centerline selected by ridge direction. Only simple outlines intersected
 * exactly twice are accepted; every generated facet is validated as planar.
 */
export function satelliteTraceToGablePlanes(
  points: TracePoint[],
  pitch: number,
  ridgeAxis: RidgeAxis,
  ridgeOffsetPercent = 0,
  ridgeAngleDegrees = 0,
): RoofPlane[] {
  if (points.length < 4 || points.length > 100) {
    throw new Error("A gable trace needs at least four boundary corners.");
  }
  if (!Number.isFinite(pitch) || pitch <= 0 || pitch > 24) {
    throw new Error("Gable pitch must be greater than 0:12 and no more than 24:12.");
  }
  // Reuse the single-plane validator for coordinate, duplicate, and outline checks.
  satelliteTraceToPlane(points, 0);
  const lat0 = points.reduce((sum, p) => sum + p.lat, 0) / points.length;
  const lon0 = points.reduce((sum, p) => sum + p.lon, 0) / points.length;
  const cos = Math.cos((lat0 * Math.PI) / 180);
  const local = points.map((p) => ({
    x: (p.lon - lon0) * 111320 * cos * METERS_TO_FEET,
    z: (lat0 - p.lat) * 110540 * METERS_TO_FEET,
  }));
  if (!Number.isFinite(ridgeOffsetPercent) || ridgeOffsetPercent < -40 || ridgeOffsetPercent > 40) {
    throw new Error("Ridge offset must be between -40% and 40%.");
  }
  if (!Number.isFinite(ridgeAngleDegrees) || ridgeAngleDegrees < -30 || ridgeAngleDegrees > 30) {
    throw new Error("Ridge angle must be between -30 and 30 degrees.");
  }
  // Project onto the ridge normal so the ridge can rotate off cardinal axes.
  const angle = (ridgeAngleDegrees * Math.PI) / 180;
  const baseNormal = ridgeAxis === "north-south" ? { x: 1, z: 0 } : { x: 0, z: 1 };
  const normal = {
    x: baseNormal.x * Math.cos(angle) - baseNormal.z * Math.sin(angle),
    z: baseNormal.x * Math.sin(angle) + baseNormal.z * Math.cos(angle),
  };
  const project = (p: { x: number; z: number }) => p.x * normal.x + p.z * normal.z;
  const projections = local.map(project);
  const projectionMin = Math.min(...projections);
  const projectionMax = Math.max(...projections);
  const projectionSpan = projectionMax - projectionMin;
  if (projectionSpan <= 0.001)
    throw new Error("The traced outline is too narrow for this ridge direction.");
  // Bounding midpoint is stable when users add extra trace points along one edge.
  const centerAxis =
    (projectionMin + projectionMax) / 2 + (projectionSpan * ridgeOffsetPercent) / 100;
  const tolerance = 0.00001;
  const expanded: { x: number; z: number }[] = [];
  for (let i = 0; i < local.length; i++) {
    const a = local[i]!;
    const b = local[(i + 1) % local.length]!;
    if (
      !expanded.length ||
      Math.hypot(expanded[expanded.length - 1]!.x - a.x, expanded[expanded.length - 1]!.z - a.z) >
        tolerance
    )
      expanded.push(a);
    const da = project(a) - centerAxis;
    const db = project(b) - centerAxis;
    if (Math.abs(da) <= tolerance && Math.abs(db) <= tolerance) {
      throw new Error("The selected ridge direction overlaps a roof boundary edge.");
    }
    if (da * db < -tolerance * tolerance) {
      const t = da / (da - db);
      expanded.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
    }
  }
  const intersections = expanded
    .map((p, index) => ({ p, index }))
    .filter(({ p }) => Math.abs(project(p) - centerAxis) <= tolerance);
  if (intersections.length !== 2) {
    throw new Error(
      "This ridge direction must cross the outline at exactly two points. Try the other direction or adjust the trace.",
    );
  }
  const [first, second] = intersections;
  if (!first || !second || first.index === second.index) {
    throw new Error("Could not create two distinct gable facets from this outline.");
  }
  const pathBetween = (start: number, end: number) => {
    const path: { x: number; z: number }[] = [];
    for (
      let index = start, count = 0;
      count <= expanded.length;
      index = (index + 1) % expanded.length, count++
    ) {
      path.push(expanded[index]!);
      if (index === end) break;
    }
    return path;
  };
  const paths = [pathBetween(first.index, second.index), pathBetween(second.index, first.index)];
  if (paths.some((path) => path.length < 3)) {
    throw new Error("The ridge split creates a collapsed roof facet.");
  }
  // Keep facet order stable on either side of the selected ridge.
  paths.sort(
    (a, b) =>
      a.reduce((sum, point) => sum + project(point), 0) / a.length -
      b.reduce((sum, point) => sum + project(point), 0) / b.length,
  );
  const maxDistance = Math.max(...expanded.map((p) => Math.abs(project(p) - centerAxis)));
  const ridgeHeight = 10 + (maxDistance * pitch) / 12;
  const makePlane = (path: { x: number; z: number }[], index: number): RoofPlane => {
    const vertices: Point[] = path.map((p) => ({
      x: p.x,
      z: p.z,
      y: ridgeHeight - (Math.abs(project(p) - centerAxis) * pitch) / 12,
    }));
    const plane: RoofPlane = {
      id: `satellite-gable-${index}-${globalThis.crypto?.randomUUID?.() ?? Date.now()}`,
      name:
        Math.abs(ridgeAngleDegrees) > 0.001
          ? `Gable facet ${index + 1}`
          : ridgeAxis === "north-south"
            ? path.reduce((sum, point) => sum + project(point), 0) / path.length < centerAxis
              ? "West gable facet"
              : "East gable facet"
            : path.reduce((sum, point) => sum + project(point), 0) / path.length < centerAxis
              ? "North gable facet"
              : "South gable facet",
      points: vertices,
      edges: vertices.map((_, edgeIndex) =>
        edgeIndex === vertices.length - 1 ? "ridge" : "other",
      ),
    };
    planeInfo(plane);
    return plane;
  };
  return paths.map(makePlane);
}

export function SatelliteRoofTrace({
  onAdd,
  initialAddress = "",
}: {
  onAdd: (planes: RoofPlane[], geoReference: GeoReference) => boolean | void;
  initialAddress?: string;
}) {
  const [address, setAddress] = useState("");
  const [location, setLocation] = useState<GeocodeResult | null>(null);
  const [targetLocation, setTargetLocation] = useState<TracePoint | null>(null);
  const [mapCenter, setMapCenter] = useState<TracePoint | null>(null);
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [points, setPoints] = useState<TracePoint[]>([]);
  const [pitch, setPitch] = useState("6");
  const [drawingMode, setDrawingMode] = useState<"outline" | "diy">("outline");
  const [planeName, setPlaneName] = useState("Roof plane 1");
  const [edgeTypes, setEdgeTypes] = useState<EdgeType[]>([]);
  const [pitchDirection, setPitchDirection] = useState<PitchDirection>("south");
  const [ridgeAxis, setRidgeAxis] = useState<RidgeAxis>("north-south");
  const [ridgeOffsetPercent, setRidgeOffsetPercent] = useState(0);
  const [ridgeAngleDegrees, setRidgeAngleDegrees] = useState(0);
  const [zoom, setZoom] = useState(18);
  const [mapInteraction, setMapInteraction] = useState<"draw" | "pan">("draw");
  const mapPanStart = useRef<{ x: number; y: number; center: TracePoint } | null>(null);
  const [mapViewportElement, setMapViewportElement] = useState<HTMLDivElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [autoTraceBusy, setAutoTraceBusy] = useState(false);
  const [autoTraced, setAutoTraced] = useState(false);
  const [selectedBuildingCenter, setSelectedBuildingCenter] = useState<TracePoint | null>(null);
  const [error, setError] = useState("");
  const [imageryLoadError, setImageryLoadError] = useState(false);
  const lastInitialAddress = useRef("");
  const skipNextAddressSearch = useRef(false);
  const draggingPoint = useRef<number | null>(null);
  const draggingTarget = useRef(false);
  const targetLocationRef = useRef<TracePoint | null>(null);
  const suppressNextMapClick = useRef(false);
  const pinchStartDistance = useRef<number | null>(null);
  const pinchStartZoom = useRef(1);
  const center = location ? { lat: Number(location.lat), lon: Number(location.lon) } : null;
  const bounds = useMemo(
    () =>
      mapCenter
        ? {
            west: mapCenter.lon - TILE_SPAN / zoom,
            east: mapCenter.lon + TILE_SPAN / zoom,
            south: mapCenter.lat - (TILE_SPAN * 0.7) / zoom,
            north: mapCenter.lat + (TILE_SPAN * 0.7) / zoom,
          }
        : null,
    [mapCenter, zoom],
  );
  useEffect(() => {
    const viewport = mapViewportElement;
    if (!viewport) return;
    // Native non-passive listener is required: browsers may otherwise scroll
    // the document instead of allowing the map to consume the wheel gesture.
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (Math.abs(event.deltaY) < 1) return;
      setZoom((value) => nextSatelliteZoom(value, event.deltaY < 0 ? "in" : "out"));
    };
    viewport.addEventListener("wheel", handleWheel, { passive: false });
    return () => viewport.removeEventListener("wheel", handleWheel);
  }, [mapViewportElement]);

  const imageryUrl = bounds
    ? `https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export?bbox=${bounds.west},${bounds.south},${bounds.east},${bounds.north}&bboxSR=4326&imageSR=4326&size=${MAP_WIDTH},${MAP_HEIGHT}&format=jpg&f=image`
    : "";

  useEffect(() => {
    setImageryLoadError(false);
  }, [imageryUrl]);

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
    const addressPoint = { lat: Number(result.lat), lon: Number(result.lon) };
    targetLocationRef.current = addressPoint;
    setTargetLocation(addressPoint);
    setMapCenter(addressPoint);
    setPoints([]);
    setSelectedBuildingCenter(null);
    setAutoTraced(false);
    setAddress(result.display_name);
    setResults([]);
    setPoints([]);
    setAutoTraced(false);
    setZoom(18);
    setError("");
  }
  useEffect(() => {
    const query = initialAddress.trim();
    if (query === lastInitialAddress.current) return;
    lastInitialAddress.current = query;

    // The roof workspace can stay mounted while the selected property changes.
    // Clear the previous property's pin and trace immediately so they cannot be
    // mistaken for the newly selected address while geocoding is in flight.
    setLocation(null);
    targetLocationRef.current = null;
    setTargetLocation(null);
    setMapCenter(null);
    setPoints([]);
    setAutoTraced(false);
    setResults([]);
    setZoom(1);
    setError("");
    skipNextAddressSearch.current = Boolean(query);
    setAddress(query);
    if (!query) return;

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
  function tracePointFromPointer(
    clientX: number,
    clientY: number,
    rect: DOMRect,
  ): TracePoint | null {
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
    if (point) {
      setAutoTraced(false);
      setPoints((current) => [...current, point]);
      setEdgeTypes((current) => [...current, "other"]);
    }
  }
  async function autoTraceBuildingFootprint() {
    if (!location) return;
    setAutoTraceBusy(true);
    setError("");
    try {
      const searchTarget = targetLocationRef.current ?? {
        lat: Number(location.lat),
        lon: Number(location.lon),
      };
      const lat = searchTarget.lat,
        lon = searchTarget.lon;
      const query = `[out:json][timeout:20];way(around:50,${lat},${lon})["building"];out tags geom;`;
      // Public Overpass instances occasionally throttle or go offline. Try a
      // second community endpoint before asking the estimator to trace manually.
      const endpoints = [
        "https://overpass-api.de/api/interpreter",
        "https://overpass.kumi.systems/api/interpreter",
      ];
      let elements: OSMBuildingWay[] | null = null;
      for (const endpoint of endpoints) {
        try {
          const response = await fetch(`${endpoint}?data=${encodeURIComponent(query)}`, {
            headers: { Accept: "application/json" },
          });
          if (!response.ok) continue;
          const data = (await response.json()) as { elements?: OSMBuildingWay[] };
          if (Array.isArray(data.elements)) {
            elements = data.elements;
            break;
          }
        } catch {
          // Continue to the next free public endpoint.
        }
      }
      if (!elements) throw new Error("OpenStreetMap building lookup failed");
      const footprint = nearestBuildingFootprint(elements, { lat, lon });
      if (!footprint) throw new Error("No nearby mapped building outline was found");
      const footprintCenter = {
        lat: footprint.reduce((sum, point) => sum + point.lat, 0) / footprint.length,
        lon: footprint.reduce((sum, point) => sum + point.lon, 0) / footprint.length,
      };
      setPoints(footprint);
      setSelectedBuildingCenter(footprintCenter);
      // Center the aerial on the selected building, not just the street address.
      // Keep the geocoded address pin visible as a separate reference marker.
      setMapCenter(footprintCenter);
      setAutoTraced(true);
      setZoom((value) => Math.max(value, 3));
      // A building footprint is not a roof model. Do not fabricate two gable
      // facets or assign a user-default pitch to a property whose roof shape
      // has not been established from imagery/elevation evidence.
      const selectedElement = elements.find((element) => {
        if (element.type !== "way" || !Array.isArray(element.geometry)) return false;
        const ring = element.geometry.filter(
          (point, index, all) =>
            index === 0 || point.lat !== all[index - 1]?.lat || point.lon !== all[index - 1]?.lon,
        );
        return (
          ring.length >= 3 &&
          ring.length === footprint.length &&
          ring.every((point) =>
            footprint.some(
              (candidate) =>
                Math.abs(candidate.lat - point.lat) < 1e-7 &&
                Math.abs(candidate.lon - point.lon) < 1e-7,
            ),
          )
        );
      });
      const tags = selectedElement?.tags ?? {};
      const roofShape = tags["roof:shape"] ?? tags["building:roof"] ?? "";
      const mappedPitch = Number(tags["roof:angle"]);
      const hasMappedPitch =
        Boolean(tags["roof:angle"]) &&
        Number.isFinite(mappedPitch) &&
        mappedPitch >= 0 &&
        mappedPitch <= 90;
      const evidence = [
        roofShape
          ? `Mapped roof shape: ${roofShape}`
          : "Roof shape: not available in public map data",
        hasMappedPitch
          ? `Mapped roof angle: ${mappedPitch}°`
          : "Roof pitch: not available in public map data",
      ];
      setError(
        `Building footprint found. ${evidence.join(". ")}. The outline is only a ground/building footprint; no roof planes, ridges, hips, valleys, eaves, or rakes have been verified. Continue with roof-plane tracing or provide elevation/oblique imagery before generating a measured roof report.`,
      );
    } catch (e) {
      setError(
        e instanceof Error && e.message.includes("No nearby")
          ? "No OpenStreetMap building outline was found close to this address. Trace the roof corners manually instead."
          : "Automatic footprint lookup is unavailable right now. You can still trace the roof manually.",
      );
    } finally {
      setAutoTraceBusy(false);
    }
  }

  const polygon = points
    .map((p) => {
      if (!bounds) return "";
      return `${((p.lon - bounds.west) / (bounds.east - bounds.west)) * MAP_WIDTH},${((bounds.north - p.lat) / (bounds.north - bounds.south)) * MAP_HEIGHT}`;
    })
    .join(" ");
  const traceGeoReference = (trace: TracePoint[], addressPoint: TracePoint): GeoReference => ({
    addressLatitude: addressPoint.lat,
    addressLongitude: addressPoint.lon,
    originLatitude: trace.reduce((sum, point) => sum + point.lat, 0) / trace.length,
    originLongitude: trace.reduce((sum, point) => sum + point.lon, 0) / trace.length,
  });
  const canAdd =
    Boolean(center) &&
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
            An address centers the map only. Trace the roof corners, then add the plane to update
            measurements and the 2D/3D drawing.
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
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={autoTraceBusy}
              onClick={autoTraceBuildingFootprint}
            >
              <Satellite className="h-4 w-4" />{" "}
              {autoTraceBusy ? "Finding footprint…" : "Auto trace building"}
            </Button>
            <p className="text-xs text-muted-foreground">Zoom: {zoom.toFixed(zoom < 1 ? 2 : 1)}×</p>
            <div className="flex min-w-0 flex-wrap items-center gap-2">
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
                disabled={zoom >= 64}
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
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={
                  !center ||
                  !mapCenter ||
                  (center.lat === mapCenter.lat && center.lon === mapCenter.lon)
                }
                onClick={() => {
                  if (!center) return;
                  setMapCenter(center);
                  setZoom(1);
                }}
              >
                <MapPin className="h-4 w-4" /> Center address
              </Button>
              <div className="flex items-center gap-1" aria-label="Pan satellite map">
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  aria-label="Pan map north"
                  onClick={() =>
                    setMapCenter((current) =>
                      current ? panSatelliteCenter(current, "north", zoom) : current,
                    )
                  }
                >
                  <ArrowUp className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  aria-label="Pan map south"
                  onClick={() =>
                    setMapCenter((current) =>
                      current ? panSatelliteCenter(current, "south", zoom) : current,
                    )
                  }
                >
                  <ArrowDown className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  aria-label="Pan map west"
                  onClick={() =>
                    setMapCenter((current) =>
                      current ? panSatelliteCenter(current, "west", zoom) : current,
                    )
                  }
                >
                  <ArrowLeft className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  aria-label="Pan map east"
                  onClick={() =>
                    setMapCenter((current) =>
                      current ? panSatelliteCenter(current, "east", zoom) : current,
                    )
                  }
                >
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-3">
            <div className="mr-auto">
              <h4 className="font-semibold">Roof drawing method</h4>
              <p className="text-xs text-muted-foreground">
                Choose automatic building-outline lookup or draw and classify each roof plane
                yourself.
              </p>
            </div>
            <Button
              type="button"
              size="sm"
              variant={drawingMode === "outline" ? "default" : "outline"}
              onClick={() => setDrawingMode("outline")}
            >
              Building outline
            </Button>
            <Button
              type="button"
              size="sm"
              variant={drawingMode === "diy" ? "default" : "outline"}
              onClick={() => {
                setDrawingMode("diy");
                setError("");
              }}
            >
              Draw-It-Yourself
            </Button>
          </div>
          {drawingMode === "diy" && (
            <div className="rounded-lg border border-primary/40 bg-primary/5 p-3 space-y-2">
              <h4 className="font-semibold">Draw-It-Yourself roof measurement</h4>
              <p className="text-sm text-muted-foreground">
                Tap the satellite image to place corners in order around one roof plane. Repeat for
                every plane. Enter the pitch and classify each boundary edge to build a detailed
                takeoff. Your entries remain user-drawn measurements until field verified.
              </p>
              <label className="block text-sm">
                Plane name
                <Input
                  value={planeName}
                  onChange={(e) => setPlaneName(e.target.value)}
                  placeholder="e.g. Front main slope"
                  className="mt-1 max-w-sm"
                />
              </label>
            </div>
          )}
          <div className="rounded-md border border-blue-500/40 bg-blue-500/5 p-3 text-sm">
            <strong>Confirm the correct building:</strong> the red pin is the geocoded street
            address. Drag the blue TARGET pin onto the actual house roof before using automatic
            footprint tracing. The target is separate from the address reference.
          </div>
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            <span className="mr-auto text-sm font-medium">Map interaction</span>
            <Button
              type="button"
              size="sm"
              variant={mapInteraction === "draw" ? "default" : "outline"}
              onClick={() => setMapInteraction("draw")}
            >
              <MousePointer2 className="h-4 w-4" /> Draw roof
            </Button>
            <Button
              type="button"
              size="sm"
              variant={mapInteraction === "pan" ? "default" : "outline"}
              onClick={() => setMapInteraction("pan")}
            >
              <ArrowLeft className="h-4 w-4" /> Move map
            </Button>
            <span className="text-xs text-muted-foreground">
              {mapInteraction === "pan"
                ? "Drag the map to move around; use wheel or pinch to zoom."
                : "Click roof corners to add tracing points."}
            </span>
          </div>
          <div
            ref={setMapViewportElement}
            className="relative aspect-[8/5] overflow-hidden rounded-lg border border-border bg-muted overscroll-contain"
            style={{ touchAction: "none" }}
          >
            <img
              src={imageryUrl}
              alt="Satellite aerial imagery of the selected property"
              className="absolute inset-0 h-full w-full object-fill"
              draggable={false}
              onLoad={() => setImageryLoadError(false)}
              onError={() => setImageryLoadError(true)}
            />
            <svg
              viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`}
              className={`relative z-10 block h-full w-full touch-none ${mapInteraction === "pan" ? "cursor-grab active:cursor-grabbing" : "cursor-crosshair"}`}
              onClick={(event) => {
                if (mapInteraction === "pan") return;
                addMapPoint(event);
              }}
              onPointerDown={(event) => {
                if (draggingTarget.current) return;
                if (mapInteraction !== "pan" || !mapCenter) return;
                event.preventDefault();
                mapPanStart.current = { x: event.clientX, y: event.clientY, center: mapCenter };
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
              onPointerMove={(event) => {
                if (draggingTarget.current) {
                  const point = tracePointFromPointer(
                    event.clientX,
                    event.clientY,
                    event.currentTarget.getBoundingClientRect(),
                  );
                  if (point) {
                    targetLocationRef.current = point;
                    setTargetLocation(point);
                    setAutoTraced(false);
                    setSelectedBuildingCenter(null);
                    setPoints([]);
                  }
                  return;
                }
                if (mapPanStart.current) {
                  const rect = event.currentTarget.getBoundingClientRect();
                  if (rect.width > 0 && rect.height > 0) {
                    const dx = event.clientX - mapPanStart.current.x;
                    const dy = event.clientY - mapPanStart.current.y;
                    const longitudeSpan = bounds.east - bounds.west;
                    const latitudeSpan = bounds.north - bounds.south;
                    setMapCenter({
                      lon: mapPanStart.current.center.lon - (dx / rect.width) * longitudeSpan,
                      lat: mapPanStart.current.center.lat + (dy / rect.height) * latitudeSpan,
                    });
                  }
                  return;
                }
                const index = draggingPoint.current;
                if (index === null) return;
                const point = tracePointFromPointer(
                  event.clientX,
                  event.clientY,
                  event.currentTarget.getBoundingClientRect(),
                );
                if (point)
                  setPoints((current) => current.map((item, i) => (i === index ? point : item)));
              }}
              onPointerUp={() => {
                mapPanStart.current = null;
                if (draggingTarget.current) {
                  draggingTarget.current = false;
                  suppressNextMapClick.current = true;
                  // Once the user positions the target over the intended roof,
                  // immediately look up that building instead of requiring a
                  // second "Auto trace building" click. The ref holds the final
                  // pointer coordinate even when React has not rendered yet.
                  if (targetLocationRef.current && location) {
                    void autoTraceBuildingFootprint();
                  }
                }
                if (draggingPoint.current !== null) {
                  draggingPoint.current = null;
                  suppressNextMapClick.current = true;
                }
              }}
              onPointerCancel={() => {
                mapPanStart.current = null;
                draggingTarget.current = false;
                draggingPoint.current = null;
                suppressNextMapClick.current = true;
              }}
              onTouchStart={(event) => {
                if (event.touches.length === 2) {
                  event.preventDefault();
                  const [a, b] = [event.touches[0]!, event.touches[1]!];
                  pinchStartDistance.current = Math.hypot(
                    a.clientX - b.clientX,
                    a.clientY - b.clientY,
                  );
                  pinchStartZoom.current = zoom;
                }
              }}
              onTouchMove={(event) => {
                if (event.touches.length !== 2 || pinchStartDistance.current === null) return;
                event.preventDefault();
                const [a, b] = [event.touches[0]!, event.touches[1]!];
                const distance = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
                setZoom(
                  zoomSatelliteByPinch(
                    pinchStartZoom.current,
                    pinchStartDistance.current,
                    distance,
                  ),
                );
              }}
              onTouchEnd={(event) => {
                if (event.touches.length < 2) pinchStartDistance.current = null;
              }}
              onDoubleClick={(event) => {
                event.preventDefault();
                setZoom((value) => nextSatelliteZoom(value, "in"));
              }}
              role="img"
              aria-label="Satellite image. Click around the roof to trace its outline."
            >
              {selectedBuildingCenter && bounds && (
                <g
                  transform={`translate(${((selectedBuildingCenter.lon - bounds.west) / (bounds.east - bounds.west)) * MAP_WIDTH},${((bounds.north - selectedBuildingCenter.lat) / (bounds.north - bounds.south)) * MAP_HEIGHT})`}
                  pointerEvents="none"
                >
                  <circle
                    r="25"
                    fill="#16a34a"
                    fillOpacity="0.18"
                    stroke="#86efac"
                    strokeWidth="3"
                  />
                  <circle r="7" fill="#16a34a" stroke="white" strokeWidth="3" />
                  <text
                    x="32"
                    y="6"
                    fill="white"
                    stroke="#14532d"
                    strokeWidth="5"
                    paintOrder="stroke"
                    fontSize="19"
                    fontWeight="800"
                  >
                    TARGET HOUSE
                  </text>
                </g>
              )}
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
              {targetLocation && bounds && (
                <g
                  transform={`translate(${((targetLocation.lon - bounds.west) / (bounds.east - bounds.west)) * MAP_WIDTH},${((bounds.north - targetLocation.lat) / (bounds.north - bounds.south)) * MAP_HEIGHT})`}
                  onPointerDown={(event) => {
                    event.stopPropagation();
                    event.preventDefault();
                    draggingTarget.current = true;
                    event.currentTarget.ownerSVGElement?.setPointerCapture(event.pointerId);
                  }}
                  className="cursor-grab active:cursor-grabbing"
                  role="button"
                  aria-label="Drag target pin onto the correct house"
                >
                  <circle
                    r="27"
                    fill="#2563eb"
                    fillOpacity="0.2"
                    stroke="#93c5fd"
                    strokeWidth="3"
                  />
                  <path
                    d="M0 22 C-4 14 -16 3 -16 -7 A16 16 0 1 1 16 -7 C16 3 4 14 0 22Z"
                    fill="#2563eb"
                    stroke="white"
                    strokeWidth="3"
                  />
                  <circle cx="0" cy="-7" r="5" fill="white" />
                  <text
                    x="24"
                    y="5"
                    fill="white"
                    stroke="#1e3a8a"
                    strokeWidth="5"
                    paintOrder="stroke"
                    fontSize="19"
                    fontWeight="800"
                  >
                    TARGET · DRAG ME
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
                    setAutoTraced(false);
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
          {imageryLoadError && (
            <p
              role="alert"
              className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
            >
              Satellite imagery could not be loaded from the free imagery provider. Try again in a
              moment or use an uploaded overhead photo; the map controls remain available but do not
              trace against a blank image.
            </p>
          )}
          {drawingMode === "diy" && points.length >= 2 && (
            <div className="rounded-md border border-border p-3 space-y-2">
              <h4 className="font-semibold">Classify plane boundary edges</h4>
              <p className="text-xs text-muted-foreground">
                Edge 1 joins corner 1 to corner 2. The final edge closes the plane from the last
                corner to corner 1. Shared internal edges should receive the same classification on
                adjacent planes.
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                {points.map((_, index) => {
                  const next = (index + 1) % points.length;
                  const edgeLabels: Record<EdgeType, string> = {
                    eave: "Eave",
                    rake: "Rake",
                    ridge: "Ridge",
                    hip: "Hip",
                    valley: "Valley",
                    other: "Other / unclassified",
                  };
                  return (
                    <label key={index} className="flex items-center justify-between gap-2 text-sm">
                      <span>
                        Edge {index + 1} ({index + 1} → {next + 1})
                      </span>
                      <select
                        value={edgeTypes[index] ?? "other"}
                        onChange={(event) =>
                          setEdgeTypes((current) =>
                            current.map((value, edgeIndex) =>
                              edgeIndex === index ? (event.target.value as EdgeType) : value,
                            ),
                          )
                        }
                        className="h-9 rounded-md border border-input bg-background px-2"
                        aria-label={`Classify edge ${index + 1}`}
                      >
                        {Object.entries(edgeLabels).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                  );
                })}
              </div>
            </div>
          )}
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
            <label className="text-sm">
              Pitch rises toward
              <select
                value={pitchDirection}
                onChange={(e) => setPitchDirection(e.target.value as PitchDirection)}
                className="mt-1 block h-10 rounded-md border border-input bg-background px-3 text-sm"
                aria-label="Pitch rises toward"
              >
                <option value="north">North</option>
                <option value="south">South</option>
                <option value="east">East</option>
                <option value="west">West</option>
              </select>
            </label>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setAutoTraced(false);
                setPoints((current) => current.slice(0, -1));
                setEdgeTypes((current) => current.slice(0, -1));
              }}
              disabled={!points.length}
            >
              <RotateCcw className="h-4 w-4" /> Undo point
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setAutoTraced(false);
                setPoints([]);
                setEdgeTypes([]);
              }}
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
                  const drawnPlane = satelliteTraceToPlane(points, Number(pitch), pitchDirection);
                  const namedPlane: RoofPlane = {
                    ...drawnPlane,
                    name:
                      drawingMode === "diy"
                        ? planeName.trim() || `Roof plane ${Date.now()}`
                        : drawnPlane.name,
                    edges:
                      drawingMode === "diy" && edgeTypes.length === points.length
                        ? edgeTypes
                        : drawnPlane.edges,
                  };
                  const accepted = onAdd(
                    [namedPlane],
                    traceGeoReference(points, targetLocation ?? center!),
                  );
                  if (accepted !== false) {
                    setPoints([]);
                    setEdgeTypes([]);
                    if (drawingMode === "diy") setPlaneName(`Roof plane ${Date.now()}`);
                  }
                } catch {
                  setError("Could not convert this outline into a roof plane.");
                } finally {
                  setBusy(false);
                }
              }}
            >
              <MapPin className="h-4 w-4" />{" "}
              {drawingMode === "diy" ? "Add DIY roof plane" : "Add traced plane"}
            </Button>
          </div>

          <div className="flex flex-wrap items-end gap-3 rounded-md border border-border p-3">
            <label className="text-sm">
              Gable ridge runs
              <select
                value={ridgeAxis}
                onChange={(e) => setRidgeAxis(e.target.value as RidgeAxis)}
                className="mt-1 block h-10 rounded-md border border-input bg-background px-3 text-sm"
                aria-label="Gable ridge direction"
              >
                <option value="north-south">North–South</option>
                <option value="east-west">East–West</option>
              </select>
            </label>
            <label className="min-w-48 flex-1 text-sm">
              Ridge position: {ridgeOffsetPercent > 0 ? "+" : ""}
              {ridgeOffsetPercent}%
              <input
                type="range"
                min={-40}
                max={40}
                step={1}
                value={ridgeOffsetPercent}
                onChange={(e) => setRidgeOffsetPercent(Number(e.target.value))}
                className="mt-2 block w-full accent-primary"
                aria-label="Ridge position offset"
              />
              <span className="text-xs text-muted-foreground">
                Move the ridge across the traced width
              </span>
            </label>
            <label className="min-w-48 flex-1 text-sm">
              Ridge angle: {ridgeAngleDegrees > 0 ? "+" : ""}
              {ridgeAngleDegrees}°
              <input
                type="range"
                min={-30}
                max={30}
                step={1}
                value={ridgeAngleDegrees}
                onChange={(e) => setRidgeAngleDegrees(Number(e.target.value))}
                className="mt-2 block w-full accent-primary"
                aria-label="Ridge angle"
              />
              <span className="text-xs text-muted-foreground">Rotate the ridge up to 30°</span>
            </label>
            <Button
              type="button"
              variant="outline"
              disabled={points.length < 4 || Number(pitch) <= 0 || busy}
              onClick={() => {
                setBusy(true);
                try {
                  const accepted = onAdd(
                    satelliteTraceToGablePlanes(
                      points,
                      Number(pitch),
                      ridgeAxis,
                      ridgeOffsetPercent,
                      ridgeAngleDegrees,
                    ),
                    traceGeoReference(points, targetLocation ?? center!),
                  );
                  if (accepted !== false) setPoints([]);
                } catch (e) {
                  setError(
                    e instanceof Error
                      ? e.message
                      : "Could not split this outline into gable facets.",
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              Split into 2 gable planes
            </Button>
            <p className="basis-full text-xs text-muted-foreground">
              Creates two preliminary facets along the selected ridge direction. Adjust the ridge
              position for an off-center roof; confirm the ridge, eaves, overhangs, and pitch before
              using quantities. Irregular outlines that cannot be split cleanly are rejected.
            </p>
          </div>
          {autoTraced && (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              Auto-traced OpenStreetMap building footprint loaded. This is a building outline, not a
              verified roof edge; adjust for roof overhangs and confirm every plane before using
              quantities.
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            Imagery: Esri World Imagery. Building footprints and address lookup: OpenStreetMap. DIY
            mode: draw each roof plane separately and classify every edge; the software calculates
            its dimensions and area from the traced geometry.
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