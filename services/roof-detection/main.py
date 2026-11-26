from __future__ import annotations

import hashlib
import math
import os
import re
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
from shapely.geometry import MultiPoint, Point, Polygon, mapping, shape
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
        # Unexpected payloads are provider failures, not fatal geocoding errors.
        if not isinstance(payload, dict) or payload.get("error"):
            return None
        requested = _normalize_street_address(street_line)
        matches = []
        for feature in payload.get("features", []):
            if not isinstance(feature, dict):
                continue
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
    # Preserve the existing county exact-match contract: Broward address points
    # carry the county folio used by downstream parcel corroboration. Miramar's
    # city layer is the next authoritative fallback, before general geocoders.
    county_match = await resolve_broward_address_point(address)
    if county_match:
        lat, lon, matched_address, provenance = county_match
        return lat, lon, matched_address, dict(provenance)

    miramar_match = await resolve_miramar_address_point(address)
    if miramar_match:
        lat, lon, matched_address, provenance = miramar_match
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
    # GIS address points commonly omit ordinal suffixes (189 AVE) while
    # user-entered addresses include them (189TH AVE). Normalize numeric ordinals.
    tokens = [re.sub(r"^(\d+)(?:ST|ND|RD|TH)$", r"\1", token) for token in tokens]
    expansions = {
        "N": "NORTH", "S": "SOUTH", "E": "EAST", "W": "WEST",
        "NE": "NORTHEAST", "NW": "NORTHWEST", "SE": "SOUTHEAST", "SW": "SOUTHWEST",
        "ST": "STREET", "AVE": "AVENUE", "AV": "AVENUE", "RD": "ROAD",
        "BLVD": "BOULEVARD", "DR": "DRIVE", "CT": "COURT", "LN": "LANE",
        "PL": "PLACE", "TRL": "TRAIL", "PKWY": "PARKWAY", "HWY": "HIGHWAY",
    }
    return " ".join(expansions.get(token, token) for token in tokens)


async def resolve_miramar_address_point(
    address: str,
) -> tuple[float, float, str, dict[str, Any]] | None:
    """Resolve an exact Miramar situs address to the City's official address point.

    A coarse server-side query is followed by normalized full-address equality;
    zero, duplicate, malformed, or unavailable records fall back to other geocoders.
    """
    street_line = address.split(",", 1)[0].strip()
    tokens = re.findall(r"[A-Za-z0-9]+", street_line.upper())
    if len(tokens) < 3 or not tokens[0].isdigit():
        return None
    excluded = {
        "N", "S", "E", "W", "NE", "NW", "SE", "SW", "NORTH", "SOUTH",
        "EAST", "WEST", "NORTHEAST", "NORTHWEST", "SOUTHEAST", "SOUTHWEST",
        "ST", "STREET", "AVE", "AVENUE", "RD", "ROAD", "DR", "DRIVE",
        "BLVD", "BOULEVARD", "CT", "COURT", "LN", "LANE", "PL", "PLACE",
        "TRL", "TRAIL", "PKWY", "PARKWAY", "HWY", "HIGHWAY",
    }
    street_tokens = [token for token in tokens[1:] if token not in excluded]
    if not street_tokens:
        return None
    # Match the same ordinal normalization used for exact local comparison;
    # otherwise a GIS value like "189 AVE" is excluded by a "%189TH%" query.
    street_tokens = [re.sub(r"^(\d+)(?:ST|ND|RD|TH)$", r"\1", token) for token in street_tokens]
    house_number = tokens[0].replace("'", "''")
    street_token = street_tokens[0].replace("'", "''")
    url = (
        "https://smartcity.miramarfl.gov/server/rest/services/Hosted/"
        "MiramarAddressPoints/FeatureServer/1/query"
    )
    params = {
        "where": f"situsaddrfull LIKE '%{house_number}%' AND situsaddrfull LIKE '%{street_token}%'",
        "outFields": "parcel_id,situsaddrfull,situszip,addr_id",
        "returnGeometry": "true", "outSR": "4326", "resultRecordCount": "20", "f": "json",
    }
    try:
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(12.0, connect=5.0), headers={"User-Agent": USER_AGENT}
        ) as client:
            response = await client.get(url, params=params)
            response.raise_for_status()
            payload = response.json()
        # ArcGIS errors, malformed JSON shapes, and invalid features must safely
        # fall through to the next geocoder instead of aborting address resolution.
        if not isinstance(payload, dict) or payload.get("error"):
            return None
        requested = _normalize_street_address(street_line)
        matches = []
        for feature in payload.get("features", []):
            if not isinstance(feature, dict):
                continue
            attrs = feature.get("attributes") or {}
            candidate_address = str(attrs.get("situsaddrfull") or "")
            if _normalize_street_address(candidate_address) != requested:
                continue
            geometry = feature.get("geometry") or {}
            try:
                lon, lat = float(geometry["x"]), float(geometry["y"])
            except (KeyError, TypeError, ValueError):
                continue
            if not (-80.95 <= lon <= -80.05 and 25.0 <= lat <= 26.5):
                continue
            matches.append((lat, lon, candidate_address, {
                "source": "City of Miramar Official Address Points",
                "parcel_id": attrs.get("parcel_id"),
                "address_id": attrs.get("addr_id"),
                "zip_code": attrs.get("situszip"),
            }))
        return matches[0] if len(matches) == 1 else None
    except (httpx.HTTPError, ValueError, KeyError, TypeError):
        return None


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
        if not isinstance(payload, dict) or payload.get("error"):
            return None, {"status": "provider_error", "provider": "City of Miramar GIS"}
        point, matches = Point(lon, lat), []
        for feature in payload.get("features", []):
            if not isinstance(feature, dict):
                continue
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


