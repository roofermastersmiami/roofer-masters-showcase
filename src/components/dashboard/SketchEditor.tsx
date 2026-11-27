import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  Box,
  Info,
  MapPin,
  Minus,
  PenTool,
  Plus,
  Redo2,
  RotateCcw,
  Shapes,
  Spline,
  Trash2,
  Undo2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { satelliteMapTiles, SATELLITE_MAX_ZOOM, SATELLITE_MIN_ZOOM } from "@/lib/satellite-map";
import { PENETRATION_COLORS, ROOF_FACE_COLORS } from "@/lib/roof-feature-styles";
import type { EdgeType, Point, RoofDrawing } from "@/lib/roof-geometry";

type Penetration = RoofDrawing["penetrations"][number];
import {
  applyPitchToPlane,
  createPlaneFromDraft,
  deleteAllEdges,
  deleteEdge,
  drawingPointToLatLon,
  edgeLengthFt,
  formatEdgeLength,
  insertVertexOnEdge,
  latLonToDrawingPoint,
  latLonToWorldPx,
  moveVertex,
  planeCentroid,
  planePitchArea,
  retypeEdge,
  SKETCH_EDGE_ACTION_ORDER,
  SKETCH_EDGE_STYLES,
  snapSegmentPoint,
  snapVertexPosition,
  validateSketchDrawing,
  worldPxToLatLon,
  type PitchDirection,
  type SketchMode,
} from "@/lib/sketch-editor";
import { DrawingErrorBoundary } from "./DrawingErrorBoundary";

const Scene = lazy(() => import("./RoofScene"));

const PENETRATION_LABELS: Record<Penetration["kind"], string> = {
  pipe: "Pipe",
  vent: "Vent",
  skylight: "Skylight",
  chimney: "Chimney",
  other: "Other",
};

const MODE_BUTTONS: { mode: SketchMode; label: string; icon: typeof PenTool }[] = [
  { mode: "draw", label: "Draw", icon: PenTool },
  { mode: "edges", label: "Edges", icon: Spline },
  { mode: "facets", label: "Facets", icon: Shapes },
  { mode: "pins", label: "Pins", icon: MapPin },
];

type SelectedEdge = { planeId: string; edgeIndex: number };

type DragState =
  | { kind: "vertex"; planeId: string; vertexIndex: number }
  | { kind: "pin"; pinId: string }
  | null;

/**
 * Edit Sketch: a RoofSnap-style sketch editor for one roof drawing.
 * The 2D Sketch view draws the facets over Esri World Imagery tiles
 * (geo-referenced drawings) or a measured grid (drawings without a
 * geo reference), with edges coloured by classification and live
 * length labels. The 3D view reuses the workspace's Three.js scene
 * (RoofScene) on the same in-progress drawing. Done hands the edited
 * drawing back to the workspace, which saves it as a new revision
 * through the existing report-linked save path and clears review
 * state — this component never writes to the database itself.
 */
