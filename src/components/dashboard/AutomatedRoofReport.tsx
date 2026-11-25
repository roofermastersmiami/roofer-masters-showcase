import { useState } from "react";
import { Activity, AlertTriangle, CheckCircle2, CloudDownload, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { detectedFacetsToDrawing, type RoofDetectionResponse } from "@/lib/roof-detection";

type Props = {
  address: string;
  onApply: (drawing: ReturnType<typeof detectedFacetsToDrawing>) => void;
};

function endpointUrl() {
  const base = import.meta.env["VITE_ROOF_DETECTION_API_URL"]?.trim().replace(/\/+$/, "");
  return base ? `${base}/v1/roof/analyze` : "";
}

export function AutomatedRoofReport({ address, onApply }: Props) {
  const [result, setResult] = useState<RoofDetectionResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function analyze() {
    if (!address.trim()) {
      setError("Select a property with a complete street address first.");
      return;
    }
    const endpoint = endpointUrl();
    if (!endpoint) {
      setError(
        "The free roof-detection service is not connected. Set VITE_ROOF_DETECTION_API_URL after deploying the service.",
      );
      return;
    }
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ street_address: address.trim() }),
        signal: AbortSignal.timeout(90000),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const message =
          body && typeof body === "object" && "detail" in body && typeof body.detail === "string"
            ? body.detail
            : `Roof detection request failed (${response.status}).`;
        throw new Error(message);
      }
      // Parse at the boundary; never allow unchecked API data into editable roof geometry.
      const { roofDetectionResponseSchema } = await import("@/lib/roof-detection");
      setResult(roofDetectionResponseSchema.parse(body));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Roof detection could not be completed.");
    } finally {
      setLoading(false);
    }
  }

  function apply() {
    if (!result) return;
    try {
      onApply(detectedFacetsToDrawing(result));
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Detected facets could not be added to the drawing.",
      );
    }
  }

  return (
    <section className="space-y-3 rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold">Automated public LiDAR roof detection</h3>
          <p className="text-sm text-muted-foreground">
            OpenStreetMap footprint + public USGS 3DEP point cloud. No paid API keys.
          </p>
        </div>
        <Button onClick={() => void analyze()} disabled={loading || !address.trim()}>
          {loading ? <Loader2 className="animate-spin" /> : <CloudDownload />}
          {loading ? "Analyzing address…" : "Analyze roof"}
        </Button>
      </div>
      {loading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <Activity className="size-4" /> Searching public footprint and LiDAR coverage. First
          request may take longer on a free host.
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {result && (
        <div className="space-y-3">
          {result.footprint.address_point_inside_footprint === false && (
            <p className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm text-amber-800">
              Address match is approximate: the geocoded point is {result.footprint.address_to_footprint_distance_m?.toFixed(1)} m from the selected building outline. Confirm the correct building before using these measurements.
            </p>
          )}
          {result.status === "lidar_facets" ? (
            <div className="flex items-start gap-2 text-sm">
              <CheckCircle2 className="mt-0.5 size-4 text-emerald-600" />
              <div>
                <strong>{result.roof.facet_count} candidate roof facets detected</strong>
                <p className="text-muted-foreground">
                  {result.roof.total_squares?.toFixed(2)} squares · Dominant pitch{" "}
                  {result.roof.dominant_pitch_rise_per_12?.toFixed(1)}:12 · Preliminary LiDAR result
                </p>
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-2 text-sm">
              <AlertTriangle className="mt-0.5 size-4 text-amber-600" />
              <div>
                <strong>Footprint found; roof facets were not measurable</strong>
                <p className="text-muted-foreground">{result.fallback.message}</p>
                <p className="mt-1">
                  Ground footprint: {result.fallback.footprint_area_sqft.toLocaleString()} sq ft.
                  This is not roof surface area.
                </p>
              </div>
            </div>
          )}
          {result.roof.facets.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="py-2 pr-3">Facet</th>
                    <th className="py-2 pr-3">Area SF</th>
                    <th className="py-2 pr-3">Squares</th>
                    <th className="py-2 pr-3">Pitch</th>
                    <th className="py-2">Azimuth</th>
                  </tr>
                </thead>
                <tbody>
                  {result.roof.facets.map((facet) => (
                    <tr key={facet.id} className="border-b border-border/60">
                      <td className="py-2 pr-3">{facet.id}</td>
                      <td className="py-2 pr-3 tabular-nums">{facet.area_sqft.toFixed(1)}</td>
                      <td className="py-2 pr-3 tabular-nums">{facet.squares.toFixed(2)}</td>
                      <td className="py-2 pr-3 tabular-nums">
                        {facet.pitch_rise_per_12.toFixed(1)}:12
                      </td>
                      <td className="py-2 tabular-nums">{facet.azimuth_degrees.toFixed(0)}°</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            {result.disclaimer} Edge classifications are left unclassified until reviewed in the
            measurement editor.
          </p>
          {result.roof.facets.length > 0 && (
            <Button variant="outline" onClick={apply}>
              Load candidate facets into roof editor
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
