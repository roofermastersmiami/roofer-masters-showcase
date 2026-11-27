from __future__ import annotations

import asyncio
import hashlib
import math
import os
import re
from pathlib import Path
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
from shapely import contains_xy
from shapely.geometry import LineString, MultiPoint, Point, Polygon, mapping, shape
from shapely.ops import nearest_points
from shapely.validation import make_valid
from sklearn.cluster import DBSCAN
from sklearn.linear_model import LinearRegression, RANSACRegressor

APP_NAME = "Roofer Masters public-data roof detection"
NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
OVERPASS_URL = "https://overpass-api.de/api/interpreter"
STAC_URL = "https://planetarycomputer.microsoft.com/api/stac/v1"
STAC_COLLECTION = "3dep-lidar-copc"
TNM_PRODUCTS_URL = "https://tnmaccess.nationalmap.gov/api/v1/products"
LIDAR_CACHE_DIR = Path(os.getenv("LIDAR_CACHE_DIR", "/tmp/roof-lidar-cache"))
MAX_TNM_TILES = int(os.getenv("MAX_TNM_TILES", "2"))
MAX_TNM_TILE_MB = float(os.getenv("MAX_TNM_TILE_MB", "400"))
USER_AGENT = os.getenv("ROOF_SERVICE_USER_AGENT", "RooferMastersCRM/1.0 (roof-report contact: roofermasters@gmail.com)")
MAX_STAC_ITEMS = int(os.getenv("MAX_STAC_ITEMS", "8"))
MIN_ROOF_POINTS = int(os.getenv("MIN_ROOF_POINTS", "80"))
MAX_PLANES = int(os.getenv("MAX_PLANES", "8"))
# Facet hulls are resolved largest-first and each hull gives up the area
# already claimed by earlier facets (see _fit_facets). A remainder below
# MIN_FACET_AREA_SQFT is a subtraction sliver, and a facet that keeps less
# than MIN_FACET_REMAINING_FRACTION of its clipped hull is a duplicate
# detection of claimed area rather than a distinct roof plane.
MIN_FACET_AREA_SQFT = float(os.getenv("MIN_FACET_AREA_SQFT", "25"))
MIN_FACET_REMAINING_FRACTION = float(os.getenv("MIN_FACET_REMAINING_FRACTION", "0.35"))
# RANSAC plane tolerance. A loose threshold lets one fit gather points from
# two faces meeting at a hip or ridge and settle on a shallow compromise
# plane between them: the real Miramar pool reads 3.1-4.1/12 compromise
# planes at 0.20 m but clean 5.35-5.58/12 faces at 0.10 m. Fit tight first;
# only when a plane cannot gather MIN_ROOF_POINTS inliers at the tight
# threshold (sparse or noisy tile) is that plane retried at the fallback.
RANSAC_RESIDUAL_THRESHOLD_M = float(os.getenv("RANSAC_RESIDUAL_THRESHOLD_M", "0.10"))
RANSAC_RESIDUAL_THRESHOLD_FALLBACK_M = float(
    os.getenv("RANSAC_RESIDUAL_THRESHOLD_FALLBACK_M", "0.20")
)
# Coverage completion: after hull resolution, parts of the clipped footprint
# region that no facet claimed are assigned to an adjacent facet along the
# planes' intersection lines — but only where roof evidence brackets the
# growth: input points no facet claimed that the growing facet's own plane
# still predicts (seam points between two planes, a dropped duplicate
# detection's fringe). Evidence-free overhang/courtyard margins stay
# unclaimed, so the tessellation completes measured seams along hips,
# ridges and eaves without inventing roof the point cloud never saw.
COVERAGE_GAP_ADJACENCY_M = float(os.getenv("COVERAGE_GAP_ADJACENCY_M", "1.0"))
# An unclaimed point only evidences growth of a facet whose plane actually
# predicts it (residual within this tolerance, the RANSAC fallback scale).
# Without the check, a facet annexes any nearby unclaimed surface — a
# sloped facet growing into an adjacent flat section whose points its
# plane plainly does not fit.
COVERAGE_EVIDENCE_RESIDUAL_M = float(os.getenv("COVERAGE_EVIDENCE_RESIDUAL_M", "0.20"))
# Sequential RANSAC passes can split one physical roof face into several
# near-parallel fragments: the first pass consumes only part of the face and
# a later pass fits the rest with a slightly different pitch/offset. Left
# alone, the fragments' hulls overlap and the resolution pass drops pieces
# of the face as "duplicates". Candidates whose plane normals agree within
# MERGE_NORMAL_ANGLE_DEG, whose planes sit within MERGE_PLANE_OFFSET_M of
# each other (0.107 m ≈ 0.35 ft), and whose clipped hulls overlap or nearly
# touch (within MERGE_HULL_GAP_M) are therefore merged before resolution:
# their inlier points are pooled, one plane is refit, and one hull is
# rebuilt (see _merge_fragmented_candidates).
MERGE_NORMAL_ANGLE_DEG = float(os.getenv("MERGE_NORMAL_ANGLE_DEG", "4"))
MERGE_PLANE_OFFSET_M = float(os.getenv("MERGE_PLANE_OFFSET_M", "0.107"))
MERGE_HULL_GAP_M = float(os.getenv("MERGE_HULL_GAP_M", "1.0"))
# Overhang ring evidence: the fitting pool stops at the footprint + 0.75 m
# clip, but a roof's eaves can extend past it, and that outer strip then has
# no points a facet may grow on — Miramar's remaining deficit includes
# ~250 sq ft of exactly that ring. Both LiDAR paths can therefore also
# gather building points in the ring out to OVERHANG_RING_M. Ring points
# never enter plane fitting; they only evidence facet growth into the ring
# (see _grow_into_overhang_ring), and only where they lie on the facet's own
# plane, connect back to the facet in steps of at most
# RING_EVIDENCE_ADJACENCY_M, and stay below the facet's own highest fitted
# elevation plus RING_EVIDENCE_Z_CAP_M (a taller neighbouring roof that
# merely crosses the plane's extension is not this roof's overhang).
# Whether the growth may fire at all depends on what the footprint polygon
# traces (see ROOF_OUTLINE_PROVIDERS below): where the county traces the
# WALL line (Broward), the ring past it is real roof and the growth is
# worth a great deal (Miramar's total error went to -0.4% with the ring at
# 1.5 m); where the footprint already traces the ROOF outline (Miami-Dade),
# the same growth annexes non-roof surface beyond the eave (at Annel's
# house a same-pitch patio cover added +92 sq ft the FirstMeasure report
# does not count). The ring therefore defaults to 1.5 m and is gated per
# footprint provider in _fit_facets, not per deployment.
OVERHANG_RING_M = float(os.getenv("OVERHANG_RING_M", "1.5"))
RING_EVIDENCE_ADJACENCY_M = float(os.getenv("RING_EVIDENCE_ADJACENCY_M", "1.0"))
RING_EVIDENCE_Z_CAP_M = float(os.getenv("RING_EVIDENCE_Z_CAP_M", "0.25"))
# Competing planes: largest-first resolution drops a candidate that keeps
# less than MIN_FACET_REMAINING_FRACTION of its hull as a duplicate. Two
# genuinely different planes can face the same way over one roof section
# (Miramar's SE section holds a 4.26/12 and a 5.64/12 surface); the loser
# is then not a duplicate but a real plane whose points the winner does
# not explain. A dropped candidate with at least
# COMPETING_PLANE_MIN_POINTS such points — fitting its own plane within
# COMPETING_PLANE_RESIDUAL_M while every accepted plane misses them by
# more than that — is rescued: the contested ground is split along the
# planes' intersection lines (see _competing_plane_share).
COMPETING_PLANE_MIN_POINTS = int(os.getenv("COMPETING_PLANE_MIN_POINTS", "150"))
COMPETING_PLANE_RESIDUAL_M = float(os.getenv("COMPETING_PLANE_RESIDUAL_M", "0.20"))
# Footprint provenance decides two things in _fit_facets: whether the
# overhang ring may grow facets past the polygon, and whether facet edges
# are clipped back to the polygon. Miami-Dade County's building footprints
# are derived from the county LiDAR survey itself (the layer's SOURCE code
# 'L'), so the polygon traces the ROOF outline — eave overhang is already
# inside it, and surface past the eave (an attached patio cover at Annel's
# house, same pitch, same height) is not part of the measured roof. Every
# other provider used here (Broward County, ArcGIS USA Structures,
# OpenStreetMap, City of Miramar parcels) traces the WALL line, so the
# roof legitimately extends past the polygon by the eave overhang and the
# ring evidence may claim it. Providers not in this set are treated as
# wall outlines.
ROOF_OUTLINE_PROVIDERS = frozenset({"Miami-Dade County Building Footprints"})
# Boundary snapping: the resolution/shrink/growth passes can leave two
# facets that share one physical seam a few decimetres apart, so the edge
# classifier sees two perimeters instead of one shared edge (Miramar's
# ridge nearly vanished this way). After all growth, boundary vertices of
# one facet that lie within this tolerance of a neighbour's boundary move
# to the midpoint between the two boundaries, and any overlap the move
# creates is trimmed back, so adjacent facets end up coincident and
# disjoint.
BOUNDARY_SNAP_TOLERANCE_M = float(os.getenv("BOUNDARY_SNAP_TOLERANCE_M", "0.5"))
# Valley protection for overhang growth: a valley runs out to the eave,
# and ring growth at its mouth would fill the concave corner (and, by
# moving the facet outline, can cost the valley its classification).
# Growth pieces are clipped out of a corridor this wide around each
# existing valley seam, extended into the ring along its own line.
VALLEY_GROWTH_CLEARANCE_M = float(os.getenv("VALLEY_GROWTH_CLEARANCE_M", "0.5"))
CACHE_TTL_SECONDS = max(60, int(os.getenv("CACHE_TTL_SECONDS", "86400")))
MAX_RESPONSE_CACHE = 200
CANDIDATE_SEARCH_RADIUS_M = 80.0
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
    footprint_candidate_id: str | None = Field(default=None, min_length=8, max_length=128)

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


async def resolve_broward_address_point(address: str) -> tuple[float, float, str, dict[str, Any]] | None:
    """Resolve a street address against Broward County's official site-address points.

    The query is deliberately narrow and the returned address is normalized and
    checked locally before its coordinates can replace a general geocoder result.
    """
    street_line = address.split(",", 1)[0].strip()
    tokens = re.findall(r"[A-Za-z0-9]+", street_line.upper())
    if len(tokens) < 3 or not tokens[0].isdigit():
        return None

    house_number = tokens[0]
    # Use a distinctive street-name token as a coarse server-side filter;
    # full normalized-address equality is the actual acceptance condition.
    street_tokens = [token for token in tokens[1:] if token not in {
        "N", "S", "E", "W", "NE", "NW", "SE", "SW",
        "NORTH", "SOUTH", "EAST", "WEST", "NORTHEAST",
        "NORTHWEST", "SOUTHEAST", "SOUTHWEST",
        "ST", "STREET", "AVE", "AVENUE", "RD", "ROAD",
        "DR", "DRIVE", "BLVD", "BOULEVARD", "CT", "COURT",
        "LN", "LANE", "PL", "PLACE", "TRL", "TRAIL",
        "PKWY", "PARKWAY", "HWY", "HIGHWAY",
    }]
    if not street_tokens:
        return None
    street_token = street_tokens[0].replace("'", "''")
    url = (
        "https://services.arcgis.com/JMAJrTsHNLrSsWf5/"
        "ArcGIS/rest/services/ZoningApp/FeatureServer/0/query"
    )
    params = {
        "where": (
            f"SITUS_HOUSE_NUMBER = '{house_number}' "
            f"AND FULL_SITE_ADDRESS LIKE '%{street_token}%'"
        ),
        "outFields": "FULL_SITE_ADDRESS,Address,FOLIO_NUMBER,CITY_NAME,ZIP_CODE,X_COORD,Y_COORD",
        "returnGeometry": "true",
        "outSR": "4326",
        "returnGeometry": "true",
        "resultRecordCount": "10",
        "f": "json",
    }
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(12.0, connect=5.0), headers={"User-Agent": USER_AGENT}) as client:
            response = await client.get(url, params=params)
            response.raise_for_status()
            payload = response.json()
        if payload.get("error"):
            return None
        requested = _normalize_street_address(street_line)
        matches = []
        for feature in payload.get("features", []):
            attrs = feature.get("attributes") or {}
            candidate_address = attrs.get("FULL_SITE_ADDRESS") or attrs.get("Address") or ""
            if _normalize_street_address(str(candidate_address)) != requested:
                continue
            geometry = feature.get("geometry") or {}
            x = geometry.get("x", attrs.get("X_COORD"))
            y = geometry.get("y", attrs.get("Y_COORD"))
            if x is None or y is None:
                continue
            try:
                lon, lat = float(x), float(y)
            except (TypeError, ValueError):
                continue
            if not (-80.95 <= lon <= -80.05 and 25.0 <= lat <= 26.5):
                continue
            matches.append((lat, lon, str(candidate_address), {
                "source": "Broward County Address Points",
                "folio_number": attrs.get("FOLIO_NUMBER"),
                "city": attrs.get("CITY_NAME"),
                "zip_code": attrs.get("ZIP_CODE"),
            }))
        # Multiple exact records (for example, unit/address duplicates) are
        # not silently collapsed into one coordinate.
        return matches[0] if len(matches) == 1 else None
    except (httpx.HTTPError, ValueError, KeyError, TypeError):
        # County GIS is an enhancement, never a single point of failure.
        return None