def _apply_parcel_candidate_evidence(
    candidates: list[tuple[float, Polygon, dict[str, Any]]],
    parcel_polygon: Polygon | None,
    parcel_metadata: dict[str, Any],
) -> tuple[list[tuple[float, Polygon, dict[str, Any]]], dict[str, Any]]:
    """Narrow candidates only when exactly one building is substantially inside a verified parcel."""
    evidence = dict(parcel_metadata)
    if parcel_polygon is None:
        return candidates, evidence

    parcel_candidates = [
        row for row in candidates
        if parcel_polygon.intersection(row[1]).area / max(row[1].area, 1e-12) >= 0.50
    ]
    evidence["building_candidates_intersecting_parcel"] = len(parcel_candidates)
    for row in candidates:
        row[2]["parcel_match"] = dict(evidence)

    if len(parcel_candidates) == 1:
        parcel_candidates[0][2]["parcel_match"] = dict(evidence)
        return parcel_candidates, evidence

    # Zero or multiple parcel intersections are not decisive. Keep all
    # candidates so existing address/distance safeguards can decide.
    return candidates, evidence


def _find_explicit_candidate(
    candidates: list[tuple[float, Polygon, dict[str, Any]]],
    selected_candidate_id: str,
) -> tuple[float, Polygon, dict[str, Any]] | None:
    """Return only one exact candidate-id match; stale or duplicate ids fail closed."""
    matches = [row for row in candidates if row[2].get("candidate_id") == selected_candidate_id]
    return matches[0] if len(matches) == 1 else None


def _parcel_requires_explicit_candidate_selection(parcel_metadata: dict[str, Any]) -> bool:
    """A verified parcel with no building overlap must never fall back to nearest-building auto-match."""
    return (
        parcel_metadata.get("status") == "matched"
        and parcel_metadata.get("building_candidates_intersecting_parcel") == 0
    )


async def get_footprint(lat: float, lon: float, street_address: str | None = None, selected_candidate_id: str | None = None) -> tuple[Polygon, dict[str, Any]]:
    # Use a nationwide ArcGIS structures layer first. It is independent of
    # Overpass and covers US building polygons; OSM remains a secondary source.
    address_point = Point(lon, lat)
    raw_candidates: list[tuple[Polygon, dict[str, Any]]] = []
    provider_errors: list[str] = []
    providers_succeeded = 0
    arcgis_feature_count = 0
    broward_feature_count = 0
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
        if not selected_candidate_id:
            candidates, parcel_metadata = _apply_parcel_candidate_evidence(
                candidates, parcel_polygon, parcel_metadata
            )
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
                    "providers_tried": 4,
                    "provider_errors": provider_errors,
                },
            )
        raise HTTPException(
            status_code=404,
            detail={
                "code": "building_footprint_not_found",
                "message": "No eligible mapped building was found within the 80 m candidate search radius. Review the geocoded pin or use manual footprint tracing.",
                "providers_checked": ["ArcGIS USA Structures", "Broward County Building Footprints", "OpenStreetMap Overpass"],
                "candidate_search_radius_m": CANDIDATE_SEARCH_RADIUS_M,
                "provider_feature_count": len(raw_candidates),
                "arcgis_feature_count": arcgis_feature_count,
                "broward_feature_count": broward_feature_count,
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
        selected_candidate = _find_explicit_candidate(candidates, selected_candidate_id)
        if selected_candidate is None:
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
        _, selected_polygon, selected_metadata = selected_candidate
        return selected_polygon, selected_metadata

    # A verified parcel that contains none of the mapped buildings is
    # contradictory evidence. Do not let distance heuristics auto-select a
    # neighboring structure; require an explicit user choice.
    if _parcel_requires_explicit_candidate_selection(parcel_metadata):
        raise HTTPException(
            status_code=409,
            detail={
                "code": "parcel_building_mismatch_confirmation_required",
                "message": "The verified address parcel does not contain any mapped building candidate. Review the outlines and explicitly select the correct building before roof analysis.",
                "candidate_count": len(candidates),
                "parcel_match": parcel_metadata,
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
        "tile_ids_used": used_tile_ids,
        "building_class_points": len(unique_points),
        "raw_building_class_points": raw_point_count,
        "duplicate_points_removed": raw_point_count - len(unique_points),
        "tiles_missing_vertical_units": tiles_missing_vertical_units,
        "vertical_unit_to_meters_factors": sorted(vertical_unit_factors),
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
    lidar_area = sum(facet["area_sqft"] for facet in facets)
    status = "lidar_facets" if facets else "footprint_only"
    # Edge classes and intersections are deliberately not inferred from a ground footprint.
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
