import { useEffect, useRef, useState } from "react";
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
  const [resultAddress, setResultAddress] = useState("");
  const [errorAddress, setErrorAddress] = useState("");
  const [loadingAddress, setLoadingAddress] = useState("");
  const requestId = useRef(0);

  // Prevent a previous property response from being applied to a newly selected address.
  useEffect(() => {
    requestId.current += 1;
  }, [address]);

  const currentAddress = address.trim();
  const visibleResult = resultAddress === currentAddress ? result : null;
  const visibleError = errorAddress === currentAddress ? error : "";
  const isLoading = loading && loadingAddress === currentAddress;

  async function analyze() {
    if (!address.trim()) {
      setError("Select a property with a complete street address first.");
      setErrorAddress(currentAddress);
      return;
    }
    const endpoint = endpointUrl();
    if (!endpoint) {
      setError(
        "The free roof-detection service is not connected. Set VITE_ROOF_DETECTION_API_URL after deploying the service.",
      );
      setErrorAddress(currentAddress);
      return;
    }
    const activeRequest = ++requestId.current;
    const requestedAddress = address.trim();
    setLoading(true);
    setLoadingAddress(requestedAddress);
    setError("");
    setErrorAddress("");
    setResult(null);
    setResultAddress("");
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ street_address: requestedAddress }),
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
      if (activeRequest !== requestId.current) return;
      setResult(roofDetectionResponseSchema.parse(body));
      setResultAddress(requestedAddress);
    } catch (cause) {
      if (activeRequest !== requestId.current) return;
      setError(cause instanceof Error ? cause.message : "Roof detection could not be completed.");
      setErrorAddress(requestedAddress);
    } finally {
      if (activeRequest === requestId.current) setLoading(false);
    }
  }

  function apply() {
    if (!visibleResult || resultAddress !== address.trim()) return;
    try {
      onApply(detectedFacetsToDrawing(visibleResult));
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Detected facets could not be added to the drawing.",
      );
      setErrorAddress(currentAddress);
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
        <Button onClick={() => void analyze()} disabled={isLoading || !address.trim()}>
          {isLoading ? <Loader2 className="animate-spin" /> : <CloudDownload />}
          {isLoading ? "Analyzing address…" : "Analyze roof"}
        </Button>
      </div>
      {isLoading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <Activity className="size-4" /> Searching public footprint and LiDAR coverage. First
          request may take longer on a free host.
        </div>
      )}
      {visibleError && (
        <p role="alert" className="text-sm text-destructive">
          {visibleError}
        </p>
      )}
      {visibleResult && (
        <div className="space-y-3">
          {visibleResult.status === "lidar_facets" ? (
            <div className="flex items-start gap-2 text-sm">
              <CheckCircle2 className="mt-0.5 size-4 text-emerald-600" />
              <div>
                <strong>{visibleResult.roof.facet_count} candidate roof facets detected</strong>
                <p className="text-muted-foreground">
                  {visibleResult.roof.total_squares?.toFixed(2)} squares · Dominant pitch{" "}
                  {visibleResult.roof.dominant_pitch_rise_per_12?.toFixed(1)}:12 · Preliminary LiDAR result
                </p>
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-2 text-sm">
              <AlertTriangle className="mt-0.5 size-4 text-amber-600" />
              <div>
                <strong>Footprint found; roof facets were not measurable</strong>
                <p className="text-muted-foreground">{visibleResult.fallback.message}</p>
                <p className="mt-1">
                  Ground footprint: {visibleResult.fallback.footprint_area_sqft.toLocaleString()} sq ft.
                  This is not roof surface area.
                </p>
              </div>
            </div>
          )}
          {visibleResult.roof.facets.length > 0 && (
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
                  {visibleResult.roof.facets.map((facet) => (
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
            {visibleResult.disclaimer} Edge classifications are left unclassified until reviewed in the
            measurement editor.
          </p>
          {visibleResult.roof.facets.length > 0 && (
            <Button variant="outline" onClick={apply}>
              Load candidate facets into roof editor
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
