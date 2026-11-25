# Roofer Masters public-data roof detection API

A keyless FastAPI service using OpenStreetMap Nominatim/Overpass for address and ground-footprint discovery, and the public Microsoft Planetary Computer `3dep-lidar-copc` STAC collection for USGS 3DEP point clouds.

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
- The service uses ASPRS class 6 building points only; unclassified points are not silently treated as roofs.
- RANSAC fits local planes to the available building-classified points. Small, occluded, complex, or low-density facets may be missed.
- Facet surface area is derived from the fitted plane and point-cloud convex hull. It remains preliminary until checked against imagery and/or on-site measurements.
- Ridge/hip/valley/eave/rake linework is not returned as verified because a building footprint and disconnected plane hulls cannot reliably distinguish those edge classes without shared-boundary topology and manual/imagery review.
- Public services have fair-use limits. The service currently caches completed responses in process memory; restarts clear that cache.
