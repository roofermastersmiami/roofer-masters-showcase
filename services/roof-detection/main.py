from __future__ import annotations

import math
import os
from typing import Any
from time import monotonic

import httpx
import laspy
import numpy as np
import planetary_computer
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, model_validator
from pyproj import CRS, Transformer
from pystac_client import Client
from shapely.geometry import MultiPoint, Point, Polygon, mapping
from shapely.validation import make_valid
from sklearn.cluster import DBSCAN
from sklearn.linear_model import LinearRegression, RANSACRegressor

APP_NAME = "Roofer Masters public-data roof detection"
NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
OVERPASS_URL = "https://overpass-api.de/api/interpreter"
STAC_URL = "https://planetarycomputer.microsoft.com/api/stac/v1"
STAC_COLLECTION = "3dep-lidar-copc"
USER_AGENT = os.getenv("ROOF_SERVICE_USER_AGENT", "RooferMastersCRM/1.0 (roof-report contact: roofermasters@gmail.com)")
MAX_STAC_ITEMS = int(os.getenv("MAX_STAC_ITEMS", "8"))
MIN_ROOF_POINTS = int(os.getenv("MIN_ROOF_POINTS", "80"))
MAX_PLANES = int(os.getenv("MAX_PLANES", "8"))
CACHE_TTL_SECONDS = max(60, int(os.getenv("CACHE_TTL_SECONDS", "86400")))
MAX_RESPONSE_CACHE = 200
_RESPONSE_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}