async def geocode_with_provenance(address: str) -> tuple[float, float, str, dict[str, Any]]:
    """Resolve an address once and retain the provider evidence for diagnostics."""
    county_match = await resolve_broward_address_point(address)
    if county_match:
        lat, lon, matched_address, provenance = county_match
        return lat, lon, matched_address, dict(provenance)

    headers = {"User-Agent": USER_AGENT}
    try:
        async with httpx.AsyncClient(timeout=25, headers=headers) as client:
            response = await client.get(NOMINATIM_URL, params={"q": address, "format": "jsonv2", "limit": 1})
            response.raise_for_status()
            results = response.json()
        if results:
            item = results[0]
            return (
                float(item["lat"]),
                float(item["lon"]),
                str(item.get("display_name", address)),
                {"source": "OpenStreetMap Nominatim"},
            )
        lat, lon, matched = await _geocode_census(address)
        return lat, lon, matched, {"source": "US Census Geocoder"}
    except httpx.HTTPStatusError as exc:
        # Nominatim may return 429/629 when public rate limits or anti-abuse controls
        # are reached. Use the free US Census geocoder for US street addresses.
        if exc.response.status_code not in {429, 500, 502, 503, 504, 629}:
            raise
        lat, lon, matched = await _geocode_census(address)
        return lat, lon, matched, {"source": "US Census Geocoder"}
    except (httpx.TimeoutException, httpx.ConnectError):
        lat, lon, matched = await _geocode_census(address)
        return lat, lon, matched, {"source": "US Census Geocoder"}


async def geocode(address: str) -> tuple[float, float, str]:
    """Backward-compatible coordinate-only geocoder."""
    lat, lon, matched_address, _provenance = await geocode_with_provenance(address)
    return lat, lon, matched_address

def _normalize_street_address(value: str | None) -> str:
    """Normalize a street line for conservative exact address-attribute matching."""
    if not value:
        return ""
    street = value.split(",", 1)[0].upper()
    street = re.sub(r"[^A-Z0-9 ]+", " ", street)
    tokens = street.split()
    expansions = {
        "N": "NORTH", "S": "SOUTH", "E": "EAST", "W": "WEST",
        "NE": "NORTHEAST", "NW": "NORTHWEST", "SE": "SOUTHEAST", "SW": "SOUTHWEST",
        "ST": "STREET", "AVE": "AVENUE", "AV": "AVENUE", "RD": "ROAD",
        "BLVD": "BOULEVARD", "DR": "DRIVE", "CT": "COURT", "LN": "LANE",
        "PL": "PLACE", "TRL": "TRAIL", "PKWY": "PARKWAY", "HWY": "HIGHWAY",
    }
    return " ".join(expansions.get(token, token) for token in tokens)


async def resolve_miramar_parcel(lat: float, lon: float) -> tuple[Polygon | None, dict[str, Any]]:
    """Find the unique Miramar parcel containing a resolved address point."""
    url = ("https://services6.arcgis.com/dAtAhTJ12QXYHJYN/ArcGIS/rest/services/"
           "MiramarParcels/FeatureServer/20/query")
    params = {"where": "1=1", "geometry": f"{lon},{lat}", "geometryType": "esriGeometryPoint",
              "inSR": "4326", "spatialRel": "esriSpatialRelIntersects", "outFields": "OBJECTID,FOLIO",
              "returnGeometry": "true", "outSR": "4326", "resultRecordCount": "10", "f": "geojson"}
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(12.0, connect=5.0),
                                     headers={"User-Agent": USER_AGENT}) as client:
            response = await client.get(url, params=params)
            response.raise_for_status()
            payload = response.json()
        if payload.get("error"):
            return None, {"status": "provider_error", "provider": "City of Miramar GIS"}
        point, matches = Point(lon, lat), []
        for feature in payload.get("features", []):
            geometry = feature.get("geometry")
            if not geometry:
                continue
            try:
                parsed = make_valid(shape(geometry))
            except (TypeError, ValueError):
                continue
            parts = list(parsed.geoms) if parsed.geom_type == "MultiPolygon" else [parsed]
            attrs = feature.get("properties") or {}
            for polygon in parts:
                if polygon.geom_type == "Polygon" and not polygon.is_empty and polygon.covers(point):
                    matches.append((polygon, {"object_id": attrs.get("OBJECTID"), "folio": attrs.get("FOLIO")}))
        if len(matches) != 1:
            return None, {"status": "not_found" if not matches else "ambiguous",
                          "provider": "City of Miramar GIS", "match_count": len(matches)}
        polygon, identity = matches[0]
        return polygon, {"status": "matched", "provider": "City of Miramar GIS", **identity}
    except (httpx.HTTPError, ValueError, KeyError, TypeError):
        return None, {"status": "provider_error", "provider": "City of Miramar GIS"}


async def get_footprint(lat: float, lon: float, street_address: str | None = None, selected_candidate_id: str | None = None) -> tuple[Polygon, dict[str, Any]]:
    # Use a nationwide ArcGIS structures layer first. It is independent of
    # Overpass and covers US building polygons; OSM remains a secondary source.
    address_point = Point(lon, lat)
    raw_candidates: list[tuple[Polygon, dict[str, Any]]] = []
    provider_errors: list[str] = []
    providers_succeeded = 0
    arcgis_feature_count = 0
    broward_feature_count = 0
    miamidade_feature_count = 0
    overpass_element_count = 0

    arcgis_url = (
        "https://services2.arcgis.com/VNo0ht0YPXJoI4oE/"
        "ArcGIS/rest/services/USA_Buildings/FeatureServer/0/query"
    )
    arcgis_params = {
        "where": "1=1",
        "geometry": f"{lon},{lat}",
        "geometryType": "esriGeometryPoint",
        "inSR": "4326",
        "spatialRel": "esriSpatialRelIntersects",
        "distance": str(int(CANDIDATE_SEARCH_RADIUS_M)),
        "units": "esriSRUnit_Meter",
        "outFields": "OBJECTID,OCC_CLS,PROP_ADDR,PROP_CITY,PROP_ST,PROP_ZIP,SQFEET,SQMETERS,SOURCE,PROD_DATE",
        "returnGeometry": "true",
        "outSR": "4326",
        "f": "geojson",
    }
    headers = {"User-Agent": USER_AGENT}
    async with httpx.AsyncClient(timeout=httpx.Timeout(20.0, connect=7.0), headers=headers) as client:
        try:
            response = await client.get(arcgis_url, params=arcgis_params)
            response.raise_for_status()
            payload = response.json()
            if payload.get("error"):
                raise ValueError(str(payload["error"]))
            providers_succeeded += 1
            arcgis_features = payload.get("features", [])
            arcgis_feature_count = len(arcgis_features)
            for feature in arcgis_features:
                geometry = feature.get("geometry")
                if not geometry:
                    continue
                try:
                    parsed = shape(geometry)
                except (TypeError, ValueError):
                    continue
                parts = (
                    list(parsed.geoms)
                    if parsed.geom_type == "MultiPolygon"
                    else [parsed]
                )
                properties = feature.get("properties") or {}
                address_key = _normalize_street_address(street_address)
                feature_address_key = _normalize_street_address(properties.get("PROP_ADDR"))
                address_attribute_match = bool(
                    address_key and feature_address_key and address_key == feature_address_key
                )
                for polygon in parts:
                    if polygon.geom_type != "Polygon" or polygon.is_empty:
                        continue
                    raw_candidates.append((polygon, {
                        "provider": "ArcGIS USA Structures",
                        "source_id": properties.get("OBJECTID"),
                        "address_attribute_match": address_attribute_match,
                        "building_tags": {
                            key: properties.get(key)
                            for key in ("OCC_CLS", "PROP_ADDR", "PROP_CITY", "PROP_ST", "PROP_ZIP", "SOURCE", "PROD_DATE")
                            if properties.get(key) is not None
                        },
                    }))
        except (httpx.HTTPError, ValueError, KeyError) as exc:
            provider_errors.append(f"ArcGIS USA Structures: {type(exc).__name__}")

        # Broward County publishes its own current building-footprint layer.
        # Use it as a geographically authoritative fallback for properties
        # in Broward when the nationwide layer has no coverage.
        broward_url = (
            "https://services.arcgis.com/JMAJrTsHNLrSsWf5/"
            "ArcGIS/rest/services/Broward_BuildingFootPrints/FeatureServer/0/query"
        )
        broward_params = {
            "where": "1=1",
            "geometry": f"{lon},{lat}",
            "geometryType": "esriGeometryPoint",
            "inSR": "4326",
            "spatialRel": "esriSpatialRelIntersects",
            "distance": str(int(CANDIDATE_SEARCH_RADIUS_M)),
            "units": "esriSRUnit_Meter",
            "outFields": "OBJECTID,AREA,COUNTY_NAM,capture_dates_range",
            "returnGeometry": "true",
            "outSR": "4326",
            "f": "geojson",
        }
        try:
            response = await client.get(broward_url, params=broward_params)
            response.raise_for_status()
            payload = response.json()
            if payload.get("error"):
                raise ValueError(str(payload["error"]))
            providers_succeeded += 1
            broward_features = payload.get("features", [])
            broward_feature_count = len(broward_features)
            for feature in broward_features:
                geometry = feature.get("geometry")
                if not geometry:
                    continue
                try:
                    parsed = shape(geometry)
                except (TypeError, ValueError):
                    continue
                parts = list(parsed.geoms) if parsed.geom_type == "MultiPolygon" else [parsed]
                properties = feature.get("properties") or {}
                for polygon in parts:
                    if polygon.geom_type != "Polygon" or polygon.is_empty:
                        continue
                    raw_candidates.append((polygon, {
                        "provider": "Broward County Building Footprints",
                        "source_id": properties.get("OBJECTID"),
                        "building_tags": {
                            key: properties.get(key)
                            for key in ("AREA", "COUNTY_NAM", "capture_dates_range")
                            if properties.get(key) is not None
                        },
                    }))
        except (httpx.HTTPError, ValueError, KeyError) as exc:
            provider_errors.append(f"Broward County Building Footprints: {type(exc).__name__}")

        # Miami-Dade County publishes its own LiDAR-derived building
        # footprints (BuildingFootprint2D). The nationwide structures layer
        # has no coverage for much of Miami-Dade, so this county layer is the
        # authoritative source there, mirroring the Broward fallback above.
        miamidade_url = (
            "https://services.arcgis.com/8Pc9XBTAsYuxx9Ny/"
            "ArcGIS/rest/services/BuildingFootprint2D_gdb/FeatureServer/0/query"
        )
        miamidade_params = {
            "where": "1=1",
            "geometry": f"{lon},{lat}",
            "geometryType": "esriGeometryPoint",
            "inSR": "4326",
            "spatialRel": "esriSpatialRelIntersects",
            "distance": str(int(CANDIDATE_SEARCH_RADIUS_M)),
            "units": "esriSRUnit_Meter",
            "outFields": "OBJECTID,UNIQUEID,SOURCE,YEARUPDATE",
            "returnGeometry": "true",
            "outSR": "4326",
            "f": "geojson",
        }
        try:
            response = await client.get(miamidade_url, params=miamidade_params)
            response.raise_for_status()
            payload = response.json()
            if payload.get("error"):
                raise ValueError(str(payload["error"]))
            providers_succeeded += 1
            miamidade_features = payload.get("features", [])
            miamidade_feature_count = len(miamidade_features)
            for feature in miamidade_features:
                geometry = feature.get("geometry")
                if not geometry:
                    continue
                try:
                    parsed = shape(geometry)
                except (TypeError, ValueError):
                    continue
                parts = list(parsed.geoms) if parsed.geom_type == "MultiPolygon" else [parsed]
                properties = feature.get("properties") or {}
                for polygon in parts:
                    if polygon.geom_type != "Polygon" or polygon.is_empty:
                        continue
                    raw_candidates.append((polygon, {
                        "provider": "Miami-Dade County Building Footprints",
                        "source_id": properties.get("OBJECTID"),
                        "building_tags": {
                            key: properties.get(key)
                            for key in ("UNIQUEID", "SOURCE", "YEARUPDATE")
                            if properties.get(key) is not None
                        },
                    }))
        except (httpx.HTTPError, ValueError, KeyError) as exc:
            provider_errors.append(f"Miami-Dade County Building Footprints: {type(exc).__name__}")

        # Query independent OSM Overpass endpoints as a fallback and to fill
        # coverage gaps in the nationwide structures layer.
        query = f"""
        [out:json][timeout:20];
        way(around:{int(CANDIDATE_SEARCH_RADIUS_M)},{lat},{lon})[building];
        out geom;
        """
        overpass_headers = {
            "User-Agent": USER_AGENT,
            "Content-Type": "application/x-www-form-urlencoded",
        }
        endpoints = (
            OVERPASS_URL,
            "https://overpass.kumi.systems/api/interpreter",
            "https://overpass.private.coffee/api/interpreter",
        )
        for endpoint in endpoints:
            try:
                response = await client.post(endpoint, data={"data": query}, headers=overpass_headers)
                response.raise_for_status()
                payload = response.json()
                providers_succeeded += 1
                overpass_elements = payload.get("elements", [])
                overpass_element_count = len(overpass_elements)
                for element in overpass_elements:
                    coords = element.get("geometry") or []
                    if len(coords) < 4:
                        continue
                    ring = [(float(point["lon"]), float(point["lat"])) for point in coords]
                    polygon = make_valid(Polygon(ring))
                    parts = (
                        list(polygon.geoms)
                        if polygon.geom_type == "MultiPolygon"
                        else [polygon]
                    )
                    for part in parts:
                        if part.geom_type == "Polygon" and not part.is_empty:
                            raw_candidates.append((part, {
                                "provider": "OpenStreetMap",
                                "source_id": element.get("id"),
                                "building_tags": element.get("tags", {}),
                            }))
                # One healthy Overpass endpoint is enough; avoid duplicate
                # requests and unnecessary latency.
                break
            except (httpx.HTTPError, ValueError, KeyError) as exc:
                provider_errors.append(f"{endpoint}: {type(exc).__name__}")

    candidates: list[tuple[float, Polygon, dict[str, Any]]] = []
    rejected_by_area = 0
    rejected_by_distance = 0
    nearest_provider_feature: dict[str, Any] | None = None
    for polygon, source_metadata in raw_candidates:
        if polygon.is_empty or polygon.area <= 0:
            continue
        area_sqft = _polygon_area_sqft(polygon)
        distance_m = _distance_to_footprint_meters(polygon, lat, lon)
        if nearest_provider_feature is None or distance_m < nearest_provider_feature["distance_m"]:
            nearest_provider_feature = {
                "provider": source_metadata.get("provider"),
                "source_id": source_metadata.get("source_id"),
                "distance_m": round(distance_m, 2),
                "area_sqft": round(area_sqft, 1),
            }
        if area_sqft < 150 or area_sqft > 100000:
            rejected_by_area += 1
            continue
        # Keep a wider candidate window for explicit human selection when
        # geocoders land on a curb/driveway. Candidates beyond 25 m are never
        # auto-selected; the 60 m cap prevents unrelated distant structures.
        if distance_m > CANDIDATE_SEARCH_RADIUS_M:
            rejected_by_distance += 1
            continue
        candidate_identity = (
            f"{source_metadata.get('provider', '')}:"
            f"{source_metadata.get('source_id', '')}:"
            f"{hashlib.sha256(polygon.wkb).hexdigest()[:16]}"
        )
        candidate_id = hashlib.sha256(candidate_identity.encode("utf-8")).hexdigest()[:24]
        metadata = {
            **source_metadata,
            "candidate_id": candidate_id,
            "address_point_inside_footprint": polygon.contains(address_point),
            "address_to_footprint_distance_m": round(distance_m, 2),
            "area_sqft": round(area_sqft, 1),
            "centroid": {
                "lat": round(float(polygon.centroid.y), 7),
                "lon": round(float(polygon.centroid.x), 7),
            },
        }
        candidates.append((distance_m, polygon, metadata))

    # Collapse near-identical geometry returned by two public sources so
    # duplicate representations of one building do not trigger ambiguity.
    deduplicated: list[tuple[float, Polygon, dict[str, Any]]] = []
    for candidate in candidates:
        distance, polygon, metadata = candidate
        duplicate_index = None
        for index, existing in enumerate(deduplicated):
            existing_polygon = existing[1]
            union_area = polygon.union(existing_polygon).area
            overlap = polygon.intersection(existing_polygon).area
            if union_area > 0 and overlap / union_area >= 0.85:
                duplicate_index = index
                break
        if duplicate_index is None:
            deduplicated.append(candidate)
        elif (
            (
                metadata.get("address_attribute_match")
                and not deduplicated[duplicate_index][2].get("address_attribute_match")
            )
            or (
                metadata.get("address_point_inside_footprint")
                and not deduplicated[duplicate_index][2].get("address_point_inside_footprint")
                and not deduplicated[duplicate_index][2].get("address_attribute_match")
            )
        ):
            deduplicated[duplicate_index] = candidate
    candidates = deduplicated

    # Parcel membership is corroborating evidence only; parcels may contain
    # multiple buildings and cannot independently establish the primary roof.
    parcel_metadata: dict[str, Any] = {"status": "not_applicable"}
    if street_address and re.search(r"\bMIRAMAR\b", street_address, re.IGNORECASE):
        parcel_polygon, parcel_metadata = await resolve_miramar_parcel(lat, lon)
        if parcel_polygon is not None and not selected_candidate_id:
            parcel_candidates = [row for row in candidates
                if parcel_polygon.intersection(row[1]).area / max(row[1].area, 1e-12) >= 0.50]
            parcel_metadata["building_candidates_intersecting_parcel"] = len(parcel_candidates)
            if len(parcel_candidates) == 1:
                parcel_candidates[0][2]["parcel_match"] = dict(parcel_metadata)
                candidates = parcel_candidates
            else:
                for row in candidates:
                    row[2]["parcel_match"] = dict(parcel_metadata)
        elif parcel_metadata.get("status") in {"ambiguous", "not_found"}:
            for row in candidates:
                row[2]["parcel_match"] = dict(parcel_metadata)


    if not candidates:
        if providers_succeeded == 0:
            raise HTTPException(
                status_code=503,
                detail={
                    "code": "building_footprint_provider_unavailable",
                    "message": "The free building-footprint providers could not be reached. No roof measurement was generated. Retry later or use the CRM's manual footprint tracing tool.",
                    "providers_tried": 5,
                    "provider_errors": provider_errors,
                },
            )
        raise HTTPException(
            status_code=404,
            detail={
                "code": "building_footprint_not_found",
                "message": "No eligible mapped building was found within the 80 m candidate search radius. Review the geocoded pin or use manual footprint tracing.",
                "providers_checked": ["ArcGIS USA Structures", "Broward County Building Footprints", "Miami-Dade County Building Footprints", "OpenStreetMap Overpass"],
                "candidate_search_radius_m": CANDIDATE_SEARCH_RADIUS_M,
                "provider_feature_count": len(raw_candidates),
                "arcgis_feature_count": arcgis_feature_count,
                "broward_feature_count": broward_feature_count,
                "miamidade_feature_count": miamidade_feature_count,
                "overpass_element_count": overpass_element_count,
                "geocoded_location": {"lat": round(lat, 7), "lon": round(lon, 7)},
                "provider_errors": provider_errors,
                "rejected_by_area_filter": rejected_by_area,
                "rejected_by_distance_filter": rejected_by_distance,
                "nearest_provider_feature": nearest_provider_feature,
            },
        )

    # A user can resolve ambiguous addresses by choosing one of the exact
    # candidates returned in the 409 response. The identifier is tied to the
    # provider, source record, and polygon geometry so stale selections fail closed.
    if selected_candidate_id:
        selected = [
            candidate for candidate in candidates
            if candidate[2].get("candidate_id") == selected_candidate_id
        ]
        if len(selected) != 1:
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "building_candidate_selection_stale",
                    "message": "The selected building candidate is no longer available. Refresh candidates and choose again.",
                    "candidate_count": len(candidates),
                    "candidates": [
                        {
                            "candidate_id": row[2]["candidate_id"],
                            "provider": row[2].get("provider"),
                            "source_id": row[2].get("source_id"),
                            "area_sqft": row[2]["area_sqft"],
                            "address_point_inside_footprint": row[2]["address_point_inside_footprint"],
                            "address_to_footprint_distance_m": row[2]["address_to_footprint_distance_m"],
                            "centroid": row[2]["centroid"],
                            "polygon_geojson": mapping(row[1]),
                        }
                        for row in candidates
                    ],
                },
            )
        _, selected_polygon, selected_metadata = selected[0]
        return selected_polygon, selected_metadata

    # A candidate outside the trusted 25 m auto-match radius may still be
    # the correct building when geocoding lands on the street. Surface it for
    # explicit user confirmation, never silently accept it.
    if min(row[0] for row in candidates) > 25.0:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "building_candidate_confirmation_required",
                "message": "Mapped buildings are more than 25 m from the geocoded address point. Review the outlines and explicitly select the correct building before roof analysis.",
                "candidate_count": len(candidates),
                "candidates": [
                    {
                        "candidate_id": row[2]["candidate_id"],
                        "provider": row[2].get("provider"),
                        "source_id": row[2].get("source_id"),
                        "area_sqft": row[2]["area_sqft"],
                        "address_point_inside_footprint": row[2]["address_point_inside_footprint"],
                        "address_to_footprint_distance_m": row[2]["address_to_footprint_distance_m"],
                        "centroid": row[2]["centroid"],
                        "polygon_geojson": mapping(row[1]),
                    }
                    for row in candidates
                ],
            },
        )

    # Prefer address-point containment, then nearest footprint. If two nearby
    # structures remain similarly plausible, fail safely instead of using a
    # neighboring building.
    # An exact street-line match from the building provider is stronger than
    # proximity to a geocoder pin that may fall on a driveway. Only use it when
    # exactly one distinct footprint matches; never break ties by address text.
    exact_address_matches = [
        candidate for candidate in candidates
        if candidate[2].get("address_attribute_match") is True
    ]
    if len(exact_address_matches) == 1:
        candidates = exact_address_matches
    elif len(exact_address_matches) > 1:
        candidates = exact_address_matches

    candidates.sort(key=lambda row: (
        not bool(row[2].get("address_attribute_match")),
        not bool(row[2].get("address_point_inside_footprint")),
        row[0],
    ))
    if len(candidates) > 1:
        nearest_distance = candidates[0][0]
        next_distance = candidates[1][0]
        if (
            len(exact_address_matches) > 1
            or (
                len(exact_address_matches) != 1
                and next_distance - nearest_distance < 8.0
                and not candidates[0][2].get("address_point_inside_footprint")
            )
        ):
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "ambiguous_building_match",
                    "message": "Several nearby buildings could match this address pin. Review the candidate outlines and explicitly select the correct building before running roof detection.",
                    "candidate_count": len(candidates),
                    "candidates": [
                        {
                            "candidate_id": row[2]["candidate_id"],
                            "provider": row[2].get("provider"),
                            "source_id": row[2].get("source_id"),
                            "area_sqft": row[2]["area_sqft"],
                            "address_point_inside_footprint": row[2]["address_point_inside_footprint"],
                            "address_to_footprint_distance_m": row[2]["address_to_footprint_distance_m"],
                            "centroid": row[2]["centroid"],
                            "polygon_geojson": mapping(row[1]),
                        }
                        for row in candidates
                    ],
                },
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


