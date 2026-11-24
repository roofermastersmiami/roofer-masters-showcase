import type { EdgeType } from "@/lib/roof-geometry";

export const ROOF_EDGE_STYLES: Record<EdgeType, { label: string; color: string }> = {
  eave: { label: "Eave", color: "#16A34A" },
  rake: { label: "Rake", color: "#0EA5E9" },
  ridge: { label: "Ridge", color: "#DC2626" },
  hip: { label: "Hip", color: "#F59E0B" },
  valley: { label: "Valley", color: "#A855F7" },
  other: { label: "Unclassified edge", color: "#64748B" },
};

export const ROOF_FACE_COLORS = [
  "#93C5FD",
  "#A7F3D0",
  "#FDE68A",
  "#FBCFE8",
  "#C4B5FD",
  "#FDBA74",
  "#67E8F9",
  "#D9F99D",
] as const;

export const PENETRATION_COLORS = {
  pipe: "#E11D48",
  vent: "#0D9488",
  skylight: "#2563EB",
  chimney: "#7C2D12",
  other: "#64748B",
} as const;

export const ROOF_FEATURE_LEGEND = [
  ...Object.entries(ROOF_EDGE_STYLES).map(([type, style]) => ({
    id: type,
    label: style.label,
    color: style.color,
  })),
  { id: "pipe", label: "Pipe / penetration", color: PENETRATION_COLORS.pipe },
  { id: "face", label: "Roof face (each plane)", color: ROOF_FACE_COLORS[0] },
] as const;
