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
from shapely.geometry import MultiPoint, Point, Polygon, mapping, shape
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
# Pools selected from unclassified tiles (the elevated non-ground fallback
# in _select_building_points) mix roof returns with above-ground clutter —
# tree canopy overhanging the eaves, patio structures, multi-surface
# returns — that shares no plane with the roof and pulls the facet fitter
# toward shallow compromise planes. Before fitting, such a pool is refined
# in plan-view cells (see _planar_refine_mask): a cell contributes points
# only when one plane explains it tightly, and only points close to that
# plane survive.
PLANAR_REFINE_CELL_M = float(os.getenv("PLANAR_REFINE_CELL_M", "1.5"))
PLANAR_REFINE_MIN_POINTS = int(os.getenv("PLANAR_REFINE_MIN_POINTS", "12"))
PLANAR_REFINE_MAX_RMSE_M = float(os.getenv("PLANAR_REFINE_MAX_RMSE_M", "0.12"))
PLANAR_REFINE_MAX_RESIDUAL_M = float(os.getenv("PLANAR_REFINE_MAX_RESIDUAL_M", "0.15"))
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


def _fit_facets(points: np.ndarray, footprint: Polygon | None = None) -> list[dict[str, Any]]:
    remaining = points.copy()
    # Clipped hull components from every fitted plane, resolved into facets
    # only after the plane loop (see the overlap pass at the end).
    candidates: list[dict[str, Any]] = []
    for plane_index in range(MAX_PLANES):
        if len(remaining) < MIN_ROOF_POINTS:
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

    # Hulls of different planes routinely overlap in plan view (a fragmented
    # near-parallel detection, or a plane fitted across a ridge, extends under
    # its neighbour), and summing the raw hulls double-counts the overlap —
    # total facet area can exceed the whole clipped footprint region. Resolve
    # largest-first: each candidate keeps only the part of its hull that no
    # earlier (larger) facet has claimed, so the accepted hulls tile the roof
    # instead of stacking on top of each other.
    facets: list[dict[str, Any]] = []
    accepted_union: Any = None
    for candidate in sorted(candidates, key=lambda item: -item["point_count"]):
        if len(facets) >= MAX_PLANES:
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
        if not kept:
            continue
        if (
            sum(surface_sqft(part) for part in kept)
            < MIN_FACET_REMAINING_FRACTION * original_surface_sqft
        ):
            # What is left is mostly area earlier facets already claimed;
            # this detection is a duplicate, not another roof plane.
            continue
        model = candidate["model"]
        for part in kept:
            if len(facets) >= MAX_PLANES:
                break
            part_points = [
                point
                for point in candidate["cluster"]
                if part.buffer(0.02).covers(Point(float(point[0]), float(point[1])))
            ]
            if not part_points:
                continue
            part_array = np.asarray(part_points, dtype=float)
            residuals = part_array[:, 2] - model.predict(part_array[:, :2])
            fit_rmse_m = float(np.sqrt(np.mean(np.square(residuals))))
            surface_area_sqft = surface_sqft(part)
            facets.append({
                "id": f"facet-{len(facets) + 1}",
                "point_count": len(part_points),
                "fit_rmse_m": round(fit_rmse_m, 4),
                "pitch_degrees": round(pitch, 2),
                "pitch_rise_per_12": round(float(candidate["pitch_rise"]), 2),
                "azimuth_degrees": round(float(candidate["azimuth"]), 1),
                "area_sqft": round(surface_area_sqft, 1),
                "squares": round(surface_area_sqft / 100.0, 3),
                "plane_model": {
                    "z_equals_ax_plus_by_plus_c": [
                        float(candidate["a"]),
                        float(candidate["b"]),
                        float(model.intercept_),
                    ]
                },
                "boundary_xy": [
                    [round(float(x), 3), round(float(y), 3)]
                    for x, y in part.exterior.coords
                ],
            })
            accepted_union = part if accepted_union is None else accepted_union.union(part)
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