def _fit_ransac_plane(
    xy: np.ndarray,
    z: np.ndarray,
    residual_threshold_m: float,
    random_state: int,
) -> tuple[Any, np.ndarray] | None:
    """One RANSAC plane hypothesis over the points.

    Returns (fitted LinearRegression, inlier mask), or None when the fit
    fails or gathers fewer than MIN_ROOF_POINTS inliers.
    """
    estimator = RANSACRegressor(
        estimator=LinearRegression(),
        # Three non-collinear points are sufficient to hypothesize a
        # plane. Large random samples can mix both sides of a ridge and
        # converge on a shallow compromise plane, corrupting pitch.
        min_samples=3,
        residual_threshold=residual_threshold_m,
        max_trials=250,
        random_state=random_state,
    )
    try:
        estimator.fit(xy, z)
    except (ValueError, FloatingPointError):
        return None
    inliers = estimator.inlier_mask_
    if inliers is None or int(inliers.sum()) < MIN_ROOF_POINTS:
        return None
    return estimator.estimator_, inliers


def _polygon_parts(geometry: Any) -> list[Polygon]:
    if geometry is None or geometry.is_empty:
        return []
    if geometry.geom_type == "Polygon":
        return [geometry]
    return [
        part for part in getattr(geometry, "geoms", []) if part.geom_type == "Polygon"
    ]


def _upper_envelope_part(region: Polygon, owner: dict[str, Any], others: list[dict[str, Any]]) -> Polygon | None:
    """The part of `region` on the owner's own side of the intersection
    line with every other candidate plane.

    Two roof planes divide the plan along their intersection line; which
    side belongs to the owner is the side its existing polygon lies on.
    That one rule reproduces both junction kinds: at a valley the owner's
    side is where its plane is the higher one (upper envelope), and at a
    ridge or hip it is where its plane is the lower one — a plane's
    extension across a peak would poke through the real roof, so a plain
    "highest plane wins" rule hands ridge gaps to the wrong facet.
    """
    part: Any = region
    min_x, min_y, max_x, max_y = region.bounds
    span = math.hypot(max_x - min_x, max_y - min_y) + 10.0
    anchor = owner["polygon"].representative_point()
    for other in others:
        da = owner["a"] - other["a"]
        db = owner["b"] - other["b"]
        dc = owner["c"] - other["c"]
        norm = math.hypot(da, db)
        if norm <= 1e-9:
            # Parallel planes never intersect; they impose no split line.
            continue
        if da * anchor.x + db * anchor.y + dc < 0:
            # The owner's territory is on the negative side of the line;
            # flip the constraint so the kept half-plane contains it.
            da, db, dc = -da, -db, -dc
        # Half-plane da*x + db*y + dc >= 0, materialized as a rectangle
        # large enough to cover the region on the kept side of the line.
        ux, uy = -db / norm, da / norm
        nx, ny = da / norm, db / norm
        px, py = -dc * da / (norm * norm), -dc * db / (norm * norm)
        half_plane = Polygon([
            (px - span * ux, py - span * uy),
            (px + span * ux, py + span * uy),
            (px + span * ux + span * nx, py + span * uy + span * ny),
            (px - span * ux + span * nx, py - span * uy + span * ny),
        ])
        part = part.intersection(half_plane)
        if part.is_empty:
            return None
    return part


def _complete_coverage(
    records: list[dict[str, Any]],
    clip: Polygon,
    points: np.ndarray,
) -> None:
    """Grow facet polygons so they tessellate the evidenced roof plan.

    Fitted hulls stop where inlier points stop, leaving unclaimed seams
    along hips, ridges and eaves (and whole fringes whose detection was
    dropped as a duplicate). An unclaimed part of the clipped footprint
    region is split among the adjacent facets along the planes'
    intersection lines and merged into them — but a facet may only grow
    across ground bracketed by unclaimed input points that the facet's
    own plane predicts (residual within COVERAGE_EVIDENCE_RESIDUAL_M):
    its growth zone is the convex hull of its polygon plus those points,
    so completion follows measured roof surface, never annexes a
    neighbouring surface the plane does not fit, and never extends past
    the outermost returns near an eave. Facet point counts and fit RMSE
    are untouched: they describe the points actually fitted, not the
    completed geometry.
    """
    from shapely.ops import unary_union

    if not records:
        return
    covered = unary_union([record["polygon"] for record in records])
    uncovered = clip.difference(covered)
    if uncovered.is_empty or uncovered.area <= 1e-6:
        return
    # Evidence points are input points no facet polygon claims. Points on
    # a shared boundary count as claimed (distance zero), so hull vertices
    # along a facet edge cannot masquerade as evidence for the margin
    # beyond that edge.
    unclaimed_rows = [
        point
        for point in points
        if covered.distance(Point(float(point[0]), float(point[1]))) > 0.02
    ]
    if not unclaimed_rows:
        return
    for component in _polygon_parts(uncovered):
        if component.is_empty or component.area <= 1e-6:
            continue
        owners = [
            record
            for record in records
            if record["polygon"].distance(component) <= COVERAGE_GAP_ADJACENCY_M
        ]
        if not owners:
            owners = [min(records, key=lambda record: record["polygon"].distance(component))]
        owners.sort(key=lambda record: -record["point_count"])
        # Each owner's evidence zone inside this component: the convex
        # hull of the facet's own polygon plus the unclaimed points its
        # plane predicts. Growth is bracketed by measured points on every
        # side — a radial buffer around the points would also annex the
        # strip beyond the outermost returns, overshooting the true roof
        # edge wherever returns thin out near an eave.
        zones: dict[int, Any] = {}
        for index, owner in enumerate(owners):
            fitting = [
                (float(point[0]), float(point[1]))
                for point in unclaimed_rows
                if abs(
                    float(point[2])
                    - (owner["a"] * float(point[0]) + owner["b"] * float(point[1]) + owner["c"])
                )
                <= COVERAGE_EVIDENCE_RESIDUAL_M
            ]
            if fitting:
                hull = MultiPoint(
                    fitting + list(owner["polygon"].exterior.coords)
                ).convex_hull
                if hull.geom_type == "Polygon" and not hull.is_empty:
                    zone = hull.intersection(component)
                    if not zone.is_empty:
                        zones[index] = zone
        if not zones:
            continue
        def grow(owner: dict[str, Any], geometry: Any) -> None:
            # A growth piece that meets the facet at a single point would
            # leave a self-touching (invalid) ring; a 2 cm expansion of
            # the piece turns point contacts into edge overlaps. A piece
            # that still cannot merge cleanly is left unassigned rather
            # than corrupting the facet boundary.
            for piece in _polygon_parts(geometry):
                merged = owner["polygon"].union(piece)
                if merged.geom_type != "Polygon" or not merged.is_valid:
                    merged = owner["polygon"].union(piece.buffer(0.02))
                if merged.geom_type == "Polygon" and merged.is_valid:
                    owner["polygon"] = merged

        remainder: Any = component
        for index, owner in enumerate(owners):
            if remainder.is_empty or remainder.area <= 1e-9:
                break
            if index not in zones:
                continue
            part = _upper_envelope_part(
                remainder, owner, [other for other in owners if other is not owner]
            )
            if part is None or part.is_empty:
                continue
            part = part.intersection(zones[index])
            if part.is_empty:
                continue
            grow(owner, part)
            remainder = remainder.difference(part)
        if not remainder.is_empty and remainder.area > 1e-9:
            # A zone-covered sliver can survive the envelope split (for
            # example between two owners' zones along a seam); the
            # largest adjacent facet absorbs that part. Anything outside
            # every zone stays unclaimed.
            evidenced_leftover = remainder.intersection(
                unary_union(list(zones.values()))
            )
            if not evidenced_leftover.is_empty:
                grow(owners[0], evidenced_leftover)


