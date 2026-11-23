import { useMemo, useEffect, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Line, Environment, Lightformer } from "@react-three/drei";
import {
  BufferGeometry,
  Float32BufferAttribute,
  DoubleSide,
  CanvasTexture,
  SRGBColorSpace,
} from "three";
import { planeInfo, distance, type RoofDrawing, type RoofPlane } from "@/lib/roof-geometry";
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
}: {
  plane: RoofPlane;
  selected: boolean;
  onSelect: () => void;
  colors: { roof: string; selected: string; edge: string };
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
    } catch {}
    return g;
  }, [plane]);
  useEffect(() => () => geometry.dispose(), [geometry]);
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
          color={selected ? colors.selected : colors.roof}
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
              color={colors.edge}
              lineWidth={selected ? 2 : 1}
            />
            {selected && (
              <Dimension
                text={`${distance(p, b).toFixed(1)} ft`}
                position={[(p.x + b.x) / 2, (p.y + b.y) / 2 + 0.4, (p.z + b.z) / 2]}
              />
            )}
          </group>
        );
      })}
    </group>
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
      <meshStandardMaterial color={color} side={DoubleSide} roughness={0.9} />
    </mesh>
  );
}
export default function RoofScene({
  drawing,
  selected,
  onSelect,
  view,
  fitKey,
}: {
  drawing: RoofDrawing;
  selected: string;
  onSelect: (id: string) => void;
  view: "3d" | "plan";
  fitKey: number;
}) {
  const [ready, setReady] = useState(false);
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
  const extent = Math.max(
    30,
    ...drawing.planes.flatMap((p) =>
      p.points.flatMap((v) => [Math.abs(v.x) * 2, Math.abs(v.z) * 2]),
    ),
  );
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
        frameloop="demand"
        camera={{
          position: view === "plan" ? [0, extent * 1.5, 0.01] : [extent * 0.9, extent, extent],
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
        <gridHelper args={[extent * 2, 20, colors.edge, colors.ground]} />
        <Walls drawing={drawing} color={colors.ground} />
        {drawing.planes.map((p) => (
          <Plane
            key={p.id}
            plane={p}
            selected={p.id === selected}
            onSelect={() => onSelect(p.id)}
            colors={colors}
          />
        ))}
        {drawing.penetrations.map((p) => {
          const highest = Math.max(
            10,
            ...drawing.planes.flatMap((pl) => pl.points.map((v) => v.y)),
          );
          return (
            <group key={p.id} position={[p.x, highest + 0.6, p.z]}>
              <mesh>
                <boxGeometry args={[p.width, 1.2, p.length]} />
                <meshStandardMaterial color={colors.edge} />
              </mesh>
              <Dimension text={p.kind} position={[0, 1.2, 0]} />
            </group>
          );
        })}
        <OrbitControls
          makeDefault
          target={[0, 10, 0]}
          enableRotate={view === "3d"}
          minDistance={5}
          maxDistance={extent * 5}
        />
        <Ready onReady={() => setReady(true)} />
      </Canvas>
    </div>
  );
}
