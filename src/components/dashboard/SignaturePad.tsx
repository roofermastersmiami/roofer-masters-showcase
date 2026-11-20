import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { Eraser, Check } from "lucide-react";

export function SignaturePad({ onUse }: { onUse: (bytes: Uint8Array) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  return <div className="grid gap-2">
    <span className="text-sm font-semibold">Signature</span>
    <canvas ref={ref} width={480} height={150} aria-label="Draw signature" className="aspect-[16/5] w-full touch-none rounded-md border border-border bg-card"
      onPointerDown={(e) => { const canvas = ref.current; const ctx = canvas?.getContext("2d"); if (!canvas || !ctx) return; drawing.current = true; canvas.setPointerCapture(e.pointerId); const rect = canvas.getBoundingClientRect(); ctx.beginPath(); ctx.moveTo((e.clientX - rect.left) * 480 / rect.width, (e.clientY - rect.top) * 150 / rect.height); ctx.strokeStyle = getComputedStyle(canvas).color; ctx.lineWidth = 3; ctx.lineCap = "round"; }}
      onPointerMove={(e) => { if (!drawing.current) return; const canvas = ref.current; const ctx = canvas?.getContext("2d"); if (!canvas || !ctx) return; const rect = canvas.getBoundingClientRect(); ctx.lineTo((e.clientX - rect.left) * 480 / rect.width, (e.clientY - rect.top) * 150 / rect.height); ctx.stroke(); }}
      onPointerUp={() => { drawing.current = false; }} onPointerCancel={() => { drawing.current = false; }} />
    <div className="flex gap-2">
      <Button size="sm" variant="outline" onClick={() => ref.current?.getContext("2d")?.clearRect(0, 0, 480, 150)}><Eraser /> Clear</Button>
      <Button size="sm" variant="secondary" onClick={() => { ref.current?.toBlob(async (blob) => { if (blob) onUse(new Uint8Array(await blob.arrayBuffer())); }, "image/png"); }}><Check /> Use signature</Button>
    </div>
  </div>;
}