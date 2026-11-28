import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

/**
 * The report workspace's three views, in the order Fredy asked for:
 * the actual house photo first, then the 3D house, then the 2D plan.
 */
export type WorkspaceView = "photo" | "3d" | "plan";

export const WORKSPACE_VIEWS: { id: WorkspaceView; label: string }[] = [
  { id: "photo", label: "House photo" },
  { id: "3d", label: "3D House" },
  { id: "plan", label: "2D Plan" },
];

/**
 * Fallback source label for a cover photo whose exact source isn't
 * recorded (the cached aerial-cover.jpg stores no source metadata).
 * Mirrors REPORT_AERIAL_SOURCE in src/lib/report-aerial.server.ts —
 * that module is server-only and cannot be imported into the
 * browser bundle, so the string is kept in step here. A photo
 * fetched fresh through the server function carries its own exact
 * per-source attribution (county GIS / USDA NAIP) and that is what
 * the view shows instead.
 */
export const NAIP_AERIAL_SOURCE_LABEL = "USDA National Agriculture Imagery Program (NAIP)";

export type HousePhotoState =
  | { status: "loading" }
  | { status: "ready"; url: string; source: string }
  | { status: "unavailable" };

/**
 * Which view a freshly opened workspace shows: the house photo,
 * unless no aerial photo exists for the property — then the 3D
 * house, so the first thing seen is never an empty photo pane.
 */
export function defaultWorkspaceView(photoStatus: HousePhotoState["status"]): WorkspaceView {
  return photoStatus === "unavailable" ? "3d" : "photo";
}

export function WorkspaceViewTabs({
  view,
  onChange,
}: {
  view: WorkspaceView;
  onChange: (view: WorkspaceView) => void;
}) {
  return (
    <>
      {WORKSPACE_VIEWS.map((item) => (
        <Button
          key={item.id}
          size="sm"
          variant={view === item.id ? "secondary" : "ghost"}
          aria-pressed={view === item.id}
          onClick={() => onChange(item.id)}
        >
          {item.label}
        </Button>
      ))}
    </>
  );
}

const MIN_PHOTO_SCALE = 1;
const MAX_PHOTO_SCALE = 5;
const PHOTO_ZOOM_STEP = 1.3;

/**
 * View-only display of the property's actual aerial photo — the
 * same photo the automatic flow prints on the report PDF cover.
 * The workspace toolbar's zoom in/out and fit buttons drive the
 * scale through the same zoomKey/fitKey signals the 3D/2D scene
 * uses; dragging pans while zoomed in. No editing affordances.
 */
export function HousePhotoView({
  photo,
  zoomDirection,
  zoomKey,
  fitKey,
}: {
  photo: HousePhotoState;
  zoomDirection: "in" | "out";
  zoomKey: number;
  fitKey: number;
}) {
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const drag = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    baseX: number;
    baseY: number;
  } | null>(null);
  const lastZoomKey = useRef(zoomKey);
  const lastFitKey = useRef(fitKey);

  useEffect(() => {
    if (lastZoomKey.current === zoomKey) return;
    lastZoomKey.current = zoomKey;
    setScale((current) => {
      const next =
        zoomDirection === "in"
          ? Math.min(MAX_PHOTO_SCALE, current * PHOTO_ZOOM_STEP)
          : Math.max(MIN_PHOTO_SCALE, current / PHOTO_ZOOM_STEP);
      if (next === MIN_PHOTO_SCALE) setOffset({ x: 0, y: 0 });
      return next;
    });
  }, [zoomKey, zoomDirection]);

  useEffect(() => {
    if (lastFitKey.current === fitKey) return;
    lastFitKey.current = fitKey;
    setScale(1);
    setOffset({ x: 0, y: 0 });
  }, [fitKey]);

  // A new photo starts fitted to the frame.
  const photoUrlKey = photo.status === "ready" ? photo.url : photo.status;
  useEffect(() => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  }, [photoUrlKey]);

  if (photo.status === "loading") {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <p className="text-sm text-muted-foreground" role="status">
          Loading the aerial photo of this property…
        </p>
      </div>
    );
  }
  if (photo.status === "unavailable") {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <p className="max-w-md text-center text-sm text-muted-foreground">
          No aerial photo available for this property. The 3D House and 2D Plan views still show the
          measured roof.
        </p>
      </div>
    );
  }
  return (
    <figure className="flex h-full flex-col">
      <div
        className="min-h-0 flex-1 overflow-hidden"
        style={{ touchAction: scale > 1 ? "none" : undefined }}
        onPointerDown={(event) => {
          if (scale <= 1) return;
          drag.current = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            baseX: offset.x,
            baseY: offset.y,
          };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const current = drag.current;
          if (!current || current.pointerId !== event.pointerId) return;
          const limit = 240 * scale;
          const clamp = (value: number) => Math.max(-limit, Math.min(limit, value));
          setOffset({
            x: clamp(current.baseX + event.clientX - current.startX),
            y: clamp(current.baseY + event.clientY - current.startY),
          });
        }}
        onPointerUp={(event) => {
          if (drag.current?.pointerId === event.pointerId) drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
      >
        <img
          src={photo.url}
          alt="Aerial photo of this property"
          draggable={false}
          className="h-full w-full select-none object-contain"
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
            cursor: scale > 1 ? "grab" : undefined,
          }}
        />
      </div>
      <figcaption className="shrink-0 px-3 py-2 text-xs text-muted-foreground">
        Actual aerial photo of this property — the same photo printed on the report cover. Source:{" "}
        {photo.source}
      </figcaption>
    </figure>
  );
}