export function SketchEditor({
  drawing: initialDrawing,
  onDone,
  onCancel,
}: {
  drawing: RoofDrawing;
  onDone: (next: RoofDrawing, changed: boolean) => void;
  onCancel: () => void;
}) {
  const geoRef = initialDrawing.geo_reference ?? null;
  const [drawing, setDrawing] = useState<RoofDrawing>(initialDrawing);
  const [past, setPast] = useState<RoofDrawing[]>([]);
  const [future, setFuture] = useState<RoofDrawing[]>([]);
  const [changed, setChanged] = useState(false);
  const [mode, setMode] = useState<SketchMode>("edges");
  const [view, setView] = useState<"sketch" | "3d">("sketch");
  const [fitKey, setFitKey] = useState(0);
  const [selectedPlaneId, setSelectedPlaneId] = useState(initialDrawing.planes[0]?.id ?? "");
  const [selectedEdge, setSelectedEdge] = useState<SelectedEdge | null>(null);
  const [selectedPinId, setSelectedPinId] = useState<string | null>(null);
  const [ninetyMode, setNinetyMode] = useState(false);
  const [showLengths, setShowLengths] = useState(true);
  const [showLabels, setShowLabels] = useState(true);
  const [draftPoints, setDraftPoints] = useState<Point[]>([]);
  const [draftPitch, setDraftPitch] = useState("6");
  const [draftDirection, setDraftDirection] = useState<PitchDirection>("south");
  const [facetPitch, setFacetPitch] = useState("6");
  const [facetDirection, setFacetDirection] = useState<PitchDirection>("south");
  const [error, setError] = useState("");
  const [helpOpen, setHelpOpen] = useState(false);

  /* ---------------- canvas size + camera ---------------- */
  const canvasWrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 960, h: 640 });
  useEffect(() => {
    const element = canvasWrapRef.current;
    if (!element) return;
    const update = () => {
      const rect = element.getBoundingClientRect();
      if (rect.width > 40 && rect.height > 40)
        setSize({ w: Math.round(rect.width), h: Math.round(rect.height) });
    };
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [view]);

  const initialCentroid = useMemo(() => {
    const points = initialDrawing.planes.flatMap((plane) => plane.points);
    if (!points.length) return { x: 0, z: 0 };
    return {
      x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
      z: points.reduce((sum, p) => sum + p.z, 0) / points.length,
    };
  }, [initialDrawing]);

  const [geoCenter, setGeoCenter] = useState(() => {
    if (!geoRef) return { lat: 0, lon: 0 };
    return drawingPointToLatLon(initialCentroid, geoRef);
  });
  const [geoZoom, setGeoZoom] = useState(19);
  const [localCenter, setLocalCenter] = useState(initialCentroid);
  const [localScale, setLocalScale] = useState<number | null>(null);
  const fitScale = useMemo(() => {
    const points = initialDrawing.planes.flatMap((plane) => plane.points);
    if (!points.length) return 4;
    const spanX = Math.max(...points.map((p) => p.x)) - Math.min(...points.map((p) => p.x));
    const spanZ = Math.max(...points.map((p) => p.z)) - Math.min(...points.map((p) => p.z));
    const span = Math.max(spanX, spanZ, 10);
    return Math.max(0.5, (Math.min(size.w, size.h) * 0.72) / span);
  }, [initialDrawing, size]);
  const scale = localScale ?? fitScale;

  const camWorldPx = useMemo(
    () => (geoRef ? latLonToWorldPx(geoCenter.lat, geoCenter.lon, geoZoom) : { x: 0, y: 0 }),
    [geoRef, geoCenter, geoZoom],
  );

  function project(point: { x: number; z: number }): { px: number; py: number } {
    if (geoRef) {
      const latLon = drawingPointToLatLon(point, geoRef);
      const world = latLonToWorldPx(latLon.lat, latLon.lon, geoZoom);
      return { px: world.x - camWorldPx.x + size.w / 2, py: world.y - camWorldPx.y + size.h / 2 };
    }
    return {
      px: (point.x - localCenter.x) * scale + size.w / 2,
      py: (point.z - localCenter.z) * scale + size.h / 2,
    };
  }

  function unproject(px: number, py: number, y: number): Point {
    if (geoRef) {
      const latLon = worldPxToLatLon(
        px + camWorldPx.x - size.w / 2,
        py + camWorldPx.y - size.h / 2,
        geoZoom,
      );
      return latLonToDrawingPoint(latLon.lat, latLon.lon, geoRef, y);
    }
    return {
      x: (px - size.w / 2) / scale + localCenter.x,
      y,
      z: (py - size.h / 2) / scale + localCenter.z,
    };
  }

  function panBy(dxPx: number, dyPx: number) {
    if (geoRef) {
      const next = worldPxToLatLon(camWorldPx.x - dxPx, camWorldPx.y - dyPx, geoZoom);
      setGeoCenter(next);
    } else {
      setLocalCenter((center) => ({ x: center.x - dxPx / scale, z: center.z - dyPx / scale }));
    }
  }

  function zoomBy(direction: 1 | -1) {
    if (geoRef) {
      setGeoZoom((zoom) =>
        Math.max(SATELLITE_MIN_ZOOM, Math.min(SATELLITE_MAX_ZOOM, zoom + direction)),
      );
    } else {
      setLocalScale(Math.max(0.25, Math.min(80, scale * (direction > 0 ? 1.3 : 1 / 1.3))));
    }
  }

  // Native non-passive wheel listener: React's synthetic wheel is
  // passive at the root and cannot stop the page scrolling behind
  // the editor (same pattern as SatelliteMap). Works with a mouse
  // wheel, a Magic Mouse, and trackpad pinch (ctrlKey wheel).
  const zoomRef = useRef({ geoRef: Boolean(geoRef), geoZoom, scale });
  zoomRef.current = { geoRef: Boolean(geoRef), geoZoom, scale };
  useEffect(() => {
    const element = canvasWrapRef.current;
    if (!element || view !== "sketch") return;
    let accum = 0;
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1;
      const delta = event.deltaY * unit;
      if (zoomRef.current.geoRef) {
        accum += delta;
        const threshold = event.ctrlKey ? 12 : 60;
        while (accum <= -threshold) {
          accum += threshold;
          setGeoZoom((zoom) => Math.min(SATELLITE_MAX_ZOOM, zoom + 1));
        }
        while (accum >= threshold) {
          accum -= threshold;
          setGeoZoom((zoom) => Math.max(SATELLITE_MIN_ZOOM, zoom - 1));
        }
      } else {
        setLocalScale((current) => {
          const base = current ?? zoomRef.current.scale;
          return Math.max(0.25, Math.min(80, base * Math.exp(-delta * 0.0015)));
        });
      }
    };
    element.addEventListener("wheel", handleWheel, { passive: false });
    return () => element.removeEventListener("wheel", handleWheel);
  }, [view]);

  /* ---------------- history ---------------- */
  const transientBase = useRef<RoofDrawing | null>(null);
  function commit(next: RoofDrawing) {
    transientBase.current = null;
    setPast((entries) => [...entries.slice(-49), drawing]);
    setFuture([]);
    setDrawing(next);
    setChanged(true);
  }
  function transient(next: RoofDrawing) {
    if (!transientBase.current) transientBase.current = drawing;
    setDrawing(next);
  }
  function endTransient() {
    if (transientBase.current && transientBase.current !== drawing) {
      const base = transientBase.current;
      setPast((entries) => [...entries.slice(-49), base]);
      setFuture([]);
      setChanged(true);
    }
    transientBase.current = null;
  }
  function undo() {
    const previous = past[past.length - 1];
    if (!previous) return;
    transientBase.current = null;
    setFuture((entries) => [drawing, ...entries]);
    setPast(past.slice(0, -1));
    setDrawing(previous);
    setSelectedEdge(null);
  }
  function redo() {
    const next = future[0];
    if (!next) return;
    transientBase.current = null;
    setPast((entries) => [...entries, drawing]);
    setFuture(future.slice(1));
    setDrawing(next);
    setSelectedEdge(null);
  }

  /* ---------------- pointer interaction ---------------- */
  const dragRef = useRef<DragState>(null);
  const panRef = useRef<{
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    moved: boolean;
  } | null>(null);

  function pointerPosition(event: ReactPointerEvent): { px: number; py: number } {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { px: 0, py: 0 };
    return { px: event.clientX - rect.left, py: event.clientY - rect.top };
  }

  function baseElevation(): number {
    const ys = drawing.planes.flatMap((plane) => plane.points.map((p) => p.y));
    return ys.length ? Math.min(...ys) : 10;
  }

  function handleVertexDrag(event: ReactPointerEvent) {
    const drag = dragRef.current;
    if (!drag || drag.kind !== "vertex") return;
    const plane = drawing.planes.find((p) => p.id === drag.planeId);
    if (!plane) return;
    const current = plane.points[drag.vertexIndex];
    if (!current) return;
    const { px, py } = pointerPosition(event);
    const point = unproject(px, py, current.y);
    const snapped = ninetyMode
      ? snapVertexPosition(plane, drag.vertexIndex, point.x, point.z)
      : { x: point.x, z: point.z };
    transient(moveVertex(drawing, drag.planeId, drag.vertexIndex, snapped.x, snapped.z));
  }

  function handlePinDrag(event: ReactPointerEvent) {
    const drag = dragRef.current;
    if (!drag || drag.kind !== "pin") return;
    const { px, py } = pointerPosition(event);
    const point = unproject(px, py, 0);
    transient({
      ...drawing,
      penetrations: drawing.penetrations.map((pin) =>
        pin.id === drag.pinId ? { ...pin, x: point.x, z: point.z } : pin,
      ),
    });
  }

  function finishDraft() {
    if (draftPoints.length < 3) return;
    let plane = createPlaneFromDraft(draftPoints, `Facet ${drawing.planes.length + 1}`);
    const pitch = Number(draftPitch);
    if (Number.isFinite(pitch) && pitch > 0)
      plane = applyPitchToPlane(plane, pitch, draftDirection);
    commit({ ...drawing, planes: [...drawing.planes, plane] });
    setSelectedPlaneId(plane.id);
    setDraftPoints([]);
    setMode("facets");
  }

  function handleCanvasClick(event: ReactPointerEvent) {
    const { px, py } = pointerPosition(event);
    if (mode === "draw") {
      // Clicking the first draft corner again closes the facet.
      if (draftPoints.length >= 3) {
        const first = project(draftPoints[0]!);
        if (Math.hypot(first.px - px, first.py - py) <= 14) {
          finishDraft();
          return;
        }
      }
      const point = unproject(px, py, baseElevation());
      let snapped = { x: point.x, z: point.z };
      if (ninetyMode && draftPoints.length >= 1) {
        const anchor = draftPoints[draftPoints.length - 1]!;
        const before = draftPoints.length >= 2 ? draftPoints[draftPoints.length - 2]! : null;
        snapped = snapSegmentPoint(anchor, before, point);
      }
      setDraftPoints((points) => [...points, { ...point, x: snapped.x, z: snapped.z }]);
    } else if (mode === "pins") {
      const point = unproject(px, py, 0);
      const pin: Penetration = {
        id: globalThis.crypto?.randomUUID?.() ?? `pin-${Date.now()}`,
        kind: "other",
        x: point.x,
        z: point.z,
        width: 2,
        length: 2,
      };
      commit({ ...drawing, penetrations: [...drawing.penetrations, pin] });
      setSelectedPinId(pin.id);
    }
  }

  function onCanvasPointerDown(event: ReactPointerEvent<SVGSVGElement>) {
    if (view !== "sketch") return;
    svgRef.current?.setPointerCapture(event.pointerId);
    panRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      moved: false,
    };
  }
  function onCanvasPointerMove(event: ReactPointerEvent<SVGSVGElement>) {
    if (dragRef.current?.kind === "vertex") return handleVertexDrag(event);
    if (dragRef.current?.kind === "pin") return handlePinDrag(event);
    const pan = panRef.current;
    if (!pan) return;
    const dx = event.clientX - pan.lastX;
    const dy = event.clientY - pan.lastY;
    if (Math.hypot(event.clientX - pan.startX, event.clientY - pan.startY) > 4) pan.moved = true;
    if (pan.moved) {
      panBy(dx, dy);
      pan.lastX = event.clientX;
      pan.lastY = event.clientY;
    }
  }
  function onCanvasPointerUp(event: ReactPointerEvent<SVGSVGElement>) {
    if (dragRef.current) {
      dragRef.current = null;
      endTransient();
      panRef.current = null;
      return;
    }
    const pan = panRef.current;
    panRef.current = null;
    if (pan && !pan.moved && (mode === "draw" || mode === "pins")) handleCanvasClick(event);
  }

  /* ---------------- derived render data ---------------- */
  const selectedPlane = drawing.planes.find((plane) => plane.id === selectedPlaneId);
  const selectedEdgeData = (() => {
    if (!selectedEdge) return null;
    const plane = drawing.planes.find((p) => p.id === selectedEdge.planeId);
    if (!plane || selectedEdge.edgeIndex >= plane.points.length) return null;
    const a = plane.points[selectedEdge.edgeIndex]!;
    const b = plane.points[(selectedEdge.edgeIndex + 1) % plane.points.length]!;
    return { plane, a, b, length: edgeLengthFt(a, b), type: plane.edges[selectedEdge.edgeIndex]! };
  })();
  const selectedPin = drawing.penetrations.find((pin) => pin.id === selectedPinId);

  const tileLayer = useMemo(() => {
    if (!geoRef || view !== "sketch") return null;
    const layerW = Math.ceil(size.w * 1.5) + 256;
    const layerH = Math.ceil(size.h * 1.5) + 256;
    return {
      width: layerW,
      height: layerH,
      tiles: satelliteMapTiles(geoCenter.lat, geoCenter.lon, geoZoom, layerW, layerH),
    };
  }, [geoRef, view, size, geoCenter, geoZoom]);

  const gridLines = useMemo(() => {
    if (geoRef || view !== "sketch") return null;
    const stepFt = scale >= 8 ? 5 : scale >= 3 ? 10 : 25;
    const minX = localCenter.x - size.w / 2 / scale;
    const maxX = localCenter.x + size.w / 2 / scale;
    const minZ = localCenter.z - size.h / 2 / scale;
    const maxZ = localCenter.z + size.h / 2 / scale;
    const lines: { x1: number; y1: number; x2: number; y2: number; key: string }[] = [];
    for (let x = Math.floor(minX / stepFt) * stepFt; x <= maxX; x += stepFt) {
      const a = project({ x, z: minZ });
      const b = project({ x, z: maxZ });
      lines.push({ x1: a.px, y1: a.py, x2: b.px, y2: b.py, key: `v${x}` });
    }
    for (let z = Math.floor(minZ / stepFt) * stepFt; z <= maxZ; z += stepFt) {
      const a = project({ x: minX, z });
      const b = project({ x: maxX, z });
      lines.push({ x1: a.px, y1: a.py, x2: b.px, y2: b.py, key: `h${z}` });
    }
    return lines;
    // project closes over camera state; recompute when it changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geoRef, view, scale, localCenter, size]);

  function handleDone() {
    const problem = validateSketchDrawing(drawing);
    if (problem) {
      setError(problem);
      return;
    }
    onDone(drawing, changed);
  }

  const hints: Record<SketchMode, string> = {
    draw: "Click the roof to place corners. Click the first corner again (or Finish facet) to close the facet. Drag the map to pan; scroll to zoom.",
    edges:
      "Click an edge to select it, then assign its type or delete it in Edge Actions. Drag green corners to reshape.",
    facets:
      "Click a facet to select it. See its pitch and area, re-slope it, or delete it. Drag green corners to reshape.",
    pins: "Click the roof to drop a pin (saved with the drawing as a penetration). Drag pins to move them.",
  };

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-background"
      role="dialog"
      aria-label="Edit roof sketch"
    >
      {/* ---------- toolbar (reference layout) ---------- */}
      <div className="flex flex-wrap items-center gap-1.5 bg-primary px-3 py-2 text-primary-foreground">
        <Button
          size="sm"
          variant="ghost"
          className="text-primary-foreground hover:bg-primary-foreground/15 hover:text-primary-foreground"
          onClick={() => setHelpOpen(true)}
        >
          <Info /> Help
        </Button>
        <div className="mx-1 h-6 w-px bg-primary-foreground/30" />
        <Button
          size="icon"
          variant="ghost"
          className="text-primary-foreground hover:bg-primary-foreground/15 hover:text-primary-foreground"
          aria-label="Zoom out"
          onClick={() => zoomBy(-1)}
          disabled={view === "3d"}
        >
          <Minus />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="text-primary-foreground hover:bg-primary-foreground/15 hover:text-primary-foreground"
          aria-label="Zoom in"
          onClick={() => zoomBy(1)}
          disabled={view === "3d"}
        >
          <Plus />
        </Button>
        <span className="min-w-12 text-center text-xs font-medium">
          {view === "3d" ? "3D" : geoRef ? `z${geoZoom}` : `${Math.round(scale * 10) / 10} px/ft`}
        </span>
        <Button
          size="icon"
          variant="ghost"
          className="text-primary-foreground hover:bg-primary-foreground/15 hover:text-primary-foreground"
          aria-label="Undo"
          onClick={undo}
          disabled={!past.length}
        >
          <Undo2 />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="text-primary-foreground hover:bg-primary-foreground/15 hover:text-primary-foreground"
          aria-label="Redo"
          onClick={redo}
          disabled={!future.length}
        >
          <Redo2 />
        </Button>
        <div className="mx-1 h-6 w-px bg-primary-foreground/30" />
        {MODE_BUTTONS.map(({ mode: buttonMode, label, icon: Icon }) => (
          <Button
            key={buttonMode}
            size="sm"
            variant={mode === buttonMode && view === "sketch" ? "secondary" : "ghost"}
            className={
              mode === buttonMode && view === "sketch"
                ? ""
                : "text-primary-foreground hover:bg-primary-foreground/15 hover:text-primary-foreground"
            }
            onClick={() => {
              setMode(buttonMode);
              setView("sketch");
            }}
            aria-pressed={mode === buttonMode && view === "sketch"}
          >
            <Icon /> {label}
          </Button>
        ))}
        <div className="mx-1 h-6 w-px bg-primary-foreground/30" />
        <Button
          size="sm"
          variant={view === "sketch" ? "secondary" : "ghost"}
          className={
            view === "sketch"
              ? ""
              : "text-primary-foreground hover:bg-primary-foreground/15 hover:text-primary-foreground"
          }
          onClick={() => setView("sketch")}
          aria-pressed={view === "sketch"}
        >
          <PenTool /> Sketch
        </Button>
        <Button
          size="sm"
          variant={view === "3d" ? "secondary" : "ghost"}
          className={
            view === "3d"
              ? ""
              : "text-primary-foreground hover:bg-primary-foreground/15 hover:text-primary-foreground"
          }
          onClick={() => {
            setView("3d");
            setFitKey((key) => key + 1);
          }}
          aria-pressed={view === "3d"}
        >
          <Box /> 3D
        </Button>
        <div className="ml-auto flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            className="text-primary-foreground hover:bg-primary-foreground/15 hover:text-primary-foreground"
            onClick={onCancel}
          >
            Cancel
          </Button>
          <Button size="sm" variant="secondary" onClick={handleDone}>
            Done
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* ---------- canvas ---------- */}
        <div ref={canvasWrapRef} className="relative min-w-0 flex-1 overflow-hidden bg-neutral-900">
          {view === "sketch" ? (
            <>
              {tileLayer && (
                <div
                  className="absolute left-1/2 top-1/2"
                  style={{
                    width: tileLayer.width,
                    height: tileLayer.height,
                    transform: "translate(-50%, -50%)",
                  }}
                  aria-hidden="true"
                >
                  {tileLayer.tiles.map((tile) => (
                    <img
                      key={tile.key}
                      src={tile.src}
                      alt=""
                      draggable={false}
                      className="absolute max-w-none select-none"
                      style={{ left: tile.left, top: tile.top, width: 256, height: 256 }}
                    />
                  ))}
                </div>
              )}
              <svg
                ref={svgRef}
                width={size.w}
                height={size.h}
                className="absolute inset-0 touch-none"
                style={{ cursor: mode === "draw" ? "crosshair" : "grab" }}
                onPointerDown={onCanvasPointerDown}
                onPointerMove={onCanvasPointerMove}
                onPointerUp={onCanvasPointerUp}
                onPointerCancel={() => {
                  dragRef.current = null;
                  panRef.current = null;
                  endTransient();
                }}
                role="img"
                aria-label="Roof sketch over satellite imagery. Drag corners to reshape the roof."
              >
                {gridLines?.map((line) => (
                  <line
                    key={line.key}
                    x1={line.x1}
                    y1={line.y1}
                    x2={line.x2}
                    y2={line.y2}
                    stroke="#ffffff"
                    strokeOpacity="0.12"
                    strokeWidth="1"
                  />
                ))}
                {drawing.planes.map((plane, planeIndex) => {
                  const projected = plane.points.map((point) => project(point));
                  const polygonPoints = projected.map((p) => `${p.px},${p.py}`).join(" ");
                  const centroid = planeCentroid(plane);
                  const centroidPx = project(centroid);
                  const info = planePitchArea(plane);
                  return (
                    <g key={plane.id}>
                      <polygon
                        points={polygonPoints}
                        fill={ROOF_FACE_COLORS[planeIndex % ROOF_FACE_COLORS.length]}
                        fillOpacity={plane.id === selectedPlaneId ? 0.3 : 0.16}
                        stroke="none"
                        onPointerDown={(event) => {
                          if (mode !== "facets") return;
                          event.stopPropagation();
                          setSelectedPlaneId(plane.id);
                        }}
                        style={{ cursor: mode === "facets" ? "pointer" : undefined }}
                      />
                      {plane.points.map((point, edgeIndex) => {
                        const a = projected[edgeIndex]!;
                        const b = projected[(edgeIndex + 1) % projected.length]!;
                        const type = plane.edges[edgeIndex] ?? "other";
                        const style = SKETCH_EDGE_STYLES[type];
                        const isSelected =
                          selectedEdge?.planeId === plane.id &&
                          selectedEdge.edgeIndex === edgeIndex;
                        const mid = { px: (a.px + b.px) / 2, py: (a.py + b.py) / 2 };
                        return (
                          <g key={edgeIndex}>
                            <line
                              x1={a.px}
                              y1={a.py}
                              x2={b.px}
                              y2={b.py}
                              stroke="transparent"
                              strokeWidth="14"
                              onPointerDown={(event) => {
                                if (mode !== "edges") return;
                                event.stopPropagation();
                                setSelectedPlaneId(plane.id);
                                setSelectedEdge({ planeId: plane.id, edgeIndex });
                              }}
                              style={{ cursor: mode === "edges" ? "pointer" : undefined }}
                            />
                            {isSelected && (
                              <line
                                x1={a.px}
                                y1={a.py}
                                x2={b.px}
                                y2={b.py}
                                stroke="#ffffff"
                                strokeWidth="7"
                                strokeLinecap="round"
                                pointerEvents="none"
                              />
                            )}
                            <line
                              x1={a.px}
                              y1={a.py}
                              x2={b.px}
                              y2={b.py}
                              stroke={style.color}
                              strokeWidth={isSelected ? 4 : 3}
                              strokeLinecap="round"
                              pointerEvents="none"
                            />
                            {showLengths && (
                              <text
                                x={mid.px}
                                y={mid.py - 4}
                                textAnchor="middle"
                                fontSize="11"
                                fontWeight="700"
                                fill="#ffffff"
                                stroke="rgba(0,0,0,0.7)"
                                strokeWidth="3"
                                paintOrder="stroke"
                                pointerEvents="none"
                              >
                                {formatEdgeLength(
                                  edgeLengthFt(
                                    point,
                                    plane.points[(edgeIndex + 1) % plane.points.length]!,
                                  ),
                                )}
                              </text>
                            )}
                            {showLabels && (
                              <text
                                x={mid.px}
                                y={mid.py + 12}
                                textAnchor="middle"
                                fontSize="8.5"
                                fontWeight="600"
                                fill={style.color}
                                stroke="rgba(0,0,0,0.7)"
                                strokeWidth="3"
                                paintOrder="stroke"
                                pointerEvents="none"
                                style={{ textTransform: "uppercase" }}
                              >
                                {style.label}
                              </text>
                            )}
                            {mode === "draw" && plane.id === selectedPlaneId && (
                              <circle
                                cx={mid.px}
                                cy={mid.py}
                                r="6"
                                fill="#ffffff"
                                stroke="#111827"
                                strokeWidth="1.5"
                                onPointerDown={(event) => {
                                  event.stopPropagation();
                                  const y = point.y;
                                  const inserted = insertVertexOnEdge(
                                    drawing,
                                    plane.id,
                                    edgeIndex,
                                    {
                                      x:
                                        (point.x +
                                          plane.points[(edgeIndex + 1) % plane.points.length]!.x) /
                                        2,
                                      y,
                                      z:
                                        (point.z +
                                          plane.points[(edgeIndex + 1) % plane.points.length]!.z) /
                                        2,
                                    },
                                  );
                                  commit(inserted);
                                  dragRef.current = {
                                    kind: "vertex",
                                    planeId: plane.id,
                                    vertexIndex: edgeIndex + 1,
                                  };
                                  svgRef.current?.setPointerCapture(event.pointerId);
                                }}
                                style={{ cursor: "copy" }}
                              >
                                <title>Insert corner on this edge</title>
                              </circle>
                            )}
                          </g>
                        );
                      })}
                      {mode === "facets" && (
                        <text
                          x={centroidPx.px}
                          y={centroidPx.py}
                          textAnchor="middle"
                          fontSize="12"
                          fontWeight="700"
                          fill="#ffffff"
                          stroke="rgba(0,0,0,0.7)"
                          strokeWidth="3"
                          paintOrder="stroke"
                          pointerEvents="none"
                        >
                          {plane.name}
                          {info
                            ? ` · ${info.pitch.toFixed(1)}/12 · ${Math.round(info.area)} sf`
                            : ""}
                        </text>
                      )}
                      {projected.map((position, vertexIndex) => (
                        <circle
                          key={vertexIndex}
                          cx={position.px}
                          cy={position.py}
                          r="5.5"
                          fill="#22C55E"
                          stroke="#ffffff"
                          strokeWidth="2"
                          onPointerDown={(event) => {
                            if (mode === "pins") return;
                            event.stopPropagation();
                            setSelectedPlaneId(plane.id);
                            dragRef.current = { kind: "vertex", planeId: plane.id, vertexIndex };
                            svgRef.current?.setPointerCapture(event.pointerId);
                          }}
                          style={{ cursor: "move" }}
                        />
                      ))}
                    </g>
                  );
                })}
                {draftPoints.length > 0 && (
                  <g>
                    <polyline
                      points={draftPoints
                        .map((point) => {
                          const p = project(point);
                          return `${p.px},${p.py}`;
                        })
                        .join(" ")}
                      fill="none"
                      stroke="#FACC15"
                      strokeWidth="2.5"
                      strokeDasharray="6 4"
                      pointerEvents="none"
                    />
                    {draftPoints.map((point, index) => {
                      const p = project(point);
                      return (
                        <circle
                          key={index}
                          cx={p.px}
                          cy={p.py}
                          r={index === 0 && draftPoints.length >= 3 ? 9 : 5.5}
                          fill={index === 0 && draftPoints.length >= 3 ? "#FACC15" : "#22C55E"}
                          stroke="#ffffff"
                          strokeWidth="2"
                          pointerEvents="none"
                        />
                      );
                    })}
                  </g>
                )}
                {drawing.penetrations.map((pin) => {
                  const position = project(pin);
                  const isSelected = pin.id === selectedPinId;
                  return (
                    <g
                      key={pin.id}
                      transform={`translate(${position.px},${position.py})`}
                      onPointerDown={(event) => {
                        if (mode !== "pins") return;
                        event.stopPropagation();
                        setSelectedPinId(pin.id);
                        dragRef.current = { kind: "pin", pinId: pin.id };
                        svgRef.current?.setPointerCapture(event.pointerId);
                      }}
                      style={{ cursor: mode === "pins" ? "move" : undefined }}
                      pointerEvents={mode === "pins" ? "auto" : "none"}
                    >
                      <circle
                        r={isSelected ? 13 : 11}
                        fill={PENETRATION_COLORS[pin.kind]}
                        stroke="#ffffff"
                        strokeWidth={isSelected ? 3 : 2}
                      />
                      <text
                        textAnchor="middle"
                        dy="3.5"
                        fontSize="10"
                        fontWeight="800"
                        fill="#ffffff"
                        pointerEvents="none"
                      >
                        {PENETRATION_LABELS[pin.kind].charAt(0)}
                      </text>
                    </g>
                  );
                })}
              </svg>
              <div className="pointer-events-none absolute bottom-2 left-2 rounded bg-black/55 px-2 py-1 text-[11px] text-white">
                {geoRef
                  ? "Imagery: Esri World Imagery"
                  : "No satellite reference saved for this drawing — measured grid shown; dimensions stay exact."}
              </div>
            </>
          ) : (
            <>
              <DrawingErrorBoundary>
                <Suspense fallback={<p className="p-8 text-muted-foreground">Loading 3D view…</p>}>
                  <Scene
                    drawing={drawing}
                    selected={selectedPlaneId}
                    onSelect={setSelectedPlaneId}
                    view="3d"
                    fitKey={fitKey}
                    autoRotate={false}
                    zoomDirection="in"
                    zoomKey={0}
                  />
                </Suspense>
              </DrawingErrorBoundary>
              <Button
                size="sm"
                variant="secondary"
                className="absolute right-3 top-3"
                onClick={() => setFitKey((key) => key + 1)}
              >
                <RotateCcw /> Reset view
              </Button>
              <div className="pointer-events-none absolute bottom-2 left-2 rounded bg-black/55 px-2 py-1 text-[11px] text-white">
                Drag to orbit · Scroll to zoom · Right-drag to pan. The model is built from this
                drawing's facets and elevations — switch back to Sketch to keep editing.
              </div>
            </>
          )}
        </div>

        {/* ---------- right panel ---------- */}
        <aside className="flex w-72 shrink-0 flex-col gap-4 overflow-y-auto border-l border-border bg-background p-3">
          <section>
            <h3 className="mb-2 text-sm font-semibold text-primary">Drawing Options</h3>
            {(
              [
                [
                  "90 Mode",
                  ninetyMode,
                  setNinetyMode,
                  "Snap new and dragged segments to right-angle / 45° family angles",
                ],
                [
                  "Line Length",
                  showLengths,
                  setShowLengths,
                  "Show each edge's length on the drawing",
                ],
                [
                  "Line Labels",
                  showLabels,
                  setShowLabels,
                  "Show each edge's type name on the drawing",
                ],
              ] as const
            ).map(([label, value, setValue, hint]) => (
              <div key={label} className="flex items-center justify-between gap-2 py-1.5">
                <div>
                  <p className="text-sm font-medium">{label}</p>
                  <p className="text-[11px] text-muted-foreground">{hint}</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={value}
                  aria-label={label}
                  onClick={() => setValue(!value)}
                  className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${value ? "bg-primary" : "bg-muted-foreground/40"}`}
                >
                  <span
                    className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${value ? "left-[22px]" : "left-0.5"}`}
                  />
                </button>
              </div>
            ))}
          </section>

          {mode === "edges" && (
            <section>
              <h3 className="mb-2 text-sm font-semibold text-primary">Edge Actions</h3>
              {selectedEdgeData ? (
                <p className="mb-2 text-xs text-muted-foreground">
                  Edge {selectedEdge!.edgeIndex + 1} · {selectedEdgeData.plane.name} ·{" "}
                  {formatEdgeLength(selectedEdgeData.length)}
                </p>
              ) : (
                <p className="mb-2 text-xs text-muted-foreground">
                  Click an edge in the drawing to select it.
                </p>
              )}
              <div className="flex flex-col gap-1">
                {SKETCH_EDGE_ACTION_ORDER.map((type) => {
                  const style = SKETCH_EDGE_STYLES[type];
                  const active = selectedEdgeData?.type === type;
                  return (
                    <button
                      key={type}
                      type="button"
                      disabled={!selectedEdgeData}
                      onClick={() => {
                        if (!selectedEdge) return;
                        commit(
                          retypeEdge(drawing, selectedEdge.planeId, selectedEdge.edgeIndex, type),
                        );
                      }}
                      className={`flex items-center gap-2 rounded-md border px-2 py-1.5 text-left text-sm disabled:opacity-45 ${
                        active
                          ? "border-primary bg-primary/10 font-semibold"
                          : "border-border hover:bg-muted"
                      }`}
                    >
                      <span
                        aria-hidden="true"
                        className="inline-block h-3 w-3 rounded-sm"
                        style={{ backgroundColor: style.color }}
                      />
                      {style.label}
                    </button>
                  );
                })}
              </div>
              <div className="mt-3 flex flex-col gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!selectedEdgeData}
                  onClick={() => {
                    if (!selectedEdge) return;
                    const next = deleteEdge(drawing, selectedEdge.planeId, selectedEdge.edgeIndex);
                    if (!next) {
                      setError("A facet needs at least 3 corners — this edge cannot be deleted.");
                      return;
                    }
                    commit(next);
                    setSelectedEdge(null);
                  }}
                >
                  <Trash2 /> Delete Edge
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!drawing.planes.length}
                  onClick={() => {
                    if (
                      !window.confirm(
                        "Delete every edge and facet in this sketch? You can undo it.",
                      )
                    )
                      return;
                    commit(deleteAllEdges(drawing));
                    setSelectedEdge(null);
                  }}
                >
                  <Trash2 /> Delete All Edges
                </Button>
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">
                Deleting an edge removes the corner at its end and merges the two neighbouring edges
                into one. Step, wall and pitch-change classifications are not stored in drawings, so
                they are not offered here.
              </p>
            </section>
          )}

          {mode === "facets" && (
            <section>
              <h3 className="mb-2 text-sm font-semibold text-primary">Facets</h3>
              <div className="mb-3 flex flex-col gap-1">
                {drawing.planes.map((plane) => {
                  const info = planePitchArea(plane);
                  return (
                    <button
                      key={plane.id}
                      type="button"
                      onClick={() => setSelectedPlaneId(plane.id)}
                      className={`rounded-md border px-2 py-1.5 text-left text-sm ${
                        plane.id === selectedPlaneId
                          ? "border-primary bg-primary/10 font-semibold"
                          : "border-border hover:bg-muted"
                      }`}
                    >
                      {plane.name}
                      <span className="block text-[11px] font-normal text-muted-foreground">
                        {info
                          ? `${info.pitch.toFixed(1)}/12 pitch · ${Math.round(info.area)} sf`
                          : "Not measurable — check the outline"}
                      </span>
                    </button>
                  );
                })}
                {!drawing.planes.length && (
                  <p className="text-xs text-muted-foreground">No facets yet — draw one.</p>
                )}
              </div>
              {selectedPlane && (
                <div className="flex flex-col gap-2">
                  <label className="text-xs font-medium">
                    Facet name
                    <Input
                      className="mt-1"
                      value={selectedPlane.name}
                      onChange={(event) =>
                        transient({
                          ...drawing,
                          planes: drawing.planes.map((plane) =>
                            plane.id === selectedPlane.id
                              ? { ...plane, name: event.target.value }
                              : plane,
                          ),
                        })
                      }
                      onBlur={endTransient}
                    />
                  </label>
                  <div className="flex items-end gap-2">
                    <label className="text-xs font-medium">
                      Set pitch (rise / 12)
                      <Input
                        className="mt-1 w-20"
                        type="number"
                        min="0"
                        max="24"
                        step="0.5"
                        value={facetPitch}
                        onChange={(event) => setFacetPitch(event.target.value)}
                      />
                    </label>
                    <label className="text-xs font-medium">
                      Rising toward
                      <select
                        className="mt-1 block h-9 rounded-md border border-input bg-background px-2 text-sm"
                        value={facetDirection}
                        onChange={(event) =>
                          setFacetDirection(event.target.value as PitchDirection)
                        }
                        aria-label="Pitch rises toward"
                      >
                        <option value="north">North</option>
                        <option value="south">South</option>
                        <option value="east">East</option>
                        <option value="west">West</option>
                      </select>
                    </label>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        const pitch = Number(facetPitch);
                        if (!Number.isFinite(pitch) || pitch < 0 || pitch > 24) {
                          setError("Pitch must be between 0 and 24.");
                          return;
                        }
                        commit({
                          ...drawing,
                          planes: drawing.planes.map((plane) =>
                            plane.id === selectedPlane.id
                              ? applyPitchToPlane(plane, pitch, facetDirection)
                              : plane,
                          ),
                        });
                      }}
                    >
                      Apply
                    </Button>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      commit({
                        ...drawing,
                        planes: drawing.planes.filter((plane) => plane.id !== selectedPlane.id),
                      });
                      setSelectedPlaneId(
                        drawing.planes.find((plane) => plane.id !== selectedPlane.id)?.id ?? "",
                      );
                    }}
                  >
                    <Trash2 /> Delete facet
                  </Button>
                </div>
              )}
              <Button
                size="sm"
                className="mt-3"
                onClick={() => {
                  setDraftPoints([]);
                  setMode("draw");
                }}
              >
                <Plus /> Add facet (Draw)
              </Button>
            </section>
          )}

          {mode === "draw" && (
            <section>
              <h3 className="mb-2 text-sm font-semibold text-primary">Draw Facet</h3>
              <p className="text-xs text-muted-foreground">
                Click corners around one roof facet. {draftPoints.length} corner
                {draftPoints.length === 1 ? "" : "s"} placed
                {draftPoints.length >= 3 ? " — click the first (yellow) corner to close it." : "."}
              </p>
              <div className="mt-2 flex items-end gap-2">
                <label className="text-xs font-medium">
                  Pitch (rise / 12)
                  <Input
                    className="mt-1 w-20"
                    type="number"
                    min="0"
                    max="24"
                    step="0.5"
                    value={draftPitch}
                    onChange={(event) => setDraftPitch(event.target.value)}
                  />
                </label>
                <label className="text-xs font-medium">
                  Rising toward
                  <select
                    className="mt-1 block h-9 rounded-md border border-input bg-background px-2 text-sm"
                    value={draftDirection}
                    onChange={(event) => setDraftDirection(event.target.value as PitchDirection)}
                    aria-label="New facet pitch rises toward"
                  >
                    <option value="north">North</option>
                    <option value="south">South</option>
                    <option value="east">East</option>
                    <option value="west">West</option>
                  </select>
                </label>
              </div>
              <div className="mt-3 flex gap-2">
                <Button size="sm" disabled={draftPoints.length < 3} onClick={finishDraft}>
                  Finish facet
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!draftPoints.length}
                  onClick={() => setDraftPoints([])}
                >
                  Clear draft
                </Button>
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">
                New facets start flat at the roof's lowest elevation with every edge Unlabeled — set
                the pitch here before finishing, then classify edges in Edges mode. In Draw mode you
                can also click a white midpoint handle on the selected facet to insert a corner on
                that edge.
              </p>
            </section>
          )}

          {mode === "pins" && (
            <section>
              <h3 className="mb-2 text-sm font-semibold text-primary">Pins</h3>
              <p className="text-xs text-muted-foreground">
                Pins mark penetrations and are saved with the drawing. Click the roof to drop one;
                drag to move it.
              </p>
              {selectedPin ? (
                <div className="mt-2 flex flex-col gap-2">
                  <label className="text-xs font-medium">
                    Pin type
                    <select
                      className="mt-1 block h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                      value={selectedPin.kind}
                      onChange={(event) =>
                        commit({
                          ...drawing,
                          penetrations: drawing.penetrations.map((pin) =>
                            pin.id === selectedPin.id
                              ? { ...pin, kind: event.target.value as Penetration["kind"] }
                              : pin,
                          ),
                        })
                      }
                      aria-label="Pin type"
                    >
                      {Object.entries(PENETRATION_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="flex gap-2">
                    <label className="text-xs font-medium">
                      Width (ft)
                      <Input
                        className="mt-1 w-20"
                        type="number"
                        min="0.1"
                        step="0.5"
                        value={selectedPin.width}
                        onChange={(event) =>
                          transient({
                            ...drawing,
                            penetrations: drawing.penetrations.map((pin) =>
                              pin.id === selectedPin.id
                                ? {
                                    ...pin,
                                    width: Math.max(0.1, Number(event.target.value) || 0.1),
                                  }
                                : pin,
                            ),
                          })
                        }
                        onBlur={endTransient}
                      />
                    </label>
                    <label className="text-xs font-medium">
                      Length (ft)
                      <Input
                        className="mt-1 w-20"
                        type="number"
                        min="0.1"
                        step="0.5"
                        value={selectedPin.length}
                        onChange={(event) =>
                          transient({
                            ...drawing,
                            penetrations: drawing.penetrations.map((pin) =>
                              pin.id === selectedPin.id
                                ? {
                                    ...pin,
                                    length: Math.max(0.1, Number(event.target.value) || 0.1),
                                  }
                                : pin,
                            ),
                          })
                        }
                        onBlur={endTransient}
                      />
                    </label>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      commit({
                        ...drawing,
                        penetrations: drawing.penetrations.filter(
                          (pin) => pin.id !== selectedPin.id,
                        ),
                      });
                      setSelectedPinId(null);
                    }}
                  >
                    <Trash2 /> Delete pin
                  </Button>
                </div>
              ) : (
                <p className="mt-2 text-xs text-muted-foreground">No pin selected.</p>
              )}
              {!!drawing.penetrations.length && (
                <p className="mt-2 text-[11px] text-muted-foreground">
                  {drawing.penetrations.length} pin{drawing.penetrations.length === 1 ? "" : "s"} on
                  this drawing.
                </p>
              )}
            </section>
          )}

          <p className="mt-auto text-[11px] text-muted-foreground">
            Done saves a new drawing revision through the workspace and marks it unreviewed, like
            any other measurement edit. Cancel discards your changes.
          </p>
        </aside>
      </div>

      {/* ---------- hint / error bar ---------- */}
      <div className="border-t border-border px-3 py-1.5 text-xs" role="status">
        {error ? (
          <span className="font-medium text-destructive">{error}</span>
        ) : (
          <span className="text-muted-foreground">
            {view === "3d"
              ? "3D view — drag to orbit, scroll to zoom, right-drag to pan."
              : hints[mode]}
            {changed ? " · Unsaved edits in this editor" : ""}
          </span>
        )}
      </div>

      <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Sketch help</DialogTitle>
            <DialogDescription>
              Correct a measured roof drawing by hand, over the property's satellite photo.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 text-sm">
            <p>
              <strong>Draw</strong> — click corners to outline a new facet; click the first corner
              again to close it. Click a white midpoint handle on the selected facet to insert a
              corner on that edge.
            </p>
            <p>
              <strong>Edges</strong> — click an edge to select it, then colour-code it (eave, rake,
              ridge, hip, valley) or delete it. Lengths update live as you drag corners.
            </p>
            <p>
              <strong>Facets</strong> — select a facet to see its pitch and area, re-slope it, or
              delete it.
            </p>
            <p>
              <strong>Pins</strong> — drop markers for pipes, vents, skylights and chimneys; they
              save with the drawing.
            </p>
            <p>
              <strong>3D</strong> — orbit a three-dimensional model built from this drawing's facets
              and elevations.
            </p>
            <p>
              Drag green corners to reshape. Drag the map to pan and scroll to zoom — including with
              a Magic Mouse. 90 Mode snaps segments to right-angle and 45° angles. Done saves a new
              revision and marks the drawing unreviewed.
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
