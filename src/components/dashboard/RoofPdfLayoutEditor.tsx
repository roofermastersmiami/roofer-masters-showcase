import { useState } from "react";
import { Move } from "lucide-react";
import { Card } from "@/components/ui/card";
import type { RoofPdfLayout } from "@/lib/roof-drawing-pdf";

const elements = [
  { key: "brand", label: "Company name", text: "ROOFER MASTERS", defaultX: 7, defaultY: 24 },
  { key: "tagline", label: "Tagline", text: "YOUR ROOF, OUR MASTERPIECE", defaultX: 7, defaultY: 49 },
  { key: "contact", label: "Contact details", text: "(305) 942-3093  |  roofermasters@gmail.com", defaultX: 7, defaultY: 78 },
  { key: "heading", label: "Report heading", text: "ROOF MEASUREMENT REPORT", defaultX: 62, defaultY: 25 },
] as const;

type LayoutKey = keyof RoofPdfLayout;

export const defaultRoofPdfLayout: RoofPdfLayout = {
  brand: { x: 7, y: 24 },
  tagline: { x: 7, y: 49 },
  contact: { x: 7, y: 78 },
  heading: { x: 62, y: 25 },
};

export function RoofPdfLayoutEditor({
  value,
  onChange,
}: {
  value: RoofPdfLayout;
  onChange: (next: RoofPdfLayout) => void;
}) {
  const [active, setActive] = useState<LayoutKey>("brand");
  function move(key: LayoutKey, event: React.PointerEvent<HTMLButtonElement>) {
    const bounds = event.currentTarget.parentElement?.getBoundingClientRect();
    if (!bounds) return;
    const x = Math.max(2, Math.min(94, ((event.clientX - bounds.left) / bounds.width) * 100));
    const y = Math.max(8, Math.min(92, ((event.clientY - bounds.top) / bounds.height) * 100));
    onChange({ ...value, [key]: { x: Math.round(x), y: Math.round(y) } });
  }
  return (
    <Card className="mb-5 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-semibold">PDF header layout</h3>
          <p className="text-xs text-muted-foreground">Drag each item to reposition it on the first-page header. Changes apply when you generate the PDF.</p>
        </div>
        <button type="button" className="text-sm text-primary underline" onClick={() => onChange(defaultRoofPdfLayout)}>Reset layout</button>
      </div>
      <div className="relative mx-auto aspect-[612/78] w-full max-w-2xl overflow-hidden rounded-md border border-slate-700 bg-[#102b43]">
        {elements.map((item) => {
          const position = value[item.key];
          return (
            <button
              key={item.key}
              type="button"
              aria-label={`Move ${item.label}`}
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId);
                setActive(item.key);
                move(item.key, event);
              }}
              onPointerMove={(event) => {
                if (event.buttons === 1) move(item.key, event);
              }}
              onClick={() => setActive(item.key)}
              className={`absolute touch-none rounded border px-2 py-1 text-left text-white shadow-sm ${active === item.key ? "border-white bg-white/20 ring-2 ring-white/60" : "border-white/30 bg-black/10"}`}
              style={{ left: `${position.x}%`, top: `${position.y}%`, transform: "translate(-5%, -50%)", maxWidth: "90%" }}
            >
              <span className="flex items-center gap-1 whitespace-nowrap text-[clamp(7px,1.4vw,12px)]">
                <Move className="size-3 shrink-0" />{item.text}
              </span>
            </button>
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {elements.map((item) => (
          <button key={item.key} type="button" onClick={() => setActive(item.key)} className={`rounded-md border px-2.5 py-1.5 text-xs ${active === item.key ? "border-primary bg-primary/10 text-primary" : "border-border"}`}>
            {item.label}
          </button>
        ))}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">Select an item and drag it. This currently edits the report header; body text and the original uploaded PDF are not modified.</p>
    </Card>
  );
}
