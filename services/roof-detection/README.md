# Roofer Masters public-data roof detection API

A keyless FastAPI service using OpenStreetMap Nominatim/Overpass plus county building-footprint layers (Broward County and Miami-Dade County official ArcGIS services) for address and ground-footprint discovery, and free USGS LiDAR point clouds for roof planes: the Microsoft Planetary Computer `3dep-lidar-copc` STAC collection where it has coverage, with a fallback to the same USGS surveys published as LAZ tiles through The National Map (TNM) whenever the COPC path yields no roof facets — notably Miami-Dade and Broward, which have effectively no usable COPC coverage (a COPC item may intersect the search area yet contain no usable roof points). TNM tiles are large, so they are downloaded once into a disk cache (`LIDAR_CACHE_DIR`, default `/tmp/roof-lidar-cache`; at most `MAX_TNM_TILES` tiles of `MAX_TNM_TILE_MB` MB per lookup) and reused for every nearby address. Downloads are verified against the LAZ `LASF` signature so an HTML error page can never enter the cache.

## Run locally

```bash
cd services/roof-detection
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

Health: `GET /health`

Analyze: `POST /v1/roof/analyze`

```json
{ "street_address": "1600 Pennsylvania Ave NW, Washington, DC" }
```

Or pass coordinates:

```json
{ "lat": 38.8977, "lon": -77.0365 }
```

## Free deployment with Render

The repository includes a `render.yaml` Blueprint for the roof-detection service.

1. In Render, choose **New → Blueprint** and connect this GitHub repository.
2. Select the `render.yaml` Blueprint. It creates the Docker web service on Render's free plan.
3. When prompted, set `CORS_ORIGINS` to the exact public origin of the CRM frontend (scheme + hostname, no trailing path). Do not use `*` in production.
4. Deploy. Wait for the service health check to pass, then open `https://YOUR-SERVICE.onrender.com/health`.
5. Copy the service origin (without `/health`) into the frontend host's `VITE_ROOF_DETECTION_API_URL` environment variable and redeploy the frontend.

The CRM environment variable is configured in the frontend hosting provider, not in the Render service. A service URL cannot be supplied until Render creates the service. No API keys or paid data APIs are required.

The free host may sleep and cold-start; public data providers can throttle requests. This API intentionally returns `footprint_only` when LiDAR coverage or sufficient building-classified points are unavailable. It does not manufacture pitch or edge quantities from a 2D footprint.

## Accuracy and operating limits

- OSM building geometry is a ground/building footprint, not a roof outline.
- The COPC path uses ASPRS class 6 building points only. The TNM fallback prefers class 6 too, but some county deliveries (for example the 2024 Miami-Dade LPC project) contain no building classification at all — only ground/unclassified separation. For those tiles the service falls back to non-ground points at least 2 m above the local ground level inside the footprint, and the response metadata reports `points_source` (`asprs_class_6`, `elevated_non_ground`, or `mixed`) so the weaker evidence is never silent. Plane fitting still has to agree with the selected points before any facet is reported.
- RANSAC fits local planes to the available building-classified points. Fitting is tight-first (`RANSAC_RESIDUAL_THRESHOLD_M`, default 0.10 m): a loose tolerance lets one fit gather points from two faces meeting at a hip or ridge and settle on a shallow compromise plane between them, corrupting pitch; a plane that cannot gather enough inliers at the tight threshold is retried once at the fallback tolerance (`RANSAC_RESIDUAL_THRESHOLD_FALLBACK_M`, default 0.20 m) so sparse or noisy tiles still yield facets. Small, occluded, complex, or low-density facets may be missed.
- Facet surface area is derived from the fitted plane and point-cloud convex hull. Clipped hulls are resolved largest-first and each hull gives up any area an earlier facet already claimed, so overlapping detections tile the roof instead of double-counting shared area; a facet whose remainder is a sliver (< 25 sq ft) or mostly claimed (< 35% of its hull) is dropped as a duplicate. Because hulls end where inlier points end, a coverage-completion pass then grows the facets across the parts of the clipped footprint region that still hold unclaimed roof points (seams along hips, ridges and eaves, dropped detections' fringes), splitting each gap between adjacent facets along the planes' intersection lines; margins with no points in them (unevidenced overhang, courtyard edges) stay unclaimed, and facet point counts and fit RMSE always describe the points actually fitted. It remains preliminary until checked against imagery and/or on-site measurements.
- Ridge/hip/valley/eave/rake totals (`roof.edge_lengths_lf`) are computed from the fitted facets' shared-boundary topology: each pair of adjacent planes contributes their true intersection line, classified by a cross-section chord test (peak = ridge when level, hip when sloped; trough = valley), and unshared facet boundary is split into eaves (across the slope) and rakes (along it). Totals are preliminary like the facet areas — they are estimates from public LiDAR, not verified linework, and remain subject to imagery and on-site review.
- Public services have fair-use limits. The service currently caches completed responses in process memory; restarts clear that cache.