def _grow_into_overhang_ring(
    records: list[dict[str, Any]],
    footprint: Polygon,
    ring_points: np.ndarray,
    protected_zones: list[Polygon] | None = None,
) -> None:
    """Extend facets into the eave overhang ring on ring-point evidence.

    Facet hulls are clipped at footprint + 0.75 m and the fitting pool
    stops there too, so roof surface beyond the clip (a wide eave
    overhang) is structurally unmeasurable even when LiDAR returns exist
    for it. The gathering paths therefore also return the building points
    in the ring out to OVERHANG_RING_M, kept out of plane fitting. An
    uncovered part of the ring-side margin (the annulus beyond the clip,
    plus any still-uncovered strip inside it that connects to the
    annulus) is split among the adjacent facets along the planes'
    intersection lines — but a facet may only grow across ground
    bracketed by ring points that lie on its own plane: chained in steps
    of at most RING_EVIDENCE_ADJACENCY_M back to the facet (a detached
    neighbouring structure across a point-free gap cannot extend it),
    within COVERAGE_EVIDENCE_RESIDUAL_M of the plane, and no higher than
    the facet's own highest fitted elevation plus
    RING_EVIDENCE_Z_CAP_M. The growth zone is the convex hull of the
    facet plus its accepted ring points, so growth stops at the
    outermost returns — a house whose eaves end inside the clip has no
    on-plane ring points and does not grow. Facet point counts and fit
    RMSE are untouched, as in coverage completion.

    Valley protection: `protected_zones` are corridors around the valley
    seams the facets already share (extended into the ring along the
    seam's own line). Growth pieces are clipped out of those corridors:
    a valley runs out to the eave, and growth at its mouth would fill
    the concave corner the two valley facets form — the valley must
    continue through the overhang, not be paved over by it.
    """
    from shapely.ops import unary_union

    if not records or ring_points is None or len(ring_points) == 0:
        return
    protected: Any = unary_union(protected_zones) if protected_zones else None
    inner_clip = footprint.buffer(0.75)
    outer_clip = footprint.buffer(OVERHANG_RING_M)
    annulus = outer_clip.difference(inner_clip)
    if annulus.is_empty:
        return
    covered = unary_union([record["polygon"] for record in records])
    target = outer_clip.difference(covered)
    if target.is_empty:
        return
    ring_rows = [
        (float(point[0]), float(point[1]), float(point[2])) for point in ring_points
    ]
    for component in _polygon_parts(target):
        if component.is_empty or component.area <= 1e-6:
            continue
        if not component.intersects(annulus):
            # Purely interior leftovers are coverage completion's domain;
            # ring evidence must not drag growth across the roof.
            continue
        owners = [
            record
            for record in records
            if record["polygon"].distance(component) <= COVERAGE_GAP_ADJACENCY_M
        ]
        if not owners:
            continue
        owners.sort(key=lambda record: -record["point_count"])
        zones: dict[int, Any] = {}
        for index, owner in enumerate(owners):
            a, b, c = owner["a"], owner["b"], owner["c"]
            # The facet's highest fitted elevation, from its plane over
            # its own boundary; ring evidence above it (plus the cap) is
            # some taller surface, not this facet's overhang.
            z_cap = max(
                a * x + b * y + c for x, y in owner["polygon"].exterior.coords
            ) + RING_EVIDENCE_Z_CAP_M
            pool = [
                (x, y)
                for x, y, z in ring_rows
                if z <= z_cap
                and abs(z - (a * x + b * y + c)) <= COVERAGE_EVIDENCE_RESIDUAL_M
            ]
            if not pool:
                continue
            accepted: list[tuple[float, float]] = []
            progressed = True
            while progressed:
                progressed = False
                for point_xy in list(pool):
                    near_facet = (
                        owner["polygon"].distance(Point(*point_xy))
                        <= RING_EVIDENCE_ADJACENCY_M
                    )
                    near_accepted = any(
                        math.hypot(point_xy[0] - ax, point_xy[1] - ay)
                        <= RING_EVIDENCE_ADJACENCY_M
                        for ax, ay in accepted
                    )
                    if near_facet or near_accepted:
                        accepted.append(point_xy)
                        pool.remove(point_xy)
                        progressed = True
            if not accepted:
                continue
            hull = MultiPoint(
                accepted + list(owner["polygon"].exterior.coords)
            ).convex_hull
            if hull.geom_type == "Polygon" and not hull.is_empty:
                zone = hull.intersection(component)
                if not zone.is_empty:
                    zones[index] = zone
        if not zones:
            continue

        def grow(owner: dict[str, Any], geometry: Any) -> None:
            # Same merge discipline as coverage completion: a growth
            # piece meeting the facet at a single point is expanded by
            # 2 cm so the union stays one valid ring; a piece that still
            # cannot merge cleanly is left unassigned. Valley corridors
            # are cut out of every piece first (see the docstring).
            if protected is not None and not geometry.is_empty:
                geometry = geometry.difference(protected)
            for piece in _polygon_parts(geometry):
                merged = owner["polygon"].union(piece)
                if merged.geom_type != "Polygon" or not merged.is_valid:
                    merged = owner["polygon"].union(piece.buffer(0.02))
                if merged.geom_type == "Polygon" and merged.is_valid:
                    owner["polygon"] = merged

        remainder: Any = component
        for index, owner in enumerate(owners):
            if remainder.is_empty or remainder.area <= 1e-9:
                break
            if index not in zones:
                continue
            part = _upper_envelope_part(
                remainder, owner, [other for other in owners if other is not owner]
            )
            if part is None or part.is_empty:
                continue
            part = part.intersection(zones[index])
            if part.is_empty:
                continue
            grow(owner, part)
            remainder = remainder.difference(part)
        if not remainder.is_empty and remainder.area > 1e-9:
            evidenced_leftover = remainder.intersection(
                unary_union(list(zones.values()))
            )
            if not evidenced_leftover.is_empty:
                grow(owners[0], evidenced_leftover)


def _complete_outline(records: list[dict[str, Any]], footprint: Polygon) -> None:
    """Tile whatever part of the footprint the facets still leave bare.

    Coverage completion only grows a facet across ground its own points
    evidence, which leaves the footprint's corners and edges unclaimed
    wherever returns thinned out — yet the footprint is itself measured
    evidence: a roof covers its building's outline. Any part of the
    footprint polygon no facet claims is therefore split among the
    adjacent facets along the planes' intersection lines, the same
    split coverage completion uses, so facet outer edges end up
    following the true building outline (the notches and corners of an
    L-shaped plan included) instead of the smoother line the hulls
    stopped at. Ground beyond the footprint is not touched here: past
    a wall outline that is overhang, claimed only by ring evidence;
    past a roof outline it is not this roof at all.
    """
    from shapely.ops import unary_union

    if not records:
        return
    covered = unary_union([record["polygon"] for record in records])
    uncovered = footprint.difference(covered)
    if uncovered.is_empty or uncovered.area <= 1e-6:
        return

    def grow(owner: dict[str, Any], geometry: Any) -> None:
        # Same merge discipline as coverage completion.
        for piece in _polygon_parts(geometry):
            merged = owner["polygon"].union(piece)
            if merged.geom_type != "Polygon" or not merged.is_valid:
                merged = owner["polygon"].union(piece.buffer(0.02))
            if merged.geom_type == "Polygon" and merged.is_valid:
                owner["polygon"] = merged

    for component in _polygon_parts(uncovered):
        if component.is_empty or component.area <= 1e-6:
            continue
        owners = [
            record
            for record in records
            if record["polygon"].distance(component) <= COVERAGE_GAP_ADJACENCY_M
        ]
        if not owners:
            owners = [min(records, key=lambda record: record["polygon"].distance(component))]
        owners.sort(key=lambda record: -record["point_count"])
        remainder: Any = component
        for owner in owners:
            if remainder.is_empty or remainder.area <= 1e-9:
                break
            if len(owners) == 1:
                part = remainder
            else:
                part = _upper_envelope_part(
                    remainder, owner, [other for other in owners if other is not owner]
                )
            if part is None or part.is_empty:
                continue
            grow(owner, part)
            remainder = remainder.difference(part)
        if not remainder.is_empty and remainder.area > 1e-9:
            grow(owners[0], remainder)


def _snap_polygon_vertices(polygon: Polygon, other_boundary: Any, tolerance_m: float) -> Polygon:
    """Move `polygon`'s exterior vertices that lie within `tolerance_m`
    of `other_boundary` to the midpoint between the vertex and its
    nearest point on that boundary.

    A move is skipped when the midpoint would land within 2 cm of
    another vertex of the same ring (a narrow neck the facet wraps
    around a neighbour, for example): the moved ring would pinch there,
    and the boundary rounding at emission time would then cut the
    pinched lobe off — taking any seam it carried with it.
    """
    from shapely.ops import nearest_points

    coords = [(float(x), float(y)) for x, y in polygon.exterior.coords]
    moved: list[tuple[float, float]] = []
    for index, (x, y) in enumerate(coords):
        vertex = Point(x, y)
        if other_boundary.distance(vertex) > tolerance_m:
            moved.append((x, y))
            continue
        nearest = nearest_points(vertex, other_boundary)[1]
        candidate = ((x + nearest.x) / 2.0, (y + nearest.y) / 2.0)
        pinched = any(
            math.hypot(candidate[0] - ox, candidate[1] - oy) < 0.02
            for other_index, (ox, oy) in enumerate(coords)
            if other_index != index
            and abs(other_index - index) > 1
            and not (index == 0 and other_index == len(coords) - 1)
            and not (index == len(coords) - 1 and other_index == 0)
        )
        moved.append((x, y) if pinched else candidate)
    if len(moved) < 4:
        return polygon
    return Polygon(moved)


def _snap_shared_boundaries(
    records: list[dict[str, Any]],
    tolerance_m: float = BOUNDARY_SNAP_TOLERANCE_M,
) -> None:
    """Make near-coincident facet boundaries coincident (see the
    BOUNDARY_SNAP_TOLERANCE_M note).

    Boundaries are densified first so long edges bend onto the shared
    line instead of only their endpoints moving. Each pair is snapped
    symmetrically from the same snapshot, so the two sides meet at the
    midline. A record whose snapped polygon is invalid, or whose area
    moves by more than 15%, keeps its pre-snap geometry; overlaps the
    snapping itself creates are then trimmed largest-first, restoring
    the disjointness the resolution pass guarantees.
    """
    if len(records) < 2:
        return
    originals = [record["polygon"] for record in records]
    snapped: list[Polygon] = []
    for polygon in originals:
        densified = polygon.segmentize(1.0) if polygon.length > 0 else polygon
        snapped.append(densified if densified.geom_type == "Polygon" else polygon)
    for i in range(len(records)):
        for j in range(i + 1, len(records)):
            if snapped[i].distance(snapped[j]) > tolerance_m:
                continue
            boundary_i = snapped[i].boundary
            boundary_j = snapped[j].boundary
            new_i = _snap_polygon_vertices(snapped[i], boundary_j, tolerance_m)
            new_j = _snap_polygon_vertices(snapped[j], boundary_i, tolerance_m)
            snapped[i], snapped[j] = new_i, new_j
    accepted: list[Polygon] = []
    for index, record in enumerate(records):
        polygon = snapped[index]
        original = originals[index]
        if polygon is not original and not polygon.is_valid:
            repaired = _polygon_parts(make_valid(polygon))
            polygon = max(repaired, key=lambda part: part.area) if repaired else original
        if (
            polygon is original
            or not polygon.is_valid
            or polygon.is_empty
            or abs(polygon.area - original.area) > 0.15 * original.area + 1e-9
        ):
            polygon = original
        accepted.append(polygon)
    # Trim overlaps the vertex moves created (small wedges along the
    # snapped seams), largest facet first — the same priority the
    # resolution pass uses. A record the trim would gut keeps its
    # snapped polygon instead.
    order = sorted(range(len(records)), key=lambda k: -records[k]["point_count"])
    claimed: Any = None
    final: dict[int, Polygon] = {}
    for index in order:
        polygon = accepted[index]
        if claimed is not None and polygon.intersects(claimed):
            remainder = polygon.difference(claimed)
            parts = [
                part for part in _polygon_parts(remainder)
                if not part.is_empty
            ]
            if parts:
                largest = max(parts, key=lambda part: part.area)
                if largest.area >= 0.5 * polygon.area:
                    polygon = largest
        final[index] = polygon
        claimed = polygon if claimed is None else claimed.union(polygon)
    for index, record in enumerate(records):
        # Facet emission rounds boundary coordinates to millimetres and
        # repairs any ring that rounding invalidates — a repair this
        # pass cannot control, which on Miramar cut a snapped facet's
        # lobe and the ridge contact it carried. Bake the rounding in
        # here instead: a record keeps the rounded ring only when it is
        # valid as rounded and close in area to its pre-snap geometry;
        # otherwise it keeps the pre-snap polygon, whose rounding the
        # earlier passes already survived.
        polygon = final[index]
        rounded = [(round(float(x), 3), round(float(y), 3)) for x, y in polygon.exterior.coords]
        candidate = Polygon(rounded) if len(rounded) >= 4 else None
        if (
            candidate is not None
            and candidate.is_valid
            and not candidate.is_empty
            and abs(candidate.area - originals[index].area)
            <= 0.15 * originals[index].area + 1e-9
        ):
            record["polygon"] = candidate
        elif polygon is originals[index]:
            record["polygon"] = polygon
        else:
            record["polygon"] = originals[index]


