import { useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Ruler, Plus, Undo2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { calibratedPlane, checkCalibration, nextEdgeType, UPHILL_LABELS, type ImagePoint, type Uphill } from '@/lib/roof-trace';
import { planeInfo, type EdgeType, type RoofPlane } from '@/lib/roof-geometry';
import { snapToImageEdge } from '@/lib/roof-edge-snap';
import { Field, Choice } from './CrmControls';

const EDGE_SHORT: Record<EdgeType, string> = { eave: 'Eave', rake: 'Rake', ridge: 'Ridge', hip: 'Hip', valley: 'Valley', other: 'Other' };
type Traced = { id: string; name: string; points: ImagePoint[] };

export function RoofImageTrace({ path, onAdd, feetPerPixel }: { path: string; onAdd: (plane: RoofPlane, replace: boolean) => void; feetPerPixel?: number }) {
  const photo = useQuery({ queryKey: ['trace-photo', path], queryFn: async () => { const { data, error } = await supabase.storage.from('roof-job-photos').createSignedUrl(path, 300); if (error || !data) throw error; return data.signedUrl; } });
  const [mode, setMode] = useState<'calibrate' | 'trace'>(feetPerPixel && Number.isFinite(feetPerPixel) && feetPerPixel > 0 ? 'trace' : 'calibrate');
  const [reference, setReference] = useState<ImagePoint[]>(feetPerPixel && Number.isFinite(feetPerPixel) && feetPerPixel > 0 ? [{ x: 0, y: 0 }, { x: 1000, y: 0 }] : []);
  const [points, setPoints] = useState<ImagePoint[]>([]);
  const [edges, setEdges] = useState<EdgeType[]>([]);
  const [feet, setFeet] = useState(feetPerPixel && Number.isFinite(feetPerPixel) && feetPerPixel > 0 ? feetPerPixel * 1000 : 0);
  const [pitch, setPitch] = useState(6);
  const [uphill, setUphill] = useState<Uphill>('up');
  const [name, setName] = useState('');
  const [dimensions, setDimensions] = useState({ width: 1000, height: 700 });
  const [replace, setReplace] = useState(true);
  const [traced, setTraced] = useState<Traced[]>([]);
  const [edgeSnap, setEdgeSnap] = useState(false);
  const [snapPixels, setSnapPixels] = useState<{ data: Uint8ClampedArray; width: number; height: number } | null>(null);
  const snapImage = useRef<HTMLImageElement>(null);
  const drag = useRef<{ kind: 'ref' | 'pt'; i: number } | null>(null);
  const moved = useRef(false);
  const svg = useRef<SVGSVGElement>(null);
  const w = dimensions.width;
  const calibration = checkCalibration(reference, feet, w);

  const toImage = (clientX: number, clientY: number) => {
    const box = svg.current!.getBoundingClientRect();
    const s = Math.min(box.width / dimensions.width, box.height / dimensions.height);
    const x = (clientX - box.left - (box.width - dimensions.width * s) / 2) / s, y = (clientY - box.top - (box.height - dimensions.height * s) / 2) / s;
    return x < 0 || y < 0 || x > dimensions.width || y > dimensions.height ? null : { x, y };
  };
  const addPoint = (p: ImagePoint) => {
    const snapped = mode === 'trace' && edgeSnap && snapPixels
      ? snapToImageEdge(snapPixels.data, snapPixels.width, snapPixels.height, p, 18, 55)?.point
      : null;
    const point = snapped ?? p;
    if (mode === 'calibrate') setReference(reference.length === 2 ? [point] : [...reference, point]);
    else { setPoints([...points, point]); setEdges([...edges, 'other']); }
  };
  const prepareSnapPixels = () => {
    const image = snapImage.current;
    if (!image?.naturalWidth || !image.naturalHeight) return;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) return setSnapPixels(null);
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
      setSnapPixels({ data: pixels.data, width: canvas.width, height: canvas.height });
    } catch {
      setSnapPixels(null);
    }
  };
  const onMove = (e: RPointerEvent<SVGSVGElement>) => {
    if (!drag.current) return; const p = toImage(e.clientX, e.clientY); if (!p) return; moved.current = true;
    const { kind, i } = drag.current;
    if (kind === 'ref') setReference(r => r.map((q, j) => j === i ? p : q)); else setPoints(r => r.map((q, j) => j === i ? p : q));
  };
  const startDrag = (kind: 'ref' | 'pt', i: number) => (e: RPointerEvent) => { e.stopPropagation(); drag.current = { kind, i }; moved.current = false; svg.current?.setPointerCapture(e.pointerId); };

  let preview: { area: number; perimeter: number } | null = null;
  if (points.length >= 3 && calibration.ok) { try { const info = planeInfo(calibratedPlane(points, reference, feet, pitch, 'p', { uphill, edges })); const pl = calibratedPlane(points, reference, feet, pitch, "p", { uphill, edges }); preview = { area: info.area, perimeter: pl.points.reduce((s, a, i) => { const b = pl.points[(i + 1) % pl.points.length]!; return s + Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z); }, 0) }; } catch { preview = null; } }

  const add = () => {
    try {
      const id = crypto.randomUUID(); const label = name.trim() || `Traced plane ${traced.length + 1}`;
      onAdd(calibratedPlane(points, reference, feet, pitch, id, { uphill, edges, name: label }), replace);
      setTraced(t => replace ? [{ id, name: label, points }] : [...t, { id, name: label, points }]);
      setReplace(false); setPoints([]); setEdges([]); setName('');
      toast.success(`${label} added as unverified. Trace the next plane on the same photo, or review and verify.`);
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not measure traced plane'); }
  };

  return <section className="border-t border-border py-6">
    <h3 className="mb-2 text-lg font-bold">Calibrated photo tracing</h3>
    <div className="mb-4 space-y-1 text-sm text-muted-foreground">
      <p>Trace each roof plane by clicking its corners, dragging dots to adjust, and choosing Eave / Rake / Ridge / Hip / Valley for each edge. Enter the plane pitch and uphill direction, then add the plane and repeat. Scale is automatic for georeferenced USGS aerials; for uploaded photos, set scale using a known measured distance.</p>
      <p>Photos only give flat (plan) size; slope comes from the pitch you enter. Results stay estimates until you check them on site and mark the report verified. Not survey-grade.</p>
    </div>
    {feetPerPixel && <p className="mb-4 border-l-2 border-primary pl-3 text-sm"><strong>Automatic scale calibration active.</strong> The USGS aerial's georeferenced ground bounds set the image scale to {feetPerPixel.toFixed(3)} ft per pixel. No manual scale points are needed. This public imagery is relatively coarse, so treat dimensions as preliminary estimates and verify critical edges on site. You can still override the scale below if you have a measured reference.</p>}
    <div className="mb-3 flex flex-wrap items-end gap-3">
      <Button variant={mode === 'calibrate' ? 'secondary' : 'outline'} onClick={() => { setMode('calibrate'); setReference([]); }}><Ruler /> {feetPerPixel ? 'Override automatic scale' : 'Set two scale points'}</Button>
      <Field label="Known distance (ft)"><Input className="w-28" type="number" min={0.1} value={feet || ''} onChange={e => setFeet(Number(e.target.value))} /></Field>
      <Button variant={mode === 'trace' ? 'secondary' : 'outline'} disabled={!calibration.ok} onClick={() => setMode('trace')}>Trace roof plane</Button>
    </div>
    <p className={`mb-3 text-sm ${calibration.ok ? 'text-muted-foreground' : 'text-destructive'}`}>{calibration.ok ? `${feetPerPixel && mode === 'trace' ? 'Auto-calibrated scale' : 'Scale'}: ${calibration.ftPerPx.toFixed(3)} ft per pixel.` : calibration.message}{calibration.ok && calibration.warnings.map(m => <span key={m} className="block text-destructive">{m}</span>)}</p>
    {photo.data ? <div className="relative w-full overflow-hidden rounded-md border border-border">
      <img ref={snapImage} src={photo.data} alt="Roof photo used for measuring" className="block max-h-[640px] w-full select-none object-contain" draggable={false} onLoad={e => { setDimensions({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight }); prepareSnapPixels(); }} />
      <svg ref={svg} className="absolute inset-0 h-full w-full touch-none text-primary" viewBox={`0 0 ${dimensions.width} ${dimensions.height}`} preserveAspectRatio="xMidYMid meet" aria-label="Roof tracing surface"
        onPointerMove={onMove} onPointerUp={() => { drag.current = null; }}
        onClick={e => { if (moved.current) { moved.current = false; return; } const p = toImage(e.clientX, e.clientY); if (p) addPoint(p); }}>
        {traced.map(t => <g key={t.id} className="text-muted-foreground"><polygon points={t.points.map(p => `${p.x},${p.y}`).join(' ')} fill="currentColor" fillOpacity={0.15} stroke="currentColor" strokeDasharray={`${w / 120}`} strokeWidth={w / 400} /><text x={t.points.reduce((s, p) => s + p.x, 0) / t.points.length} y={t.points.reduce((s, p) => s + p.y, 0) / t.points.length} fontSize={w / 50} textAnchor="middle" fill="currentColor">{t.name}</text></g>)}
        {reference.length === 2 && <line x1={reference[0]?.x} y1={reference[0]?.y} x2={reference[1]?.x} y2={reference[1]?.y} stroke="currentColor" strokeWidth={w / 250} strokeDasharray={`${w / 80}`} />}
        <polygon points={points.map(p => `${p.x},${p.y}`).join(' ')} fill="currentColor" fillOpacity={0.25} stroke="currentColor" strokeWidth={w / 300} />
        {points.length >= 3 && points.map((p, i) => { const q = points[(i + 1) % points.length]!; return <g key={`e${i}`} role="button" aria-label={`Edge ${i + 1}: ${edges[i]}. Click to change`} onClick={ev => { ev.stopPropagation(); setEdges(es => es.map((t, j) => j === i ? nextEdgeType(t) : t)); }} className="cursor-pointer"><rect x={(p.x + q.x) / 2 - w / 28} y={(p.y + q.y) / 2 - w / 70} width={w / 14} height={w / 35} rx={w / 200} className="fill-background" stroke="currentColor" strokeWidth={w / 600} /><text x={(p.x + q.x) / 2} y={(p.y + q.y) / 2 + w / 200} fontSize={w / 60} textAnchor="middle" className="fill-foreground">{EDGE_SHORT[edges[i] ?? 'other']}</text></g>; })}
        {reference.map((p, i) => <circle key={`r${i}`} cx={p.x} cy={p.y} r={w / 100} className="cursor-move fill-destructive" onPointerDown={startDrag('ref', i)} onClick={e => e.stopPropagation()} />)}
        {points.map((p, i) => <circle key={`p${i}`} cx={p.x} cy={p.y} r={w / 90} fill="currentColor" strokeWidth={w / 600} className="cursor-move stroke-background" onPointerDown={startDrag('pt', i)} onClick={e => e.stopPropagation()} />)}
      </svg>
    </div> : <p>{photo.error ? 'Photo unavailable' : 'Loading photo…'}</p>}
    <div className="mt-4 flex flex-wrap items-end gap-3">
      <Field label="Plane name"><Input className="w-40" value={name} maxLength={100} placeholder={`Traced plane ${traced.length + 1}`} onChange={e => setName(e.target.value)} /></Field>
      <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" checked={edgeSnap} onChange={e => setEdgeSnap(e.target.checked)} disabled={!snapPixels} /> Snap corners to visible image edges</label>
      <Field label="Pitch (rise / 12)"><Input className="w-24" type="number" min={0} max={24} value={pitch} onChange={e => setPitch(Number(e.target.value))} /></Field>
      <div className="w-52"><Choice label="Roof rises (eave → ridge)" value={uphill} onChange={v => setUphill(v as Uphill)} options={(Object.keys(UPHILL_LABELS) as Uphill[]).map(k => ({ value: k, label: UPHILL_LABELS[k] }))} /></div>
      <Button variant="ghost" size="icon" aria-label="Undo last corner" title="Undo last corner" disabled={!points.length} onClick={() => { setPoints(points.slice(0, -1)); setEdges(edges.slice(0, -1)); }}><Undo2 /></Button>
      <Button variant="ghost" size="icon" aria-label="Clear current plane" title="Clear current plane" disabled={!points.length} onClick={() => { setPoints([]); setEdges([]); }}><Trash2 /></Button>
    </div>
    <div className="mt-3 flex flex-wrap items-center gap-4">
      <p className="text-sm text-muted-foreground">{points.length} corners{preview ? ` · ${preview.area.toFixed(1)} sq ft sloped · ${preview.perimeter.toFixed(1)} ft perimeter` : ''} · {traced.length} plane{traced.length === 1 ? '' : 's'} added from this photo</p>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={replace} onChange={e => setReplace(e.target.checked)} /> Replace existing roof planes</label>
      <Button disabled={points.length < 3 || !calibration.ok} onClick={add}><Plus /> Add traced plane</Button>
    </div>
  </section>;
}
