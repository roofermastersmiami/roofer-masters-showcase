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
- Facet surface area is derived from the fitted plane and point-cloud convex hull. Before resolution, plane candidates that are fragments of one physical face — normals within 4°, planes within ~0.35 ft of each other where their hulls meet, and hulls that overlap or nearly touch — are merged: their inlier points are pooled, one plane is refit, and one hull is rebuilt, so a face split across RANSAC passes enters resolution whole instead of losing pieces as "duplicates". Clipped hulls are then resolved largest-first and each hull gives up any area an earlier facet already claimed, so overlapping detections tile the roof instead of double-counting shared area; a facet whose remainder is a sliver (< 25 sq ft) or mostly claimed (< 35% of its hull) is dropped as a duplicate — unless the dropped candidate is a genuinely different plane facing the same way over the same section, proven by at least 150 of its own points that fit its plane while every accepted plane misses them: then the contested ground is split along the planes' intersection lines and both planes survive (two real surfaces at different pitches can share one roof section, and the shallower first fit must not erase the steeper one). Because hulls end where inlier points end, a coverage-completion pass then grows the facets across the parts of the clipped footprint region that still hold unclaimed points the facet's own plane predicts (seams along hips, ridges and eaves, dropped detections' fringes), splitting each gap between adjacent facets along the planes' intersection lines; margins with no fitting points in them stay unclaimed. Both LiDAR paths can also gather building points in an overhang ring past the footprint (`OVERHANG_RING_M`, default 1.5 m), kept out of plane fitting: a facet may grow into the ring only where ring points lie on its own plane, chain back to it in steps of at most 1 m, and stay below its own highest fitted elevation. The growth is provenance-gated: validation against professional reports showed it completes wall-outline footprints (Broward) but annexes same-pitch non-roof surface beyond the eave where the footprint already traces the roof outline, so it never fires for the Miami-Dade County footprint layer — that layer's polygons are LiDAR-traced roof outlines, and facets measured against one are instead clipped to the traced outline itself. Growth is also clipped out of corridors around the valley seams the facets already share, so it cannot pave over the concave corner a valley runs out through. A further outline-completion pass tiles whatever part of the footprint the facets still leave bare, splitting each patch between the adjacent facets along the planes' intersection lines, so facet outer edges follow the footprint's true outline (the notches and corners of an L-shaped plan included) rather than the smoother hull line; near-coincident boundaries of adjacent facets are then snapped onto shared lines, with the snap accepted only when the boundary survives the millimetre rounding applied at emission. Finally, each pair's edge classification (ridge, hip, valley, pitch change) is decided once, when coverage completion establishes the facet structure, and is not re-derived from the reshaped polygons afterwards: the chord test's margin on real seams can be a few centimetres, smaller than the sampling drift the geometry passes induce, and re-classifying flipped a measured valley to a hip purely because its facets had grown. Facet point counts and fit RMSE always describe the points actually fitted. It remains preliminary until checked against imagery and/or on-site measurements.
- Ridge/hip/valley/eave/rake totals (`roof.edge_lengths_lf`) are computed from the fitted facets' shared-boundary topology: each pair of adjacent planes contributes their true intersection line, classified by a cross-section chord test (peak = ridge when level, hip when sloped; trough = valley), and unshared facet boundary is split into eaves (across the slope) and rakes (along it). Totals are preliminary like the facet areas — they are estimates from public LiDAR, not verified linework, and remain subject to imagery and on-site review.
- Public services have fair-use limits. The service currently caches completed responses in process memory; restarts clear that cache.