def _compute_edge_lengths(facets: list[dict[str, Any]]) -> dict[str, float] | None:
    """Derive EagleView-style edge totals from fitted facet geometry.

    Shared boundaries between two planes are classified with a cross-section
    chord test: if the edge sits above the chord joining the two surfaces it
    is a peak (ridge when level, hip when sloped); below the chord it is a
    valley. Unshared boundary is perimeter: segments running across the
    facet's downslope direction are eaves, segments running along it are
    rakes. Lengths are true 3D lengths on the facet planes, in feet.
    """
    if not facets:
        return None
    feet_per_meter = 3.280839895
    min_segment_m = 0.5
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

    def plane_z(index: int, x: float, y: float) -> float:
        a, b, c = facets[index]["plane_model"]["z_equals_ax_plus_by_plus_c"]
        return a * x + b * y + c

    totals = {"ridge": 0.0, "hip": 0.0, "valley": 0.0, "eave": 0.0, "rake": 0.0, "pitch_change": 0.0}

    # Shared edges between adjacent facet planes. The true edge is the two
    # planes' intersection line; measuring boundary coincidence instead
    # over-counts wherever a third boundary passes near a corner.
    for i in range(len(facets)):
        for j in range(i + 1, len(facets)):
            overlap = polygons[i].intersection(polygons[j].buffer(0.75))
            if overlap.is_empty or overlap.area <= 1e-6:
                continue
            a_i, b_i, c_i = facets[i]["plane_model"]["z_equals_ax_plus_by_plus_c"]
            a_j, b_j, c_j = facets[j]["plane_model"]["z_equals_ax_plus_by_plus_c"]
            # Plane normals for z = ax + by + c are (-a, -b, 1); the edge
            # direction is their cross product.
            dx = -b_i + b_j
            dy = a_i - a_j
            dz = a_i * b_j - a_j * b_i
            horizontal = math.hypot(dx, dy)
            flat_pair = facets[i]["pitch_degrees"] < 5.0 and facets[j]["pitch_degrees"] < 5.0
            if horizontal <= 1e-9:
                # Parallel planes: no unique intersection line. Only a flat
                # pair is meaningful here, as a pitch-change seam.
                if flat_pair:
                    seam = polygons[i].boundary.intersection(polygons[j].buffer(0.3))
                    totals["pitch_change"] += seam.length * feet_per_meter
                continue
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
            for part in [overlap] if overlap.geom_type == "Polygon" else list(getattr(overlap, "geoms", [])):
                ring = part.exterior if part.geom_type == "Polygon" else None
                if ring is None:
                    continue
                for vx, vy in ring.coords:
                    s_values.append(((vx - p_x) * dx + (vy - p_y) * dy) / denom)
            if not s_values:
                continue
            s_min, s_max = min(s_values), max(s_values)
            length_m = (s_max - s_min) * math.sqrt(dx * dx + dy * dy + dz * dz)
            if length_m < min_segment_m:
                continue
            s_mid = (s_min + s_max) / 2.0
            mid_x, mid_y = p_x + s_mid * dx, p_y + s_mid * dy
            # Cross-section chord test one meter into each facet.
            chord_z = 0.0
            for index in (i, j):
                center = polygons[index].representative_point()
                vx, vy = center.x - mid_x, center.y - mid_y
                norm = math.hypot(vx, vy)
                if norm <= 1e-9:
                    chord_z = float("nan")
                    break
                chord_z += plane_z(index, mid_x + vx / norm, mid_y + vy / norm) / 2.0
            edge_z = p_z + s_mid * dz
            length_ft = length_m * feet_per_meter
            if flat_pair or not math.isfinite(chord_z) or abs(edge_z - chord_z) <= 0.03:
                totals["pitch_change"] += length_ft
            elif edge_z > chord_z:
                slope_along = abs(dz) / horizontal
                totals["ridge" if slope_along <= 0.14 else "hip"] += length_ft
            else:
                totals["valley"] += length_ft

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
) -> tuple[list[dict[str, Any]], dict[str, float] | None]:
    """Fit roof planes to deduplicated local-metric points and express each
    facet boundary back in lat/lon with modeled elevations."""
    footprint_local = _transform_polygon(polygon, to_local)
    raw_facets = _fit_facets(unique_points, footprint_local)
    edge_lengths = _compute_edge_lengths(raw_facets)
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
    all_facets, edge_lengths = _facets_from_local_points(unique_points, polygon, to_local, from_local)

    return all_facets, {
        "edge_lengths_lf": edge_lengths,
        "stac_items": len(items),
        "tiles_used": used_items,
        "tile_ids_used": used_tile_ids,
        "building_class_points": len(unique_points),
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


def _planar_refine_mask(points_m: np.ndarray) -> np.ndarray:
    """Mark points that sit on a locally planar sheet, in metric XYZ.

    The pool is gridded in plan view; each cell with enough points is fit
    with a single plane. A cell whose fit is loose (high RMSE) mixes two
    surfaces or clutter — canopy over a roof, a patio cover meeting a
    wall — and contributes nothing. In a tight cell, only points within
    PLANAR_REFINE_MAX_RESIDUAL_M of the cell plane are kept, dropping
    spikes above or below the sheet. Roof faces are locally planar, so
    they survive; hip/ridge straddle cells and vegetation do not. Cells
    with too few points to judge are dropped as well: at ordinary survey
    density they are isolated returns, not measurable roof.
    """
    keep = np.zeros(len(points_m), dtype=bool)
    if len(points_m) < PLANAR_REFINE_MIN_POINTS:
        return np.ones(len(points_m), dtype=bool)
    origin_x = float(points_m[:, 0].min())
    origin_y = float(points_m[:, 1].min())
    cell_x = ((points_m[:, 0] - origin_x) / PLANAR_REFINE_CELL_M).astype(int)
    cell_y = ((points_m[:, 1] - origin_y) / PLANAR_REFINE_CELL_M).astype(int)
    cells: dict[tuple[int, int], list[int]] = {}
    for index, key in enumerate(zip(cell_x.tolist(), cell_y.tolist())):
        cells.setdefault(key, []).append(index)
    for indices in cells.values():
        if len(indices) < PLANAR_REFINE_MIN_POINTS:
            continue
        idx = np.asarray(indices)
        cell_points = points_m[idx]
        try:
            model = LinearRegression().fit(cell_points[:, :2], cell_points[:, 2])
        except (ValueError, FloatingPointError):
            continue
        residuals = cell_points[:, 2] - model.predict(cell_points[:, :2])
        rmse = float(np.sqrt(np.mean(np.square(residuals))))
        if rmse > PLANAR_REFINE_MAX_RMSE_M:
            continue
        keep[idx[np.abs(residuals) <= PLANAR_REFINE_MAX_RESIDUAL_M]] = True
    return keep


def _tnm_points_local(
    polygon: Polygon, tile_paths: list[Path]
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Read roof points from downloaded USGS LAZ tiles and fit facets.

    Mirrors the COPC path's discipline: explicit vertical units required,
    points deduplicated across tiles in one local metric CRS. Point
    selection prefers ASPRS class 6 and falls back to elevated non-ground
    points for county deliveries that carry no building classification
    (see _select_building_points). Fallback pools are additionally passed
    through a local-planarity refinement (see _planar_refine_mask) so
    canopy and other non-planar clutter cannot pull facet fits off the
    roof planes; class 6 pools are trusted as delivered.
    """
    center = polygon.representative_point()
    local_crs = CRS.from_proj4(
        f"+proj=aeqd +lat_0={center.y} +lon_0={center.x} +datum=WGS84 +units=m +no_defs"
    )
    to_local = Transformer.from_crs("EPSG:4326", local_crs, always_xy=True)
    from_local = Transformer.from_crs(local_crs, "EPSG:4326", always_xy=True)
    tile_points: list[np.ndarray] = []
    used_items = 0
    used_tile_ids: list[str] = []
    raw_point_count = 0
    tiles_missing_vertical_units = 0
    vertical_unit_factors: set[float] = set()
    point_sources: set[str] = set()
    planar_points_removed = 0

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
                query_polygon = projected_polygon.buffer(0.75 / meters_per_unit)
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
            if source == "elevated_non_ground":
                # XY arrive in tile-CRS units; the refinement works in
                # meters (Z already is). If refinement would starve the
                # tile below the fitting minimum, keep the unrefined pool
                # rather than lose the tile entirely.
                metric = coords * np.array(
                    [meters_per_unit, meters_per_unit, 1.0]
                )
                mask = _planar_refine_mask(metric)
                if int(mask.sum()) >= MIN_ROOF_POINTS and not bool(mask.all()):
                    planar_points_removed += int((~mask).sum())
                    coords = coords[mask]
                    source = "elevated_non_ground_planar"
            point_sources.add(source)
            to_wgs84 = Transformer.from_crs(tile_crs, "EPSG:4326", always_xy=True)
            lon, lat = to_wgs84.transform(coords[:, 0], coords[:, 1])
            local_x, local_y = to_local.transform(lon, lat)
            tile_points.append(np.column_stack((local_x, local_y, coords[:, 2])))
            raw_point_count += len(coords)
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
    all_facets, edge_lengths = _facets_from_local_points(unique_points, polygon, to_local, from_local)
    return all_facets, {
        "edge_lengths_lf": edge_lengths,
        "tiles_used": used_items,
        "tile_ids_used": used_tile_ids,
        "building_class_points": len(unique_points),
        "raw_building_class_points": raw_point_count,
        "duplicate_points_removed": raw_point_count - len(unique_points),
        "tiles_missing_vertical_units": tiles_missing_vertical_units,
        "vertical_unit_to_meters_factors": sorted(vertical_unit_factors),
        "planar_points_removed": planar_points_removed,
        "points_source": (
            point_sources.pop() if len(point_sources) == 1 else "mixed"
        ),
    }


async def _read_lidar_facets_tnm(
    polygon: Polygon,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Fallback LiDAR source: USGS Lidar Point Cloud tiles via The National Map.

    Planetary Computer's COPC conversion has no coverage for parts of South
    Florida (Miami-Dade and Broward included), while the same USGS surveys are
    published as LAZ tiles through TNM. Tiles are large, so they are cached on
    disk and reused for every nearby address.
    """
    minx, miny, maxx, maxy = polygon.bounds
    async with httpx.AsyncClient(
        timeout=httpx.Timeout(30.0, connect=10.0), headers={"User-Agent": USER_AGENT}
    ) as client:
        response = await client.get(
            TNM_PRODUCTS_URL,
            params={
                "datasets": "Lidar Point Cloud (LPC)",
                "bbox": f"{minx},{miny},{maxx},{maxy}",
                "max": 12,
                "outputFormat": "JSON",
            },
        )
        response.raise_for_status()
        items = response.json().get("items", [])
    laz_items = [
        item for item in items
        if str(item.get("downloadURL", "")).lower().endswith(".laz")
    ]
    if not laz_items:
        return [], {
            "tnm_products": len(items),
            "reason": "No USGS Lidar Point Cloud tiles are published for this footprint.",
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

    facets, meta = _tnm_points_local(polygon, tile_paths)
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
    try:
        facets, lidar_meta = _read_lidar_facets(footprint)
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
            tnm_facets, tnm_meta = await _read_lidar_facets_tnm(footprint)
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
