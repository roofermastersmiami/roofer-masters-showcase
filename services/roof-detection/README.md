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
{"street_address":"1600 Pennsylvania Ave NW, Washington, DC"}
```

Or pass coordinates:

```json
{"lat":38.8977,"lon":-77.0365}
```

## Free deployment

1. Push this repository to GitHub.
2. Create a free web service on Render and connect this repository.
3. Set **Root Directory** to `services/roof-detection`.
4. Choose **Docker** as the runtime. Render will build the included Dockerfile.
5. Set `CORS_ORIGINS` to the exact CRM origin (for example, your Lovable production domain); do not leave `*` for production.
6. Deploy and verify `https://YOUR-SERVICE.onrender.com/health`.
7. Set the CRM environment variable `VITE_ROOF_DETECTION_API_URL` to the service origin.

The free host may sleep and cold-start; public data providers can throttle requests. This API intentionally returns `footprint_only` when LiDAR coverage or sufficient building-classified points are unavailable. It does not manufacture pitch or edge quantities from a 2D footprint.

## Accuracy and operating limits

- OSM building geometry is a ground/building footprint, not a roof outline.
- The service uses ASPRS class 6 building points only; unclassified points are not silently treated as roofs.
- RANSAC fits local planes to the available building-classified points. Small, occluded, complex, or low-density facets may be missed.
- Facet surface area is derived from the fitted plane and point-cloud convex hull. It remains preliminary until checked against imagery and/or on-site measurements.
- Ridge/hip/valley/eave/rake linework is not returned as verified because a building footprint and disconnected plane hulls cannot reliably distinguish those edge classes without shared-boundary topology and manual/imagery review.
- Public services have fair-use limits. Cache completed address analyses in the CRM and avoid repeated requests while editing a report.
- No API keys or paid APIs are required.
