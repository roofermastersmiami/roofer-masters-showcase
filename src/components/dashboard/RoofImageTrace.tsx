import { useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Ruler,
  Plus,
  Undo2,
  Trash2,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  Hand,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  calibratedPlane,
  checkCalibration,
  findSharedEdges,
  snapToExistingCorner,
  validateRoofOutline,
  nextEdgeType,
  UPHILL_LABELS,
  type ImagePoint,
  type Uphill,
} from "@/lib/roof-trace";
import { planeInfo, type EdgeType, type RoofPlane } from "@/lib/roof-geometry";
import { Field, Choice } from "./CrmControls";

const EDGE_SHORT: Record<EdgeType, string> = {
  eave: "Eave",
  rake: "Rake",
  ridge: "Ridge",
  hip: "Hip",
  valley: "Valley",
  other: "Other",
};
type Traced = { id: string; name: string; points: ImagePoint[] };

export function RoofImageTrace({
  path,
  onAdd,
}: {
  path: string;
  onAdd: (plane: RoofPlane, replace: boolean) => void;
}) {
  const photo = useQuery({
    queryKey: ["trace-photo", path],
    queryFn: async () => {
      const { data, error } = await supabase.storage
        .from("roof-job-photos")
        .createSignedUrl(path, 300);
      if (error || !data) throw error;
      return data.signedUrl;
    },
  });
  const [mode, setMode] = useState<"calibrate" | "trace">("calibrate");
  const [reference, setReference] = useState<ImagePoint[]>([]);
  const [points, setPoints] = useState<ImagePoint[]>([]);
  const [edges, setEdges] = useState<EdgeType[]>([]);
  const [feet, setFeet] = useState(0);
  const [pitch, setPitch] = useState(6);
  const [uphill, setUphill] = useState<Uphill>("up");
  const [name, setName] = useState("");
  const [dimensions, setDimensions] = useState({ width: 1000, height: 700 });
  const [photoZoom, setPhotoZoom] = useState(1);
  const [photoPan, setPhotoPan] = useState({ x: 0, y: 0 });
  const [photoTarget, setPhotoTarget] = useState<ImagePoint>(() => ({ x: 500, y: 350 }));
  const [panMode, setPanMode] = useState(false);
  const panDrag = useRef<{ x: number; y: number } | null>(null);
  const pinch = useRef<{ distance: number; zoom: number } | null>(null);
  const [replace, setReplace] = useState(true);
  const [snapCorners, setSnapCorners] = useState(true);
  const [traced, setTraced] = useState<Traced[]>([]);
  const drag = useRef<{ kind: "ref" | "pt" | "target"; i: number } | null>(null);
  const moved = useRef(false);
  const svg = useRef<SVGSVGElement>(null);
  const w = dimensions.width;
  const calibration = checkCalibration(reference, feet, w, dimensions.height);
  const outlineIssues = points.length >= 3 ? validateRoofOutline(points) : [];
  const sharedEdgeMatches =
    points.length >= 3
      ? traced.flatMap((plane) =>
          findSharedEdges(points, plane.points, Math.max(3, w * 0.006)).map((match) => ({
            ...match,
            planeName: plane.name,
          })),
        )
      : [];

  const toImage = (clientX: number, clientY: number) => {
    const surface = svg.current;
    if (!surface) return null;
    // Use the SVG's inverse screen transform so photo zoom/pan and responsive
    // sizing are included when converting pointer coordinates to image pixels.
    const matrix = surface.getScreenCTM();
    if (!matrix) return null;
    const point = surface.createSVGPoint();
    point.x = clientX;
    point.y = clientY;
    const local = point.matrixTransform(matrix.inverse());
    return local.x < 0 || local.y < 0 || local.x > dimensions.width || local.y > dimensions.height
      ? null
      : { x: local.x, y: local.y };
  };
  const addPoint = (p: ImagePoint) => {
    if (mode === "calibrate") setReference(reference.length === 2 ? [p] : [...reference, p]);
    else {
      const next = snapCorners
        ? snapToExistingCorner(
            p,
            traced.flatMap((plane) => plane.points),
            Math.max(6, w * 0.012),
          )
        : p;
      setPoints([...points, next]);
      setEdges([...edges, "other"]);
    }
  };
  const onMove = (e: RPointerEvent<SVGSVGElement>) => {
    if (panDrag.current) {
      const dx = e.clientX - panDrag.current.x;
      const dy = e.clientY - panDrag.current.y;
      panDrag.current = { x: e.clientX, y: e.clientY };
      setPhotoPan((p) => ({ x: p.x + dx, y: p.y + dy }));
      return;
    }
    if (!drag.current) return;
    const p = toImage(e.clientX, e.clientY);
    if (!p) return;
    moved.current = true;
    const { kind, i } = drag.current;
    if (kind === "target") {
      setPhotoTarget(p);
    } else if (kind === "ref") setReference((r) => r.map((q, j) => (j === i ? p : q)));
    else {
      const next = snapCorners
        ? snapToExistingCorner(
            p,
            traced.flatMap((plane) => plane.points),
            Math.max(6, w * 0.012),
          )
        : p;
      setPoints((r) => r.map((q, j) => (j === i ? next : q)));
    }
  };
  const startDrag = (kind: "ref" | "pt" | "target", i = 0) => (e: RPointerEvent) => {
    if (panMode) return;
    e.stopPropagation();
    drag.current = { kind, i };
    moved.current = false;
    svg.current?.setPointerCapture(e.pointerId);
  };

  let preview: { area: number; perimeter: number } | null = null;
  if (points.length >= 3 && calibration.ok) {
    try {
      const info = planeInfo(
        calibratedPlane(points, reference, feet, pitch, "p", { uphill, edges }),
      );
      const pl = calibratedPlane(points, reference, feet, pitch, "p", { uphill, edges });
      preview = {
        area: info.area,
        perimeter: pl.points.reduce((s, a, i) => {
          const b = pl.points[(i + 1) % pl.points.length]!;
          return s + Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
        }, 0),
      };
    } catch {
      preview = null;
    }
  }

  const add = () => {
    try {
      const id = crypto.randomUUID();
      const label = name.trim() || `Traced plane ${traced.length + 1}`;
      onAdd(
        calibratedPlane(points, reference, feet, pitch, id, { uphill, edges, name: label }),
        replace,
      );
      setTraced((t) =>
        replace ? [{ id, name: label, points }] : [...t, { id, name: label, points }],
      );
      setReplace(false);
      setPoints([]);
      setEdges([]);
      setName("");
      toast.success(
        `${label} added as unverified. Trace the next plane on the same photo, or review and verify.`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not measure traced plane");
    }
  };

  return (
    <section className="border-t border-border py-6">
      <h3 className="mb-2 text-lg font-bold">Calibrated photo tracing</h3>
      <div className="mb-4 space-y-1 text-sm text-muted-foreground">
        <p>
          1. Set scale: click both ends of something you measured (a wall, eave or driveway) and
          enter its real length. 2. Trace one roof plane at a time — click corners, drag dots to
          adjust, click edge labels to set Eave / Rake / Ridge / Hip / Valley. 3. Enter that plane's
          pitch and which way it rises. 4. Add plane, repeat for every plane on the same photo.
        </p>
        <p>
          Photos only give flat (plan) size; slope comes from the pitch you enter. Results stay
          estimates until you check them on site and mark the report verified. Not survey-grade.
        </p>
      </div>
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <Button
          variant={mode === "calibrate" ? "secondary" : "outline"}
          onClick={() => {
            setMode("calibrate");
            setReference([]);
          }}
        >
          <Ruler /> Set two scale points
        </Button>
        <Field label="Known distance (ft)">
          <Input
            className="w-28"
            type="number"
            min={0.1}
            value={feet || ""}
            onChange={(e) => setFeet(Number(e.target.value))}
          />
        </Field>
        <Button
          variant={mode === "trace" ? "secondary" : "outline"}
          disabled={!calibration.ok}
          onClick={() => setMode("trace")}
        >
          Trace roof plane
        </Button>
      </div>
      <p
        className={`mb-3 text-sm ${calibration.ok ? "text-muted-foreground" : "text-destructive"}`}
      >
        {calibration.ok
          ? `Scale: ${calibration.ftPerPx.toFixed(3)} ft per pixel.`
          : calibration.message}
        {calibration.ok &&
          calibration.warnings.map((m) => (
            <span key={m} className="block text-destructive">
              {m}
            </span>
          ))}
      </p>
      {photo.data ? (
        <div className="relative w-full overflow-hidden rounded-md border border-border">
          <div className="absolute left-2 top-2 z-20 rounded-md bg-background/95 px-2 py-1 text-xs font-semibold shadow">
            Red pin = photo target · drag it onto the house
          </div>
          <div className="absolute right-2 top-2 z-20 flex max-w-[calc(100%-1rem)] flex-wrap items-center gap-1 rounded-md border bg-background/95 p-1 shadow">
            <Button
              type="button"
              size="icon"
              variant={panMode ? "secondary" : "outline"}
              aria-label={panMode ? "Exit photo pan mode" : "Pan photo by dragging"}
              title={panMode ? "Exit pan mode" : "Drag photo"}
              onClick={() => {
                setPanMode((v) => !v);
                panDrag.current = null;
              }}
            >
              <Hand />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="outline"
              aria-label="Zoom out photo"
              disabled={photoZoom <= 1}
              onClick={() => setPhotoZoom((v) => Math.max(1, Number((v / 1.25).toFixed(2))))}
            >
              <ZoomOut />
            </Button>
            <span className="flex min-w-12 items-center justify-center text-xs tabular-nums">
              {photoZoom.toFixed(1)}×
            </span>
            <Button
              type="button"
              size="icon"
              variant="outline"
              aria-label="Zoom in photo"
              disabled={photoZoom >= 5}
              onClick={() => setPhotoZoom((v) => Math.min(5, Number((v * 1.25).toFixed(2))))}
            >
              <ZoomIn />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="outline"
              aria-label="Move photo up"
              onClick={() => setPhotoPan((p) => ({ ...p, y: p.y - 48 }))}
            >
              <ArrowUp />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="outline"
              aria-label="Move photo down"
              onClick={() => setPhotoPan((p) => ({ ...p, y: p.y + 48 }))}
            >
              <ArrowDown />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="outline"
              aria-label="Move photo left"
              onClick={() => setPhotoPan((p) => ({ ...p, x: p.x - 48 }))}
            >
              <ArrowLeft />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="outline"
              aria-label="Move photo right"
              onClick={() => setPhotoPan((p) => ({ ...p, x: p.x + 48 }))}
            >
              <ArrowRight />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label="Reset photo zoom"
              disabled={photoZoom === 1 && photoPan.x === 0 && photoPan.y === 0}
              onClick={() => {
                setPhotoZoom(1);
                setPhotoPan({ x: 0, y: 0 });
                setPanMode(false);
                panDrag.current = null;
              }}
            >
              <RotateCcw />
            </Button>
          </div>
          <img
            src={photo.data}
            alt="Roof photo used for measuring"
            className="block max-h-[640px] w-full select-none object-contain"
            style={{
              transform: `translate(${photoPan.x}px, ${photoPan.y}px) scale(${photoZoom})`,
              transformOrigin: "center center",
            }}
            draggable={false}
            onLoad={(e) => {
              const width = e.currentTarget.naturalWidth,
                height = e.currentTarget.naturalHeight;
              setDimensions({ width, height });
            }}
          />
          <svg
            ref={svg}
            className="absolute inset-0 h-full w-full touch-none text-primary"
            viewBox={`0 0 ${dimensions.width} ${dimensions.height}`}
            preserveAspectRatio="xMidYMid meet"
            aria-label="Roof tracing surface"
            onPointerDown={(event) => {
              if (!panMode) return;
              event.preventDefault();
              panDrag.current = { x: event.clientX, y: event.clientY };
              svg.current?.setPointerCapture(event.pointerId);
            }}
            onPointerMove={onMove}
            onWheelCapture={(event) => {
              event.preventDefault();
              if (Math.abs(event.deltaY) < 1) return;
              setPhotoZoom((value) =>
                event.deltaY < 0
                  ? Math.min(5, Number((value * 1.15).toFixed(2)))
                  : Math.max(1, Number((value / 1.15).toFixed(2))),
              );
            }}
            style={{
              touchAction: "none",
              cursor: panMode ? "grab" : "crosshair",
              transform: `translate(${photoPan.x}px, ${photoPan.y}px) scale(${photoZoom})`,
              transformOrigin: "center center",
            }}
            onTouchStart={(event) => {
              if (event.touches.length === 2) {
                event.preventDefault();
                const a = event.touches[0]!;
                const b = event.touches[1]!;
                pinch.current = {
                  distance: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
                  zoom: photoZoom,
                };
              }
            }}
            onTouchMove={(event) => {
              if (event.touches.length !== 2 || !pinch.current) return;
              event.preventDefault();
              const a = event.touches[0]!;
              const b = event.touches[1]!;
              const distance = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
              setPhotoZoom(
                Math.max(1, Math.min(5, pinch.current.zoom * (distance / pinch.current.distance))),
              );
            }}
            onTouchEnd={(event) => {
              if (event.touches.length < 2) pinch.current = null;
            }}
            onPointerUp={() => {
              drag.current = null;
              panDrag.current = null;
            }}
            onClick={(e) => {
              if (panMode) return;
              if (moved.current) {
                moved.current = false;
                return;
              }
              const p = toImage(e.clientX, e.clientY);
              if (p) addPoint(p);
            }}
          >
            {
              <g pointerEvents="none">
                <circle
                  cx={photoTarget.x}
                  cy={photoTarget.y}
                  r={Math.max(18, w / 45)}
                  fill="#dc2626"
                  fillOpacity="0.16"
                  stroke="#dc2626"
                  strokeWidth={w / 300}
                />
                <circle
                  cx={photoTarget.x}
                  cy={photoTarget.y}
                  r={Math.max(7, w / 120)}
                  fill="#dc2626"
                  stroke="white"
                  strokeWidth={w / 300}
                />
                <text
                  x={photoTarget.x + w / 35}
                  y={photoTarget.y - w / 45}
                  fontSize={w / 45}
                  fontWeight="700"
                  fill="white"
                  stroke="#111827"
                  strokeWidth="4"
                  paintOrder="stroke"
                >
                  PHOTO TARGET
                </text>
              </g>
            }
            {traced.map((t) => (
              <g key={t.id} className="text-muted-foreground">
                <polygon
                  points={t.points.map((p) => `${p.x},${p.y}`).join(" ")}
                  fill="currentColor"
                  fillOpacity={0.15}
                  stroke="currentColor"
                  strokeDasharray={`${w / 120}`}
                  strokeWidth={w / 400}
                />
                <text
                  x={t.points.reduce((s, p) => s + p.x, 0) / t.points.length}
                  y={t.points.reduce((s, p) => s + p.y, 0) / t.points.length}
                  fontSize={w / 50}
                  textAnchor="middle"
                  fill="currentColor"
                >
                  {t.name}
                </text>
              </g>
            ))}
            {reference.length === 2 && (
              <line
                x1={reference[0]?.x}
                y1={reference[0]?.y}
                x2={reference[1]?.x}
                y2={reference[1]?.y}
                stroke="currentColor"
                strokeWidth={w / 250}
                strokeDasharray={`${w / 80}`}
              />
            )}
            <polygon
              points={points.map((p) => `${p.x},${p.y}`).join(" ")}
              fill="currentColor"
              fillOpacity={0.25}
              stroke="currentColor"
              strokeWidth={w / 300}
            />
            {points.length >= 3 &&
              points.map((p, i) => {
                const q = points[(i + 1) % points.length]!;
                return (
                  <g
                    key={`e${i}`}
                    role="button"
                    aria-label={`Edge ${i + 1}: ${edges[i]}. Click to change`}
                    onClick={(ev) => {
                      ev.stopPropagation();
                      setEdges((es) => es.map((t, j) => (j === i ? nextEdgeType(t) : t)));
                    }}
                    className="cursor-pointer"
                  >
                    <rect
                      x={(p.x + q.x) / 2 - w / 28}
                      y={(p.y + q.y) / 2 - w / 70}
                      width={w / 14}
                      height={w / 35}
                      rx={w / 200}
                      className="fill-background"
                      stroke="currentColor"
                      strokeWidth={w / 600}
                    />
                    <text
                      x={(p.x + q.x) / 2}
                      y={(p.y + q.y) / 2 + w / 200}
                      fontSize={w / 60}
                      textAnchor="middle"
                      className="fill-foreground"
                    >
                      {EDGE_SHORT[edges[i] ?? "other"]}
                    </text>
                  </g>
                );
              })}
            <g
              className="cursor-move"
              onPointerDown={startDrag("target")}
              onClick={(event) => event.stopPropagation()}
              role="button"
              aria-label="Drag photo target"
              tabIndex={0}
              onKeyDown={(event) => {
                const step = event.shiftKey ? 25 : 5;
                if (event.key === "ArrowUp") setPhotoTarget((p) => ({ ...p, y: Math.max(0, p.y - step) }));
                else if (event.key === "ArrowDown") setPhotoTarget((p) => ({ ...p, y: Math.min(dimensions.height, p.y + step) }));
                else if (event.key === "ArrowLeft") setPhotoTarget((p) => ({ ...p, x: Math.max(0, p.x - step) }));
                else if (event.key === "ArrowRight") setPhotoTarget((p) => ({ ...p, x: Math.min(dimensions.width, p.x + step) }));
                else return;
                event.preventDefault();
              }}
            >
              <circle cx={photoTarget.x} cy={photoTarget.y} r={Math.max(18, w / 45)} fill="transparent" />
              <circle cx={photoTarget.x} cy={photoTarget.y} r={Math.max(12, w / 75)} fill="transparent" stroke="transparent" />
            </g>
            {reference.map((p, i) => (
              <circle
                key={`r${i}`}
                cx={p.x}
                cy={p.y}
                r={w / 100}
                className="cursor-move fill-destructive"
                onPointerDown={startDrag("ref", i)}
                onClick={(e) => e.stopPropagation()}
              />
            ))}
            {points.map((p, i) => (
              <circle
                key={`p${i}`}
                cx={p.x}
                cy={p.y}
                r={w / 90}
                fill="currentColor"
                strokeWidth={w / 600}
                className="cursor-move stroke-background"
                onPointerDown={startDrag("pt", i)}
                onClick={(e) => e.stopPropagation()}
              />
            ))}
          </svg>
        </div>
      ) : (
        <p>{photo.error ? "Photo unavailable" : "Loading photo…"}</p>
      )}
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <Field label="Plane name">
          <Input
            className="w-40"
            value={name}
            maxLength={100}
            placeholder={`Traced plane ${traced.length + 1}`}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field label="Pitch (rise / 12)">
          <Input
            className="w-24"
            type="number"
            min={0}
            max={24}
            value={pitch}
            onChange={(e) => setPitch(Number(e.target.value))}
          />
        </Field>
        <div className="w-52">
          <Choice
            label="Roof rises (eave → ridge)"
            value={uphill}
            onChange={(v) => setUphill(v as Uphill)}
            options={(Object.keys(UPHILL_LABELS) as Uphill[]).map((k) => ({
              value: k,
              label: UPHILL_LABELS[k],
            }))}
          />
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Undo last corner"
          title="Undo last corner"
          disabled={!points.length}
          onClick={() => {
            setPoints(points.slice(0, -1));
            setEdges(edges.slice(0, -1));
          }}
        >
          <Undo2 />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Clear current plane"
          title="Clear current plane"
          disabled={!points.length}
          onClick={() => {
            setPoints([]);
            setEdges([]);
          }}
        >
          <Trash2 />
        </Button>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-sm text-muted-foreground">
            {points.length} corners
            {preview
              ? ` · ${preview.area.toFixed(1)} sq ft sloped · ${preview.perimeter.toFixed(1)} ft perimeter`
              : ""}{" "}
            · {traced.length} plane{traced.length === 1 ? "" : "s"} added from this photo
          </p>
          {outlineIssues.map((issue) => (
            <p key={issue} className="mt-1 text-sm text-destructive">
              {issue}
            </p>
          ))}
          {sharedEdgeMatches.length > 0 && (
            <p className="mt-1 text-sm text-emerald-700 dark:text-emerald-400">
              Shared boundary detected:{" "}
              {sharedEdgeMatches
                .map(
                  (match) =>
                    `edge ${match.edgeA + 1} with ${match.planeName} (within ${match.maxEndpointDistance.toFixed(1)} px)`,
                )
                .join("; ")}
              . Review this connection before verifying the report.
            </p>
          )}
          {traced.length > 0 && points.length >= 3 && sharedEdgeMatches.length === 0 && (
            <p className="mt-1 text-sm text-muted-foreground">
              No matching edge found on the previously traced planes. If these planes should
              connect, review the corner alignment before verifying the report.
            </p>
          )}
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} />{" "}
          Replace existing roof planes
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={snapCorners}
            onChange={(e) => setSnapCorners(e.target.checked)}
          />{" "}
          Snap corners to previous planes
        </label>
        <Button
          disabled={points.length < 3 || !calibration.ok || outlineIssues.length > 0}
          onClick={add}
        >
          <Plus /> Add traced plane
        </Button>
      </div>
    </section>
  );
}