def _plane_normal(a: float, b: float) -> np.ndarray:
    """Unit normal of the plane z = a*x + b*y + c."""
    normal = np.array([-a, -b, 1.0])
    return normal / np.linalg.norm(normal)


def _candidates_same_face(first: dict[str, Any], second: dict[str, Any]) -> bool:
    """True when two plane candidates plausibly describe one physical face:
    near-parallel normals, planes within MERGE_PLANE_OFFSET_M of each other,
    and clipped hulls that overlap or nearly touch in plan view."""
    cos_angle = float(np.dot(
        _plane_normal(first["a"], first["b"]),
        _plane_normal(second["a"], second["b"]),
    ))
    angle_deg = math.degrees(math.acos(max(-1.0, min(1.0, cos_angle))))
    if angle_deg > MERGE_NORMAL_ANGLE_DEG:
        return False

    # Two fragments of one face must nearly coincide where they meet, so
    # the plane separation is measured at the hulls' meeting zone (their
    # overlap, or the midpoint of the gap between them) — not at each
    # fragment's own centroid, where two chord fits of one slightly
    # non-planar face have already diverged by decimetres.
    intersection = first["polygon"].intersection(second["polygon"])
    if not intersection.is_empty and intersection.area > 1e-6:
        anchor = intersection.representative_point()
    else:
        near_first, near_second = nearest_points(first["polygon"], second["polygon"])
        anchor = Point(
            (near_first.x + near_second.x) / 2.0,
            (near_first.y + near_second.y) / 2.0,
        )

    def plane_offset(source: dict[str, Any], target: dict[str, Any]) -> float:
        # Perpendicular distance from the anchor, lifted onto the source
        # plane, to the target plane.
        a, b = target["a"], target["b"]
        c = float(target["model"].intercept_)
        z_on_source = (
            source["a"] * anchor.x + source["b"] * anchor.y
            + float(source["model"].intercept_)
        )
        return abs(a * anchor.x + b * anchor.y + c - z_on_source) / math.sqrt(
            a * a + b * b + 1.0
        )

    if max(plane_offset(first, second), plane_offset(second, first)) > MERGE_PLANE_OFFSET_M:
        return False
    return first["polygon"].distance(second["polygon"]) <= MERGE_HULL_GAP_M


def _candidate_from_points(
    pooled: np.ndarray,
    model: LinearRegression,
    footprint: Polygon | None,
) -> list[dict[str, Any]]:
    """Rebuild plane candidates from a pooled point set and one fitted
    plane, following the same hull/clip/component steps as the RANSAC loop
    in _fit_facets."""
    a, b = (float(model.coef_[0]), float(model.coef_[1]))
    slope = math.hypot(a, b)
    pitch = math.degrees(math.atan(slope))
    if pitch > 70:
        return []
    hull = MultiPoint(pooled[:, :2]).convex_hull
    if hull.geom_type != "Polygon" or hull.area <= 1e-4:
        return []
    bounded = hull.intersection(footprint.buffer(0.75)) if footprint is not None else hull
    components = (
        [bounded]
        if bounded.geom_type == "Polygon"
        else [part for part in getattr(bounded, "geoms", []) if part.geom_type == "Polygon"]
    )
    rebuilt: list[dict[str, Any]] = []
    for component in components:
        if component.is_empty or component.area <= 1e-4:
            continue
        component_points = [
            point
            for point in pooled
            if component.buffer(0.02).covers(Point(float(point[0]), float(point[1])))
        ]
        if not component_points:
            continue
        rebuilt.append({
            "polygon": component,
            "cluster": pooled,
            "point_count": len(component_points),
            "model": model,
            "a": a,
            "b": b,
            "pitch": pitch,
            "pitch_rise": slope * 12.0,
            "azimuth": (math.degrees(math.atan2(-a, -b)) + 360.0) % 360.0,
        })
    return rebuilt


def _merge_fragmented_candidates(
    candidates: list[dict[str, Any]],
    footprint: Polygon | None,
) -> list[dict[str, Any]]:
    """Merge plane candidates that are fragments of one physical roof face.

    Candidates linked by _candidates_same_face (transitively) have their
    inlier points pooled and a single plane refit, so the face enters hull
    resolution as one candidate spanning the whole face instead of pieces
    that cannibalize each other as duplicates. Candidates that cannot be
    refit pass through unchanged.
    """
    if len(candidates) < 2:
        return candidates
    parent = list(range(len(candidates)))

    def find(index: int) -> int:
        while parent[index] != index:
            parent[index] = parent[parent[index]]
            index = parent[index]
        return index

    for i in range(len(candidates)):
        for j in range(i + 1, len(candidates)):
            if _candidates_same_face(candidates[i], candidates[j]):
                root_i, root_j = find(i), find(j)
                if root_i != root_j:
                    parent[root_j] = root_i

    groups: dict[int, list[int]] = {}
    for i in range(len(candidates)):
        groups.setdefault(find(i), []).append(i)

    merged: list[dict[str, Any]] = []
    for members in groups.values():
        if len(members) == 1:
            merged.append(candidates[members[0]])
            continue
        pooled = np.unique(
            np.vstack([candidates[member]["cluster"] for member in members]),
            axis=0,
        )
        rebuilt: list[dict[str, Any]] = []
        if len(pooled) >= MIN_ROOF_POINTS:
            try:
                model = LinearRegression().fit(pooled[:, :2], pooled[:, 2])
                rebuilt = _candidate_from_points(pooled, model, footprint)
            except (ValueError, FloatingPointError):
                rebuilt = []
        if rebuilt:
            merged.extend(rebuilt)
        else:
            merged.extend(candidates[member] for member in members)
    return merged


def _competing_plane_share(
    candidate: dict[str, Any],
    accepted: list[dict[str, Any]],
) -> tuple[Any, np.ndarray] | None:
    """The claimed ground that really belongs to a "duplicate" candidate,
    plus the points that prove it — or None when it is a true duplicate.

    Largest-first resolution drops a candidate whose hull is mostly
    claimed, assuming a re-detection of the winner's plane. That
    assumption fails when two genuinely different planes face the same
    way over one roof section: the loser's own points are real returns
    the winner's plane does not explain (Miramar's SE section: the
    5.64/12 candidate's points sit decimetres off the winning 4.26/12
    plane away from their intersection line). When at least
    COMPETING_PLANE_MIN_POINTS of the candidate's points fit its own
    plane within COMPETING_PLANE_RESIDUAL_M while every accepted plane
    misses them by more than that, the contested ground is split along
    the planes' intersection lines — the same split coverage completion
    uses — and the candidate keeps its own side: the side its
    unexplained points actually occupy.
    """
    from shapely.ops import unary_union

    cluster = candidate["cluster"]
    if len(cluster) < COMPETING_PLANE_MIN_POINTS or not accepted:
        return None
    a, b = float(candidate["a"]), float(candidate["b"])
    c = float(candidate["model"].intercept_)
    xs, ys, zs = cluster[:, 0], cluster[:, 1], cluster[:, 2]
    unexplained = np.abs(zs - (a * xs + b * ys + c)) <= COMPETING_PLANE_RESIDUAL_M
    for record in accepted:
        predicted = record["a"] * xs + record["b"] * ys + record["c"]
        unexplained &= np.abs(zs - predicted) > COMPETING_PLANE_RESIDUAL_M
    unique_points = cluster[unexplained]
    if len(unique_points) < COMPETING_PLANE_MIN_POINTS:
        return None
    claimed = unary_union([record["polygon"] for record in accepted])
    contested = candidate["polygon"].intersection(claimed)
    if contested.is_empty or contested.area <= 1e-6:
        return None
    # The split lines are anchored on the candidate's side by where its
    # unexplained evidence actually sits, not by its hull's centre: the
    # hull spans ground the winner legitimately owns too.
    centroid = unique_points[:, :2].mean(axis=0)
    owner_view = {
        "polygon": Point(float(centroid[0]), float(centroid[1])).buffer(0.05),
        "a": a,
        "b": b,
        "c": c,
    }
    shares: list[Polygon] = []
    for part in _polygon_parts(contested):
        rivals = [
            record for record in accepted if record["polygon"].intersects(part)
        ]
        if not rivals:
            continue
        share = _upper_envelope_part(part, owner_view, rivals)
        if share is not None and not share.is_empty and share.area > 1e-6:
            shares.extend(_polygon_parts(share))
    if not shares:
        return None
    return unary_union(shares), unique_points


def _shrink_accepted(accepted: list[dict[str, Any]], share: Any) -> None:
    """Cut a rescued competing plane's share out of the accepted facets.

    A record the cut splits in two becomes two records carrying the same
    fitted-plane statistics (point counts and RMSE describe the fitted
    points, not the trimmed geometry — the stance coverage completion
    takes). A record reduced below MIN_FACET_AREA_SQFT of surface is
    removed: that ground now belongs to the rescued plane.
    """
    survivors: list[dict[str, Any]] = []
    for record in accepted:
        polygon = record["polygon"]
        if not polygon.intersects(share):
            survivors.append(record)
            continue
        cos_pitch = max(math.cos(math.radians(float(record["pitch"]))), 1e-6)

        def surface_sqft(part: Polygon) -> float:
            return float(part.area) / cos_pitch * 10.7639104167

        for part in _polygon_parts(polygon.difference(share)):
            if not part.is_empty and surface_sqft(part) >= MIN_FACET_AREA_SQFT:
                trimmed = dict(record)
                trimmed["polygon"] = part
                survivors.append(trimmed)
    accepted[:] = survivors


