import { useMemo, useEffect, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, Line, Environment, Lightformer, useTexture } from "@react-three/drei";
import {
  BufferGeometry,
  Float32BufferAttribute,
  DoubleSide,
  CanvasTexture,
  SRGBColorSpace,
} from "three";
import {
  planeInfo,
  distance,
  addressPinPosition,
  addressMarkerPosition,
  type RoofDrawing,
  type RoofPlane,
  type SharedEdgeSuggestion,
} from "@/lib/roof-geometry";
import { PENETRATION_COLORS, ROOF_EDGE_STYLES, ROOF_FACE_COLORS } from "@/lib/roof-feature-styles";
import { planRotationFitFactor } from "@/lib/plan-rotation";
function Dimension({ text, position }: { text: string; position: [number, number, number] }) {
  const texture = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = 256;
    c.height = 64;
    const ctx = c.getContext("2d");
    if (ctx) {
      const css = getComputedStyle(document.documentElement);
      ctx.fillStyle = css.getPropertyValue("--card");
      ctx.fillRect(0, 0, 256, 64);
      ctx.fillStyle = css.getPropertyValue("--foreground");
      ctx.font = "28px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(text, 128, 42);
    }
    const t = new CanvasTexture(c);
    t.colorSpace = SRGBColorSpace;
    return t;
  }, [text]);
  useEffect(() => () => texture.dispose(), [texture]);
  return (
    <sprite position={position} scale={[5, 1.25, 1]}>
      <spriteMaterial map={texture} depthTest={false} depthWrite={false} toneMapped={false} />
    </sprite>
  );
}
function Plane({
  plane,
  selected,
  onSelect,
  colors,
  faceColor,
  suggestions,
}: {
  plane: RoofPlane;
  selected: boolean;
  onSelect: () => void;
  colors: { roof: string; selected: string; edge: string };
  faceColor: string;
  suggestions: SharedEdgeSuggestion[];
}) {
  const geometry = useMemo(() => {
    const g = new BufferGeometry();
    try {
      const info = planeInfo(plane);
      const positions = info.triangles.flatMap((i) => {
        const p = plane.points[i];
        return p ? [p.x, p.y, p.z] : [];
      });
      g.setAttribute("position", new Float32BufferAttribute(positions, 3));
      g.computeVertexNormals();
    } catch {
      // Leave an empty geometry when a plane cannot be triangulated.
    }
    return g;
  }, [plane]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const suggestedEdges = new Map(suggestions.map((item) => [item.edgeIndex, item.type]));
  return (
    <group>
      <mesh
        geometry={geometry}
        onClick={(e) => {
          e.stopPropagation();
          onSelect();
        }}
      >
        <meshStandardMaterial
          color={selected ? colors.selected : faceColor}
          side={DoubleSide}
          roughness={0.65}
          metalness={0.15}
        />
      </mesh>
      {plane.points.map((p, i) => {
        const b = plane.points[(i + 1) % plane.points.length];
        if (!b) return null;
        return (
          <group key={i}>
            <Line
              points={[
                [p.x, p.y + 0.04, p.z],
                [b.x, b.y + 0.04, b.z],
              ]}
              color={ROOF_EDGE_STYLES[suggestedEdges.get(i) ?? plane.edges[i] ?? "other"].color}
              lineWidth={suggestedEdges.has(i) ? 4 : selected ? 3 : 2}
            />
            {selected && (
              <Dimension
                text={`${(suggestedEdges.get(i) ?? plane.edges[i] ?? "other").toUpperCase()}${suggestedEdges.has(i) ? " · SUGGESTED" : ""} · ${distance(p, b).toFixed(1)} ft`}
                position={[(p.x + b.x) / 2, (p.y + b.y) / 2 + 0.55, (p.z + b.z) / 2]}
              />
            )}
          </group>
        );
      })}
    </group>
  );
}
function AerialGround({ url, position }: { url: string; position: [number, number, number] }) {
  const texture = useTexture(url);
  texture.colorSpace = SRGBColorSpace;
  return (
    <mesh rotation-x={-Math.PI / 2} position={position} receiveShadow>
      <planeGeometry args={[393.7, 393.7]} />
      <meshBasicMaterial map={texture} side={DoubleSide} depthWrite={false} />
    </mesh>
  );
}
function Ready({ onReady }: { onReady: () => void }) {
  const [done, setDone] = useState(false);
  useFrame(() => {
    if (!done) {
      setDone(true);
      onReady();
    }
  });
  return null;
}
// The plan view renders on demand, so a changed rotation angle must
// ask for a fresh frame explicitly or the canvas would sit still
// until the next zoom/pan interaction.
function InvalidateOnPlanRotation({ deg }: { deg: number }) {
  const invalidate = useThree((state) => state.invalidate);
  useEffect(() => {
    invalidate();
  }, [deg, invalidate]);
  return null;
}
function Walls({ drawing, color }: { drawing: RoofDrawing; color: string }) {
  const geometry = useMemo(() => {
    const values: number[] = [];
    const edges = new Map<
      string,
      {
        a: { x: number; y: number; z: number };
        b: { x: number; y: number; z: number };
        count: number;
      }
    >();
    for (const p of drawing.planes)
      for (let i = 0; i < p.points.length; i++) {
        const a = p.points[i],
          b = p.points[(i + 1) % p.points.length];
        if (!a || !b) continue;
        const key = [`${a.x},${a.y},${a.z}`, `${b.x},${b.y},${b.z}`].sort().join("|");
        const existing = edges.get(key);
        if (existing) existing.count++;
        else edges.set(key, { a, b, count: 1 });
      }
    for (const { a, b, count } of edges.values())
      if (count === 1)
        values.push(
          a.x,
          0,
          a.z,
          b.x,
          0,
          b.z,
          b.x,
          b.y,
          b.z,
          a.x,
          0,
          a.z,
          b.x,
          b.y,
          b.z,
          a.x,
          a.y,
          a.z,
        );
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(values, 3));
    g.computeVertexNormals();
    return g;
  }, [drawing]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial color="#b8b2a7" side={DoubleSide} roughness={0.96} />
    </mesh>
  );
}
export default function RoofScene({
  drawing,
  edgeSuggestions = [],
  aerialImageUrl,
  aerialImageCenter,
  selected,
  onSelect,
  view,
  fitKey,
  autoRotate,
  zoomDirection,
  zoomKey,
  planRotationDeg = 0,
  planRotateActive = false,
}: {
  drawing: RoofDrawing;
  edgeSuggestions?: SharedEdgeSuggestion[];
  aerialImageUrl?: string;
  aerialImageCenter?: [number, number, number];
  selected: string;
  onSelect: (id: string) => void;
  view: "3d" | "plan";
  fitKey: number;
  autoRotate: boolean;
  zoomDirection: "in" | "out";
  zoomKey: number;
  /** 2D Plan only: view-only rotation of the whole drawing, degrees. */
  planRotationDeg?: number;
  /** 2D Plan only: true while the drag-to-rotate mode owns the pointer. */
  planRotateActive?: boolean;
}) {
  const [ready, setReady] = useState(false);
  const controls = useRef<{
    dollyIn: (scale?: number) => void;
    dollyOut: (scale?: number) => void;
    update: () => void;
  } | null>(null);
  useEffect(() => {
    if (zoomKey === 0 || !controls.current) return;
    if (zoomDirection === "in") controls.current.dollyIn(1.25);
    else controls.current.dollyOut(1.25);
    controls.current.update();
  }, [zoomDirection, zoomKey]);
  const [colors, setColors] = useState({ roof: "", selected: "", edge: "", ground: "" });
  useEffect(() => {
    const c = getComputedStyle(document.documentElement);
    const pixel = document.createElement("canvas");
    pixel.width = 1;
    pixel.height = 1;
    const ctx = pixel.getContext("2d");
    const resolve = (token: string) => {
      if (!ctx) return "rgb(128,128,128)";
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = c.getPropertyValue(token).trim();
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
      return `rgb(${r},${g},${b})`;
    };
    setColors({
      roof: resolve("--primary"),
      selected: resolve("--steel"),
      edge: resolve("--foreground"),
      ground: resolve("--muted"),
    });
  }, []);
  // The aerial ground photo stays registered to the raw geocoded
  // point (that's where the imagery is centred), but the ADDRESS
  // marker itself anchors to the measured building's footprint
  // centroid — the geocode alone lands on the street in front of
  // the lot. The marker only shows for geo-referenced drawings,
  // as before.
  const geocodedPin = drawing.geo_reference ? addressPinPosition(drawing.geo_reference) : null;
  const addressPin = drawing.geo_reference ? addressMarkerPosition(drawing) : null;
  const pinBaseHeight =
    Math.max(10, ...drawing.planes.flatMap((p) => p.points.map((v) => v.y))) + 0.8;
  // Frame the actual roof-and-address bounds; a half-pin camera target only
  // works when the roof is centered at the drawing origin.
  const sceneBounds = drawing.planes.flatMap((plane) =>
    plane.points.map((point) => ({ x: point.x, y: point.y, z: point.z })),
  );
  if (addressPin) sceneBounds.push({ x: addressPin.x, y: 0, z: addressPin.z });
  const minX = Math.min(0, ...sceneBounds.map((point) => point.x));
  const maxX = Math.max(0, ...sceneBounds.map((point) => point.x));
  const minZ = Math.min(0, ...sceneBounds.map((point) => point.z));
  const maxZ = Math.max(0, ...sceneBounds.map((point) => point.z));
  const minY = Math.min(0, ...sceneBounds.map((point) => point.y));
  const maxY = Math.max(10, ...sceneBounds.map((point) => point.y));
  const sceneCenter: [number, number, number] = [
    (minX + maxX) / 2,
    (minY + maxY) / 2,
    (minZ + maxZ) / 2,
  ];
  const extent = Math.max(30, maxX - minX, maxZ - minZ, maxY - minY);
  // 2D Plan rotation: the whole drawing turns about the scene centre
  // (view-only — geometry, measurements and the PDF never change).
  // The plan camera pulls back by the rotated-extent factor so a
  // plan turned 45° still fits instead of clipping its corners.
  const planRotationRad = view === "plan" ? (planRotationDeg * Math.PI) / 180 : 0;
  const planDistance =
    extent * 1.5 * (view === "plan" ? planRotationFitFactor(planRotationDeg) : 1);
  if (!colors.roof)
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        Opening drawing…
      </div>
    );
  return (
    <div data-scene-ready={ready ? "true" : undefined} className="h-full w-full">
      <Canvas
        key={`${view}-${fitKey}`}
        frameloop={view === "3d" && autoRotate ? "always" : "demand"}
        camera={{
          position:
            view === "plan"
              ? [sceneCenter[0], sceneCenter[1] + planDistance, sceneCenter[2] + 0.01]
              : [sceneCenter[0] + extent * 0.9, sceneCenter[1] + extent, sceneCenter[2] + extent],
          fov: 42,
          near: 0.1,
          far: 20000,
        }}
        dpr={[1, 1.5]}
      >
        <ambientLight intensity={1.1} />
        <directionalLight position={[30, 60, 20]} intensity={2} />
        <Environment>
          <Lightformer
            intensity={1.5}
            position={[0, 40, 0]}
            scale={[100, 100, 1]}
            rotation-x={-Math.PI / 2}
          />
        </Environment>
        <gridHelper
          args={[extent * 2, 20, colors.edge, colors.ground]}
          position={[sceneCenter[0], 0, sceneCenter[2]]}
        />
        <group position={[sceneCenter[0], 0, sceneCenter[2]]} rotation-y={planRotationRad}>
          <group position={[-sceneCenter[0], 0, -sceneCenter[2]]}>
            {aerialImageUrl && (
              <AerialGround
                url={aerialImageUrl}
                position={
                  aerialImageCenter ??
                  (geocodedPin ? [geocodedPin.x, 0.05, geocodedPin.z] : [0, 0.05, 0])
                }
              />
            )}
            <Walls drawing={drawing} color={colors.ground} />
            {addressPin && (
              <group
                position={[addressPin.x, pinBaseHeight, addressPin.z]}
                name="Property address (anchored to the measured building)"
              >
                <mesh rotation-x={-Math.PI / 2} position={[0, 0.12, 0]}>
                  <ringGeometry args={[0.75, 1.05, 28]} />
                  <meshBasicMaterial color="#DC2626" side={DoubleSide} />
                </mesh>
                <mesh position={[0, 2.2, 0]}>
                  <cylinderGeometry args={[0.12, 0.12, 3.6, 12]} />
                  <meshStandardMaterial color="#DC2626" />
                </mesh>
                <mesh position={[0, 4.2, 0]}>
                  <sphereGeometry args={[0.62, 18, 18]} />
                  <meshStandardMaterial
                    color="#DC2626"
                    emissive="#7F1D1D"
                    emissiveIntensity={0.35}
                  />
                </mesh>
                <Dimension text="ADDRESS" position={[0, 5.5, 0]} />
              </group>
            )}
            {drawing.planes.map((p) => (
              <Plane
                key={p.id}
                plane={p}
                selected={p.id === selected}
                onSelect={() => onSelect(p.id)}
                colors={colors}
                faceColor={
                  ROOF_FACE_COLORS[drawing.planes.indexOf(p) % ROOF_FACE_COLORS.length] ??
                  colors.roof
                }
                suggestions={edgeSuggestions.filter((item) => item.planeId === p.id)}
              />
            ))}
            {drawing.penetrations.map((p) => {
              const highest = Math.max(
                10,
                ...drawing.planes.flatMap((pl) => pl.points.map((v) => v.y)),
              );
              return (
                <group key={p.id} position={[p.x, highest + 0.6, p.z]}>
                  {p.kind === "pipe" ? (
                    <mesh>
                      <cylinderGeometry
                        args={[
                          Math.max(p.width, p.length) * 0.32,
                          Math.max(p.width, p.length) * 0.32,
                          1.5,
                          20,
                        ]}
                      />
                      <meshStandardMaterial color={PENETRATION_COLORS.pipe} />
                    </mesh>
                  ) : (
                    <mesh>
                      <boxGeometry args={[p.width, 1.2, p.length]} />
                      <meshStandardMaterial color={PENETRATION_COLORS[p.kind]} />
                    </mesh>
                  )}
                  <Dimension text={p.kind} position={[0, 1.2, 0]} />
                </group>
              );
            })}
          </group>
        </group>
        <OrbitControls
          ref={controls}
          makeDefault
          target={sceneCenter}
          enableRotate={view === "3d"}
          enablePan={view !== "plan" || !planRotateActive}
          enableDamping
          dampingFactor={0.08}
          minPolarAngle={0.01}
          maxPolarAngle={Math.PI - 0.01}
          autoRotate={view === "3d" && autoRotate}
          autoRotateSpeed={0.6}
          minDistance={2}
          maxDistance={extent * 12}
          zoomSpeed={1.2}
          panSpeed={1.1}
          screenSpacePanning
        />
        {view === "plan" && <InvalidateOnPlanRotation deg={planRotationDeg} />}
        <Ready onReady={() => setReady(true)} />
      </Canvas>
    </div>
  );
}
