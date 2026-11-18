import { useRef, useState } from "react";
import { MoveHorizontal } from "lucide-react";

export function BeforeAfter({
  before,
  after,
  alt,
  caption,
}: {
  before: string;
  after: string;
  alt: string;
  caption?: string;
}) {
  const [pos, setPos] = useState(50);
  const ref = useRef<HTMLDivElement>(null);

  const update = (clientX: number) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    setPos(Math.min(100, Math.max(0, ((clientX - rect.left) / rect.width) * 100)));
  };

  return (
    <figure>
      <div
        ref={ref}
        className="relative aspect-[4/3] touch-none select-none overflow-hidden rounded-2xl bg-muted shadow-card"
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
          update(e.clientX);
        }}
        onPointerMove={(e) => {
          if (e.buttons === 1 || e.pointerType === "touch") update(e.clientX);
        }}
      >
        <img src={after} alt={`After: ${alt}`} loading="lazy" className="absolute inset-0 size-full object-cover" />
        <div className="absolute inset-0 overflow-hidden" style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}>
          <img src={before} alt={`Before: ${alt}`} loading="lazy" className="absolute inset-0 size-full object-cover" />
        </div>
        <span className="absolute left-3 top-3 rounded-full bg-charcoal/85 px-3 py-1 text-xs font-bold uppercase tracking-wider text-navy-foreground">
          Before
        </span>
        <span className="absolute right-3 top-3 rounded-full bg-primary px-3 py-1 text-xs font-bold uppercase tracking-wider text-primary-foreground">
          After
        </span>
        <div className="absolute inset-y-0 w-0.5 bg-card shadow-card" style={{ left: `${pos}%` }}>
          <div className="absolute top-1/2 left-1/2 grid size-12 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-card text-primary shadow-elegant">
            <MoveHorizontal className="size-5" />
          </div>
        </div>
        <input
          type="range"
          min={0}
          max={100}
          value={pos}
          onChange={(e) => setPos(Number(e.target.value))}
          aria-label={`Compare before and after: ${alt}`}
          className="absolute inset-0 size-full cursor-ew-resize opacity-0"
        />
      </div>
      {caption && <figcaption className="mt-3 text-sm font-semibold text-muted-foreground">{caption}</figcaption>}
    </figure>
  );
}