def _fit_facets(
    points: np.ndarray,
    footprint: Polygon | None = None,
    ring_points: np.ndarray | None = None,
    footprint_provider: str | None = None,
    pair_classes_out: dict | None = None,
) -> list[dict[str, Any]]:
    from shapely.ops import unary_union

    remaining = points.copy()
    # Clipped hull components from every fitted plane, resolved into facets
    # only after the plane loop (see the overlap pass at the end).
    candidates: list[dict[str, Any]] = []
    for plane_index in range(MAX_PLANES):
        if len(remaining) < MIN_ROOF_POINTS:
            break
        fitted = _fit_ransac_plane(
            remaining[:, :2],
            remaining[:, 2],
            RANSAC_RESIDUAL_THRESHOLD_M,
            plane_index + 13,
        )
        if fitted is None and RANSAC_RESIDUAL_THRESHOLD_FALLBACK_M > RANSAC_RESIDUAL_THRESHOLD_M:
            # Sparse or noisy pool: retry this plane at the loose threshold
            # rather than giving up on the facet entirely.
            fitted = _fit_ransac_plane(
                remaining[:, :2],
                remaining[:, 2],
                RANSAC_RESIDUAL_THRESHOLD_FALLBACK_M,
                plane_index + 13,
            )
        if fitted is None:
            break
        model, inliers = fitted
        selected = remaining[inliers]
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
            if label < 0:
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
                if component.is_empty or component.area <= 1e-4:
                    continue
                component_points = [
                    point
                    for point in cluster
                    if component.buffer(0.02).covers(Point(float(point[0]), float(point[1])))
                ]
                if not component_points:
                    continue
                candidates.append({
                    "polygon": component,
                    "cluster": cluster,
                    "point_count": len(component_points),
                    "model": model,
                    "a": a,
                    "b": b,
                    "pitch": pitch,
                    "pitch_rise": pitch_rise,
                    "azimuth": azimuth,
                })
        remaining = remaining[~inliers]

    # Reunite fragments of one physical face (split across RANSAC passes
    # into near-parallel candidates) before resolution, so the merged
    # candidate spans the face instead of its pieces being dropped below
    # as duplicates of each other.
    candidates = _merge_fragmented_candidates(candidates, footprint)

    # Hulls of different planes routinely overlap in plan view (a fragmented
    # near-parallel detection, or a plane fitted across a ridge, extends under
    # its neighbour), and summing the raw hulls double-counts the overlap —
    # total facet area can exceed the whole clipped footprint region. Resolve
    # largest-first: each candidate keeps only the part of its hull that no
    # earlier (larger) facet has claimed, so the accepted hulls tile the roof
    # instead of stacking on top of each other.
    resolved: list[dict[str, Any]] = []
    accepted_union: Any = None
    for candidate in sorted(candidates, key=lambda item: -item["point_count"]):
        if len(resolved) >= MAX_PLANES:
            break
        polygon: Polygon = candidate["polygon"]
        pitch = float(candidate["pitch"])
        cos_pitch = max(math.cos(math.radians(pitch)), 1e-6)

        def surface_sqft(part: Polygon) -> float:
            return float(part.area) / cos_pitch * 10.7639104167

        original_surface_sqft = surface_sqft(polygon)
        remainder = (
            polygon if accepted_union is None else polygon.difference(accepted_union)
        )
        parts = (
            [remainder]
            if remainder.geom_type == "Polygon"
            else [part for part in getattr(remainder, "geoms", []) if part.geom_type == "Polygon"]
        )
        kept = [
            part
            for part in parts
            if not part.is_empty and surface_sqft(part) >= MIN_FACET_AREA_SQFT
        ]
        # (part, points to score it with, inclusion buffer, and whether an
        # empty inclusion may fall back to the whole scoring set — only
        # rescued share parts, whose evidence points were verified before
        # the split, may).
        scored_parts: list[tuple[Polygon, np.ndarray, float, bool]] = [
            (part, candidate["cluster"], 0.02, False) for part in kept
        ]
        if (
            not kept
            or sum(surface_sqft(part) for part in kept)
            < MIN_FACET_REMAINING_FRACTION * original_surface_sqft
        ):
            # What is left is mostly area earlier facets already claimed;
            # normally this detection is a duplicate, not another roof
            # plane. The exception is a genuinely different plane facing
            # the same way over the same ground, proven by a substantial
            # body of its own points that no accepted plane explains:
            # rescue it by splitting the contested ground along the
            # planes' intersection lines.
            rescue = _competing_plane_share(candidate, resolved) if resolved else None
            if rescue is None:
                continue
            share, unique_points = rescue
            _shrink_accepted(resolved, share)
            accepted_union = (
                unary_union([record["polygon"] for record in resolved])
                if resolved
                else None
            )
            scored_parts += [
                (part, unique_points, 0.5, True)
                for part in _polygon_parts(share)
                if not part.is_empty and surface_sqft(part) >= MIN_FACET_AREA_SQFT
            ]
            if not scored_parts:
                continue
        model = candidate["model"]
        for part, stat_points, stat_buffer, stat_fallback in scored_parts:
            if len(resolved) >= MAX_PLANES:
                break
            part_points = [
                point
                for point in stat_points
                if part.buffer(stat_buffer).covers(Point(float(point[0]), float(point[1])))
            ]
            if not part_points:
                if not stat_fallback:
                    continue
                part_points = [point for point in stat_points]
            part_array = np.asarray(part_points, dtype=float)
            residuals = part_array[:, 2] - model.predict(part_array[:, :2])
            fit_rmse_m = float(np.sqrt(np.mean(np.square(residuals))))
            resolved.append({
                "polygon": part,
                "point_count": len(part_points),
                "fit_rmse_m": round(fit_rmse_m, 4),
                "pitch": pitch,
                "pitch_rise": float(candidate["pitch_rise"]),
                "azimuth": float(candidate["azimuth"]),
                "a": float(candidate["a"]),
                "b": float(candidate["b"]),
                "c": float(model.intercept_),
            })
            accepted_union = part if accepted_union is None else accepted_union.union(part)

    # Hulls end where inlier points end, which is short of the true seams:
    # points near a hip or ridge fit neither plane exactly, and eave rows
    # thin out. Complete the coverage over the evidenced part of the
    # clipped footprint region so the facets tessellate the roof plan.
    if footprint is not None and resolved:
        _complete_coverage(resolved, footprint.buffer(0.75), points)

    # Classify the facet pairs now, while the structure is the one the
    # fitter established, and freeze the verdicts on the records (see
    # _classify_record_pairs): the geometry passes below reshape the
    # polygons, and a seam's type must not be re-litigated from the
    # reshaped shapes. The valley corridors for ring-growth protection
    # come from the same frozen verdicts. The verdicts are keyed by
    # record identity because the roof-outline clip below may drop a
    # record; they are re-mapped to emitted-facet indices at emission.
    pair_classes = _classify_record_pairs(resolved) if resolved else {}
    for (first_index, second_index), (classification, _seam) in pair_classes.items():
        first_record = resolved[first_index]
        second_record = resolved[second_index]
        first_record.setdefault("_frozen_edges", {})[id(second_record)] = classification
        second_record.setdefault("_frozen_edges", {})[id(first_record)] = classification
    valley_zones = _valley_seams(resolved, pair_classes)

    # What coverage completion still leaves bare inside the footprint
    # itself — corners and outline stretches whose returns were consumed
    # as another facet's inliers — is assigned to the adjacent facets
    # along their intersection lines: the footprint is measured evidence
    # that the roof covers its building's outline, and facet edges
    # should follow that outline rather than the smoother hull line.
    if footprint is not None and resolved:
        _complete_outline(resolved, footprint)

    # Roof surface past the fitting clip (wide eave overhang) is invisible
    # to hulls and coverage completion alike; grow into the overhang ring
    # where the ring points gathered beyond the clip evidence it. The
    # growth is provenance-gated: it fires only when the footprint traces
    # the wall line (see ROOF_OUTLINE_PROVIDERS) — where the polygon
    # already traces the roof outline, the strip past it is not roof —
    # and it is clipped out of the corridors around existing valley
    # seams so the growth cannot fill a valley's concave corner.
    roof_outline = footprint_provider in ROOF_OUTLINE_PROVIDERS
    if footprint is not None and resolved and ring_points is not None and not roof_outline:
        _grow_into_overhang_ring(
            resolved, footprint, ring_points, protected_zones=valley_zones
        )

    # Where the footprint traces the roof outline itself, that outline
    # is the roof's edge: trim anything the earlier passes pushed past
    # it (hull and coverage growth reach the +0.75 m clip), so the
    # measured plan is the traced roof, not the traced roof plus a
    # margin.
    if footprint is not None and roof_outline:
        clipped: list[dict[str, Any]] = []
        for record in resolved:
            parts = [
                part
                for part in _polygon_parts(record["polygon"].intersection(footprint))
                if not part.is_empty
                and float(part.area)
                / max(math.cos(math.radians(float(record["pitch"]))), 1e-6)
                * 10.7639104167
                >= MIN_FACET_AREA_SQFT
            ]
            if not parts:
                continue
            record["polygon"] = max(parts, key=lambda part: part.area)
            clipped.append(record)
        resolved = clipped

    # Finally, pull near-coincident facet boundaries onto shared lines
    # so the edge classifier sees one shared edge where two facets meet,
    # not two almost-touching perimeters.
    if resolved:
        _snap_shared_boundaries(resolved)

    facets: list[dict[str, Any]] = []
    emitted_records: list[dict[str, Any]] = []
    for record in resolved:
        polygon = record["polygon"]
        if polygon.geom_type != "Polygon":
            # Coverage growth can in principle leave a disjoint piece;
            # the boundary schema carries one ring, so keep the largest
            # piece (its area is what the boundary describes).
            parts = _polygon_parts(polygon)
            if not parts:
                continue
            polygon = max(parts, key=lambda part: part.area)
        pitch = float(record["pitch"])
        cos_pitch = max(math.cos(math.radians(pitch)), 1e-6)
        surface_area_sqft = float(polygon.area) / cos_pitch * 10.7639104167
        boundary = [
            [round(float(x), 3), round(float(y), 3)]
            for x, y in polygon.exterior.coords
        ]
        if not Polygon(boundary).is_valid:
            # Coverage growth introduces vertices on the planes'
            # intersection lines, which can land within rounding distance
            # of an existing edge and make the rounded ring self-touch.
            # Repair the ring (largest valid part) so emitted boundaries
            # are always usable geometry.
            repaired = _polygon_parts(make_valid(Polygon(boundary)))
            if repaired:
                boundary = [
                    [round(float(x), 3), round(float(y), 3)]
                    for x, y in max(repaired, key=lambda part: part.area).exterior.coords
                ]
        emitted_records.append(record)
        facets.append({
            "id": f"facet-{len(facets) + 1}",
            "point_count": record["point_count"],
            "fit_rmse_m": record["fit_rmse_m"],
            "pitch_degrees": round(pitch, 2),
            "pitch_rise_per_12": round(float(record["pitch_rise"]), 2),
            "azimuth_degrees": round(float(record["azimuth"]), 1),
            "area_sqft": round(surface_area_sqft, 1),
            "squares": round(surface_area_sqft / 100.0, 3),
            "plane_model": {
                "z_equals_ax_plus_by_plus_c": [
                    float(record["a"]),
                    float(record["b"]),
                    float(record["c"]),
                ]
            },
            "boundary_xy": boundary,
        })
    if pair_classes_out is not None:
        # Re-map the frozen pair verdicts from record identity to
        # emitted-facet indices (emission may skip a record, and the
        # roof-outline clip may have dropped one).
        for first_index in range(len(emitted_records)):
            frozen = emitted_records[first_index].get("_frozen_edges", {})
            for second_index in range(first_index + 1, len(emitted_records)):
                classification = frozen.get(id(emitted_records[second_index]))
                if classification is not None:
                    pair_classes_out[(first_index, second_index)] = classification
    return facets

def _deduplicate_lidar_points(points: np.ndarray, precision_m: float = 0.02) -> np.ndarray:
    """Remove overlapping COPC tile duplicates at 2 cm XYZ precision."""
    if points.size == 0:
        return points.reshape((0, 3))
    quantized = np.round(points / precision_m).astype(np.int64)
    _, indices = np.unique(quantized, axis=0, return_index=True)
    return points[np.sort(indices)]



def _vertical_unit_to_meters(header: Any) -> float | None:
    """Return the LAS vertical CRS unit scale; reject missing or ambiguous Z units.

    Horizontal CRS metadata does not establish elevation units. Roof-plane
    pitch and facet heights must not be calculated from unnormalized Z values.
    """
    try:
        crs = header.parse_crs()
        if crs is None:
            return None
        vertical_axes = [
            axis for axis in crs.axis_info
            if str(axis.direction).lower() == "up"
        ]
        if len(vertical_axes) != 1:
            return None
        factor = float(vertical_axes[0].unit_conversion_factor)
        if not math.isfinite(factor) or factor <= 0:
            return None
        return factor
    except Exception:
        return None


def _line_components(geometry: Any) -> list[Any]:
    """Flatten a shapely result into its LineString components."""
    if geometry is None or geometry.is_empty:
        return []
    if geometry.geom_type == "LineString":
        return [geometry]
    if geometry.geom_type in {"MultiLineString", "GeometryCollection"}:
        components: list[Any] = []
        for part in geometry.geoms:
            components.extend(_line_components(part))
        return components
    return []


def _shared_edge_span(
    poly_i: Polygon, a_i: float, b_i: float, c_i: float, pitch_i: float,
    poly_j: Polygon, a_j: float, b_j: float, c_j: float, pitch_j: float,
) -> tuple[float, str, Any] | None:
    """The shared edge between two facet polygons, if they have one:
    (true 3D length in metres, classification, plan-view seam geometry).

    The edge is the two planes' intersection line; the overlap of one
    polygon with the other buffered by 0.75 m is projected onto that
    line to find the span the facets actually share, and a cross-section
    chord test one metre into each facet classifies it — above the chord
    is a peak (ridge when the line runs level, hip when it slopes),
    below it a valley. Parallel planes have no intersection line; a
    flat pair among them still shares a pitch-change seam, measured on
    the boundary itself. Projected spans under half a metre are corner
    noise and return None. This is the single implementation of the
    pair test: _compute_edge_lengths totals from it and _valley_seams
    locates valleys from it, so the two can never disagree.
    """
    overlap = poly_i.intersection(poly_j.buffer(0.75))
    if overlap.is_empty or overlap.area <= 1e-6:
        return None
    # Plane normals for z = ax + by + c are (-a, -b, 1); the edge
    # direction is their cross product.
    dx = -b_i + b_j
    dy = a_i - a_j
    dz = a_i * b_j - a_j * b_i
    horizontal = math.hypot(dx, dy)
    flat_pair = pitch_i < 5.0 and pitch_j < 5.0
    if horizontal <= 1e-9:
        # Parallel planes: no unique intersection line. Only a flat
        # pair is meaningful here, as a pitch-change seam.
        if not flat_pair:
            return None
        seam = poly_i.boundary.intersection(poly_j.buffer(0.3))
        if seam.is_empty:
            return None
        return float(seam.length), "pitch_change", seam
    # A point on the intersection line: both planes satisfy
    # (a_i - a_j) x + (b_i - b_j) y + (c_i - c_j) = 0, whose
    # coefficients are (dy, -dx). Fix the coordinate whose
    # coefficient is smaller and solve for the other.
    if abs(dx) >= abs(dy):
        p_x = 0.0
        p_y = (c_i - c_j) / dx
    else:
        p_y = 0.0
        p_x = (c_i - c_j) / (-dy)
    p_z = a_i * p_x + b_i * p_y + c_i
    # Project the overlap region onto the line: s parameterizes
    # position along it, and |d| converts s back to true 3D length.
    denom = dx * dx + dy * dy
    s_values = []
    for part in _polygon_parts(overlap):
        for vx, vy in part.exterior.coords:
            s_values.append(((vx - p_x) * dx + (vy - p_y) * dy) / denom)
    if not s_values:
        return None
    s_min, s_max = min(s_values), max(s_values)
    length_m = (s_max - s_min) * math.sqrt(dx * dx + dy * dy + dz * dz)
    if length_m < 0.5:
        return None
    s_mid = (s_min + s_max) / 2.0
    mid_x, mid_y = p_x + s_mid * dx, p_y + s_mid * dy
    edge_z = p_z + s_mid * dz
    # Cross-section chord test one metre into each facet, stepping
    # from the seam midpoint toward each polygon's representative
    # point. The margin this produces can be a few centimetres on real
    # seams, which is why _fit_facets classifies each pair once, when
    # the facet structure is established, and does not re-run this test
    # on reshaped polygons (see _classify_record_pairs).
    chord_z = 0.0
    for polygon, a, b, c in ((poly_i, a_i, b_i, c_i), (poly_j, a_j, b_j, c_j)):
        center = polygon.representative_point()
        vx, vy = center.x - mid_x, center.y - mid_y
        norm = math.hypot(vx, vy)
        if norm <= 1e-9:
            chord_z = float("nan")
            break
        chord_z += (a * (mid_x + vx / norm) + b * (mid_y + vy / norm) + c) / 2.0
    if flat_pair or not math.isfinite(chord_z) or abs(edge_z - chord_z) <= 0.03:
        classification = "pitch_change"
    elif edge_z > chord_z:
        slope_along = abs(dz) / horizontal
        classification = "ridge" if slope_along <= 0.14 else "hip"
    else:
        classification = "valley"
    seam = LineString([
        (p_x + s_min * dx, p_y + s_min * dy),
        (p_x + s_max * dx, p_y + s_max * dy),
    ])
    return length_m, classification, seam