app = FastAPI(title=APP_NAME, version="1.0.0")
origins = [item.strip() for item in os.getenv("CORS_ORIGINS", "*").split(",") if item.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


class AnalyzeRequest(BaseModel):
    street_address: str | None = Field(default=None, min_length=5, max_length=300)
    lat: float | None = Field(default=None, ge=-90, le=90)
    lon: float | None = Field(default=None, ge=-180, le=180)

    @model_validator(mode="after")
    def validate_location(self):
        if not self.street_address and (self.lat is None or self.lon is None):
            raise ValueError("Provide street_address or both lat and lon.")
        if (self.lat is None) != (self.lon is None):
            raise ValueError("Latitude and longitude must be provided together.")
        return self


def _polygon_area_sqft(polygon: Polygon) -> float:
    # Local azimuthal-equidistant projection avoids treating degrees as feet.
    from pyproj import CRS
    center = polygon.representative_point()
    local = CRS.from_proj4(
        f"+proj=aeqd +lat_0={center.y} +lon_0={center.x} +datum=WGS84 +units=m +no_defs"
    )
    transformer = Transformer.from_crs("EPSG:4326", local, always_xy=True)
    projected = Polygon([transformer.transform(x, y) for x, y in polygon.exterior.coords])
    return float(projected.area * 10.7639104167)



def _footprint_match_fields(metadata: dict[str, Any]) -> dict[str, Any]:
    """Expose address-to-building match evidence to the CRM without guessing."""
    fields: dict[str, Any] = {}
    inside = metadata.get("address_point_inside_footprint")
    distance = metadata.get("address_to_footprint_distance_m")
    if isinstance(inside, bool):
        fields["address_point_inside_footprint"] = inside
    if isinstance(distance, (int, float)) and math.isfinite(distance) and distance >= 0:
        fields["address_to_footprint_distance_m"] = round(float(distance), 2)
    return fields


def _distance_to_footprint_meters(polygon: Polygon, lat: float, lon: float) -> float:
    """Measure address-point distance in a local metric projection, not degrees."""
    local = CRS.from_proj4(
        f"+proj=aeqd +lat_0={lat} +lon_0={lon} +datum=WGS84 +units=m +no_defs"
    )
    transformer = Transformer.from_crs("EPSG:4326", local, always_xy=True)
    projected_polygon = Polygon(
        [transformer.transform(x, y) for x, y in polygon.exterior.coords]
    )
    projected_point = Point(*transformer.transform(lon, lat))
    return float(projected_polygon.distance(projected_point))


async def _geocode_census(address: str) -> tuple[float, float, str]:
    """Free US Census geocoder fallback when the public Nominatim endpoint is throttled."""
    url = "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress"
    async with httpx.AsyncClient(timeout=25, headers={"User-Agent": USER_AGENT}) as client:
        response = await client.get(
            url,
            params={"address": address, "benchmark": "Public_AR_Current", "format": "json"},
        )
        response.raise_for_status()
        matches = response.json().get("result", {}).get("addressMatches", [])
    if not matches:
        raise HTTPException(404, "Address was not found by the OpenStreetMap or US Census geocoder.")
    match = matches[0]
    coordinates = match["coordinates"]
    return float(coordinates["y"]), float(coordinates["x"]), str(match.get("matchedAddress", address))


async def geocode(address: str) -> tuple[float, float, str]:
    headers = {"User-Agent": USER_AGENT}
    try:
        async with httpx.AsyncClient(timeout=25, headers=headers) as client:
            response = await client.get(NOMINATIM_URL, params={"q": address, "format": "jsonv2", "limit": 1})
            response.raise_for_status()
            results = response.json()
        if not results:
            return await _geocode_census(address)
        item = results[0]
        return float(item["lat"]), float(item["lon"]), str(item.get("display_name", address))
    except httpx.HTTPStatusError as exc:
        # Nominatim may return 429/629 when public rate limits or anti-abuse controls
        # are reached. Use the free US Census geocoder for US street addresses.
        if exc.response.status_code not in {429, 500, 502, 503, 504, 629}:
            raise
        return await _geocode_census(address)
    except (httpx.TimeoutException, httpx.ConnectError):
        return await _geocode_census(address)


async def get_footprint(lat: float, lon: float) -> tuple[Polygon, dict[str, Any]]:
    # A tight 80 m search radius is used; candidate polygons are ranked by address-point containment
    # and distance. OSM footprints are ground/building outlines, not roof-plane geometry.
    query = f"""
    [out:json][timeout:25];
    way(around:80,{lat},{lon})[building];
    out geom;
    """
    headers = {"User-Agent": USER_AGENT, "Content-Type": "application/x-www-form-urlencoded"}
    async with httpx.AsyncClient(timeout=35, headers=headers) as client:
        response = await client.post(OVERPASS_URL, data={"data": query})
        response.raise_for_status()
        data = response.json()
    address_point = Point(lon, lat)
    candidates: list[tuple[float, Polygon, dict[str, Any]]] = []
    for element in data.get("elements", []):
        coords = element.get("geometry") or []
        if len(coords) < 4:
            continue
        ring = [(float(p["lon"]), float(p["lat"])) for p in coords]
        polygon = make_valid(Polygon(ring))
        if polygon.geom_type == "MultiPolygon":
            polygon = max(polygon.geoms, key=lambda p: p.area)
        if polygon.geom_type != "Polygon" or polygon.is_empty or polygon.area <= 0:
            continue
        # Local projected area filter avoids selecting large campus/industrial polygons.
        area_sqft = _polygon_area_sqft(polygon)
        if area_sqft < 150 or area_sqft > 100000:
            continue
        distance_m = _distance_to_footprint_meters(polygon, lat, lon)
        # Geocoders frequently place a street address on the curb or driveway.
        # Permit a conservative 25 m candidate radius, but never guess when two
        # nearby buildings are similarly plausible. Exact containment still ranks first.
        if distance_m > 25.0:
            continue
        metadata = {
            "osm_way_id": element.get("id"),
            "building_tags": element.get("tags", {}),
            "address_point_inside_footprint": polygon.contains(address_point),
            "address_to_footprint_distance_m": round(distance_m, 2),
        }
        candidates.append((distance_m, polygon, metadata))
    if not candidates:
        raise HTTPException(
            404,
            "No mapped building was found within 25 m of the geocoded address point. Zoom in and verify the property pin, or trace the roof manually.",
        )
    candidates.sort(key=lambda row: (not bool(row[2].get("address_point_inside_footprint")), row[0]))
    if len(candidates) > 1:
        nearest_distance = candidates[0][0]
        next_distance = candidates[1][0]
        # If the next structure is almost as plausible, fail safely instead of
        # running LiDAR against a potentially neighboring property.
        if next_distance - nearest_distance < 8.0 and not candidates[0][2].get("address_point_inside_footprint"):
            raise HTTPException(
                409,
                "Several nearby buildings could match this street-side address pin. Zoom in and select/trace the correct building before running roof detection.",
            )
    _, polygon, metadata = candidates[0]
    return polygon, metadata


def _transform_polygon(polygon: Polygon, transformer: Transformer) -> Polygon:
    """Transform exterior and interior rings without discarding footprint holes."""
    exterior = [transformer.transform(x, y) for x, y in polygon.exterior.coords]
    interiors = [
        [transformer.transform(x, y) for x, y in ring.coords]
        for ring in polygon.interiors
    ]
    return Polygon(exterior, interiors)


def _project_polygon(polygon: Polygon, epsg: int) -> tuple[Polygon, Transformer, Transformer]:
    to_xy = Transformer.from_crs("EPSG:4326", f"EPSG:{epsg}", always_xy=True)
    to_ll = Transformer.from_crs(f"EPSG:{epsg}", "EPSG:4326", always_xy=True)
    return _transform_polygon(polygon, to_xy), to_xy, to_ll


def _fit_facets(points: np.ndarray, footprint: Polygon | None = None) -> list[dict[str, Any]]:
    remaining = points.copy()
    facets: list[dict[str, Any]] = []
    for plane_index in range(MAX_PLANES):
        if len(remaining) < MIN_ROOF_POINTS or len(facets) >= MAX_PLANES:
            break
        estimator = RANSACRegressor(
            estimator=LinearRegression(),
            # Three non-collinear points are sufficient to hypothesize a
            # plane. Large random samples can mix both sides of a ridge and
            # converge on a shallow compromise plane, corrupting pitch.
            min_samples=3,
            residual_threshold=0.20,
            max_trials=250,
            random_state=plane_index + 13,
        )
        try:
            estimator.fit(remaining[:, :2], remaining[:, 2])
        except (ValueError, FloatingPointError):
            break
        inliers = estimator.inlier_mask_
        if inliers is None or int(inliers.sum()) < MIN_ROOF_POINTS:
            break
        selected = remaining[inliers]
        model = estimator.estimator_
        a, b = (float(model.coef_[0]), float(model.coef_[1]))
        slope = math.hypot(a, b)
        pitch = math.degrees(math.atan(slope))  # angle from horizontal
        if pitch > 70:
            # Class 6 includes walls as well as roofs; reject near-vertical building planes.
            remaining = remaining[~inliers]
            continue
        pitch_rise = slope * 12.0
        azimuth = (math.degrees(math.atan2(-a, -b)) + 360.0) % 360.0

        # A single RANSAC plane can cover multiple detached structures with the
        # same pitch. Segment its inliers spatially before computing convex hulls,
        # otherwise the hull bridges the gap and overstates roof area.
        labels = DBSCAN(eps=1.5, min_samples=3).fit_predict(selected[:, :2])
        for label in sorted(set(labels.tolist())):
            if label < 0 or len(facets) >= MAX_PLANES:
                continue
            cluster = selected[labels == label]
            if len(cluster) < MIN_ROOF_POINTS:
                continue
            hull = MultiPoint(cluster[:, :2]).convex_hull
            # A line/point hull cannot produce a valid roof polygon.
            if hull.geom_type != "Polygon" or hull.area <= 1e-4:
                continue

            # Convex hulls can bridge courtyards and concave footprint cutouts.
            # Clip to a small buffer around the ground outline to retain ordinary
            # eave overhang while preventing unsupported area across large gaps.
            bounded = hull.intersection(footprint.buffer(0.75)) if footprint is not None else hull
            components = (
                [bounded]
                if bounded.geom_type == "Polygon"
                else [part for part in getattr(bounded, "geoms", []) if part.geom_type == "Polygon"]
            )
            for component in components:
                if component.is_empty or component.area <= 1e-4 or len(facets) >= MAX_PLANES:
                    continue
                component_points = [
                    point
                    for point in cluster
                    if component.buffer(0.02).covers(Point(float(point[0]), float(point[1])))
                ]
                if not component_points:
                    continue
                horizontal_area = float(component.area)
                surface_area_sqft = (
                    horizontal_area
                    / max(math.cos(math.radians(pitch)), 1e-6)
                    * 10.7639104167
                )
                component_array = np.asarray(component_points, dtype=float)
                residuals = component_array[:, 2] - model.predict(component_array[:, :2])
                fit_rmse_m = float(np.sqrt(np.mean(np.square(residuals))))
                facets.append({
                    "id": f"facet-{len(facets) + 1}",
                    "point_count": len(component_points),
                    "fit_rmse_m": round(fit_rmse_m, 4),
                    "pitch_degrees": round(pitch, 2),
                    "pitch_rise_per_12": round(pitch_rise, 2),
                    "azimuth_degrees": round(azimuth, 1),
                    "area_sqft": round(surface_area_sqft, 1),
                    "squares": round(surface_area_sqft / 100.0, 3),
                    "plane_model": {
                        "z_equals_ax_plus_by_plus_c": [a, b, float(model.intercept_)]
                    },
                    "boundary_xy": [
                        [round(float(x), 3), round(float(y), 3)]
                        for x, y in component.exterior.coords
                    ],
                })
        remaining = remaining[~inliers]
    return facets

def _deduplicate_lidar_points(points: np.ndarray, precision_m: float = 0.02) -> np.ndarray:
    """Remove overlapping COPC tile duplicates at 2 cm XYZ precision."""
    if points.size == 0:
        return points.reshape((0, 3))
    quantized = np.round(points / precision_m).astype(np.int64)
    _, indices = np.unique(quantized, axis=0, return_index=True)
    return points[np.sort(indices)]


def _read_lidar_facets(polygon: Polygon) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    catalog = Client.open(STAC_URL)
    # Search footprint bbox, not the full city. Multiple COPC tiles may overlap.
    items = list(catalog.search(collections=[STAC_COLLECTION], bbox=list(polygon.bounds), max_items=MAX_STAC_ITEMS).items())
    if not items:
        return [], {"stac_items": 0, "reason": "No 3DEP COPC coverage intersected the building footprint."}

    center = polygon.representative_point()
    local_crs = CRS.from_proj4(
        f"+proj=aeqd +lat_0={center.y} +lon_0={center.x} +datum=WGS84 +units=m +no_defs"
    )
    to_local = Transformer.from_crs("EPSG:4326", local_crs, always_xy=True)
    from_local = Transformer.from_crs(local_crs, "EPSG:4326", always_xy=True)
    tile_points: list[np.ndarray] = []
    used_items = 0
    raw_point_count = 0

    for item in items:
        epsg_value = item.properties.get("proj:epsg")
        if not epsg_value:
            epsg_value = item.properties.get("proj:code", "")
        try:
            epsg = int(str(epsg_value).split(":")[-1])
        except (TypeError, ValueError):
            continue
        projected_polygon, _, _ = _project_polygon(polygon, epsg)
        projected_crs = CRS.from_epsg(epsg)
        meters_per_unit = projected_crs.axis_info[0].unit_conversion_factor if projected_crs.axis_info else 1.0
        if not meters_per_unit or not math.isfinite(meters_per_unit):
            continue
        # Include class-6 roof returns just beyond the ground footprint so
        # ordinary eave overhang is not discarded before facet fitting.
        lidar_query_polygon = projected_polygon.buffer(0.75 / meters_per_unit)
        asset = item.assets.get("data") or item.assets.get("copc") or next(
            (candidate for candidate in item.assets.values() if "copc" in candidate.href.lower() or candidate.href.lower().endswith(".laz")),
            None,
        )
        if asset is None:
            continue
        href = planetary_computer.sign(asset.href)
        minx, miny, maxx, maxy = lidar_query_polygon.bounds
        try:
            with laspy.CopcReader.open(href) as reader:
                cloud = reader.query(
                    bounds=laspy.Bounds(
                        mins=np.array([minx, miny]),
                        maxs=np.array([maxx, maxy]),
                    )
                )
            x = np.asarray(cloud.x)
            y = np.asarray(cloud.y)
            z = np.asarray(cloud.z)
            classifications = np.asarray(cloud.classification)
            # ASPRS class 6 is building. Do not treat generic unclassified points as roof evidence.
            mask = (classifications == 6) & np.isfinite(x) & np.isfinite(y) & np.isfinite(z)
            if not mask.any():
                continue
            coords = np.column_stack((x[mask], y[mask], z[mask]))
            inside = np.array([lidar_query_polygon.covers(Point(px, py)) for px, py in coords[:, :2]])
            coords = coords[inside]
            if len(coords) < MIN_ROOF_POINTS:
                continue

            # Convert every tile into one local metric coordinate system before
            # combining. This lets overlapping tiles be deduplicated and avoids
            # counting the same roof facet once per COPC tile.
            to_wgs84 = Transformer.from_crs(f"EPSG:{epsg}", "EPSG:4326", always_xy=True)
            lon, lat = to_wgs84.transform(coords[:, 0], coords[:, 1])
            local_x, local_y = to_local.transform(lon, lat)
            tile_points.append(np.column_stack((local_x, local_y, coords[:, 2])))
            raw_point_count += len(coords)
            used_items += 1
        except Exception:
            # One unavailable/corrupt tile must not prevent other intersecting tiles being used.
            continue

    if not tile_points:
        return [], {"stac_items": len(items), "tiles_used": 0, "building_class_points": 0}

    combined = np.vstack(tile_points)
    unique_points = _deduplicate_lidar_points(combined)
    footprint_local = _transform_polygon(polygon, to_local)
    all_facets: list[dict[str, Any]] = []
    for facet in _fit_facets(unique_points, footprint_local):
        facet["id"] = f"facet-{len(all_facets) + 1}"
        model_a, model_b, model_c = facet["plane_model"]["z_equals_ax_plus_by_plus_c"]
        facet["boundary_latlon"] = []
        for xy in facet.pop("boundary_xy"):
            lon, lat = from_local.transform(xy[0], xy[1])
            facet["boundary_latlon"].append([
                round(lat, 7),
                round(lon, 7),
                round(model_a * xy[0] + model_b * xy[1] + model_c, 3),
            ])
        all_facets.append(facet)

    return all_facets, {
        "stac_items": len(items),
        "tiles_used": used_items,
        "building_class_points": len(unique_points),
        "raw_building_class_points": raw_point_count,
        "duplicate_points_removed": raw_point_count - len(unique_points),
    }

@app.get("/health")
def health():
    return {"status": "ok", "service": APP_NAME, "lidar_collection": STAC_COLLECTION}


@app.post("/v1/roof/analyze")
async def analyze_roof(request: AnalyzeRequest):
    cache_key = (
        request.street_address.strip().casefold()
        if request.street_address
        else f"{float(request.lat):.6f},{float(request.lon):.6f}"
    )
    cached = _RESPONSE_CACHE.get(cache_key)
    if cached and cached[0] > monotonic():
        return cached[1]
    if request.street_address:
        lat, lon, matched_address = await geocode(request.street_address)
    else:
        lat, lon = float(request.lat), float(request.lon)
        matched_address = f"{lat:.7f}, {lon:.7f}"
    footprint, footprint_meta = await get_footprint(lat, lon)
    footprint_sqft = _polygon_area_sqft(footprint)
    try:
        facets, lidar_meta = _read_lidar_facets(footprint)
    except Exception as exc:
        facets, lidar_meta = [], {"reason": f"3DEP lookup failed: {type(exc).__name__}"}
    lidar_area = sum(facet["area_sqft"] for facet in facets)
    status = "lidar_facets" if facets else "footprint_only"
    # Edge classes and intersections are deliberately not inferred from a ground footprint.
    result = {
        "status": status,
        "verification": "unverified_public_data",
        "matched_address": matched_address,
        "location": {"lat": lat, "lon": lon},
        "footprint": {
            "source": "OpenStreetMap",
            "osm_way_id": footprint_meta.get("osm_way_id"),
            "area_sqft": round(footprint_sqft, 1),
            **_footprint_match_fields(footprint_meta),
            "polygon_geojson": mapping(footprint),
            "building_tags": footprint_meta.get("building_tags", {}),
        },
        "lidar": {"source": "Microsoft Planetary Computer / USGS 3DEP COPC", **lidar_meta},
        "roof": {
            "facet_count": len(facets),
            "area_sqft": round(lidar_area, 1) if facets else None,
            "total_squares": round(lidar_area / 100.0, 3) if facets else None,
            "dominant_pitch_rise_per_12": (
                max(facets, key=lambda facet: facet["area_sqft"])["pitch_rise_per_12"] if facets else None
            ),
            "facets": facets,
            "edge_lengths_lf": None,
        },
        "fallback": {
            "available": not bool(facets),
            "mode": "manual_pitch_and_facet_review" if not facets else None,
            "footprint_area_sqft": round(footprint_sqft, 1),
            "message": (
                "No adequate classified roof point cloud was available. The footprint is a ground outline, "
                "not a roof surface. Enter or trace roof planes and pitch before producing a measured report."
                if not facets else None
            ),
        },
        "disclaimer": (
            "Automated public-data output is preliminary and not a survey, engineering certification, "
            "or site-verified takeoff. Confirm geometry and quantities before ordering materials or submitting permits."
        ),
    }
    if len(_RESPONSE_CACHE) >= MAX_RESPONSE_CACHE:
        expired_or_oldest = min(_RESPONSE_CACHE, key=lambda key: _RESPONSE_CACHE[key][0])
        _RESPONSE_CACHE.pop(expired_or_oldest, None)
    _RESPONSE_CACHE[cache_key] = (monotonic() + CACHE_TTL_SECONDS, result)
    return result
