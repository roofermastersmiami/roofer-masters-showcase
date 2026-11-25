import { useCallback, useEffect, useRef, useState } from "react";
import { Activity, AlertTriangle, CheckCircle2, CloudDownload, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { detectedFacetsToDrawing, type RoofDetectionResponse } from "@/lib/roof-detection";
import type { RoofDrawing } from "@/lib/roof-geometry";

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
  const [roofType, setRoofType] = useState<RoofDrawing["roof_type"] | "">("");
  const requestId = useRef(0);
  const activeController = useRef<AbortController | null>(null);
  const autoAnalyzedAddress = useRef("");

  // Cancel work for the previous property and prevent stale responses or loading state.
  useEffect(() => {
    requestId.current += 1;
    activeController.current?.abort();
    activeController.current = null;
    setLoading(false);
    return () => {
      requestId.current += 1;
      activeController.current?.abort();
      activeController.current = null;
    };
  }, [address]);

  const currentAddress = address.trim();
  const visibleResult = resultAddress === currentAddress ? result : null;
  const visibleError = errorAddress === currentAddress ? error : "";
  const isLoading = loading && loadingAddress === currentAddress;

  const analyze = useCallback(async () => {
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
    activeController.current?.abort();
    const controller = new AbortController();
    activeController.current = controller;
    const timeoutId = window.setTimeout(() => controller.abort(), 90000);
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
        signal: controller.signal,
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
      window.clearTimeout(timeoutId);
      if (activeRequest === requestId.current) {
        setLoading(false);
        if (activeController.current === controller) activeController.current = null;
      }
    }
  }, [address, currentAddress]);

  // Start public-data analysis once when a new property address is loaded.
  // The manual button remains available for retries; results are never applied automatically.
  useEffect(() => {
    if (!currentAddress || !endpointUrl() || autoAnalyzedAddress.current === currentAddress) return;
    autoAnalyzedAddress.current = currentAddress;
    void analyze();
  }, [analyze, currentAddress]);

  function apply() {
    if (!visibleResult || resultAddress !== address.trim()) return;
    try {
      if (!roofType) {
        setError("Choose the roof system before loading the detected measurements.");
        setErrorAddress(currentAddress);
        return;
      }
      onApply(detectedFacetsToDrawing(visibleResult, roofType));
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
          {visibleResult.footprint.address_point_inside_footprint === false && (
            <div
              role="alert"
              className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm text-amber-800"
            >
              <strong>Verify the selected building before using these measurements.</strong>
              <p className="mt-1">
                The geocoded address point is outside the selected building outline
                {visibleResult.footprint.address_to_footprint_distance_m !== undefined
                  ? ` by ${visibleResult.footprint.address_to_footprint_distance_m.toFixed(1)} m`
                  : ""}
                . The match is approximate; confirm this is the correct property.
              </p>
            </div>
          )}
          {visibleResult.status === "lidar_facets" ? (
            <div className="flex items-start gap-2 text-sm">
              <CheckCircle2 className="mt-0.5 size-4 text-emerald-600" />
              <div>
                <strong>{visibleResult.roof.facet_count} candidate roof facets detected</strong>
                <p className="text-muted-foreground">
                  {visibleResult.roof.total_squares?.toFixed(2)} squares · Dominant pitch{" "}
                  {visibleResult.roof.dominant_pitch_rise_per_12?.toFixed(1)}:12 · Preliminary LiDAR
                  result
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
                  Ground footprint: {visibleResult.fallback.footprint_area_sqft.toLocaleString()} sq
                  ft. This is not roof surface area.
                </p>
              </div>
            </div>
          )}
          {visibleResult.lidar && (
            <div className="rounded-md border border-border/70 bg-muted/20 p-3 text-sm">
              <strong>Source-data coverage</strong>
              <p className="mt-1 text-muted-foreground">
                {visibleResult.lidar.building_class_points !== undefined
                  ? `${visibleResult.lidar.building_class_points.toLocaleString()} unique building-class points`
                  : "Point total unavailable"}
                {visibleResult.lidar.tiles_used !== undefined
                  ? ` · ${visibleResult.lidar.tiles_used} LiDAR tiles used`
                  : ""}
                {visibleResult.lidar.stac_items !== undefined
                  ? ` · ${visibleResult.lidar.stac_items} coverage records searched`
                  : ""}
              </p>
              {visibleResult.lidar.duplicate_points_removed !== undefined &&
                visibleResult.lidar.duplicate_points_removed > 0 && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {visibleResult.lidar.duplicate_points_removed.toLocaleString()} overlapping tile
                    duplicates removed before plane fitting
                  </p>
                )}
              <p className="mt-1 text-xs text-muted-foreground">
                Point counts describe available source data, not a measurement-confidence score.
              </p>
            </div>
          )}
          {visibleResult.roof.facets.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="py-2 pr-3">Facet</th>
                    <th className="py-2 pr-3">LiDAR points</th>
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
                      <td className="py-2 pr-3 tabular-nums">
                        {facet.point_count.toLocaleString()}
                      </td>
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
            {visibleResult.disclaimer} Edge classifications are left unclassified until reviewed in
            the measurement editor.
          </p>
          {visibleResult.roof.facets.length > 0 && (
            <div className="space-y-2">
              <label htmlFor="lidar-roof-system" className="text-sm font-medium">
                Roof system for this measurement
              </label>
              <select
                id="lidar-roof-system"
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={roofType}
                onChange={(event) => setRoofType(event.target.value as RoofDrawing["roof_type"])}
              >
                <option value="">Select roof system…</option>
                <option value="Metal Roof">Architectural / metal roof</option>
                <option value="Shingle Roof">Shingle roof</option>
                <option value="Tile Roof">Concrete / clay tile roof</option>
                <option value="TPO">TPO</option>
                <option value="Flat Roof">Flat / modified bitumen roof</option>
              </select>
              <Button variant="outline" onClick={apply} disabled={!roofType}>
                Load candidate facets into roof editor
              </Button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