def _classify_record_pairs(
    records: list[dict[str, Any]],
) -> dict[tuple[int, int], tuple[str, Any]]:
    """Classify every shared edge the records currently have:
    {(i, j): (classification, seam geometry)} from _shared_edge_span.

    _fit_facets calls this once, right after coverage completion —
    the moment the facet structure is established — and the verdicts
    are carried through the later geometry passes (outline
    completion, overhang growth, boundary snapping) instead of being
    re-derived from the reshaped polygons at emission. The chord
    test's margin on real seams can be a few centimetres (Miramar's
    main valley: ~0.07 m against a 0.03 m pitch-change band), less
    than the sampling drift those passes induce when they move a
    polygon's representative point around an unchanged pair of planes
    and an unchanged shared boundary: the same seam read as valley,
    then pitch-change, then hip across the passes, and the valley —
    and the ring-growth protection keyed to it — was lost. A seam's
    type is a property of its two planes and their initial adjacency;
    the later passes may lengthen or shorten the seam, and pairs that
    only become adjacent later are classified live at emission, but a
    classified pair is not re-litigated.
    """
    classes: dict[tuple[int, int], tuple[str, Any]] = {}
    for i in range(len(records)):
        for j in range(i + 1, len(records)):
            first, second = records[i], records[j]
            span = _shared_edge_span(
                first["polygon"], first["a"], first["b"], first["c"], first["pitch"],
                second["polygon"], second["a"], second["b"], second["c"], second["pitch"],
            )
            if span is not None:
                classes[(i, j)] = (span[1], span[2])
    return classes


def _valley_seams(
    records: list[dict[str, Any]],
    pair_classes: dict[tuple[int, int], tuple[str, Any]] | None = None,
) -> list[Polygon]:
    """Protected corridors around the valley seams the facet records
    currently share, for overhang-ring valley protection.

    Each seam is extended by OVERHANG_RING_M at both ends — a valley
    runs out through the eave, so its line continues into the ring —
    and buffered by VALLEY_GROWTH_CLEARANCE_M. Ring growth is clipped
    out of these corridors (see _grow_into_overhang_ring).
    """
    if pair_classes is None:
        pair_classes = _classify_record_pairs(records)
    zones: list[Polygon] = []
    for classification, seam in pair_classes.values():
        if classification != "valley":
            continue
        if seam is None or seam.is_empty or seam.geom_type != "LineString":
            continue
        (x0, y0), (x1, y1) = seam.coords[0], seam.coords[-1]
        span_x, span_y = x1 - x0, y1 - y0
        norm = math.hypot(span_x, span_y)
        if norm <= 1e-9:
            continue
        ux, uy = span_x / norm, span_y / norm
        extended = LineString([
            (x0 - ux * OVERHANG_RING_M, y0 - uy * OVERHANG_RING_M),
            (x1 + ux * OVERHANG_RING_M, y1 + uy * OVERHANG_RING_M),
        ])
        zones.append(extended.buffer(VALLEY_GROWTH_CLEARANCE_M))
    return zones


def _compute_edge_lengths(
    facets: list[dict[str, Any]],
    frozen_pair_classes: dict[tuple[int, int], str] | None = None,
) -> dict[str, float] | None:
    """Derive EagleView-style edge totals from fitted facet geometry.

    Shared boundaries between two planes are classified with a cross-section
    chord test: if the edge sits above the chord joining the two surfaces it
    is a peak (ridge when level, hip when sloped); below the chord it is a
    valley. Unshared boundary is perimeter: segments running across the
    facet's downslope direction are eaves, segments running along it are
    rakes. Lengths are true 3D lengths on the facet planes, in feet.

    `frozen_pair_classes` carries the classifications _fit_facets froze
    when the facet structure was established (see _classify_record_pairs):
    for a pair present in the map, the frozen classification is used with
    the pair's current span length; pairs absent from the map (adjacent
    only after the later geometry passes) are classified live.
    """
    if not facets:
        return None
    feet_per_meter = 3.280839895
    polygons: list[Polygon] = []
    for facet in facets:
        polygon = Polygon(facet["boundary_xy"])
        if not polygon.is_valid:
            fixed = make_valid(polygon)
            parts = (
                [fixed] if fixed.geom_type == "Polygon"
                else [part for part in getattr(fixed, "geoms", []) if part.geom_type == "Polygon"]
            )
            if not parts:
                return None
            polygon = max(parts, key=lambda part: part.area)
        polygons.append(polygon)

    totals = {"ridge": 0.0, "hip": 0.0, "valley": 0.0, "eave": 0.0, "rake": 0.0, "pitch_change": 0.0}

    # Shared edges between adjacent facet planes. The true edge is the two
    # planes' intersection line; measuring boundary coincidence instead
    # over-counts wherever a third boundary passes near a corner.
    for i in range(len(facets)):
        for j in range(i + 1, len(facets)):
            a_i, b_i, c_i = facets[i]["plane_model"]["z_equals_ax_plus_by_plus_c"]
            a_j, b_j, c_j = facets[j]["plane_model"]["z_equals_ax_plus_by_plus_c"]
            span = _shared_edge_span(
                polygons[i], a_i, b_i, c_i, facets[i]["pitch_degrees"],
                polygons[j], a_j, b_j, c_j, facets[j]["pitch_degrees"],
            )
            if span is None:
                continue
            length_m, classification, _seam = span
            if frozen_pair_classes:
                classification = frozen_pair_classes.get((i, j), classification)
            totals[classification] += length_m * feet_per_meter

    # Unshared boundary is roof perimeter: eaves run across the slope,
    # rakes run along it.
    for i, facet in enumerate(facets):
        others = [polygons[j].buffer(0.75) for j in range(len(facets)) if j != i]
        if others:
            from shapely.ops import unary_union

            perimeter = polygons[i].boundary.difference(unary_union(others))
        else:
            perimeter = polygons[i].boundary
        a, b, _c = facet["plane_model"]["z_equals_ax_plus_by_plus_c"]
        gradient = math.hypot(a, b)
        # Classify per straight segment: a perimeter component can turn a
        # corner (rake into eave), so endpoints alone misclassify it.
        for component in _line_components(perimeter):
            coords = list(component.coords)
            for (x0, y0), (x1, y1) in zip(coords, coords[1:]):
                span = math.hypot(x1 - x0, y1 - y0)
                if span < 0.3:
                    continue
                ux, uy = (x1 - x0) / span, (y1 - y0) / span
                slope_along = a * ux + b * uy
                length_ft = span * math.sqrt(1.0 + slope_along * slope_along) * feet_per_meter
                if gradient <= 1e-6:
                    totals["eave"] += length_ft
                    continue
                downslope_x, downslope_y = -a / gradient, -b / gradient
                alignment = abs(ux * downslope_x + uy * downslope_y)
                totals["eave" if alignment < 0.5 else "rake"] += length_ft

    return {key: round(value, 1) for key, value in totals.items()}


def _facets_from_local_points(
    unique_points: np.ndarray,
    polygon: Polygon,
    to_local: Transformer,
    from_local: Transformer,
    ring_points: np.ndarray | None = None,
    footprint_provider: str | None = None,
) -> tuple[list[dict[str, Any]], dict[str, float] | None]:
    """Fit roof planes to deduplicated local-metric points and express each
    facet boundary back in lat/lon with modeled elevations. Ring points
    (already in local coordinates) never enter fitting; they only evidence
    overhang growth in _fit_facets. The footprint provider decides whether
    that growth may fire (see ROOF_OUTLINE_PROVIDERS)."""
    footprint_local = _transform_polygon(polygon, to_local)
    pair_classes: dict[tuple[int, int], str] = {}
    raw_facets = _fit_facets(
        unique_points, footprint_local, ring_points=ring_points,
        footprint_provider=footprint_provider,
        pair_classes_out=pair_classes,
    )
    edge_lengths = _compute_edge_lengths(
        raw_facets, frozen_pair_classes=pair_classes
    )
    all_facets: list[dict[str, Any]] = []
    for facet in raw_facets:
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
    return all_facets, edge_lengths


def _read_lidar_facets(
    polygon: Polygon, footprint_provider: str | None = None
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
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
    tile_ring_points: list[np.ndarray] = []
    used_items = 0
    used_tile_ids: list[str] = []
    raw_point_count = 0
    tiles_missing_vertical_units = 0
    vertical_unit_factors: set[float] = set()

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
        # Returns in the wider ring out to OVERHANG_RING_M are gathered
        # too, but kept apart: they never enter fitting and only evidence
        # overhang growth (see _grow_into_overhang_ring).
        lidar_query_polygon = projected_polygon.buffer(OVERHANG_RING_M / meters_per_unit)
        fit_polygon = projected_polygon.buffer(0.75 / meters_per_unit)
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
                z_to_meters = _vertical_unit_to_meters(reader.header)
                if z_to_meters is None:
                    # A tile without an explicit vertical unit cannot safely
                    # contribute elevations to pitch or roof-plane fitting.
                    tiles_missing_vertical_units += 1
                    continue
                vertical_unit_factors.add(round(z_to_meters, 12))
                cloud = reader.query(
                    bounds=laspy.Bounds(
                        mins=np.array([minx, miny]),
                        maxs=np.array([maxx, maxy]),
                    )
                )
            x = np.asarray(cloud.x)
            y = np.asarray(cloud.y)
            z = np.asarray(cloud.z) * z_to_meters
            classifications = np.asarray(cloud.classification)
            # ASPRS class 6 is building. Do not treat generic unclassified points as roof evidence.
            mask = (classifications == 6) & np.isfinite(x) & np.isfinite(y) & np.isfinite(z)
            if not mask.any():
                continue
            coords = np.column_stack((x[mask], y[mask], z[mask]))
            inside = np.array([lidar_query_polygon.covers(Point(px, py)) for px, py in coords[:, :2]])
            coords = coords[inside]
            in_fit = np.array([fit_polygon.covers(Point(px, py)) for px, py in coords[:, :2]])
            fit_coords = coords[in_fit]
            ring_coords = coords[~in_fit]
            if len(fit_coords) < MIN_ROOF_POINTS:
                continue

            # Convert every tile into one local metric coordinate system before
            # combining. This lets overlapping tiles be deduplicated and avoids
            # counting the same roof facet once per COPC tile.
            to_wgs84 = Transformer.from_crs(f"EPSG:{epsg}", "EPSG:4326", always_xy=True)
            lon, lat = to_wgs84.transform(fit_coords[:, 0], fit_coords[:, 1])
            local_x, local_y = to_local.transform(lon, lat)
            tile_points.append(np.column_stack((local_x, local_y, fit_coords[:, 2])))
            if len(ring_coords):
                ring_lon, ring_lat = to_wgs84.transform(ring_coords[:, 0], ring_coords[:, 1])
                ring_x, ring_y = to_local.transform(ring_lon, ring_lat)
                tile_ring_points.append(np.column_stack((ring_x, ring_y, ring_coords[:, 2])))
            raw_point_count += len(fit_coords)
            used_items += 1
            used_tile_ids.append(str(item.id))
        except Exception:
            # One unavailable/corrupt tile must not prevent other intersecting tiles being used.
            continue

    if not tile_points:
        return [], {
            "stac_items": len(items),
            "tiles_used": 0,
            "building_class_points": 0,
            "tiles_missing_vertical_units": tiles_missing_vertical_units,
        }

    combined = np.vstack(tile_points)
    unique_points = _deduplicate_lidar_points(combined)
    unique_ring_points = (
        _deduplicate_lidar_points(np.vstack(tile_ring_points))
        if tile_ring_points
        else np.empty((0, 3))
    )
    all_facets, edge_lengths = _facets_from_local_points(
        unique_points, polygon, to_local, from_local,
        ring_points=unique_ring_points, footprint_provider=footprint_provider,
    )

    return all_facets, {
        "edge_lengths_lf": edge_lengths,
        "footprint_provider": footprint_provider,
        "roof_outline_footprint": footprint_provider in ROOF_OUTLINE_PROVIDERS,
        "overhang_ring_m": OVERHANG_RING_M,
        "stac_items": len(items),
        "tiles_used": used_items,
        "tile_ids_used": used_tile_ids,
        "building_class_points": len(unique_points),
        "overhang_ring_points": len(unique_ring_points),
        "raw_building_class_points": raw_point_count,
        "duplicate_points_removed": raw_point_count - len(unique_points),
        "tiles_missing_vertical_units": tiles_missing_vertical_units,
        "vertical_unit_to_meters_factors": sorted(vertical_unit_factors),
    }

async def _download_tile(url: str, dest: Path) -> None:
    """Stream a LAZ tile into the local cache; a partial file is never kept.

    USGS rate-limits aggressive clients (HTTP 429) and occasionally answers
    with an HTML interstitial instead of the file, so transient failures are
    retried with backoff. A LAZ always starts with the LASF signature;
    anything else must never enter the cache.
    """
    tmp = dest.with_suffix(dest.suffix + ".part")
    last_error: Exception | None = None
    for attempt in range(3):
        if attempt:
            await asyncio.sleep(20 * attempt)
        try:
            async with httpx.AsyncClient(
                timeout=httpx.Timeout(900.0, connect=15.0),
                follow_redirects=True,
                headers={"User-Agent": USER_AGENT},
            ) as client:
                async with client.stream("GET", url) as response:
                    response.raise_for_status()
                    with open(tmp, "wb") as handle:
                        async for chunk in response.aiter_bytes(1 << 20):
                            handle.write(chunk)
            with open(tmp, "rb") as handle:
                signature = handle.read(4)
            if signature != b"LASF":
                raise ValueError(f"Downloaded tile did not have a LASF signature: {url}")
            tmp.rename(dest)
            return
        except (httpx.HTTPStatusError, httpx.TransportError, ValueError) as exc:
            last_error = exc
            tmp.unlink(missing_ok=True)
            if isinstance(exc, httpx.HTTPStatusError) and exc.response.status_code not in (
                429,
                500,
                502,
                503,
                504,
            ):
                raise
    raise last_error if last_error else RuntimeError(f"Tile download failed: {url}")


def _select_building_points(
    coords: np.ndarray,
    classifications: np.ndarray,
    ground_z_median: float | None,
) -> tuple[np.ndarray, str | None]:
    """Pick roof points from one tile's in-footprint points.

    Prefers ASPRS class 6 (building). Some USGS county deliveries (for
    example the 2024 Miami-Dade LPC project) ship only ground/unclassified
    separation and contain no class 6 points at all; for those, fall back
    to non-ground points at least 2 m above the local ground level inside
    the footprint. The facet fitter's plane segmentation still has to
    agree with the selected points before anything is reported.
    """
    empty = np.empty((0, 3))
    if len(coords) == 0:
        return empty, None
    building = coords[classifications == 6]
    if len(building) >= MIN_ROOF_POINTS:
        return building, "asprs_class_6"
    pool = coords[~np.isin(classifications, [2, 7, 18])]
    if len(pool) < MIN_ROOF_POINTS:
        return empty, None
    ground = (
        ground_z_median
        if ground_z_median is not None
        else float(np.percentile(pool[:, 2], 5))
    )
    elevated = pool[pool[:, 2] >= ground + 2.0]
    if len(elevated) >= MIN_ROOF_POINTS:
        return elevated, "elevated_non_ground"
    return empty, None


def _tnm_points_local(
    polygon: Polygon, tile_paths: list[Path], footprint_provider: str | None = None
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Read roof points from downloaded USGS LAZ tiles and fit facets.

    Mirrors the COPC path's discipline: explicit vertical units required,
    points deduplicated across tiles in one local metric CRS. Point
    selection prefers ASPRS class 6 and falls back to elevated non-ground
    points for county deliveries that carry no building classification
    (see _select_building_points).
    """
    center = polygon.representative_point()
    local_crs = CRS.from_proj4(
        f"+proj=aeqd +lat_0={center.y} +lon_0={center.x} +datum=WGS84 +units=m +no_defs"
    )
    to_local = Transformer.from_crs("EPSG:4326", local_crs, always_xy=True)
    from_local = Transformer.from_crs(local_crs, "EPSG:4326", always_xy=True)
    tile_points: list[np.ndarray] = []
    tile_ring_points: list[np.ndarray] = []
    used_items = 0
    used_tile_ids: list[str] = []
    raw_point_count = 0
    tiles_missing_vertical_units = 0
    vertical_unit_factors: set[float] = set()
    point_sources: set[str] = set()

    for path in tile_paths:
        try:
            with laspy.open(str(path)) as reader:
                header = reader.header
                tile_crs = header.parse_crs()
                if tile_crs is None:
                    continue
                z_to_meters = _vertical_unit_to_meters(header)
                if z_to_meters is None:
                    tiles_missing_vertical_units += 1
                    continue
                vertical_unit_factors.add(round(z_to_meters, 12))
                meters_per_unit = (
                    tile_crs.axis_info[0].unit_conversion_factor if tile_crs.axis_info else 1.0
                )
                if not meters_per_unit or not math.isfinite(meters_per_unit):
                    continue
                to_tile = Transformer.from_crs("EPSG:4326", tile_crs, always_xy=True)
                projected_polygon = _transform_polygon(polygon, to_tile)
                # The read window reaches out to the overhang ring; the
                # fitting pool still ends at the footprint + 0.75 m clip
                # and ring returns are split off after selection.
                query_polygon = projected_polygon.buffer(OVERHANG_RING_M / meters_per_unit)
                fit_polygon = projected_polygon.buffer(0.75 / meters_per_unit)
                q_minx, q_miny, q_maxx, q_maxy = query_polygon.bounds
                ground_polygon = projected_polygon.buffer(10.0 / meters_per_unit)
                g_minx, g_miny, g_maxx, g_maxy = ground_polygon.bounds
                kept: list[np.ndarray] = []
                kept_classes: list[np.ndarray] = []
                ground_zs: list[np.ndarray] = []
                for chunk in reader.chunk_iterator(1_000_000):
                    x = np.asarray(chunk.x)
                    y = np.asarray(chunk.y)
                    z = np.asarray(chunk.z) * z_to_meters
                    classifications = np.asarray(chunk.classification)
                    finite = np.isfinite(x) & np.isfinite(y) & np.isfinite(z)
                    ground_mask = (
                        finite
                        & (classifications == 2)
                        & (x >= g_minx) & (x <= g_maxx)
                        & (y >= g_miny) & (y <= g_maxy)
                    )
                    if ground_mask.any():
                        gx, gy, gz = x[ground_mask], y[ground_mask], z[ground_mask]
                        g_inside = contains_xy(ground_polygon, gx, gy)
                        if g_inside.any():
                            ground_zs.append(gz[g_inside])
                    mask = (
                        finite
                        & (x >= q_minx) & (x <= q_maxx)
                        & (y >= q_miny) & (y <= q_maxy)
                    )
                    if not mask.any():
                        continue
                    xs, ys, zs = x[mask], y[mask], z[mask]
                    inside = contains_xy(query_polygon, xs, ys)
                    if not inside.any():
                        continue
                    kept.append(np.column_stack((xs[inside], ys[inside], zs[inside])))
                    kept_classes.append(classifications[mask][inside])
            if not kept:
                continue
            ground_median = (
                float(np.median(np.concatenate(ground_zs)))
                if sum(len(part) for part in ground_zs) >= 10
                else None
            )
            coords, source = _select_building_points(
                np.vstack(kept), np.concatenate(kept_classes), ground_median
            )
            if source is None or len(coords) < MIN_ROOF_POINTS:
                continue
            in_fit = contains_xy(fit_polygon, coords[:, 0], coords[:, 1])
            fit_coords = coords[in_fit]
            ring_coords = coords[~in_fit]
            if len(fit_coords) < MIN_ROOF_POINTS:
                continue
            point_sources.add(source)
            to_wgs84 = Transformer.from_crs(tile_crs, "EPSG:4326", always_xy=True)
            lon, lat = to_wgs84.transform(fit_coords[:, 0], fit_coords[:, 1])
            local_x, local_y = to_local.transform(lon, lat)
            tile_points.append(np.column_stack((local_x, local_y, fit_coords[:, 2])))
            if len(ring_coords):
                ring_lon, ring_lat = to_wgs84.transform(ring_coords[:, 0], ring_coords[:, 1])
                ring_x, ring_y = to_local.transform(ring_lon, ring_lat)
                tile_ring_points.append(np.column_stack((ring_x, ring_y, ring_coords[:, 2])))
            raw_point_count += len(fit_coords)
            used_items += 1
            used_tile_ids.append(path.name)
        except Exception:
            # One unavailable/corrupt tile must not prevent other tiles being used.
            continue

    if not tile_points:
        return [], {
            "tiles_used": 0,
            "building_class_points": 0,
            "tiles_missing_vertical_units": tiles_missing_vertical_units,
            "reason": "No USGS LAZ tile yielded enough building-classified or elevated non-ground points for this footprint.",
        }

    combined = np.vstack(tile_points)
    unique_points = _deduplicate_lidar_points(combined)
    unique_ring_points = (
        _deduplicate_lidar_points(np.vstack(tile_ring_points))
        if tile_ring_points
        else np.empty((0, 3))
    )
    all_facets, edge_lengths = _facets_from_local_points(
        unique_points, polygon, to_local, from_local,
        ring_points=unique_ring_points, footprint_provider=footprint_provider,
    )
    return all_facets, {
        "edge_lengths_lf": edge_lengths,
        "footprint_provider": footprint_provider,
        "roof_outline_footprint": footprint_provider in ROOF_OUTLINE_PROVIDERS,
        "overhang_ring_m": OVERHANG_RING_M,
        "tiles_used": used_items,
        "tile_ids_used": used_tile_ids,
        "building_class_points": len(unique_points),
        "overhang_ring_points": len(unique_ring_points),
        "raw_building_class_points": raw_point_count,
        "duplicate_points_removed": raw_point_count - len(unique_points),
        "tiles_missing_vertical_units": tiles_missing_vertical_units,
        "vertical_unit_to_meters_factors": sorted(vertical_unit_factors),
        "points_source": (
            point_sources.pop() if len(point_sources) == 1 else "mixed"
        ),
    }


async def _read_lidar_facets_tnm(
    polygon: Polygon, footprint_provider: str | None = None
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Fallback LiDAR source: USGS Lidar Point Cloud tiles via The National Map.

    Planetary Computer's COPC conversion has no coverage for parts of South
    Florida (Miami-Dade and Broward included), while the same USGS surveys are
    published as LAZ tiles through TNM. Tiles are large, so they are cached on
    disk and reused for every nearby address.
    """
    minx, miny, maxx, maxy = polygon.bounds

    async def search_tiles(bbox: str) -> tuple[list[dict[str, Any]], dict[str, Any]]:
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(30.0, connect=10.0), headers={"User-Agent": USER_AGENT}
        ) as client:
            response = await client.get(
                TNM_PRODUCTS_URL,
                params={
                    "datasets": "Lidar Point Cloud (LPC)",
                    "bbox": bbox,
                    "max": 12,
                    "outputFormat": "JSON",
                },
            )
            response.raise_for_status()
            payload = response.json()
        items = payload.get("items", [])
        laz = [
            item for item in items
            if str(item.get("downloadURL", "")).lower().endswith(".laz")
        ]
        return laz, payload

    items: list[dict[str, Any]] = []
    laz_items, payload = await search_tiles(f"{minx},{miny},{maxx},{maxy}")
    items = payload.get("items", [])
    if not laz_items:
        # TNM's product search is unreliable for building-sized
        # bounding boxes: it intermittently answers HTTP 200 with an
        # error envelope and no items, so a small footprint reads as
        # "no tiles published" even where tiles exist (Annel's
        # Miami-Dade D23 tiles, for one). Retry with the box padded to
        # a ~450 m span, up to two more attempts — the search only
        # discovers candidate tiles; the points are clipped to the
        # footprint later, and a tile is far larger than the padding.
        # Addresses whose first search already works are untouched.
        span_x = max(maxx - minx, 0.004)
        span_y = max(maxy - miny, 0.004)
        center_x, center_y = (minx + maxx) / 2.0, (miny + maxy) / 2.0
        padded = (
            f"{center_x - span_x / 2},{center_y - span_y / 2},"
            f"{center_x + span_x / 2},{center_y + span_y / 2}"
        )
        for _attempt in range(2):
            laz_items, payload = await search_tiles(padded)
            items = payload.get("items", [])
            if laz_items:
                break
    if not laz_items:
        reason = "No USGS Lidar Point Cloud tiles are published for this footprint."
        if payload.get("error"):
            reason = f"USGS TNM product search returned an error: {payload['error']}"
        return [], {
            "tnm_products": len(items),
            "reason": reason,
        }

    def project_key(item: dict[str, Any]) -> str:
        parts = str(item.get("title", "")).split()
        return parts[4] if len(parts) > 4 else ""

    # Prefer the newest survey project; older legacy tiles of the same ground
    # must not be mixed into one point set.
    newest = max(laz_items, key=lambda item: str(item.get("dateCreated") or ""))
    project = project_key(newest)
    tiles = [
        item for item in laz_items
        if project_key(item) == project
        and float(item.get("sizeInBytes") or 0) <= MAX_TNM_TILE_MB * 1_000_000
    ][:MAX_TNM_TILES]
    if not tiles:
        return [], {
            "tnm_products": len(items),
            "reason": "USGS Lidar tiles for this footprint exceed the download size limit.",
        }

    LIDAR_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    tile_paths: list[Path] = []
    for item in tiles:
        url = str(item["downloadURL"])
        dest = LIDAR_CACHE_DIR / url.rsplit("/", 1)[-1]
        if not dest.exists():
            await _download_tile(url, dest)
        tile_paths.append(dest)

    facets, meta = _tnm_points_local(polygon, tile_paths, footprint_provider)
    return facets, {
        "source": "USGS National Map (TNM) Lidar Point Cloud LAZ",
        "tnm_project": project,
        "tnm_products": len(items),
        **meta,
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
    ) + (f":candidate:{request.footprint_candidate_id}" if request.footprint_candidate_id else "")
    cached = _RESPONSE_CACHE.get(cache_key)
    if cached and cached[0] > monotonic():
        return cached[1]
    if request.street_address:
        lat, lon, matched_address, address_provenance = await geocode_with_provenance(request.street_address)
    else:
        lat, lon = float(request.lat), float(request.lon)
        matched_address = f"{lat:.7f}, {lon:.7f}"
        address_provenance = {"source": "User-provided coordinates"}
    footprint, footprint_meta = await get_footprint(lat, lon, request.street_address, request.footprint_candidate_id)
    footprint_sqft = _polygon_area_sqft(footprint)
    footprint_provider = footprint_meta.get("provider")
    try:
        facets, lidar_meta = _read_lidar_facets(footprint, footprint_provider)
    except Exception as exc:
        facets, lidar_meta = [], {"reason": f"3DEP lookup failed: {type(exc).__name__}"}
    if not facets:
        # The COPC path produced no facets. That covers both "no COPC items
        # intersect the footprint" (true for most of Miami-Dade) and the
        # subtler case where an item intersects the search bbox yet yields no
        # usable roof points (observed in Broward: stac_items=1, tiles_used=0).
        # Either way, fall back to the same USGS surveys published as LAZ
        # tiles via The National Map.
        try:
            tnm_facets, tnm_meta = await _read_lidar_facets_tnm(footprint, footprint_provider)
        except Exception as exc:
            tnm_facets, tnm_meta = [], {"reason": f"TNM lookup failed: {type(exc).__name__}"}
        if tnm_facets:
            facets, lidar_meta = tnm_facets, tnm_meta
        else:
            lidar_meta = {**lidar_meta, "tnm_fallback": tnm_meta}
    lidar_area = sum(facet["area_sqft"] for facet in facets)
    status = "lidar_facets" if facets else "footprint_only"
    edge_lengths_lf = lidar_meta.pop("edge_lengths_lf", None)
    result = {
        "status": status,
        "verification": "unverified_public_data",
        "matched_address": matched_address,
        "address_match": address_provenance,
        "location": {"lat": lat, "lon": lon},
        "footprint": {
            "source": footprint_meta.get("provider", "Unknown public footprint source"),
            "source_id": footprint_meta.get("source_id"),
            "osm_way_id": footprint_meta.get("source_id") if footprint_meta.get("provider") == "OpenStreetMap" else None,
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
            "edge_lengths_lf": edge_lengths_lf if facets else None,
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
