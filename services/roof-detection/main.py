from __future__ import annotations

import asyncio
import hashlib
import json
import math
import os
import re
import threading
import uuid
from pathlib import Path
from typing import Any, Callable
from time import monotonic, time as epoch_seconds

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
# Overflight demotion: a resampled ("supplemental") scan can lay a dense
# sheet of fill points at eave height across a roof it could not observe,
# and a near-flat plane fitted to that sheet is a strong RANSAC candidate
# — its inliers are numerous and its convex hull, bridged by the real
# slopes' eave bands, spans the whole building. But the sheet is not a
# roof surface: the building's real sloped planes pass ABOVE it over the
# ground it claims. A near-flat facet whose claim is majority-overflown
# by the adjoining sloped facets (the part of its polygon where a
# neighbour's plane is the higher one) is therefore dropped after hull
# resolution, and the completion passes tessellate its ground among the
# real facets along their intersection lines. A genuine flat section
# sits beyond its neighbours' eave lines, where their planes pass BELOW
# it, so it is not overflown and survives untouched; the neighbour
# restriction (the overflying facet must actually adjoin the flat one)
# keeps a distant slope's infinite plane extension from casting a vote.
FLAT_DEMOTE_MAX_RISE_PER_12 = float(os.getenv("FLAT_DEMOTE_MAX_RISE_PER_12", "1.0"))
FLAT_DEMOTE_MIN_OVERFLIGHT_SHARE = float(
    os.getenv("FLAT_DEMOTE_MIN_OVERFLIGHT_SHARE", "0.5")
)
FLAT_DEMOTE_NEIGHBOUR_M = float(os.getenv("FLAT_DEMOTE_NEIGHBOUR_M", "1.0"))
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
# Emission conditioning: the CRM drawing path (detectedFacetsToDrawing ->
# measureDrawing -> roofDrawingPdf) validates facet boundaries far more
# strictly than this service's own geometry passes do. Its response schema
# caps a boundary at 200 lat/lon entries and its drawing schema at 100
# points per plane; measureDrawing rejects facet pairs overlapping by
# more than 0.1 sq ft in plan; and its converter snaps cross-facet
# vertices within 1.0 ft of each other to their midpoint, which folds
# rings whose vertices sit closer than the snap distance without being
# the same corner. Densified hull rings (segmentize adds a vertex every
# metre), snap-pass fallbacks that keep pre-snap geometry, and
# near-but-not-exactly coincident junction vertices all violated one of
# those rules on real houses (Miramar's largest facet emitted 202
# boundary points; Annel's facets carried duplicate points at the
# converter's precision). _condition_polygons_for_emission therefore
# reworks the serialized boundary into drawing-ready geometry: valid
# simple rings, pairwise disjoint, junction vertices exactly shared,
# no edge shorter than the converter's snap distance, and at most
# EMISSION_MAX_RING_POINTS vertices per ring.
EMISSION_MAX_RING_POINTS = int(os.getenv("EMISSION_MAX_RING_POINTS", "96"))
EMISSION_MIN_EDGE_M = float(os.getenv("EMISSION_MIN_EDGE_M", "0.30"))
EMISSION_SHORT_EDGE_DEVIATION_M = float(
    os.getenv("EMISSION_SHORT_EDGE_DEVIATION_M", "0.03")
)
EMISSION_SNAP_TOLERANCE_M = 0.3048  # the CRM converter's 1.0 ft vertex snap
# Final disjointness margin: the last conditioning operation subtracts
# each facet against its neighbours' ground buffered by this much, so
# the hairline gap absorbs the centimetre-scale displacement the
# lat/lon round-trip (7 dp rounding, the converter's own projection
# constants) can add along a seam before measureDrawing measures it.
EMISSION_GAP_M = float(os.getenv("EMISSION_GAP_M", "0.02"))
CACHE_TTL_SECONDS = max(60, int(os.getenv("CACHE_TTL_SECONDS", "86400")))
MAX_RESPONSE_CACHE = 200
CANDIDATE_SEARCH_RADIUS_M = 80.0
_RESPONSE_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}
# --- Asynchronous analysis jobs -------------------------------------------
# A cold-cache analysis is dominated by USGS tile downloads (~180 MB at
# throttled per-connection speeds) and can run far longer than any HTTP
# request window on the free hosting tier — a synchronous POST dies at the
# platform's ~271 s wall before the download finishes. The jobs API splits
# submission from execution: POST /v1/roof/analyze/jobs returns 202 with a
# job id immediately, the analysis runs on a worker thread with its own
# event loop (so status polls stay responsive while the pipeline blocks on
# CPU fitting), and GET /v1/roof/analyze/jobs/{id} reports progress and,
# when complete, the exact payload the synchronous endpoint returns.
# Job state is deliberately in-memory only: the free tier has no durable
# disk, so a job lost to an instance restart cannot be recovered — instead
# it fails loudly (the id simply stops existing, GET answers 404
# job_not_found) and the CRM resubmits automatically. No human retries.
JOB_TTL_SECONDS = max(300, int(os.getenv("JOB_TTL_SECONDS", "1800")))
MAX_STORED_JOBS = max(10, int(os.getenv("MAX_STORED_JOBS", "100")))
MAX_CONCURRENT_JOBS = max(1, int(os.getenv("MAX_CONCURRENT_JOBS", "2")))
_JOBS: dict[str, dict[str, Any]] = {}
_JOBS_LOCK = threading.Lock()
_JOB_SEMAPHORE = threading.Semaphore(MAX_CONCURRENT_JOBS)
# Tile download acceleration: the USGS host (rockyweb) honours HTTP Range
# requests but throttles each connection, so a large tile is fetched as
# several byte ranges in parallel and reassembled. Any failure in the
# ranged path falls back to the original single-stream download.
TILE_DOWNLOAD_CHUNKS = max(1, int(os.getenv("TILE_DOWNLOAD_CHUNKS", "4")))
TILE_DOWNLOAD_RANGED_MIN_BYTES = max(
    1, int(float(os.getenv("TILE_DOWNLOAD_RANGED_MIN_MB", "16")) * 1_000_000)
)
# Tile fetch retries at the project-attempt level: _download_tile retries
# inside one call, but a failure that still escapes it (a throttle that
# outlasts the internal backoff, a FileNotFoundError from two concurrent
# jobs racing the same cache file) is transient, not evidence that the
# survey lacks coverage — so ensure_tile retries the whole fetch with
# backoff before a project attempt may call the tile failed.
ENSURE_TILE_ATTEMPTS = max(1, int(os.getenv("ENSURE_TILE_ATTEMPTS", "3")))
ENSURE_TILE_RETRY_DELAY_S = float(os.getenv("ENSURE_TILE_RETRY_DELAY_S", "15"))
ProgressReporter = Callable[[str, "str | None", "float | None"], None]

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
    # Optional user pin from the CRM measurement-order form. When a
    # street address is also supplied, the pin steers footprint
    # candidate search and auto-selection (the candidate containing,
    # else nearest to, the pin wins the point-based scoring) so moving
    # the pin to the correct building changes what gets measured. The
    # geocoded address point remains the response location. Ignored
    # for coordinates-only requests, where lat/lon already is the
    # point. Absent pin = the pre-existing behaviour, unchanged.
    pin_lat: float | None = Field(default=None, ge=-90, le=90)
    pin_lon: float | None = Field(default=None, ge=-180, le=180)
    # Optional multi-structure mode from the CRM measurement-order
    # form's "Include outbuilding" checkbox. When true, the pipeline
    # additionally identifies detached structures on the same property
    # (detached garage, shed, guest house — separate footprints near
    # the selected main building), measures each one with the same
    # LiDAR facet pipeline, and returns them in an additive
    # `structures` array. The top-level response always describes the
    # main structure exactly as before; with the flag off (the
    # default) the response is byte-identical to the historical one.
    include_outbuilding: bool = False

    @model_validator(mode="after")
    def validate_location(self):
        if not self.street_address and (self.lat is None or self.lon is None):
            raise ValueError("Provide street_address or both lat and lon.")
        if (self.lat is None) != (self.lon is None):
            raise ValueError("Latitude and longitude must be provided together.")
        if (self.pin_lat is None) != (self.pin_lon is None):
            raise ValueError("Pin latitude and longitude must be provided together.")
        return self


class LocateRequest(BaseModel):
    """Footprint lookup for the CRM measurement-order form's Locate
    button: a point (the browser-geocoded address point) and/or a
    street address. No LiDAR, no measurement — the response is the
    selected building footprint's centroid so the form's pin can sit
    on the house instead of on the geocoded street point."""

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
    if metadata.get("candidate_id"):
        fields["candidate_id"] = metadata["candidate_id"]
    if isinstance(metadata.get("selection"), dict):
        fields["selection"] = metadata["selection"]
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


# Multi-structure identification (detached garages, sheds, guest
# houses). A detached structure is a SEPARATE footprint standing on
# the same property as the selected main building: near it, not
# overlapping it, much smaller than it, and with no evidence it
# belongs to a different address. Attached additions share the main
# footprint polygon in every provider layer, so they are part of the
# main structure by construction and are never split off.
#
# The size rules are load-bearing, not decoration: in dense South
# Florida streets the neighbouring HOUSE stands 3–30 m from the
# subject house — closer than a backyard garage on a big lot — so
# distance alone cannot separate "detached garage" from "the
# neighbour's house". What separates them is scale: garages, sheds
# and guest houses are a fraction of the main house's footprint,
# while the neighbour's house is house-sized. (Verified live on
# 9201 SW 24th Terrace, Miami: four 2,500–3,200 sq ft neighbouring
# houses sat within 45 m of a 1,827 sq ft main house; the size
# rules reject all four, a genuine 600 sq ft garage passes.)
DETACHED_MAX_GAP_M = 45.0
DETACHED_MAX_CENTROID_M = 40.0
DETACHED_MAX_STRUCTURES = 4
DETACHED_OVERLAP_FRACTION = 0.10
DETACHED_MAX_AREA_FRACTION = 0.6
DETACHED_MAX_AREA_SQFT = 1500.0
# Provider tags that mark a footprint as a separate dwelling — never
# an outbuilding of the subject property, however close it stands.
DETACHED_DWELLING_TAGS = frozenset(
    {"house", "detached", "semidetached_house", "residential", "apartments", "bungalow", "terrace"}
)


def _polygon_gap_meters(first: Polygon, second: Polygon) -> float:
    """Edge-to-edge distance between two footprints, in metres."""
    center = first.representative_point()
    local = CRS.from_proj4(
        f"+proj=aeqd +lat_0={center.y} +lon_0={center.x} +datum=WGS84 +units=m +no_defs"
    )
    transformer = Transformer.from_crs("EPSG:4326", local, always_xy=True)

    def project(polygon: Polygon) -> Polygon:
        return Polygon([transformer.transform(x, y) for x, y in polygon.exterior.coords])

    return float(project(first).distance(project(second)))


def _centroid_distance_meters(first: Polygon, second: Polygon) -> float:
    """Distance between two footprints' centroids, in metres."""
    center = first.centroid
    local = CRS.from_proj4(
        f"+proj=aeqd +lat_0={center.y} +lon_0={center.x} +datum=WGS84 +units=m +no_defs"
    )
    transformer = Transformer.from_crs("EPSG:4326", local, always_xy=True)
    ax, ay = transformer.transform(center.x, center.y)
    bx, by = transformer.transform(second.centroid.x, second.centroid.y)
    return float(math.hypot(bx - ax, by - ay))


def _classify_detached_structures(
    main_polygon: Polygon,
    main_metadata: dict[str, Any],
    pool: list[tuple[float, Polygon, dict[str, Any]]],
    street_address: str | None,
) -> tuple[list[tuple[float, Polygon, dict[str, Any]]], list[dict[str, Any]]]:
    """Split the footprint candidate pool into detached structures of
    the main building's property versus everything else.

    Returns (accepted, audit): accepted holds (gap_m, polygon,
    metadata) sorted by gap to the main footprint, capped at
    DETACHED_MAX_STRUCTURES; audit records the decision and reasons
    for EVERY pool candidate so a classification can be reviewed
    after the fact. Pure geometry/metadata — no provider calls.
    """
    main_candidate_id = main_metadata.get("candidate_id")
    target_address_key = _normalize_street_address(street_address)
    main_area_sqft = float(main_metadata.get("area_sqft") or 0.0) or _polygon_area_sqft(
        main_polygon
    )
    accepted: list[tuple[float, Polygon, dict[str, Any]]] = []
    audit: list[dict[str, Any]] = []
    for _distance, polygon, meta in pool:
        candidate_id = meta.get("candidate_id")
        entry: dict[str, Any] = {
            "candidate_id": candidate_id,
            "provider": meta.get("provider"),
            "area_sqft": meta.get("area_sqft"),
        }
        if candidate_id == main_candidate_id:
            entry.update(decision="main", reasons=["selected as the main structure"])
            audit.append(entry)
            continue
        reasons: list[str] = []
        rejected: str | None = None
        # A second provider's rendering of the SAME building survives
        # the IoU dedupe when the two outlines differ enough; a real
        # detached structure never overlaps the main footprint.
        try:
            overlap = polygon.intersection(main_polygon).area
            smaller = min(polygon.area, main_polygon.area)
            overlap_fraction = overlap / smaller if smaller > 0 else 0.0
        except Exception:
            overlap_fraction = 0.0
        if overlap_fraction > DETACHED_OVERLAP_FRACTION:
            rejected = (
                f"overlaps the main footprint ({overlap_fraction:.0%} of the smaller "
                "outline) — same building from another source, not a detached structure"
            )
        gap_m = _polygon_gap_meters(main_polygon, polygon)
        entry["gap_to_main_m"] = round(gap_m, 2)
        if rejected is None and gap_m > DETACHED_MAX_GAP_M:
            rejected = (
                f"{gap_m:.1f} m from the main footprint exceeds the "
                f"{DETACHED_MAX_GAP_M:.0f} m same-property limit"
            )
        # Edge gap alone is not enough on wide lots: a wide main
        # house can sit within 45 m edge-to-edge of the NEXT street's
        # houses. A genuine outbuilding stands within the same lot,
        # so its centre stays near the main house's centre.
        centroid_m = _centroid_distance_meters(main_polygon, polygon)
        entry["centroid_to_main_m"] = round(centroid_m, 2)
        if rejected is None and centroid_m > DETACHED_MAX_CENTROID_M:
            rejected = (
                f"centre is {centroid_m:.1f} m from the main house's centre, beyond the "
                f"{DETACHED_MAX_CENTROID_M:.0f} m same-lot limit — a building on another lot"
            )
        candidate_area = float(meta.get("area_sqft") or 0.0)
        if rejected is None and (
            candidate_area > DETACHED_MAX_AREA_SQFT
            or candidate_area > DETACHED_MAX_AREA_FRACTION * main_area_sqft
        ):
            rejected = (
                f"footprint area {candidate_area:.0f} sq ft is house-sized (over the "
                f"{DETACHED_MAX_AREA_SQFT:.0f} sq ft outbuilding cap or "
                f"{DETACHED_MAX_AREA_FRACTION:.0%} of the main house's "
                f"{main_area_sqft:.0f} sq ft) — a neighbouring house, not an outbuilding"
            )
        tags = meta.get("building_tags") or {}
        if rejected is None:
            building_tag = str(tags.get("building") or "").strip().lower()
            if building_tag in DETACHED_DWELLING_TAGS:
                rejected = f"provider tags it as a separate dwelling (building={building_tag})"
        if rejected is None:
            # A footprint whose own recorded street address differs
            # from the requested address is the neighbour's building,
            # however close it stands.
            recorded_address = _normalize_street_address(tags.get("PROP_ADDR"))
            if recorded_address and target_address_key and recorded_address != target_address_key:
                rejected = "recorded street address differs from the requested address"
            elif recorded_address and target_address_key:
                reasons.append("recorded street address matches the requested address")
        if rejected is not None:
            entry.update(decision="rejected", reasons=[rejected])
            audit.append(entry)
            continue
        reasons.append(f"separate footprint {gap_m:.1f} m from the main structure")
        reasons.append(f"footprint area {candidate_area:.0f} sq ft")
        entry.update(decision="detached", reasons=reasons)
        audit.append(entry)
        accepted.append((gap_m, polygon, meta))
    accepted.sort(key=lambda row: (row[0], str(row[2].get("candidate_id"))))
    if len(accepted) > DETACHED_MAX_STRUCTURES:
        capped_ids = {row[2].get("candidate_id") for row in accepted[DETACHED_MAX_STRUCTURES:]}
        for entry in audit:
            if entry.get("candidate_id") in capped_ids and entry.get("decision") == "detached":
                entry.update(
                    decision="rejected",
                    reasons=[
                        f"beyond the {DETACHED_MAX_STRUCTURES} nearest detached structures cap"
                    ],
                )
        accepted = accepted[:DETACHED_MAX_STRUCTURES]
    return accepted, audit


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
        # Expose the full post-filter candidate pool to the analysis
        # layer (internal key, never serialised into a response) so
        # multi-structure runs can identify detached buildings on the
        # same property. The pool is captured before any address-match
        # narrowing: narrowing decides the MAIN building, while the
        # pool is the evidence for what else stands on the property.
        selected_metadata["_candidate_pool"] = list(candidates)
        return selected_polygon, selected_metadata

    # Hands-off selection (Fredy's rule: address in, report out, no
    # manual steps, no exceptions). The flow never stops to ask a
    # person which building is meant: every candidate is scored on
    # the available evidence — address-point containment, the
    # provider's own address attribute, parcel membership, distance
    # from the geocoded point, footprint-area plausibility — and the
    # best score wins, deterministically (score, then distance, then
    # area, then candidate id). The basis is recorded on the chosen
    # candidate's metadata and surfaced in the response, so the pick
    # is auditable; an explicit footprint_candidate_id still
    # overrides it. A single exact address-attribute match
    # short-circuits the pool, as before.
    # Multi-structure evidence pool: every eligible candidate that
    # survived area/distance filtering, deduplication and parcel
    # narrowing, captured BEFORE the address-attribute narrowing below
    # (see the explicit-selection path for the rationale). Attached to
    # the winning candidate's metadata under an internal key; the
    # analysis layer pops it and it never reaches a response.
    candidate_pool = list(candidates)

    exact_address_matches = [
        candidate for candidate in candidates
        if candidate[2].get("address_attribute_match") is True
    ]
    if len(exact_address_matches) == 1:
        candidates = exact_address_matches
    elif len(exact_address_matches) > 1:
        candidates = exact_address_matches

    def _selection_score(
        candidate: tuple[float, Polygon, dict[str, Any]],
    ) -> tuple[float, list[str]]:
        distance_m, _polygon, meta = candidate
        score = 0.0
        basis: list[str] = []
        if meta.get("address_point_inside_footprint"):
            score += 100.0
            basis.append("address point inside footprint")
        if meta.get("address_attribute_match"):
            score += 80.0
            basis.append("provider address attribute match")
        parcel = meta.get("parcel_match")
        if isinstance(parcel, dict) and parcel.get("status") == "matched":
            score += 40.0
            basis.append("parcel membership")
        score -= min(distance_m, 100.0)
        basis.append(f"{distance_m:.1f} m from the address point")
        area = float(meta.get("area_sqft") or 0.0)
        if 800.0 <= area <= 6000.0:
            score += 5.0
            basis.append("typical residential footprint area")
        return score, basis

    scored = sorted(
        candidates,
        key=lambda row: (
            -_selection_score(row)[0],
            row[0],
            -float(row[2].get("area_sqft") or 0.0),
            str(row[2].get("candidate_id")),
        ),
    )
    _, polygon, metadata = scored[0]
    best_score, best_basis = _selection_score(scored[0])
    metadata["_candidate_pool"] = candidate_pool
    metadata["selection"] = {
        "method": "automatic_score",
        "score": round(best_score, 2),
        "basis": best_basis,
        "candidates_considered": len(scored),
        "runner_up_candidate_id": (
            scored[1][2].get("candidate_id") if len(scored) > 1 else None
        ),
    }
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
    exclude: Any = None,
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
    if exclude is not None:
        # A demoted facet's ground (see _demote_overflown_flat_facets)
        # is not overhang either: growth must not route through it.
        target = target.difference(exclude)
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


def _complete_outline(
    records: list[dict[str, Any]],
    footprint: Polygon,
    points: np.ndarray | None = None,
    exclude: Any = None,
) -> None:
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

    Evidence discipline: a county footprint can be drawn looser than
    the roof it traces (a slab or patio the survey swept into the
    building polygon). When the caller supplies the fitting pool, a
    bare component is tiled only if the scan actually saw the roof
    there — a pool point inside the component, or one within
    COVERAGE_GAP_ADJACENCY_M of it that an adjacent facet's plane
    predicts within COVERAGE_EVIDENCE_RESIDUAL_M. A component with no
    supporting return at all stays unclaimed rather than inventing
    roof the point cloud never saw. Callers without a pool (unit
    tests of the tiling itself) keep the unconditional behaviour.
    """
    from shapely.ops import unary_union

    if not records:
        return
    covered = unary_union([record["polygon"] for record in records])
    uncovered = footprint.difference(covered)
    if exclude is not None:
        # Ground a demoted facet claimed is a decided non-surface (see
        # _demote_overflown_flat_facets): never tile it back in here.
        uncovered = uncovered.difference(exclude)
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

    def evidenced(component: Polygon, owners: list[dict[str, Any]]) -> bool:
        if points is None or len(points) == 0:
            return True
        min_x, min_y, max_x, max_y = component.bounds
        pad = COVERAGE_GAP_ADJACENCY_M
        near = points[
            (points[:, 0] >= min_x - pad) & (points[:, 0] <= max_x + pad)
            & (points[:, 1] >= min_y - pad) & (points[:, 1] <= max_y + pad)
        ]
        for point in near:
            pt = Point(float(point[0]), float(point[1]))
            if component.covers(pt):
                return True
            if component.distance(pt) <= COVERAGE_GAP_ADJACENCY_M and any(
                abs(
                    float(point[2])
                    - (
                        owner["a"] * float(point[0])
                        + owner["b"] * float(point[1])
                        + owner["c"]
                    )
                )
                <= COVERAGE_EVIDENCE_RESIDUAL_M
                for owner in owners
            ):
                return True
        return False

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
        if not evidenced(component, owners):
            continue
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


def _ring_coords(polygon: Polygon) -> list[tuple[float, float]]:
    """Exterior ring vertices without the duplicated closing point."""
    if polygon.is_empty or polygon.geom_type != "Polygon":
        return []
    return [(float(x), float(y)) for x, y in polygon.exterior.coords][:-1]


def _largest_polygon_part(geometry: Any) -> Polygon | None:
    parts = _polygon_parts(geometry)
    if not parts:
        return None
    return max(parts, key=lambda part: part.area)


def _repaired_polygon(polygon: Polygon) -> Polygon:
    """The polygon itself when it is one valid simple ring, else its
    largest valid part (or an empty polygon when nothing survives)."""
    if polygon.geom_type == "Polygon" and polygon.is_valid and not polygon.is_empty:
        return polygon
    repaired = _largest_polygon_part(make_valid(polygon))
    return repaired if repaired is not None else Polygon()


def _resolve_overlaps_largest_first(
    polygons: list[Polygon],
    gap_m: float = 0.0,
) -> list[Polygon]:
    """Subtract already-claimed ground from each polygon, largest facet
    first — the same priority the resolution pass uses — with no
    keep-the-overlap fallback: emitted facets must be pairwise disjoint
    or the CRM's measureDrawing rejects the drawing outright. With
    `gap_m`, the claimed ground is buffered by that margin first, so
    the resolved facets end up separated by a hairline gap instead of
    merely touching."""
    from shapely.ops import unary_union

    order = sorted(range(len(polygons)), key=lambda k: -polygons[k].area)
    claimed: Any = None
    resolved: list[Polygon] = list(polygons)
    for index in order:
        polygon = polygons[index]
        if claimed is not None:
            boundary = claimed.buffer(gap_m) if gap_m > 0 else claimed
            if polygon.intersects(boundary):
                remainder = _largest_polygon_part(polygon.difference(boundary))
                if gap_m > 0 and remainder is not None:
                    # The gap is a hairline, not a scalpel: where the
                    # buffered subtraction pinches a narrow facet in two
                    # and the largest-piece rule would amputate a whole
                    # lobe (Maria's valley facet lost a quarter of its
                    # area exactly this way), fall back to the
                    # unbuffered subtraction — touching neighbours are
                    # acceptable downstream; only overlap is rejected.
                    plain = _largest_polygon_part(polygon.difference(claimed))
                    if plain is not None and remainder.area < 0.98 * plain.area:
                        remainder = plain
                polygon = remainder if remainder is not None else Polygon()
        resolved[index] = polygon
        if not polygon.is_empty:
            claimed = polygon if claimed is None else unary_union([claimed, polygon])
    return resolved


def _remove_cheapest_vertices(
    ring: list[tuple[float, float]], cap: int
) -> list[tuple[float, float]]:
    """Remove vertices until the ring holds at most `cap` of them, each
    time removing the vertex whose triangle with its neighbours is
    smallest — the area-cheapest way to thin a dense ring."""
    ring = list(ring)
    while len(ring) > cap and len(ring) > 4:
        count = len(ring)
        worst_index, worst_area = -1, math.inf
        for i in range(count):
            prev = ring[(i - 1) % count]
            point = ring[i]
            nxt = ring[(i + 1) % count]
            area = abs(
                (point[0] - prev[0]) * (nxt[1] - prev[1])
                - (point[1] - prev[1]) * (nxt[0] - prev[0])
            ) / 2.0
            if area < worst_area:
                worst_area, worst_index = area, i
        del ring[worst_index]
    return ring


def _sparsify_ring(polygon: Polygon) -> Polygon:
    """Reduce a facet ring to drawing-ready density without moving its
    area: drop consecutive near-duplicates; when the ring exceeds the
    vertex cap, simplify with the smallest Douglas-Peucker tolerance
    that satisfies the cap while costing at most 1% of the facet's area
    (a larger tolerance can plunge a jagged small-facet ring from a
    hundred points to a dozen and take real roof with it — Maria's
    largest facet lost a sixth of its plan area that way); if no
    tolerance qualifies, thin greedily by cheapest vertex instead.
    Short edges are removed only when their far vertex is nearly
    collinear with its neighbours, so cleanup cannot erode a boundary
    corner by corner."""
    ring = _ring_coords(polygon)
    deduped: list[tuple[float, float]] = []
    for point in ring:
        if not deduped or math.hypot(
            point[0] - deduped[-1][0], point[1] - deduped[-1][1]
        ) > 0.01:
            deduped.append(point)
    if (
        len(deduped) > 1
        and math.hypot(
            deduped[0][0] - deduped[-1][0], deduped[0][1] - deduped[-1][1]
        )
        <= 0.01
    ):
        deduped.pop()
    if len(deduped) < 3:
        return polygon
    base = Polygon(deduped)
    if not base.is_valid:
        base = _repaired_polygon(base)
    if base.is_empty:
        return polygon
    base_area = base.area
    result = base
    if len(deduped) > EMISSION_MAX_RING_POINTS:
        result = None
        for tolerance in (0.02, 0.04, 0.08, 0.16, 0.32):
            candidate = _largest_polygon_part(
                base.simplify(tolerance, preserve_topology=True)
            )
            if (
                candidate is not None
                and not candidate.is_empty
                and len(_ring_coords(candidate)) <= EMISSION_MAX_RING_POINTS
                and candidate.area >= 0.99 * base_area
            ):
                result = candidate
                break
        if result is None:
            thinned = _remove_cheapest_vertices(deduped, EMISSION_MAX_RING_POINTS)
            candidate = Polygon(thinned)
            result = candidate if not candidate.is_empty else _repaired_polygon(candidate)
            if result.is_empty:
                result = base
    ring = _ring_coords(result)
    # Short-edge cleanup, near-collinear vertices only: an edge shorter
    # than the converter's snap distance can be folded onto its
    # neighbours by that snap, but only a vertex that barely deviates
    # from its neighbours' chord may be dropped for it.
    changed = True
    while changed and len(ring) > 4:
        changed = False
        count = len(ring)
        for i in range(count):
            a = ring[i]
            b = ring[(i + 1) % count]
            if math.hypot(b[0] - a[0], b[1] - a[1]) >= EMISSION_MIN_EDGE_M:
                continue
            prev = ring[(i - 1) % count]
            nxt = ring[(i + 2) % count]
            chord = (nxt[0] - prev[0], nxt[1] - prev[1])
            chord_len = math.hypot(*chord)
            deviation = (
                abs(chord[0] * (b[1] - prev[1]) - chord[1] * (b[0] - prev[0]))
                / chord_len
                if chord_len > 1e-9
                else 0.0
            )
            if deviation <= EMISSION_SHORT_EDGE_DEVIATION_M:
                del ring[(i + 1) % count]
                changed = True
                break
    if len(ring) > EMISSION_MAX_RING_POINTS:
        ring = _remove_cheapest_vertices(ring, EMISSION_MAX_RING_POINTS)
    rebuilt = Polygon(ring)
    if rebuilt.is_empty or not rebuilt.is_valid:
        rebuilt = _repaired_polygon(rebuilt)
    return rebuilt if not rebuilt.is_empty else result


def _conflate_junction_vertices(
    polygons: list[Polygon],
) -> list[Polygon]:
    """Move cross-facet vertices that lie within the CRM converter's
    snap distance of each other to their cluster centroid, so junctions
    the facets share are EXACTLY coincident and the converter's snap —
    any variant of it — moves nothing there.

    Clusters are DIAMETER-CAPPED: two clusters merge only when every
    cross pair stays within the snap distance, so a cluster never spans
    more than one physical corner. Plain transitive clustering chains
    along a shared seam — each seam vertex within reach of the next —
    and collapses both facets' seam sides onto a single centroid
    (Francisco's largest facet lost its whole ring that way). Pairs are
    considered closest-first, so the most confident matches claim their
    vertices before looser ones are tested against the cap. A facet
    whose rebuilt ring comes back empty or gutted keeps its
    pre-conflation polygon."""
    rings = [_ring_coords(polygon) for polygon in polygons]
    nodes = [
        (facet_index, vertex_index)
        for facet_index, ring in enumerate(rings)
        for vertex_index in range(len(ring))
    ]
    if not nodes:
        return polygons
    pairs: list[tuple[float, tuple[int, int], tuple[int, int]]] = []
    for a in range(len(nodes)):
        for b in range(a + 1, len(nodes)):
            first, second = nodes[a], nodes[b]
            if first[0] == second[0]:
                continue
            p = rings[first[0]][first[1]]
            q = rings[second[0]][second[1]]
            distance = math.hypot(p[0] - q[0], p[1] - q[1])
            if distance <= EMISSION_SNAP_TOLERANCE_M:
                pairs.append((distance, first, second))
    pairs.sort(key=lambda item: item[0])
    parent = {node: node for node in nodes}
    members_of: dict[tuple[int, int], list[tuple[int, int]]] = {
        node: [node] for node in nodes
    }

    def find(node: tuple[int, int]) -> tuple[int, int]:
        while parent[node] != node:
            parent[node] = parent[parent[node]]
            node = parent[node]
        return node

    for _distance, first, second in pairs:
        root_a, root_b = find(first), find(second)
        if root_a == root_b:
            continue
        merged = members_of[root_a] + members_of[root_b]
        if all(
            math.hypot(
                rings[f1][v1][0] - rings[f2][v2][0],
                rings[f1][v1][1] - rings[f2][v2][1],
            )
            <= EMISSION_SNAP_TOLERANCE_M
            for f1, v1 in merged
            for f2, v2 in merged
        ):
            parent[root_a] = root_b
            members_of[root_b] = merged
            del members_of[root_a]
    for members in members_of.values():
        if len(members) < 2:
            continue
        centroid_x = sum(rings[f][v][0] for f, v in members) / len(members)
        centroid_y = sum(rings[f][v][1] for f, v in members) / len(members)
        for f, v in members:
            rings[f][v] = (centroid_x, centroid_y)
    rebuilt: list[Polygon] = []
    for index, ring in enumerate(rings):
        deduped = []
        for point in ring:
            if not deduped or math.hypot(
                point[0] - deduped[-1][0], point[1] - deduped[-1][1]
            ) > 0.01:
                deduped.append(point)
        if (
            len(deduped) > 1
            and math.hypot(
                deduped[0][0] - deduped[-1][0], deduped[0][1] - deduped[-1][1]
            )
            <= 0.01
        ):
            deduped.pop()
        candidate = (
            _repaired_polygon(Polygon(deduped)) if len(deduped) >= 3 else Polygon()
        )
        original = polygons[index]
        if candidate.is_empty or candidate.area < 0.75 * original.area:
            candidate = original
        rebuilt.append(candidate)
    return rebuilt


def _tidy_ring(polygon: Polygon) -> Polygon:
    """Drop consecutive vertices closer than 2 cm — the overlap
    subtraction's cut points can land on top of an existing vertex, and
    after the millimetre rounding at emission (and the lat/lon grid
    beyond it) such a pair serializes as a duplicate point, which the
    CRM converter rejects outright."""
    ring = _ring_coords(polygon)
    if len(ring) < 3:
        return polygon
    deduped: list[tuple[float, float]] = []
    for point in ring:
        if not deduped or math.hypot(
            point[0] - deduped[-1][0], point[1] - deduped[-1][1]
        ) > 0.02:
            deduped.append(point)
    if (
        len(deduped) > 1
        and math.hypot(
            deduped[0][0] - deduped[-1][0], deduped[0][1] - deduped[-1][1]
        )
        <= 0.02
    ):
        deduped.pop()
    if len(deduped) < 3 or len(deduped) == len(ring):
        return polygon
    rebuilt = Polygon(deduped)
    if rebuilt.is_empty or not rebuilt.is_valid:
        rebuilt = _repaired_polygon(rebuilt)
    return rebuilt if not rebuilt.is_empty else polygon


def _condition_polygons_for_emission(
    polygons: list[Polygon],
    exact_tiling: bool = False,
) -> list[Polygon]:
    """Rework fitted facet polygons into geometry the CRM drawing path
    accepts as-is (see the EMISSION_* constants): valid disjoint rings
    under the drawing schema's vertex cap, junction vertices exactly
    shared, no edge short enough for the converter's vertex snap to
    fold. This runs on the SERIALIZED boundary only, after the
    service's areas and edge totals have been computed from the fitted
    polygons — conditioning is a rendering of the measured facets for
    the drawing consumer, never a re-measurement: the reported numbers
    stay the fitter's own. (An earlier design conditioned the fitted
    polygons themselves; every conditioning variant then moved some
    house's validated area or edge split — Maria's fragmented facets
    three times in three variants.) The overlap subtraction may
    legitimately take a large share of a facet that was double-counted
    against a bigger neighbour — disjointness is a hard requirement,
    not a fidelity loss — so the per-facet guard only rejects a
    conditioned polygon that is empty, invalid, grown past its fitted
    area, or trimmed below the pipeline's own minimum remaining
    fraction (MIN_FACET_REMAINING_FRACTION): those are the signatures
    of conditioning destroying a facet, and such a facet keeps its
    fitted ring instead."""
    if not polygons:
        return polygons
    if exact_tiling:
        # The input is the surgery's exact tiling: condition it
        # without breaking seam coincidence (see
        # _condition_tiling_for_emission). If that cannot be done,
        # fall through to the legacy passes below — today's behaviour
        # for every house — rather than ship no drawing at all.
        tiling = _condition_tiling_for_emission(polygons)
        if tiling is not None:
            return tiling
    originals = list(polygons)
    # A single pass, in a fixed order — deliberately NOT a loop.
    # Sparsify and conflate first (they only move or drop vertices),
    # then decide disjointness LAST with one largest-first subtraction:
    # conflation moves vertices, so any subtraction done before it can
    # be undone by it. An earlier looped design re-ran the subtraction
    # after every conflation; on Maria's fragmented facets each pass
    # treated the previous pass's centroid drift as new overlap and cut
    # again, eroding one facet by more than a quarter of its area over
    # three cycles. One pass leaves the facets separated by the
    # EMISSION_GAP_M hairline, and a ring tidy then removes any
    # near-duplicate consecutive vertices the cut points left behind.
    conditioned = [_repaired_polygon(polygon) for polygon in originals]
    conditioned = [
        _sparsify_ring(polygon) if not polygon.is_empty else polygon
        for polygon in conditioned
    ]
    conditioned = _conflate_junction_vertices(conditioned)
    conditioned = [_repaired_polygon(polygon) for polygon in conditioned]
    conditioned = _resolve_overlaps_largest_first(conditioned, gap_m=EMISSION_GAP_M)
    conditioned = [
        _tidy_ring(_repaired_polygon(polygon)) for polygon in conditioned
    ]
    result: list[Polygon] = []
    for index, original in enumerate(originals):
        candidate = conditioned[index]
        if (
            candidate.is_empty
            or not candidate.is_valid
            or candidate.area < MIN_FACET_REMAINING_FRACTION * original.area - 1e-9
            or candidate.area > 1.10 * original.area + 1e-9
        ):
            result.append(original)
        else:
            result.append(candidate)
    return result


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


def _overflight_region(
    polygon: Polygon, flat: dict[str, Any], other: dict[str, Any]
) -> Polygon | None:
    """The part of `polygon` where `other`'s plane is the higher one:
    the half-plane beyond the two planes' intersection line, on the side
    where the other plane has risen above the flat one. None when the
    other plane never rises above the flat one over the polygon (the
    flat surface is the top surface there — a genuine flat section
    beyond the other's eave line)."""
    da = float(other["a"]) - float(flat["a"])
    db = float(other["b"]) - float(flat["b"])
    dc = float(other["c"]) - float(flat["c"])
    norm = math.hypot(da, db)
    if norm <= 1e-9:
        # Parallel planes: the higher one overflies everywhere or nowhere.
        return polygon if dc > 0 else None
    min_x, min_y, max_x, max_y = polygon.bounds
    span = math.hypot(max_x - min_x, max_y - min_y) + 10.0
    ux, uy = -db / norm, da / norm
    nx, ny = da / norm, db / norm
    px, py = -dc * da / (norm * norm), -dc * db / (norm * norm)
    half_plane = Polygon([
        (px - span * ux, py - span * uy),
        (px + span * ux, py + span * uy),
        (px + span * ux + span * nx, py + span * uy + span * ny),
        (px - span * ux + span * nx, py - span * uy + span * ny),
    ])
    region = polygon.intersection(half_plane)
    return None if region.is_empty else region


def _demote_overflown_flat_facets(
    records: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], Any]:
    """Drop near-flat facets whose claim is majority-overflown by the
    sloped facets adjoining them (see FLAT_DEMOTE_MAX_RISE_PER_12).

    The overflown share of a flat facet is the union over its sloped
    neighbours of the region where the neighbour's plane is the higher
    one. A filled plateau at eave height is overflown over the whole
    span between the real slopes' eave lines — a 100% share — while a
    genuine flat section, sitting where its neighbours' planes pass
    below it, keeps a share near zero. The drop is all-or-nothing at
    the majority threshold: a facet that is mostly another surface's
    underside is not a surface at all, and the completion passes that
    follow reassign its ground to the real facets; a facet below the
    threshold is left exactly as fitted.

    Returns the surviving records and the union of the dropped facets'
    polygons (None when nothing was dropped). The dropped region is a
    decided non-surface: the evidence-based coverage pass may still
    grow real facets into parts of it their own points support, but
    the unconditional passes (outline completion, ring growth) must
    not silently re-annex the same ground under a neighbour's name —
    callers pass the region to them as an exclusion.
    """
    from shapely.ops import unary_union

    sloped = [
        record
        for record in records
        if float(record["pitch_rise"]) > FLAT_DEMOTE_MAX_RISE_PER_12
    ]
    if not sloped:
        return records, None
    kept: list[dict[str, Any]] = []
    dropped: list[Polygon] = []
    for record in records:
        if float(record["pitch_rise"]) > FLAT_DEMOTE_MAX_RISE_PER_12:
            kept.append(record)
            continue
        polygon = record["polygon"]
        regions = [
            region
            for other in sloped
            if other["polygon"].distance(polygon) <= FLAT_DEMOTE_NEIGHBOUR_M
            for region in [_overflight_region(polygon, record, other)]
            if region is not None
        ]
        if regions and polygon.area > 0:
            overflown = unary_union(regions).area
            if overflown >= FLAT_DEMOTE_MIN_OVERFLIGHT_SHARE * polygon.area:
                dropped.append(polygon)
                continue
        kept.append(record)
    return kept, (unary_union(dropped) if dropped else None)


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

    # A near-flat candidate fitted to a resampled scan's fill sheet can
    # hold a hull spanning the whole building; drop it when the real
    # sloped facets adjoining it pass above the majority of its claim
    # (see _demote_overflown_flat_facets). This runs before coverage
    # completion, so the freed ground is tessellated among the real
    # facets by the evidenced passes below, and before pair
    # classification, so no seam verdict ever involves the fill plane.
    # The dropped region travels on as an exclusion: outline
    # completion and ring growth must not re-annex it unconditionally.
    resolved, demoted_region = _demote_overflown_flat_facets(resolved)

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
        _complete_outline(resolved, footprint, points, exclude=demoted_region)

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
            resolved,
            footprint,
            ring_points,
            protected_zones=valley_zones,
            exclude=demoted_region,
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
    valley. Unshared boundary is perimeter, split by _perimeter_edge_class:
    segments the facet drains across are eaves, segments the downslope runs
    along without draining across are rakes. Lengths are true 3D lengths on
    the facet planes, in feet.

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
                nx, ny = _outward_normal(
                    polygons[i], (x0 + x1) / 2.0, (y0 + y1) / 2.0, ux, uy
                )
                totals[_perimeter_edge_class(a, b, ux, uy, nx, ny)] += length_ft

    return {key: round(value, 1) for key, value in totals.items()}


def _drawing_outline(
    footprint: Polygon,
    fitted_polygons: list[Polygon],
    footprint_provider: str | None,
) -> Polygon:
    """The roof's outer boundary for the drawing: the footprint itself
    for roof-outline providers (their polygon IS the roof outline);
    for wall-outline providers, the footprint offset outward by the
    eave overhang. The offset distance is solved so the offset
    outline's area matches the fitted facets' union area — the
    fitter's own evidence of how far the roof extends past the walls
    — which keeps the drawing's facet areas in line with the fitted
    ones. The offset keeps the footprint's own straight edges (mitre
    joins), so the drawing's perimeter is the survey geometry a
    roofer would trace, at the fitted eave line."""
    if footprint_provider in ROOF_OUTLINE_PROVIDERS:
        return footprint
    from shapely.geometry import JOIN_STYLE
    from shapely.ops import unary_union

    union = unary_union([p for p in fitted_polygons if not p.is_empty])
    target = union.area

    def offset(distance: float) -> Polygon | None:
        buffered = footprint.buffer(
            distance, join_style=JOIN_STYLE.mitre, mitre_limit=3.0
        )
        largest = _largest_polygon_part(buffered)
        if largest is None or not largest.is_valid:
            largest = _largest_polygon_part(footprint.buffer(distance))
        return largest

    low, high = 0.3, OVERHANG_RING_M
    best = offset(low)
    if best is None:
        return footprint
    if best.area < target:
        # Bisect for the distance whose outline matches the fitted
        # union's area (buffer area grows monotonically with distance).
        for _ in range(8):
            mid = (low + high) / 2
            candidate = offset(mid)
            if candidate is None:
                break
            best = candidate
            if candidate.area < target:
                low = mid
            else:
                high = mid
    return best

def _partition_facets_to_outline(
    fitted_polygons: list[Polygon], outline: Polygon
) -> list[Polygon]:
    """Tile the drawing outline with the fitted facets: clip each
    facet to the outline, resolve overlaps largest-first, then fill
    every remaining gap of the outline with the facet it borders
    longest (the strip a hull under-read along an eave belongs to the
    facet behind that eave). The result covers the outline exactly —
    no gaps, no overlaps, no hull overshoot past the eave line."""
    from shapely.ops import unary_union

    clipped: list[Polygon] = []
    for polygon in fitted_polygons:
        if polygon.is_empty or not polygon.is_valid:
            clipped.append(Polygon())
            continue
        region = _largest_polygon_part(polygon.intersection(outline))
        clipped.append(region if region is not None else Polygon())
    resolved = _resolve_overlaps_largest_first(clipped, gap_m=0.0)
    covered = unary_union([p for p in resolved if not p.is_empty])
    gap = outline.difference(covered)
    pieces = sorted(_polygon_parts(gap), key=lambda part: -part.area)
    for piece in pieces:
        best_index = -1
        best_contact = 0.0
        for index, region in enumerate(resolved):
            if region.is_empty:
                continue
            contact = piece.intersection(region.buffer(0.02)).area / 0.02
            if contact > best_contact:
                best_contact = contact
                best_index = index
        if best_index < 0:
            # No bordering facet (an island gap): nearest facet wins.
            best_distance = math.inf
            for index, region in enumerate(resolved):
                if region.is_empty:
                    continue
                distance = piece.centroid.distance(region)
                if distance < best_distance:
                    best_distance = distance
                    best_index = index
        if best_index < 0:
            continue
        merged = _largest_polygon_part(
            unary_union([resolved[best_index], piece])
        )
        if merged is not None:
            resolved[best_index] = merged
    return resolved


# ---------------------------------------------------------------------
# Drawing surgery (Phase 2): rebuild the partition's seams from the
# fitted planes themselves. Ports the validated Phase 1 prototype
# (boundary-graph surgery) into the drawing path.
#
# Diagnosis in one paragraph: the fitter derives each facet's region
# from the convex hull of its RANSAC inlier cluster, so neighbouring
# facets own two different polylines for what is physically one edge.
# The partition tiles those hulls to the outline, but the seams stay
# hull traces — wobbly, doubled or orphan lines in the sketch. A hip,
# valley or ridge IS the intersection line of the two fitted planes,
# and an eave/rake is a fitted plane clipped by the outline: both are
# exact geometry the pipeline already has.
#
# Construction: node the partition tiling into a planar boundary
# graph; each maximal chain between two junctions separates either
# two facets or a facet and the outside. A chain separating facets
# i and j is replaced by the single segment of the pair's true
# intersection line between its two junctions, and each junction
# moves to the least-squares point of the lines meeting there
# (clamped). Guards keep a chain's polyline when its junctions sit
# more than 1.25 m from the pair's line or the chord deviates more
# than 2.5 m from the drawn chain (that seam's planes disagree with
# its territory — a segmentation symptom, not a geometry one). Faces
# are recovered by polygonizing the rebuilt graph, so the tiling
# stays exact and every shared edge is one straight segment on the
# true line in both facets BY CONSTRUCTION. A guarded veto ladder
# (worst chain vetoed, then smaller clamps) protects small facets
# from amputation and the house from divergent-seam regressions;
# on any structural doubt the whole house falls back to the plain
# partition tiling. Micro-segment cleanup (< 0.15 m) runs on the
# shared graph before emission — NEVER per ring: dropping vertices
# ring-by-ring breaks seam coincidence (the two sides of one seam
# simplify against different chords and drift apart, proven in
# Phase 1). Perimeter edges are the outline's own straight segments.
#
# Phase 5 (labelled tilings only): the DSM labelling's boundaries
# are residual-competition raster paths, so the snap guards above —
# calibrated on hull tilings, whose chains hug the pair's line by
# construction — refuse most of them: the chain's junctions sit
# metres off the pairwise line (residual boundaries meet where the
# raster regions happen to touch, not at the planes' triple point;
# near-parallel pairs extrapolate their line tens of metres away),
# and parallel pairs have no line at all. The refused chains would
# ship their raw raster staircases. So on the labelled path, a
# refused seam chain is straightened on the same shared graph: it
# is drawn as one segment between its junctions, with a
# total-least-squares line through the chain's own vertices guiding
# the junction solve — the segment follows the boundary the
# evidence drew, minus the steps, instead of an extrapolated plane
# line the territory never agreed with. The attempt guards and the
# veto ladder arbitrate exactly as for snapped chains: a
# straightened chain whose segment breaks the rebuild (lost facet,
# area drift, phantom adjacency, divergent regression) is vetoed
# back to its drawn trace, per chain, never per house.
# ---------------------------------------------------------------------

_SURGERY_ADJACENCY_M = 1.5        # hulls closer than this are data-adjacent
_SURGERY_CHAIN_SNAP_MAX_M = 1.25  # a seam's junctions must sit this
                                  # close to the pair's line to snap
_SURGERY_JUNCTION_CLAMP_M = 1.5   # a junction never moves further
_SURGERY_CHAIN_HAUSDORFF_MAX_M = 2.5
_SURGERY_MICRO_SEGMENT_M = 0.15   # graph-level micro-segment cleanup
_SURGERY_STRAIGHTEN_MIN_CHORD_RATIO = 0.5  # a labelled chain whose
                                  # chord spans less than half its
                                  # traced length doubles back on
                                  # itself and keeps its trace
_SURGERY_STRAIGHTEN_SPLIT_MIN_DEV_M = 0.5  # a bend sharper than this
                                  # is a real corner, not raster
                                  # noise: split the chain there
_SURGERY_STRAIGHTEN_MAX_DEV_M = 1.25      # a straightened piece may
                                  # deviate from its chord by at
                                  # most this (the snap guards'
                                  # own endpoint tolerance): a
                                  # longer bow is split, not chorded,
                                  # so its segment cannot amputate
                                  # the facet it bows around
_SURGERY_STRAIGHTEN_MAX_SPLIT_DEPTH = 2    # at most 4 straightened
                                  # pieces per labelled chain
_GRAPH_MIN_SEAM_M = 0.5           # shorter pair chains are corner noise
_FT_PER_M = 3.280839895


def _plane_intersection_line(
    first: tuple[float, float, float],
    second: tuple[float, float, float],
) -> tuple[float, float, float] | None:
    """(la, lb, lc) with la*x + lb*y + lc = 0 — the plan-view trace of
    two planes' intersection line; None for parallel planes."""
    la = first[0] - second[0]
    lb = first[1] - second[1]
    lc = first[2] - second[2]
    if math.hypot(la, lb) <= 1e-9:
        return None
    return la, lb, lc


def _tls_line(
    verts: list[tuple[float, float]],
) -> tuple[float, float, float] | None:
    """Total-least-squares line through a chain's vertices, in the
    (la, lb, lc) form of _plane_intersection_line: the line
    minimising the sum of squared perpendicular distances to the
    vertices. One trimming pass — vertices deviating more than
    three times the median deviation are dropped and the line is
    refit — keeps a single stray raster vertex from rotating the
    fit. None when the vertices determine no line: fewer than two
    distinct points, or a near-isotropic scatter (a blob loop or an
    L-bend, whose principal axis is meaningless — such a chain has
    no single trend to straighten onto)."""
    pts = np.asarray(verts, dtype=float)
    if len(pts) < 2:
        return None

    def fit(sample: np.ndarray) -> tuple[float, float, float] | None:
        centre = sample.mean(axis=0)
        centred = sample - centre
        cov = centred.T @ centred
        eigvals, eigvecs = np.linalg.eigh(cov)
        if eigvals[-1] <= 1e-12:
            return None
        if eigvals[0] > 0.25 * eigvals[-1]:
            return None
        nx, ny = eigvecs[:, 0]
        return (
            float(nx),
            float(ny),
            float(-(nx * centre[0] + ny * centre[1])),
        )

    line = fit(pts)
    if line is None or len(pts) < 4:
        return line
    la, lb, lc = line
    norm = math.hypot(la, lb)
    devs = np.abs(la * pts[:, 0] + lb * pts[:, 1] + lc) / norm
    median = float(np.median(devs))
    keep = devs <= 3.0 * median
    if keep.all() or int(keep.sum()) < 2:
        return line
    return fit(pts[keep]) or line


def _straighten_chain_pieces(
    chain: dict[str, Any],
) -> list[dict[str, Any]] | None:
    """Phase 5: break a snap-refused labelled seam chain into pieces
    that can each ship as one straight segment on the shared graph,
    or None when no piece can (the caller keeps the drawn chain).

    A piece qualifies when its trace does not double back on itself
    (chord at least _SURGERY_STRAIGHTEN_MIN_CHORD_RATIO of the traced
    length), its vertices determine a TLS trend line, and it deviates
    from its own chord by at most _SURGERY_STRAIGHTEN_MAX_DEV_M — a
    longer bow chorded in one segment would hand the whole bow to
    one side, which is how a straightened seam amputates the small
    facet it bows around. A chain that fails as a whole — the arc
    over a fragment blob, a boundary bending around a corner — is
    split at the vertex deviating most from its chord, recursively
    up to _SURGERY_STRAIGHTEN_MAX_SPLIT_DEPTH, but only while that
    deviation exceeds _SURGERY_STRAIGHTEN_SPLIT_MIN_DEV_M (a real
    corner, not raster noise). The split vertex is an ordinary graph
    vertex shared by both facets, so the pieces still meet exactly;
    it simply becomes the corner where the two straight segments
    join. Unqualifying pieces keep their traced vertices — the
    fallback is per piece, exactly as the veto ladder's is per
    chain."""

    def pieces_for(
        verts: list[tuple[float, float]], depth: int
    ) -> list[tuple[list[tuple[float, float]], Any]]:
        if len(verts) <= 2:
            return [(verts, None)]  # already a single segment
        traced = LineString(verts).length
        chord = math.hypot(
            verts[-1][0] - verts[0][0], verts[-1][1] - verts[0][1]
        )
        (x0, y0), (x1, y1) = verts[0], verts[-1]
        dx, dy = x1 - x0, y1 - y0
        split_at, worst = -1, 0.0
        for k in range(1, len(verts) - 1):
            x, y = verts[k]
            dev = (
                abs(dx * (y - y0) - dy * (x - x0)) / chord
                if chord > 1e-9
                else 0.0
            )
            if dev > worst:
                split_at, worst = k, dev
        line = None
        if traced > 0 and chord >= (
            _SURGERY_STRAIGHTEN_MIN_CHORD_RATIO * traced
        ):
            line = _tls_line(verts)
        if line is not None and worst <= _SURGERY_STRAIGHTEN_MAX_DEV_M:
            return [(verts, line)]
        if (
            depth >= _SURGERY_STRAIGHTEN_MAX_SPLIT_DEPTH
            or len(verts) < 4
            or split_at < 0
            or worst <= _SURGERY_STRAIGHTEN_SPLIT_MIN_DEV_M
        ):
            return [(verts, None)]
        return (
            pieces_for(verts[: split_at + 1], depth + 1)
            + pieces_for(verts[split_at:], depth + 1)
        )

    pieces = pieces_for(chain["verts"], 0)
    if not any(line is not None for _verts, line in pieces):
        return None
    result: list[dict[str, Any]] = []
    for verts, line in pieces:
        piece: dict[str, Any] = {
            "verts": verts,
            "pair": chain["pair"],
            "snap": False,
            "hausdorff": 0.0,
        }
        if line is not None:
            piece["hausdorff"] = LineString(verts).hausdorff_distance(
                LineString([verts[0], verts[-1]])
            )
            piece["line"] = line
            piece["snap"] = True
            piece["straightened"] = True
        result.append(piece)
    return result


def _graph_vertex(x: float, y: float) -> tuple[float, float]:
    return (round(x, 7), round(y, 7))


def _tiling_side_label(point: Point, labels: list[Polygon]) -> int:
    """Index of the tiling polygon owning ``point`` (-1 = outside the
    tiling). Hairline gaps between boolean-op neighbours resolve to
    the nearest label within 6 cm."""
    best, best_d = -1, 0.06
    for i, geom in enumerate(labels):
        if geom is None or geom.is_empty:
            continue
        if geom.covers(point):
            return i
        distance = geom.distance(point)
        if distance < best_d:
            best, best_d = i, distance
    return best


def _boundary_chains(
    polygons: list[Polygon], outline: Polygon
) -> dict[str, Any]:
    """Node a facet tiling into a planar boundary graph and group its
    atomic segments into maximal same-pair chains between junctions.

    Every boundary (the facets' and the outline's) is noded together.
    Each atomic segment is classified by what it separates — facet i
    on one side, facet j (or -1, the outside) on the other — sampled
    a few centimetres off its midpoint, while the segments still lie
    exactly on the rings. Micro-segments shorter than
    _SURGERY_MICRO_SEGMENT_M are then contracted on the SHARED graph
    (both endpoints merge to their midpoint, identically for every
    incident chain), so cleanup can never pull the two sides of a
    seam apart; the pair labels are sampled BEFORE contraction and
    carried through it by segment identity, because a contracted
    segment can sit centimetres off the true ring — further than the
    sampling offset — and would mislabel both its sides. A vertex is
    a junction when the segments meeting there do not all separate
    the same pair. Returns the chains (vertex lists with their pair),
    the per-segment pairs, the vertex → segments index, and the
    junction set."""
    from shapely.ops import unary_union

    noded = unary_union(
        [outline.boundary]
        + [geom.boundary for geom in polygons if not geom.is_empty]
    )
    segments: list[tuple[tuple[float, float], tuple[float, float]]] = []
    for component in _line_components(noded):
        coords = list(component.coords)
        for a, b in zip(coords, coords[1:]):
            ka, kb = _graph_vertex(*a), _graph_vertex(*b)
            if ka != kb:
                segments.append((ka, kb))

    outline_boundary = outline.boundary

    seg_pair: list[tuple[int, int]] = []
    for a, b in segments:
        mx, my = (a[0] + b[0]) / 2.0, (a[1] + b[1]) / 2.0
        dx, dy = b[0] - a[0], b[1] - a[1]
        norm = math.hypot(dx, dy) or 1.0
        nx, ny = -dy / norm * 0.01, dx / norm * 0.01
        mid = Point(mx, my)
        probes = (Point(mx + nx, my + ny), Point(mx - nx, my - ny))
        if outline_boundary.distance(mid) <= 0.005:
            # A segment lying ON the outline: the outside is -1 by
            # definition (the tiling-union boundary IS the outline).
            # The inside is the facet whose ring CONTAINS the segment
            # — distance zero from the midpoint — which stays exact
            # even when that facet is a centimetre-thin strip along
            # the eave whose 1 cm probe would overshoot into the
            # facet behind it (counting the strip's seam as that
            # facet's perimeter and the strip's own perimeter as
            # nobody's: the double-count trap Phase 1 documented on
            # sw139's tiling, which carries ~130 ft of such seams).
            inside = None
            best_distance = 0.02
            for idx, geom in enumerate(polygons):
                if geom.is_empty:
                    continue
                distance = geom.distance(mid)
                if distance < best_distance:
                    best_distance, inside = distance, idx
            pair = []
            for probe in probes:
                if not outline.covers(probe):
                    pair.append(-1)
                elif inside is not None:
                    pair.append(inside)
                else:
                    pair.append(_tiling_side_label(probe, polygons))
            seg_pair.append((pair[0], pair[1]))
        else:
            # An INTERIOR segment never borders the outside, even
            # when a probe overshoots a hairline strip facet and the
            # outline behind it: the nearest tiling label owns that
            # side.
            seg_pair.append((
                _tiling_side_label(probes[0], polygons),
                _tiling_side_label(probes[1], polygons),
            ))

    def pair_rank(pair: tuple[int, int]) -> int:
        labels = set(pair)
        if len(labels) == 2 and -1 not in labels:
            return 3  # a true seam
        if len(labels) == 2:
            return 2  # perimeter
        return 1 if -1 not in labels else 0

    # Micro-segment contraction on the shared graph. Each contraction
    # strictly reduces the vertex count, so the loop terminates.
    while True:
        deduped: list[tuple[tuple[float, float], tuple[float, float]]] = []
        deduped_pairs: list[tuple[int, int]] = []
        index_of: dict[Any, int] = {}
        for (a, b), pair in zip(segments, seg_pair):
            if a == b:
                continue
            key = (a, b) if a <= b else (b, a)
            if key in index_of:
                idx = index_of[key]
                if pair_rank(pair) > pair_rank(deduped_pairs[idx]):
                    deduped_pairs[idx] = pair
                continue
            index_of[key] = len(deduped)
            deduped.append((a, b))
            deduped_pairs.append(pair)
        segments, seg_pair = deduped, deduped_pairs
        target = None
        for idx, (a, b) in enumerate(segments):
            if math.hypot(a[0] - b[0], a[1] - b[1]) < _SURGERY_MICRO_SEGMENT_M:
                target = idx
                break
        if target is None:
            break
        a, b = segments[target]
        mid = _graph_vertex((a[0] + b[0]) / 2.0, (a[1] + b[1]) / 2.0)
        if mid == a or mid == b:
            del segments[target]
            del seg_pair[target]
        else:
            segments = [
                (
                    mid if seg[0] in (a, b) else seg[0],
                    mid if seg[1] in (a, b) else seg[1],
                )
                for seg in segments
            ]

    at_vertex: dict[tuple[float, float], list[int]] = {}
    for idx, (a, b) in enumerate(segments):
        at_vertex.setdefault(a, []).append(idx)
        at_vertex.setdefault(b, []).append(idx)

    def is_junction(vertex: tuple[float, float]) -> bool:
        segs = at_vertex[vertex]
        if len(segs) != 2:
            return True
        return len({frozenset(seg_pair[s]) for s in segs}) > 1

    seg_ends: dict[tuple[float, float], list[tuple[int, tuple[float, float]]]] = {}
    for idx, (a, b) in enumerate(segments):
        seg_ends.setdefault(a, []).append((idx, b))
        seg_ends.setdefault(b, []).append((idx, a))
    used: set[int] = set()
    chains: list[dict[str, Any]] = []
    for idx, (a, b) in enumerate(segments):
        if idx in used:
            continue
        pair = frozenset(seg_pair[idx])
        verts = [a, b]
        used.add(idx)
        for at_head in (True, False):
            while True:
                end_v = verts[0] if at_head else verts[-1]
                if is_junction(end_v) and len(verts) > 2:
                    break
                nxt = None
                for sidx, other in seg_ends[end_v]:
                    if sidx not in used and frozenset(seg_pair[sidx]) == pair:
                        nxt = (sidx, other)
                        break
                if nxt is None:
                    break
                used.add(nxt[0])
                if at_head:
                    verts.insert(0, nxt[1])
                else:
                    verts.append(nxt[1])
                if verts[0] == verts[-1]:
                    break  # closed loop (island facet ring)
        chains.append({
            "verts": verts, "pair": pair, "snap": False, "hausdorff": 0.0,
        })
    return {
        "chains": chains,
        "seg_pair": seg_pair,
        "at_vertex": at_vertex,
        "junctions": {v for v in at_vertex if is_junction(v)},
    }


def _simplify_boundary_chains(
    chains: list[dict[str, Any]],
    tol_m: float,
    protected: set[tuple[float, float]] | None = None,
) -> None:
    """Drop interior chain vertices that barely deviate from the
    chord between their kept neighbours (in place). Raster-derived
    tilings (Phase 4's DSM labelling) arrive with hundreds of
    per-cell staircase vertices; the staircase carries no
    information beyond the raster's own resolution, and the vertex
    flood starves the snap guards (every vertex is a potential
    junction sample) and the emission ring cap. The thinning runs
    on the SHARED graph — a chain is one object seen identically by
    both facets it separates — so it can never pull the two sides
    of a seam apart the way per-ring simplification provably does
    (Phase 1). Chain endpoints (junctions) never move."""
    for chain in chains:
        verts = chain["verts"]
        if len(verts) <= 2:
            continue
        kept = [verts[0]]
        for idx in range(1, len(verts) - 1):
            prev, point, nxt = kept[-1], verts[idx], verts[idx + 1]
            chord = (nxt[0] - prev[0], nxt[1] - prev[1])
            chord_len = math.hypot(*chord)
            deviation = (
                abs(
                    chord[0] * (point[1] - prev[1])
                    - chord[1] * (point[0] - prev[0])
                )
                / chord_len
                if chord_len > 1e-9
                else 0.0
            )
            if deviation > tol_m or (
                protected is not None and point in protected
            ):
                kept.append(point)
        kept.append(verts[-1])
        chain["verts"] = kept


def _divergent_seam_ft(
    polygons: list[Polygon],
    plane_models: list[tuple[float, float, float]],
    outline: Polygon,
    curved: dict[int, dict[str, Any]] | None = None,
) -> float:
    """Feet of facet boundary that runs near a neighbour WITHOUT
    coinciding with it — the doubled trace a roofer sees as two
    almost-parallel lines. A boundary segment counts when its
    midpoint sits within 0.75 m of the neighbour's polygon but more
    than 5 cm from the neighbour's boundary (and it is not perimeter).
    Ported from the Phase 1 prototype's diagnose()."""
    polys = [p for p in polygons]
    boundaries = [p.boundary if not p.is_empty else None for p in polys]
    outline_boundary = outline.boundary
    divergent_m = 0.0
    for i in range(len(polys)):
        if polys[i].is_empty:
            continue
        for j in range(i + 1, len(polys)):
            if polys[j].is_empty or polys[i].distance(polys[j]) > 1.0:
                continue
            line = _plane_intersection_line(plane_models[i], plane_models[j])
            if line is None or math.hypot(line[0], line[1]) < 0.02:
                # Near-parallel planes: the intersection trace is
                # numerically meaningless and must not pollute metrics.
                # A pair involving a curved facet has no plane line
                # at all — its seam is real geometry and is always
                # measured.
                if not (curved and (i in curved or j in curved)):
                    continue
            for mine, theirs in ((i, j), (j, i)):
                # A facet's region can be several disjoint parts
                # (the DSM labelling legitimately assigns one plane
                # two separated patches); every part's ring carries
                # seams. Single-polygon facets iterate exactly as
                # before.
                rings = [
                    list(part.exterior.coords)
                    for part in _polygon_parts(polys[mine])
                ]
                for coords in rings:
                    for (x0, y0), (x1, y1) in zip(coords, coords[1:]):
                        mid = Point((x0 + x1) / 2, (y0 + y1) / 2)
                        if outline_boundary.distance(mid) <= 0.05:
                            continue  # perimeter, not a seam
                        if boundaries[theirs] is not None and (
                            boundaries[theirs].distance(mid) <= 0.05
                        ):
                            continue  # coincident seam
                        if polys[theirs].distance(mid) <= 0.75:
                            divergent_m += math.hypot(x1 - x0, y1 - y0)
    return round(divergent_m * _FT_PER_M, 1)


def _surgery_partition_violation(
    regions: list[Polygon],
    graph_pairs: set[tuple[int, int]],
) -> str | None:
    """Partition-validity guard for a rebuilt tiling (Phase 3
    finding): the rebuilt rings must remain a clean partition of the
    SAME adjacency graph the surgery started from. Two violations:

    - overlap: two facets' regions overlap by more than a hairline
      (1e-6 m²) — the rebuild is not a partition at all;
    - phantom adjacency: two facets share a real edge (> 0.05 m of
      coincident boundary) although the boundary graph has no chain
      for that pair. Face recovery can manufacture such an edge —
      Phase 3's sw139 case: a 49.6 ft coincident facet-2/facet-4 edge
      in the rebuilt rings where the two facets never touch in the
      tiling (a third facet sits between them). The phantom edge is
      coincident in both rings, so the divergent-seam guard cannot
      see it; only this adjacency check can.

    Returns a short violation tag, or None when the rebuild is a
    valid partition of the graph's adjacency."""
    for i in range(len(regions)):
        if regions[i].is_empty:
            continue
        for j in range(i + 1, len(regions)):
            if regions[j].is_empty:
                continue
            if regions[i].intersection(regions[j]).area > 1e-6:
                return f"overlap_{i}_{j}"
            shared = regions[i].boundary.intersection(
                regions[j].boundary
            ).length
            if shared > 0.05 and (i, j) not in graph_pairs:
                return f"phantom_adjacency_{i}_{j}"
    return None


def _surgery_partition_boundaries(
    partition: list[Polygon],
    plane_models: list[tuple[float, float, float]],
    pitches: list[float],
    outline: Polygon,
    simplify_tol_m: float = 0.0,
    curved: dict[int, dict[str, Any]] | None = None,
) -> tuple[list[Polygon], dict[str, Any]]:
    """Boundary-graph surgery on the partition tiling (see the block
    comment above): shared seams become single straight segments of
    the facet pairs' true plane-intersection lines. Returns the
    rebuilt polygons (aligned with `partition`) and construction
    stats. On any structural doubt the whole house falls back to the
    input tiling, recorded in stats["fallback_reason"] — the surgery
    may degrade to today's drawing, never below it. Facets the
    partition erased (empty region) are excluded and stay empty, so
    the caller's fitted-polygon fallback still applies to them."""
    from shapely.ops import polygonize, unary_union

    stats: dict[str, Any] = {}
    active = [i for i, p in enumerate(partition) if not p.is_empty]
    if len(active) < 2:
        stats["fallback_reason"] = "fewer_than_two_partitioned_facets"
        return list(partition), stats
    labels = [partition[i] for i in active]
    planes = [plane_models[i] for i in active]
    count = len(active)

    # Phase 5d: curved facets, translated into active indexing.
    # A curved facet has no plane-intersection line with anything
    # (its pair lines are voided below, so its chains never snap),
    # and a cone's rim chains are protected end to end: no
    # simplification, no straightening, and junction solutions
    # that would move a rim vertex are projected back onto the
    # fitted circle — the arc the tiling drew is the arc the
    # drawing ships.
    curved_active: dict[int, dict[str, Any]] = {}
    if curved:
        position = {orig: pos for pos, orig in enumerate(active)}
        curved_active = {
            position[i]: surf for i, surf in curved.items() if i in position
        }
    rim_circles: list[tuple[float, float, float]] = [
        (
            surf["centre"][0],
            surf["centre"][1],
            float(surf["rim_radius_m"]),
        )
        for surf in curved_active.values()
        if surf.get("kind") == "cone" and surf.get("rim_radius_m")
    ]

    def _on_rim(x: float, y: float) -> bool:
        return any(
            abs(math.hypot(x - cx, y - cy) - radius) <= 0.12
            for cx, cy, radius in rim_circles
        )

    def _is_rim_chain(chain: dict[str, Any]) -> bool:
        if not rim_circles or len(chain["pair"]) != 2:
            return False
        verts = chain["verts"]
        if not verts:
            return False
        for i in chain["pair"]:
            surf = curved_active.get(i)
            if (
                not surf
                or surf.get("kind") != "cone"
                or not surf.get("rim_radius_m")
            ):
                continue
            cx, cy = surf["centre"]
            radius = float(surf["rim_radius_m"])
            on = sum(
                1
                for x, y in verts
                if abs(math.hypot(x - cx, y - cy) - radius) <= 0.12
            )
            if on >= 0.5 * len(verts):
                return True
        return False

    def fallback(reason: str) -> tuple[list[Polygon], dict[str, Any]]:
        stats["fallback_reason"] = reason
        return list(partition), stats

    graph = _boundary_chains(labels, outline)
    chains = graph["chains"]
    if not chains:
        return fallback("no_chains")
    if simplify_tol_m > 0:
        # Raster tilings only (Phase 4): thin the staircase chains
        # on the shared graph before snap evaluation. Hull tilings
        # keep the Phase 2 behaviour exactly (tol 0 = no thinning).
        protected: set[tuple[float, float]] | None = None
        if rim_circles:
            cone_idx = {
                i
                for i, surf in curved_active.items()
                if surf.get("kind") == "cone"
            }
            protected = {
                vert
                for chain in chains
                if len(chain["pair"]) == 2
                and not chain["pair"].isdisjoint(cone_idx)
                for vert in chain["verts"]
                if _on_rim(vert[0], vert[1])
            }
        _simplify_boundary_chains(chains, simplify_tol_m, protected)
        stats["chains_simplified_tol_m"] = simplify_tol_m
    junctions = graph["junctions"]
    # The adjacency the rebuild must preserve: facet pairs that share
    # a chain in the tiling's own boundary graph (active indexing).
    graph_pairs: set[tuple[int, int]] = {
        tuple(sorted(chain["pair"]))
        for chain in chains
        if len(chain["pair"]) == 2 and -1 not in chain["pair"]
    }

    pair_lines: dict[frozenset, Any] = {}
    for chain in chains:
        pair = chain["pair"]
        if len(pair) == 2 and -1 not in pair and pair not in pair_lines:
            i, j = sorted(pair)
            pair_lines[pair] = _plane_intersection_line(planes[i], planes[j])
    if curved_active:
        # No plane-intersection line exists against a curved
        # surface; voiding the pair's line keeps its chains out of
        # the snap phase (and out of junction line constraints) on
        # exactly the terms parallel plane pairs already get.
        for pair in pair_lines:
            i, j = sorted(pair)
            if i in curved_active or j in curved_active:
                pair_lines[pair] = None
    pair_chains = 0
    snapped = 0
    for chain in chains:
        pair = chain["pair"]
        if len(pair) != 2 or -1 in pair:
            continue
        line = pair_lines.get(pair)
        if line is None:
            continue
        pair_chains += 1
        verts = chain["verts"]
        if verts[0] == verts[-1] or len(verts) < 2:
            continue  # a closed island ring is not one line segment
        la, lb, lc = line
        norm = math.hypot(la, lb)
        d_end = max(
            abs(la * x + lb * y + lc) / norm for x, y in (verts[0], verts[-1])
        )
        if d_end > _SURGERY_CHAIN_SNAP_MAX_M:
            continue
        chain["hausdorff"] = LineString(verts).hausdorff_distance(
            LineString([verts[0], verts[-1]])
        )
        if chain["hausdorff"] > _SURGERY_CHAIN_HAUSDORFF_MAX_M:
            continue
        chain["line"] = line
        chain["snap"] = True
        snapped += 1
    stats["pair_chains"] = pair_chains
    stats["chains_snapped"] = snapped
    straightened = 0
    chains_split = 0
    if simplify_tol_m > 0:
        # Phase 5 straightening, labelled (raster) tilings only —
        # see the block comment above the surgery constants. A seam
        # chain the snap guards refused would ship its raster
        # staircase; instead it is broken into straightenable
        # pieces on the shared graph (corners split, never moved),
        # each piece marked for the same segment treatment as a
        # snapped chain but guided by the TLS line through its own
        # vertices. Hull tilings (tol 0) keep the Phase 2 behaviour
        # exactly. The graph's adjacency is unchanged — pieces share
        # their parent chain's pair — so graph_pairs above stands.
        rebuilt_chains: list[dict[str, Any]] = []
        for chain in chains:
            pair = chain["pair"]
            if (
                chain["snap"]
                or len(pair) != 2
                or -1 in pair
                or chain["verts"][0] == chain["verts"][-1]
                or len(chain["verts"]) < 3
                or _is_rim_chain(chain)
            ):
                rebuilt_chains.append(chain)
                continue
            pieces = _straighten_chain_pieces(chain)
            if pieces is None:
                rebuilt_chains.append(chain)
                continue
            if len(pieces) > 1:
                chains_split += 1
            straightened += sum(1 for p in pieces if p["snap"])
            rebuilt_chains.extend(pieces)
        chains = rebuilt_chains
    stats["chains_straightened"] = straightened
    if chains_split:
        stats["chains_split"] = chains_split

    incident: dict[tuple[float, float], list[dict[str, Any]]] = {}
    for chain in chains:
        incident.setdefault(chain["verts"][0], []).append(chain)
        if chain["verts"][-1] != chain["verts"][0]:
            incident.setdefault(chain["verts"][-1], []).append(chain)

    def solve_targets(clamp_m: float) -> tuple[dict, int]:
        targets: dict[tuple[float, float], tuple[float, float]] = {}
        moved = 0
        for vertex, chs in incident.items():
            if vertex not in junctions:
                continue
            lines: list[tuple[float, float, float]] = []
            for chain in chs:
                if chain["snap"]:
                    # A snapped chain contributes its pair's plane
                    # line; a straightened one (Phase 5) contributes
                    # the TLS line through its own vertices — both
                    # are recorded on the chain when it is marked.
                    line = chain.get("line") or pair_lines.get(
                        chain["pair"]
                    )
                    if line is not None:
                        lines.append(line)
                elif len(chain["pair"]) == 2 and -1 in chain["pair"]:
                    # Perimeter chain: constrain the junction to the
                    # outline edge line of its own first segment.
                    verts = chain["verts"]
                    if verts[0] == vertex:
                        (x1, y1), (x2, y2) = verts[0], verts[1]
                    else:
                        (x1, y1), (x2, y2) = verts[-1], verts[-2]
                    la, lb = y2 - y1, x1 - x2
                    lines.append((la, lb, -(la * x1 + lb * y1)))
            if not lines:
                targets[vertex] = vertex
                continue
            ata = [[0.0, 0.0], [0.0, 0.0]]
            atb = [0.0, 0.0]
            for la, lb, lc in lines:
                n2 = la * la + lb * lb
                if n2 < 1e-12:
                    continue
                w = 1.0 / math.sqrt(n2)
                la, lb, lc = la * w, lb * w, lc * w
                ata[0][0] += la * la
                ata[0][1] += la * lb
                ata[1][0] += la * lb
                ata[1][1] += lb * lb
                atb[0] += -la * lc
                atb[1] += -lb * lc
            det = ata[0][0] * ata[1][1] - ata[0][1] * ata[1][0]
            if abs(det) < 1e-9:
                # Project onto the first line with a usable normal.
                # A perimeter chain can carry a degenerate first
                # segment (zero-length, from graph contraction on
                # raster-derived tilings), whose "line" is (0, 0, c):
                # projecting onto it divided by zero and sank the
                # whole surgery. Lines with no normal carry no
                # constraint — the loop above already skips them.
                usable = [
                    line for line in lines
                    if line[0] * line[0] + line[1] * line[1] >= 1e-12
                ]
                if not usable:
                    targets[vertex] = vertex
                    continue
                la, lb, lc = usable[0]
                t = -(la * vertex[0] + lb * vertex[1] + lc) / (la * la + lb * lb)
                tx, ty = vertex[0] + la * t, vertex[1] + lb * t
            else:
                tx = (atb[0] * ata[1][1] - atb[1] * ata[0][1]) / det
                ty = (ata[0][0] * atb[1] - ata[1][0] * atb[0]) / det
            if math.hypot(tx - vertex[0], ty - vertex[1]) > clamp_m:
                tx, ty = vertex
            elif math.hypot(tx - vertex[0], ty - vertex[1]) > 0.01:
                moved += 1
            targets[vertex] = (tx, ty)
        return targets, moved

    def attempt(clamp_m: float):
        """One rebuild at the current snap set. Returns (regions,
        None) or (None, reason)."""
        targets, moved = solve_targets(clamp_m)
        if rim_circles:
            # A junction solution may move a rim vertex (its other
            # chains still carry line constraints); project the
            # moved target radially back onto the fitted circle so
            # the arc survives the solve.
            for vertex, target in list(targets.items()):
                if target == vertex:
                    continue
                for cx, cy, radius in rim_circles:
                    if abs(
                        math.hypot(vertex[0] - cx, vertex[1] - cy) - radius
                    ) > 0.12:
                        continue
                    dx, dy = target[0] - cx, target[1] - cy
                    norm = math.hypot(dx, dy)
                    if norm > 1e-9:
                        targets[vertex] = (
                            cx + radius * dx / norm,
                            cy + radius * dy / norm,
                        )
                    break
        rebuilt: list[LineString] = []
        for chain in chains:
            verts = chain["verts"]
            if chain["snap"]:
                a = targets.get(verts[0], verts[0])
                b = targets.get(verts[-1], verts[-1])
                if a != b:
                    rebuilt.append(LineString([a, b]))
            else:
                mapped = [
                    targets.get(v, v) if k in (0, len(verts) - 1) else v
                    for k, v in enumerate(verts)
                ]
                rebuilt.append(LineString(mapped))
        faces = [
            face for face in polygonize(unary_union(rebuilt + [outline.boundary]))
            if face.area > 1e-9 and outline.covers(face.representative_point())
        ]
        covered = sum(face.area for face in faces)
        if covered < 0.99 * outline.area:
            return None, f"faces_cover_{covered / outline.area:.3f}"
        buckets: list[list[Polygon]] = [[] for _ in range(count)]
        for face in faces:
            owner = _tiling_side_label(face.representative_point(), labels)
            if owner < 0:
                return None, "unowned_face"
            buckets[owner].append(face)
        regions: list[Any] = [
            unary_union(buckets[i]) if buckets[i] else Polygon()
            for i in range(count)
        ]
        # A facet whose faces form disjoint parts cannot ship as one
        # ring. Reassign each smaller part to the neighbour sharing
        # its longest border (the union stays a single polygon and
        # the tiling stays exact); if that is impossible the attempt
        # fails and the veto ladder proceeds.
        for i in range(count):
            if regions[i].is_empty:
                continue
            parts = _polygon_parts(regions[i])
            if len(parts) <= 1:
                continue
            parts.sort(key=lambda part: -part.area)
            regions[i] = parts[0]
            for part in parts[1:]:
                best_k, best_len = -1, 0.0
                for k in range(count):
                    if k == i or regions[k].is_empty:
                        continue
                    shared_len = part.boundary.intersection(
                        regions[k].boundary
                    ).length
                    if shared_len > best_len:
                        best_len, best_k = shared_len, k
                if best_k < 0 or best_len <= 1e-9:
                    return None, "multipart_facet"
                merged_parts = _polygon_parts(
                    unary_union([regions[best_k], part])
                )
                if len(merged_parts) != 1:
                    return None, "multipart_facet"
                regions[best_k] = merged_parts[0]
                stats["parts_reassigned"] = stats.get("parts_reassigned", 0) + 1
        ratios = [
            round(regions[i].area / labels[i].area, 3) if regions[i] else 0.0
            for i in range(count)
        ]
        stats["area_ratios"] = ratios
        for i in range(count):
            if regions[i].is_empty:
                return None, f"facet_{active[i]}_lost_its_face"
            if ratios[i] < 0.6 or ratios[i] > 1.5:
                return None, f"facet_{active[i]}_area_drift"
        stats["junctions_moved"] = moved
        stats["clamp_used_m"] = clamp_m
        # Partition-validity guard (Phase 3): the recovered faces —
        # including any multi-part reassignment above — must not
        # overlap and must not invent an adjacency the boundary graph
        # does not have. A violation fails this attempt like any
        # other, so the veto ladder proceeds and the house can still
        # fall back to today's tiling.
        violation = _surgery_partition_violation(regions, graph_pairs)
        if violation is not None:
            return None, violation
        result: list[Polygon] = list(partition)
        for i in range(count):
            result[active[i]] = regions[i]
        return result, None

    # Attempt order: full snap set at the standard clamp; then veto
    # the most-deviant snapped chain one at a time (a straightened
    # chord can amputate a small facet the chain bowed around, which
    # no junction clamp can fix — the chord, not the move, does the
    # damage); then smaller clamps. A rebuild that trades a true seam
    # for a longer doubled trace elsewhere is likewise vetoed.
    attempts: list[str] = []
    vetoed: list[str] = []
    result = None
    divergent_before = _divergent_seam_ft(labels, planes, outline)
    stats["divergent_before_ft"] = divergent_before
    while True:
        result, reason = attempt(_SURGERY_JUNCTION_CLAMP_M)
        if result is not None:
            result_active = [result[i] for i in active]
            div_after = _divergent_seam_ft(result_active, planes, outline)
            stats["divergent_after_ft"] = div_after
            live = [ch for ch in chains if ch["snap"]]
            if div_after <= divergent_before + 2.0 or not live:
                break
            attempts.append(
                f"divergent_regressed {divergent_before} -> {div_after}"
            )
            result = None
        else:
            attempts.append(reason)
            live = [ch for ch in chains if ch["snap"]]
            if not live:
                break
        worst = max(live, key=lambda ch: ch["hausdorff"])
        worst["snap"] = False
        if worst.get("straightened"):
            stats["chains_straightened"] -= 1
        else:
            stats["chains_snapped"] -= 1
        vetoed.append("+".join(str(active[k]) for k in sorted(worst["pair"])))
    if result is None:
        for clamp_m in (
            _SURGERY_JUNCTION_CLAMP_M / 2,
            _SURGERY_JUNCTION_CLAMP_M / 4,
        ):
            result, reason = attempt(clamp_m)
            if result is not None:
                break
            attempts.append(f"clamp {clamp_m}: {reason}")
    if vetoed:
        stats["chains_vetoed"] = vetoed
    if attempts:
        stats["earlier_attempts"] = attempts
    if result is None:
        return fallback("attempts_exhausted: " + "; ".join(attempts))
    return [_dedupe_ring_points(polygon) for polygon in result], stats


def _classify_pair_local_chord(
    geom_i: Polygon,
    plane_i: tuple[float, float, float],
    pitch_i: float,
    geom_j: Polygon,
    plane_j: tuple[float, float, float],
    pitch_j: float,
) -> str | None:
    """Classify a facet pair's shared edge with a LOCAL chord test
    (the Phase 1 prototype's classify_pair_local): the seam itself
    comes from _shared_edge_span, but the verdict is re-derived at
    the seam midpoint by stepping 1 m perpendicular into each facet —
    the side of the intersection line that facet actually occupies —
    and comparing the planes' heights there against the seam height.
    The verdict depends only on the two planes and the seam, not on
    either polygon's representative point, so a pair keeps its class
    when the polygons are rebuilt. (_shared_edge_span's own verdict
    steps toward each polygon's representative point, which made the
    same pair of planes flip class when a polygon changed shape:
    measured on Miramar, the valley the fitter reported at 59.6 ft
    classified as hip on the drawing partition.) The span's verdict
    survives only where the local test cannot be evaluated (parallel
    planes — a flat pair's pitch-change seam — or an indeterminate
    side). Returns None when the pair shares no span at all."""
    span = _shared_edge_span(
        geom_i, plane_i[0], plane_i[1], plane_i[2], pitch_i,
        geom_j, plane_j[0], plane_j[1], plane_j[2], pitch_j,
    )
    if span is None:
        return None
    _length_m, live_class, seam = span
    line = _plane_intersection_line(plane_i, plane_j)
    if line is None or seam is None or seam.is_empty:
        return live_class
    la, lb, lc = line
    norm = math.hypot(la, lb)
    nx, ny = la / norm, lb / norm
    (x0, y0), (x1, y1) = seam.coords[0], seam.coords[-1]
    mx, my = (x0 + x1) / 2.0, (y0 + y1) / 2.0
    edge_z = plane_i[0] * mx + plane_i[1] * my + plane_i[2]
    chord = 0.0
    for geom, plane in ((geom_i, plane_i), (geom_j, plane_j)):
        # Which side of the line does this facet occupy? Probe both
        # sides: the occupied side's probe lands inside the facet.
        # (A plain distance threshold cannot decide this — a probe
        # 0.5 m across the seam is also within 0.5 m of THIS facet's
        # boundary, which flips the chord test's sign on symmetric
        # roofs.) Fall back to the nearer probe, then to the
        # representative point's side.
        probes = {}
        for sign in (1.0, -1.0):
            probe = Point(mx + sign * nx * 0.5, my + sign * ny * 0.5)
            probes[sign] = (geom.covers(probe), geom.distance(probe))
        covered = [sign for sign, (cov, _d) in probes.items() if cov]
        if len(covered) == 1:
            inside = covered[0]
        elif abs(probes[1.0][1] - probes[-1.0][1]) > 1e-9:
            inside = 1.0 if probes[1.0][1] < probes[-1.0][1] else -1.0
        else:
            rep = geom.representative_point()
            side = (rep.x - mx) * nx + (rep.y - my) * ny
            if abs(side) <= 1e-9:
                return live_class
            inside = 1.0 if side > 0 else -1.0
        px, py = mx + inside * nx * 1.0, my + inside * ny * 1.0
        chord += (plane[0] * px + plane[1] * py + plane[2]) / 2.0
    flat_pair = pitch_i < 5.0 and pitch_j < 5.0
    if flat_pair or abs(edge_z - chord) <= 0.03:
        return "pitch_change"
    if edge_z > chord:
        dz = plane_i[0] * plane_j[1] - plane_j[0] * plane_i[1]
        dx, dy = -plane_i[1] + plane_j[1], plane_i[0] - plane_j[0]
        horizontal = math.hypot(dx, dy)
        slope_along = abs(dz) / horizontal if horizontal > 1e-9 else 0.0
        return "ridge" if slope_along <= 0.14 else "hip"
    return "valley"


def _classify_pair_curved_chord(
    geom_c: Polygon,
    surf: dict[str, Any],
    plane_c: tuple[float, float, float],
    pitch_c: float,
    geom_o: Polygon,
    plane_o: tuple[float, float, float],
    pitch_o: float,
) -> str | None:
    """Classify a curved facet's shared edge with a plane facet.
    _shared_edge_span (run on the tangent pseudo-plane) supplies
    the seam geometry, but the verdict is re-derived from the
    SURFACE: the chord test steps 1 m perpendicular from the seam
    midpoint into each facet — surface height on the curved side,
    plane height on the other — and the ridge/hip split reads the
    slope along the seam from the two surfaces' own gradients at
    the midpoint, averaged exactly as the plane path averages the
    two planes' gradients. Mirrors _classify_pair_local_chord's
    verdicts on the terms a curved surface can honestly offer."""
    span = _shared_edge_span(
        geom_c, plane_c[0], plane_c[1], plane_c[2], pitch_c,
        geom_o, plane_o[0], plane_o[1], plane_o[2], pitch_o,
    )
    if span is None:
        return None
    _length_m, live_class, seam = span
    if seam is None or seam.is_empty:
        return live_class
    (x0, y0), (x1, y1) = seam.coords[0], seam.coords[-1]
    mx, my = (x0 + x1) / 2.0, (y0 + y1) / 2.0
    seg_len = math.hypot(x1 - x0, y1 - y0)
    if seg_len <= 1e-9:
        return live_class
    ux, uy = (x1 - x0) / seg_len, (y1 - y0) / seg_len
    nx, ny = -uy, ux
    edge_z = (
        float(_curved_surface_z(surf, mx, my))
        + (plane_o[0] * mx + plane_o[1] * my + plane_o[2])
    ) / 2.0
    chord = 0.0
    for geom, is_curved in ((geom_c, True), (geom_o, False)):
        probes = {}
        for sign in (1.0, -1.0):
            probe = Point(mx + sign * nx * 0.5, my + sign * ny * 0.5)
            probes[sign] = (geom.covers(probe), geom.distance(probe))
        covered = [sign for sign, (cov, _d) in probes.items() if cov]
        if len(covered) == 1:
            inside = covered[0]
        elif abs(probes[1.0][1] - probes[-1.0][1]) > 1e-9:
            inside = 1.0 if probes[1.0][1] < probes[-1.0][1] else -1.0
        else:
            rep = geom.representative_point()
            side = (rep.x - mx) * nx + (rep.y - my) * ny
            if abs(side) <= 1e-9:
                return live_class
            inside = 1.0 if side > 0 else -1.0
        px, py = mx + inside * nx * 1.0, my + inside * ny * 1.0
        if is_curved:
            chord += float(_curved_surface_z(surf, px, py)) / 2.0
        else:
            chord += (plane_o[0] * px + plane_o[1] * py + plane_o[2]) / 2.0
    flat_pair = pitch_c < 5.0 and pitch_o < 5.0
    if flat_pair or abs(edge_z - chord) <= 0.03:
        return "pitch_change"
    if edge_z > chord:
        ga, gb = _curved_surface_grad(surf, mx, my)
        slope_along = abs(
            ((ga * ux + gb * uy) + (plane_o[0] * ux + plane_o[1] * uy)) / 2.0
        )
        return "ridge" if slope_along <= 0.14 else "hip"
    return "valley"


# ---------------------------------------------------------------------
# Perimeter totals (Phase 5b): single-counting + eave/rake classes.
#
# Classification: a perimeter segment is an EAVE unless the facet's
# water runs ALONG it. Two tests, both read off the facet's fitted
# plane — no house-specific constants:
#
# * Parallel: the downslope direction's component along the segment
#   is at least half the downslope (|cos| >= 0.5, the cone the
#   totals have always used). Across-slope segments fail here and
#   are eaves.
# * Non-draining: the downslope's component along the segment's
#   OUTWARD normal is at most _PERIMETER_RAKE_MAX_OUTWARD_FLOW.
#   A true gable end's dip is parallel to its rake, so its outward
#   flow is ~0 (fitted planes put it within a few hundredths on
#   every validation house); an oblique hip facet whose bottom
#   edge the water DOES drain off — Miramar's big south-east slope
#   runs ~16 degrees off its eave line — sits at +0.23..+0.27.
#   The old alignment-only rule called those segments rakes
#   (Miramar rake 258.6 ft against a 7.9 ft pro figure); the flow
#   test is what separates them.
_PERIMETER_RAKE_MAX_OUTWARD_FLOW = 0.15

# How far off the outline a facet's perimeter chain may run and
# still claim that stretch of outline (see _perimeter_totals).
# Graph construction and micro-segment contraction displace a
# shipped chain by centimetres at most (Phase 5b measured 4.6 cm
# worst case); the tolerance must clear that, and overlapping
# claims resolve by chain distance, so a generous value cannot
# steal a neighbouring facet's stretch.
_PERIMETER_CLAIM_TOLERANCE_M = 0.10


def _outward_normal(
    polygon: Polygon, mx: float, my: float, ux: float, uy: float
) -> tuple[float, float]:
    """Unit normal of the segment through (mx, my) with direction
    (ux, uy), pointing AWAY from ``polygon``'s interior. Decided by
    probing 5 cm to each side and asking which side the polygon
    covers — coverage, not distance: a probe just across a hairline
    boundary is still within centimetres of the polygon, and a
    representative-point side test flips on concave polygons.
    Falls back to the representative point's side when both probes
    land on the same side (a neck thinner than the probe offset)."""
    px, py = -uy, ux
    plus = polygon.covers(Point(mx + px * 0.05, my + py * 0.05))
    minus = polygon.covers(Point(mx - px * 0.05, my - py * 0.05))
    if plus and not minus:
        return -px, -py
    if minus and not plus:
        return px, py
    rep = polygon.representative_point()
    side = (rep.x - mx) * px + (rep.y - my) * py
    return (-px, -py) if side > 0 else (px, py)


def _perimeter_edge_class(
    a: float, b: float, ux: float, uy: float, nx: float, ny: float
) -> str:
    """Eave/rake verdict for one perimeter segment of the facet
    whose plane gradient is (a, b): (ux, uy) is the segment's unit
    direction and (nx, ny) its outward unit normal. A flat facet's
    perimeter is all eave. Otherwise the segment is a RAKE only
    when the downslope runs along it without draining across it
    (a gable end); every segment the facet drains across —
    straight out or obliquely — is an EAVE."""
    gradient = math.hypot(a, b)
    if gradient <= 1e-6:
        return "eave"
    downslope_x, downslope_y = -a / gradient, -b / gradient
    alignment = abs(ux * downslope_x + uy * downslope_y)
    if alignment < 0.5:
        return "eave"
    outward_flow = downslope_x * nx + downslope_y * ny
    if outward_flow <= _PERIMETER_RAKE_MAX_OUTWARD_FLOW:
        return "rake"
    return "eave"


def _perimeter_totals(
    by_pair: dict[frozenset, list[dict[str, Any]]],
    polygons: list[Polygon],
    plane_models: list[tuple[float, float, float]],
    outline: Polygon,
    curved: dict[int, dict[str, Any]] | None = None,
) -> dict[str, float]:
    """Eave/rake totals (feet) for the tiling's perimeter, each
    physical edge counted exactly once, measured ON THE OUTLINE.

    The boundary graph nodes every boundary it is given — the
    outline's and each facet ring's — so where a ring runs parallel
    to the outline a hair inside it, the graph carries TWO traces
    of one physical edge, both labelled {-1, i}: the outline's own
    trace and the ring's. Summing chain lengths counts the
    perimeter twice wherever that happens (the labelled path's
    straightened rings run micrometres inside the outline around
    whole houses — Phase 4 counted 115 m of Miramar perimeter
    against its 85.9 m outline, Phase 5a 169 m). The traces sit at
    micrometre-to-millimetre offsets, so no distance filter can
    separate the true trace from its echo; but both traces CLAIM
    the same stretch of outline. So the outline is cut at every
    point where any facet's claim starts or ends — a facet claims
    the stretches within _PERIMETER_CLAIM_TOLERANCE_M of its
    perimeter chains — and each atomic interval between cuts goes
    to the facet whose chains run nearest its midpoint. The
    interval's own outline geometry — a single trace, the survey
    line — is then measured and classified per segment with the
    owning facet's plane. An interval no chain claims (a ring the
    graph displaced past the tolerance) falls to the facet the
    tiling has just inside the outline there, so the counted
    perimeter still covers the outline exactly once.

    The assignment runs on linear references (project /
    interpolate / substring along the outline), never on line
    differences: claim geometry clipped from the outline differs
    from it by floating-point dust, and GEOS line difference
    silently fails to subtract such near-coincident lines —
    measured on Maria, a difference-based version recounted a
    third of the outline."""
    from shapely.ops import substring, unary_union

    totals = {"eave": 0.0, "rake": 0.0}
    outline_line = outline.boundary
    total_length = outline_line.length
    if total_length <= 0:
        return totals
    facet_chains: dict[int, Any] = {}
    cuts = {0.0, total_length}
    # No interval may cross an outline vertex: a corner-straddling
    # interval would be measured with one facet's plane while its
    # far piece lies on the neighbouring facet's edge (a square hip
    # roof grew 1.1 ft of phantom rake that way).
    for coord in outline_line.coords:
        cuts.add(outline_line.project(Point(coord)))
    for pair, pair_chains in by_pair.items():
        if -1 not in pair:
            continue
        i = next(k for k in pair if k != -1)
        chain_lines = [
            LineString(chain["verts"])
            for chain in pair_chains
            if len(chain["verts"]) >= 2
        ]
        if not chain_lines:
            continue
        chains_union = unary_union(chain_lines)
        facet_chains[i] = chains_union
        covered = outline_line.intersection(
            chains_union.buffer(_PERIMETER_CLAIM_TOLERANCE_M)
        )
        for component in _line_components(covered):
            if component.length <= 1e-9:
                continue
            for coord in (component.coords[0], component.coords[-1]):
                cuts.add(outline_line.project(Point(coord)))
    if not facet_chains:
        return totals
    ordered_cuts = sorted(cuts)
    intervals: list[tuple[float, float, int]] = []
    for start, end in zip(ordered_cuts, ordered_cuts[1:]):
        if end - start < 1e-9:
            continue
        mid_distance = (start + end) / 2.0
        midpoint = outline_line.interpolate(mid_distance)
        owner, best = -1, math.inf
        for i, chains_union in facet_chains.items():
            distance = chains_union.distance(midpoint)
            if distance < best:
                owner, best = i, distance
        if owner < 0 or best > _PERIMETER_CLAIM_TOLERANCE_M:
            owner = _tiling_side_label(
                _outline_interior_probe(outline, outline_line, mid_distance),
                polygons,
            )
        if owner >= 0:
            intervals.append((start, end, owner))
    # Group consecutive intervals of one facet into runs (the first
    # and last runs merge when the same facet owns both sides of
    # the outline's zero point). A run shorter than 0.3 m in total
    # is corner noise — a sliver claim at a junction — and does not
    # count. Within a run, the service's long-standing 0.3 m
    # segment floor applies as in _compute_edge_lengths: it drops
    # the claim-bleed slivers at corners (at most ~0.2 m per
    # corner) and the county outlines' shortest wiggle segments,
    # the same convention the chain totals used.
    runs: list[tuple[int, list[tuple[float, float]]]] = []
    for start, end, owner in intervals:
        if runs and runs[-1][0] == owner:
            runs[-1][1].append((start, end))
        else:
            runs.append((owner, [(start, end)]))
    if len(runs) > 1 and runs[0][0] == runs[-1][0]:
        runs[0][1].extend(runs[-1][1])
        runs.pop()
    for owner, spans in runs:
        if sum(end - start for start, end in spans) < 0.3:
            continue
        a, b, _c = plane_models[owner]
        surf = curved.get(owner) if curved else None
        for start, end in spans:
            piece = substring(outline_line, start, end)
            for component in _line_components(piece):
                coords = list(component.coords)
                for (x0, y0), (x1, y1) in zip(coords, coords[1:]):
                    span = math.hypot(x1 - x0, y1 - y0)
                    if span < 0.3:
                        continue
                    ux, uy = (x1 - x0) / span, (y1 - y0) / span
                    nx, ny = _outward_normal(
                        outline, (x0 + x1) / 2.0, (y0 + y1) / 2.0, ux, uy
                    )
                    if surf is not None:
                        # A curved owner's downslope is local: the
                        # surface gradient at the segment midpoint.
                        ga, gb = _curved_surface_grad(
                            surf, (x0 + x1) / 2.0, (y0 + y1) / 2.0
                        )
                    else:
                        ga, gb = a, b
                    slope_along = ga * ux + gb * uy
                    length_ft = (
                        span * math.sqrt(1.0 + slope_along * slope_along)
                        * _FT_PER_M
                    )
                    totals[_perimeter_edge_class(ga, gb, ux, uy, nx, ny)] += (
                        length_ft
                    )
    return totals


def _outline_interior_probe(
    outline: Polygon, outline_line: Any, distance_along: float
) -> Point:
    """A point 2 cm INSIDE the outline at the given distance along
    its boundary: the probe _tiling_side_label reads to name the
    facet owning an unclaimed outline stretch. The inward side is
    decided by _outward_normal against the local boundary
    direction."""
    midpoint = outline_line.interpolate(distance_along)
    ahead = outline_line.interpolate(
        min(distance_along + 0.05, outline_line.length)
    )
    behind = outline_line.interpolate(max(distance_along - 0.05, 0.0))
    ux, uy = ahead.x - behind.x, ahead.y - behind.y
    norm = math.hypot(ux, uy)
    if norm <= 1e-9:
        return midpoint
    nx, ny = _outward_normal(outline, midpoint.x, midpoint.y, ux / norm, uy / norm)
    return Point(midpoint.x - nx * 0.02, midpoint.y - ny * 0.02)


def _graph_edge_totals(
    polygons: list[Polygon],
    plane_models: list[tuple[float, float, float]],
    pitches: list[float],
    outline: Polygon,
    curved: dict[int, dict[str, Any]] | None = None,
) -> dict[str, float]:
    """EagleView-style edge totals measured on the drawing's boundary
    graph itself: for each facet pair, the summed 3D length of the
    chains they share in the emitted tiling, classified once per pair
    by the local chord test (_classify_pair_local_chord); the
    perimeter is measured separately by _perimeter_totals, which
    counts each physical edge once on the outline itself and splits
    eave/rake with _perimeter_edge_class, as _compute_edge_lengths
    does. Measuring the graph —
    instead of re-running the polygon-sensitive _shared_edge_span on
    reshaped polygons — means the totals describe exactly the lines
    the drawing ships, and a pair's class cannot drift when a polygon
    is rebuilt. Chains shorter than _GRAPH_MIN_SEAM_M are corner
    noise and do not count toward a pair's total."""
    totals = {
        "ridge": 0.0, "hip": 0.0, "valley": 0.0,
        "eave": 0.0, "rake": 0.0, "pitch_change": 0.0,
    }
    graph = _boundary_chains(polygons, outline)
    by_pair: dict[frozenset, list[dict[str, Any]]] = {}
    for chain in graph["chains"]:
        if len(chain["pair"]) == 2:
            by_pair.setdefault(chain["pair"], []).append(chain)

    def chain_plan_length(chain: dict[str, Any]) -> float:
        verts = chain["verts"]
        return sum(
            math.hypot(x1 - x0, y1 - y0)
            for (x0, y0), (x1, y1) in zip(verts, verts[1:])
        )

    for pair, pair_chains in by_pair.items():
        if -1 in pair:
            # Perimeter: measured once, on the outline, below —
            # summing these chains would count every edge whose
            # facet ring runs parallel to the outline twice (the
            # outline's trace plus the ring's; see _perimeter_totals).
            continue
        i, j = sorted(pair)
        surf_i = curved.get(i) if curved else None
        surf_j = curved.get(j) if curved else None
        if surf_i is not None or surf_j is not None:
            # Phase 5d: a curved pair is classified on the surface
            # (see _classify_pair_curved_chord), and each segment's
            # rise is the average of the two sides' own rises —
            # the surface's height difference on the curved side,
            # the plane's on the other — the same averaging the
            # plane path applies to the two gradients.
            if surf_i is not None:
                classification = _classify_pair_curved_chord(
                    polygons[i], surf_i, plane_models[i], pitches[i],
                    polygons[j], plane_models[j], pitches[j],
                )
            else:
                classification = _classify_pair_curved_chord(
                    polygons[j], surf_j, plane_models[j], pitches[j],
                    polygons[i], plane_models[i], pitches[i],
                )
            if classification is None:
                continue

            def _dz(k: int, surf: Any, x0: float, y0: float, x1: float, y1: float) -> float:
                if surf is not None:
                    return float(
                        _curved_surface_z(surf, x1, y1)
                    ) - float(_curved_surface_z(surf, x0, y0))
                a_k, b_k, _c_k = plane_models[k]
                return a_k * (x1 - x0) + b_k * (y1 - y0)

            length_m = 0.0
            for chain in pair_chains:
                if chain_plan_length(chain) < _GRAPH_MIN_SEAM_M:
                    continue
                verts = chain["verts"]
                for (x0, y0), (x1, y1) in zip(verts, verts[1:]):
                    dz = (
                        _dz(i, surf_i, x0, y0, x1, y1)
                        + _dz(j, surf_j, x0, y0, x1, y1)
                    ) / 2.0
                    length_m += math.hypot(math.hypot(x1 - x0, y1 - y0), dz)
            totals[classification] += length_m * _FT_PER_M
            continue
        classification = _classify_pair_local_chord(
            polygons[i], plane_models[i], pitches[i],
            polygons[j], plane_models[j], pitches[j],
        )
        if classification is None:
            continue
        a_i, b_i, _ = plane_models[i]
        a_j, b_j, _ = plane_models[j]
        length_m = 0.0
        for chain in pair_chains:
            if chain_plan_length(chain) < _GRAPH_MIN_SEAM_M:
                continue
            verts = chain["verts"]
            for (x0, y0), (x1, y1) in zip(verts, verts[1:]):
                dx, dy = x1 - x0, y1 - y0
                dz = ((a_i + a_j) / 2.0) * dx + ((b_i + b_j) / 2.0) * dy
                length_m += math.hypot(math.hypot(dx, dy), dz)
        totals[classification] += length_m * _FT_PER_M
    perimeter = _perimeter_totals(
        by_pair, polygons, plane_models, outline, curved=curved
    )
    totals["eave"] = perimeter["eave"]
    totals["rake"] = perimeter["rake"]
    return {key: round(value, 1) for key, value in totals.items()}


def _dedupe_ring_points(polygon: Polygon) -> Polygon:
    """Drop consecutive ring vertices that duplicate (within 0.1 mm)
    the previous kept vertex, and a closing vertex that repeats the
    first. Polygonized faces can carry a point twice in a row where
    the boundary graph contracted a micro-segment, and noding leaves
    hairline-apart vertex pairs (micrometres) at junctions; neither
    carries geometry, but both trip the emission ring checks
    (minimum consecutive-vertex distance) and the converter's
    duplicate-point rejection. Returns the input unchanged when
    nothing is dropped or the rebuild is not a faithful copy (same
    validity, area within 0.1%)."""
    if polygon.is_empty or polygon.geom_type != "Polygon":
        return polygon
    ring = _ring_coords(polygon)
    deduped: list[tuple[float, float]] = []
    for point in ring:
        if deduped and math.hypot(
            point[0] - deduped[-1][0], point[1] - deduped[-1][1]
        ) <= 1e-4:
            continue
        deduped.append(point)
    while len(deduped) > 1 and math.hypot(
        deduped[-1][0] - deduped[0][0], deduped[-1][1] - deduped[0][1]
    ) <= 1e-4:
        deduped.pop()
    if len(deduped) == len(ring) or len(deduped) < 3:
        return polygon
    rebuilt = Polygon(deduped)
    if (
        rebuilt.is_empty
        or rebuilt.is_valid != polygon.is_valid
        or abs(rebuilt.area - polygon.area) > 0.001 * max(polygon.area, 1e-9)
    ):
        return polygon
    return rebuilt


def _condition_tiling_for_emission(
    polygons: list[Polygon],
) -> list[Polygon] | None:
    """Coincidence-preserving conditioning for an exact facet tiling
    (the surgery's output): the rings already tile exactly — shared
    edges coincident, junctions single points — so the legacy
    conditioning passes (per-ring sparsify, conflation, overlap
    subtraction across an EMISSION_GAP_M hairline) must NOT run: each
    of them moves or cuts one side of a seam without the other and
    would re-introduce the divergent traces the surgery removed.
    What remains is validity repair (a no-op on polygonized faces),
    the same per-facet destruction guard the legacy path applies,
    and — only if a ring exceeds the vertex cap — near-collinear
    thinning of whole CHAINS on the shared graph (a chain vertex is
    dropped for both facets at once, and only when it barely deviates
    from its neighbours' chord). Returns None when the tiling cannot
    be conditioned without breaking coincidence; the caller then
    falls back to the legacy conditioning, today's behaviour."""
    if not polygons:
        return list(polygons)
    originals = list(polygons)
    repaired = [
        _dedupe_ring_points(_repaired_polygon(polygon)) for polygon in originals
    ]
    for original, candidate in zip(originals, repaired):
        if (
            candidate.is_empty
            or not candidate.is_valid
            or candidate.area
            < MIN_FACET_REMAINING_FRACTION * original.area - 1e-9
            or candidate.area > 1.10 * original.area + 1e-9
        ):
            return None
    # The premise of this path is an exact tiling: verify the rings
    # really are pairwise disjoint before trusting them as one.
    for i in range(len(repaired)):
        for j in range(i + 1, len(repaired)):
            if repaired[i].intersection(repaired[j]).area > 1e-6:
                return None

    def within_limits(rings: list[Polygon]) -> bool:
        for polygon in rings:
            ring = _ring_coords(polygon)
            if len(ring) > EMISSION_MAX_RING_POINTS:
                return False
            for a, b in zip(ring, ring[1:] + ring[:1]):
                # Only a literal zero-length segment is rejected
                # here. Closer-than-a-centimetre vertex pairs are
                # real tiling micro-geometry (junction pinches tens
                # of micrometres apart, load-bearing for the ring's
                # validity); moving them apart on one ring would
                # break coincidence, and the converter-frame repair
                # downstream already merges micro-clusters
                # (<= 0.25 ft) identically across rings before the
                # converter sees them — that sanitation exists for
                # exactly this partition output.
                if math.hypot(a[0] - b[0], a[1] - b[1]) == 0.0:
                    return False
        return True

    if within_limits(repaired):
        return repaired

    from shapely.ops import polygonize, unary_union

    outline = _largest_polygon_part(unary_union(repaired))
    if outline is None:
        return None
    graph = _boundary_chains(repaired, outline)
    changed = False
    for chain in graph["chains"]:
        verts = chain["verts"]
        if len(verts) <= 2 or verts[0] == verts[-1]:
            continue
        idx = 1
        while len(verts) > 2 and idx < len(verts) - 1:
            prev, point, nxt = verts[idx - 1], verts[idx], verts[idx + 1]
            chord = (nxt[0] - prev[0], nxt[1] - prev[1])
            chord_len = math.hypot(*chord)
            deviation = (
                abs(chord[0] * (point[1] - prev[1])
                    - chord[1] * (point[0] - prev[0])) / chord_len
                if chord_len > 1e-9
                else 0.0
            )
            if deviation <= EMISSION_SHORT_EDGE_DEVIATION_M:
                verts.pop(idx)
                changed = True
            else:
                idx += 1
    # Even when no interior vertex was thinned, the rebuild below is
    # worth attempting: the graph's own micro-segment contraction
    # (segments under 0.15 m merged while the chains were built) can
    # clear sub-centimetre junction pairs that vertex thinning cannot
    # touch — the pair's endpoints are junctions, not interior
    # points. The rebuild's guards (face coverage, owner assignment,
    # per-facet area limits, final within_limits) decide whether the
    # result is trustworthy; if nothing actually changed, the final
    # check rejects it exactly as before.
    _ = changed
    linework = [
        LineString(chain["verts"])
        for chain in graph["chains"]
        if len(chain["verts"]) >= 2
    ]
    faces = [
        face for face in polygonize(unary_union(linework + [outline.boundary]))
        if face.area > 1e-9 and outline.covers(face.representative_point())
    ]
    if sum(face.area for face in faces) < 0.99 * outline.area:
        return None
    buckets: list[list[Polygon]] = [[] for _ in repaired]
    for face in faces:
        owner = _tiling_side_label(face.representative_point(), repaired)
        if owner < 0:
            return None
        buckets[owner].append(face)
    thinned: list[Polygon] = []
    for index, bucket in enumerate(buckets):
        if not bucket:
            return None
        region = unary_union(bucket)
        parts = _polygon_parts(region)
        if len(parts) != 1:
            return None
        # The union of polygonized faces re-nodes shared junctions and
        # can leave micrometre-apart vertex pairs along the seams;
        # drop them (they carry no geometry) before the ring checks.
        candidate = _dedupe_ring_points(parts[0])
        original = originals[index]
        if (
            candidate.is_empty
            or not candidate.is_valid
            or candidate.area
            < MIN_FACET_REMAINING_FRACTION * original.area - 1e-9
            or candidate.area > 1.10 * original.area + 1e-9
        ):
            return None
        thinned.append(candidate)
    return thinned if within_limits(thinned) else None



# ---------------------------------------------------------------------
# DSM-residual labelling (Phase 4): build the drawing tiling from the
# LiDAR point cloud's own evidence instead of the fitted facets'
# convex hulls. Phase 1 proved the worst sketches are wrong because
# the hull tiling asserts contacts the fitted planes themselves
# disown (invented adjacencies: pairs whose intersection line sits
# metres from their drawn seam). Phase 3 validated the fix offline:
# rasterize the drawing outline at the point cloud's density, take
# the median pool height per cell as a DSM, and assign every cell to
# the plane with the smallest absolute residual — territory follows
# point-cloud evidence, so a seam can only appear where the two
# planes actually compete for the surface. Cells no plane explains
# (best residual > 0.30 m) form connected components; a component
# with enough raw points earns a NEW plane (bounded discovery, gates
# below) and the labelling repeats — that is what segments a face
# the RANSAC stage folded into a neighbour. The labelled tiling then
# feeds the Phase 2 boundary-graph surgery unchanged, and edge
# totals come from the graph as before.
#
# The discovery gates are the Phase 3 prototype's, byte-identical:
# every one of them exists because a looser variant produced a
# visible failure during Phase 3 validation (unmasked discovery
# stealing distant patches, a 0.20 m seeding tolerance diluting
# components into rejection). They are constants here, not knobs.
# The near-parallel fragment merge from the same prototype is
# deliberately NOT ported: it never fired legitimately on the
# seven-house validation set (fragments are either exactly identical
# — already merged — or genuinely different faces), so only the
# exact-equality collapse it generalised is applied, and only to
# group identical planes for labelling (their members split the
# group's region afterwards through the hull partition).
#
# Reported area stays plane-based: production facets keep their
# fitted areas, except that territory a discovered plane wins is
# transferred — each source facet is debited the sloped area of its
# overlap with the discovered region at its own pitch, and the
# discovered facet is credited exactly the debited total — so a
# discovery never moves the house's reported area, and the total is
# never re-faced from the rings.
# ---------------------------------------------------------------------

_LAB_UNEXPLAINED_TOL_M = 0.30     # best residual above this: no plane fits
_LAB_DISC_SEED_TOL_M = 0.30       # discovery seeding tolerance
_LAB_DISC_MIN_AREA_M2 = 2.0       # smallest component that can earn a plane
_LAB_DISC_MIN_POINTS = 40         # smallest point pool for a discovered plane
_LAB_DISC_MAX_RMSE_M = 0.08       # discovered plane must fit this well
_LAB_DISC_MAX_PITCH_DEG = 55.0
_LAB_DISC_MAX_ROUNDS = 3
_LAB_EVIDENCE_RESID_M = 0.20      # a plane's evidence: cells won this well
_LAB_EVIDENCE_DILATE_CELLS = 3
_LAB_POTTS_LAMBDA = 0.05          # label-smoothing prior (metres)
_LAB_DEAD_FACET_AREA_M2 = 0.5     # a label owning less is not a facet
_LAB_SLIVER_COMPONENT_M2 = 0.75   # label components smaller dissolve
_LAB_DSM_FILL_RADIUS_M = 1.5      # nearest-measured fill for empty cells
_LAB_CHAIN_SIMPLIFY_TOL_M = 0.15  # graph chain thinning for raster tilings
# Phase 5c fitter-stage passes. These run AFTER bounded discovery,
# whose gates above are unchanged; each new pass has its own gates,
# documented at its function. Both passes propose planes by
# deterministic RANSAC over a component's raw points and judge the
# proposal by the discovery acceptance numbers (inliers, trimmed
# rmse, pitch, residual cut) applied to the territory the plane
# actually claims, plus a near-refit guard: a candidate almost
# parallel to an existing plane and within _LAB_REFIT_OFFSET_M of
# it over its claim is that same face re-measured, not a new face.
_LAB_RANSAC_TOL_M = 0.10          # RANSAC inlier band for proposals
_LAB_RANSAC_SEEDS = (0, 1, 2, 3, 4, 5)
_LAB_RANSAC_MAX_TRIALS = 250
_LAB_CLAIM_TOL_M = 0.12           # a plane claims cells it fits this well
_LAB_CLAIM_MAIN_SHARE = 0.8       # the claim's largest connected piece
                                  # must hold this share of it (a real
                                  # face is one territory; a RANSAC slab
                                  # through scatter is not)
_LAB_REFIT_ANGLE_DEG = 5.0        # below this, two planes are one face...
_LAB_REFIT_OFFSET_M = 0.45        # ...when this close over the claim
_LAB_SPLIT_MAX_ACCEPTED = 3       # split-pass planes per house
_LAB_BOUNDARY_TOL_M = 0.12        # boundary pass seeds above this...
_LAB_BOUNDARY_MAX_ACCEPTED = 3    # boundary-pass planes per house
_LAB_BOUNDARY_MIN_ANGLE_DEG = 8.0  # vs the planes it displaces
# Phase 5d curved pass. Some real roof sections are not planes at
# all — a turret's half-cone, a barrel vault — and the plane model
# can only flatten them into ill-fitting pieces (Miramar's turret:
# the labelling left its rim unexplained and the Phase 5c core
# faces fragmented around it). After the boundary pass, components
# still unexplained at the discovery seed tolerance are tested
# against two curved surface families — a cone (height a linear
# function of radial distance from one centre) and a cylinder
# (height a function of distance from one axis line) — fitted by
# least squares over the component's points. Acceptance is at
# least as strict as discovery's, plus the two guards a curved
# family needs because it has more freedom than a plane:
#   * WIN MARGIN: the best plane refit on the same inlier points
#     must itself FAIL discovery's rmse bar and be at least
#     _LAB_CURVED_PLANE_WIN_FACTOR times worse than the surface —
#     a curved fit that merely ties a plane is a plane.
#   * INCUMBENT MEDIAN: the median incumbent residual over the
#     claimed cells must clear _LAB_CURVED_MIN_INCUMBENT_MEDIAN_M —
#     the territory must be genuinely poorly explained today, not
#     a re-tiling of cells some plane already fits (the failure
#     mode of fitting a shallow "cone" through the seam lines
#     radiating from a valley convergence: those points ARE
#     radial, but the planes own their cells at centimetre
#     residuals, so the median test refuses the claim).
# An accepted surface enters the labelling as one more facet: it
# competes by its true surface residual (its plane slot holds the
# tangent pseudo-plane at the claim centroid, for the consumers
# that need coefficients), its reported area is the TRUE curved
# area integrated over its region (the plane-scheme debits are
# scaled so they sum to it — see _dsm_labelling_tiling), and a
# cone's region rim is redrawn onto the fitted circle before the
# surgery runs (see _lab_apply_cone_rims).
_LAB_CURVED_SEED_TOL_M = 0.30        # seeds where discovery seeds
_LAB_CURVED_CLAIM_TOL_M = _LAB_CLAIM_TOL_M      # 0.12, as discovery
_LAB_CURVED_MAX_RMSE_M = _LAB_DISC_MAX_RMSE_M   # 0.08, as discovery
_LAB_CURVED_MIN_INLIERS = _LAB_DISC_MIN_POINTS  # 40, as discovery
_LAB_CURVED_MIN_CLAIM_SQM = _LAB_DISC_MIN_AREA_M2  # 2.0, as discovery
_LAB_CURVED_MIN_CLAIM_MAIN_SHARE = _LAB_CLAIM_MAIN_SHARE  # 0.8
_LAB_CURVED_MIN_PITCH_DEG = 12.0     # shallower is a plane's job
_LAB_CURVED_MAX_PITCH_DEG = _LAB_DISC_MAX_PITCH_DEG  # 55, as discovery
_LAB_CURVED_PLANE_WIN_FACTOR = 2.0
_LAB_CURVED_MIN_INCUMBENT_MEDIAN_M = 0.15
# Section-ness (judged on the claim): a curved SECTION contains
# its own centre — a turret's claim wraps its apex, a barrel's
# claim reaches its crown line. A tangent patch does not: two hip
# planes meeting at a hip approximate a cone arbitrarily well in
# an annulus sector around a centre metres away (measured on
# Miramar: a "cone" centred on the ridge, radius 7 m, fitting the
# north-east hip faces at rmse 0.06). So the claim's nearest cell
# must sit within _LAB_CURVED_MAX_CENTRE_GAP_M of the centre (the
# axis, for a cylinder), and a cone's explained territory must
# wrap at least _LAB_CURVED_MIN_SPAN_DEG around its centre — a
# section presents an arc, not a wedge sliver.
_LAB_CURVED_MAX_CENTRE_GAP_M = 1.0
_LAB_CURVED_MIN_SPAN_DEG = 100.0
_LAB_CURVED_MAX_ACCEPTED = 2         # curved facets per house
_LAB_CURVED_RIM_BAND_M = 0.7         # rim redraw band half-width
_LAB_CURVED_MAX_SUPPORT_M = 7.0      # a section's fit is local: pool
                                  # points farther than this from the
                                  # centre (or axis) cannot belong to
                                  # it — a turret or barrel is a local
                                  # surface, and an unbounded fit lets
                                  # the majority planes drag the scan
                                  # onto a roof-wide compromise cone
_SQFT_PER_SQM = 10.7639104167


def _curved_surface_z(
    surf: dict[str, Any], xs: Any, ys: Any
) -> Any:
    """Height of a fitted curved surface (Phase 5d) at plan
    positions — vectorized over numpy arrays, scalar-friendly.
    Cone: apex_z - slope * r about the centre. Cylinder: the upper
    arc about the axis line (n . p = offset), axis_z + sqrt(R^2 -
    d^2), clamped flat outside the arc's reach (residuals there
    are large by construction — the clamp only keeps the function
    total)."""
    if surf["kind"] == "cone":
        cx, cy = surf["centre"]
        return surf["apex_z"] - surf["slope"] * np.hypot(
            np.asarray(xs, dtype=float) - cx,
            np.asarray(ys, dtype=float) - cy,
        )
    nx, ny = surf["normal"]
    d = np.asarray(xs, dtype=float) * nx + np.asarray(ys, dtype=float) * ny - surf["offset"]
    radius = surf["radius_m"]
    return surf["axis_z"] + np.sqrt(
        np.maximum(radius * radius - d * d, 0.0)
    )


def _curved_surface_grad(
    surf: dict[str, Any], x: float, y: float
) -> tuple[float, float]:
    """Plan gradient (dz/dx, dz/dy) of a curved surface at a point:
    a cone's points radially outward at its slope; a cylinder's
    points across its axis, steepening toward the arc's edges."""
    if surf["kind"] == "cone":
        cx, cy = surf["centre"]
        r = math.hypot(x - cx, y - cy)
        if r <= 1e-9:
            return 0.0, 0.0
        return (
            -surf["slope"] * (x - cx) / r,
            -surf["slope"] * (y - cy) / r,
        )
    nx, ny = surf["normal"]
    d = x * nx + y * ny - surf["offset"]
    radius = surf["radius_m"]
    rise = math.sqrt(max(radius * radius - d * d, 1e-6))
    slope_across = -d / rise
    return slope_across * nx, slope_across * ny


def _curved_surface_factor(
    surf: dict[str, Any], xs: Any, ys: Any
) -> Any:
    """Sloped-area factor sqrt(1 + |grad z|^2) of a curved surface
    at plan positions: constant sqrt(1 + slope^2) for a cone (its
    true area is exactly plan area times this), R / rise for a
    cylinder."""
    if surf["kind"] == "cone":
        return np.full(
            np.broadcast(
                np.asarray(xs, dtype=float), np.asarray(ys, dtype=float)
            ).shape,
            math.sqrt(1.0 + surf["slope"] ** 2),
        )
    nx, ny = surf["normal"]
    d = np.asarray(xs, dtype=float) * nx + np.asarray(ys, dtype=float) * ny - surf["offset"]
    radius = surf["radius_m"]
    rise = np.sqrt(np.maximum(radius * radius - d * d, 1e-6))
    return radius / rise


def _fit_plane_lsq(
    points: np.ndarray,
) -> tuple[float, float, float, float]:
    """Least-squares z = a x + b y + c over xyz points; (a, b, c, rmse)."""
    design = np.column_stack(
        (points[:, 0], points[:, 1], np.ones(len(points)))
    )
    coef, *_ = np.linalg.lstsq(design, points[:, 2], rcond=None)
    resid = points[:, 2] - design @ coef
    return (
        float(coef[0]),
        float(coef[1]),
        float(coef[2]),
        float(np.sqrt(np.mean(resid**2))),
    )


class _DsmGrid:
    """Raster over the outline bbox: DSM height = median fit-pool
    height per cell; participating cells with no points are filled
    from the nearest measured cell within _LAB_DSM_FILL_RADIUS_M
    (flagged interpolated). Cell size follows point density
    (0.30–0.50 m), as in the Phase 3 prototype."""

    def __init__(self, points: np.ndarray, outline: Polygon):
        area = max(outline.area, 1.0)
        density = len(points) / area
        self.cell = float(min(0.50, max(0.30, math.sqrt(1.44 / density))))
        minx, miny, maxx, maxy = outline.bounds
        self.x0, self.y0 = minx, miny
        self.nx = int(math.ceil((maxx - minx) / self.cell)) + 1
        self.ny = int(math.ceil((maxy - miny) / self.cell)) + 1
        z = np.full((self.ny, self.nx), np.nan)
        counts = np.zeros((self.ny, self.nx), dtype=int)
        ix = np.floor((points[:, 0] - self.x0) / self.cell).astype(int)
        iy = np.floor((points[:, 1] - self.y0) / self.cell).astype(int)
        ok = (ix >= 0) & (ix < self.nx) & (iy >= 0) & (iy < self.ny)
        self.point_cell = (ix, iy, ok)
        flat = iy[ok] * self.nx + ix[ok]
        order = np.lexsort((points[ok][:, 2], flat))
        keys = flat[order]
        zs = points[ok][:, 2][order]
        bounds = np.searchsorted(keys, np.arange(self.nx * self.ny + 1))
        for k in range(self.nx * self.ny):
            lo, hi = bounds[k], bounds[k + 1]
            if hi > lo:
                z.flat[k] = float(np.median(zs[lo:hi]))
                counts.flat[k] = hi - lo
        self.z_measured = z
        self.counts = counts
        # Participating cells: the cell square intersects the outline.
        from shapely.geometry import box
        from shapely.prepared import prep

        prepared = prep(outline)
        inside = np.zeros((self.ny, self.nx), dtype=bool)
        for gy in range(self.ny):
            for gx in range(self.nx):
                cell_box = box(
                    self.x0 + gx * self.cell,
                    self.y0 + gy * self.cell,
                    self.x0 + (gx + 1) * self.cell,
                    self.y0 + (gy + 1) * self.cell,
                )
                if prepared.intersects(cell_box):
                    inside[gy, gx] = True
        self.inside = inside
        filled = z.copy()
        interpolated = np.zeros_like(inside)
        measured_idx = np.argwhere(~np.isnan(z))
        if len(measured_idx):
            from scipy.spatial import cKDTree

            tree = cKDTree(measured_idx[:, ::-1].astype(float))
            empty = np.argwhere(inside & np.isnan(z))
            if len(empty):
                dist, near = tree.query(empty[:, ::-1].astype(float), k=1)
                for row, d, n in zip(empty, dist, near):
                    if d * self.cell <= _LAB_DSM_FILL_RADIUS_M:
                        src = measured_idx[n]
                        filled[row[0], row[1]] = z[src[0], src[1]]
                        interpolated[row[0], row[1]] = True
        self.z = filled
        self.interpolated = interpolated

    def centres(self) -> tuple[np.ndarray, np.ndarray]:
        xs = self.x0 + (np.arange(self.nx) + 0.5) * self.cell
        ys = self.y0 + (np.arange(self.ny) + 0.5) * self.cell
        return np.meshgrid(xs, ys)


def _lab_resid_stack(
    planes: list[tuple[float, float, float]],
    grid: _DsmGrid,
    masks: list[np.ndarray | None] | None = None,
    curved: dict[int, dict[str, Any]] | None = None,
) -> np.ndarray:
    """Per-index absolute-residual layers over the DSM grid — the
    shared currency of the labelling competition (label grid,
    smoothing, cleanup all read residuals through here so they can
    never disagree about what a facet explains). An index carrying
    a mask competes only inside it. Phase 5d: an index present in
    `curved` competes by its fitted SURFACE's residual, not its
    tangent pseudo-plane's — the pseudo-plane exists only so
    plane-shaped consumers have coefficients to hold; the
    labelling itself must judge the true surface."""
    xs, ys = grid.centres()
    layers = []
    for i, (a, b, c) in enumerate(planes):
        if curved is not None and i in curved:
            layer = np.abs(_curved_surface_z(curved[i], xs, ys) - grid.z)
        else:
            layer = np.abs(a * xs + b * ys + c - grid.z)
        if masks is not None and masks[i] is not None:
            layer = np.where(masks[i], layer, np.inf)
        layers.append(layer)
    return np.stack(layers)


def _lab_label_grid(
    planes: list[tuple[float, float, float]],
    grid: _DsmGrid,
    masks: list[np.ndarray | None] | None = None,
    curved: dict[int, dict[str, Any]] | None = None,
) -> tuple[np.ndarray, np.ndarray]:
    """(labels, best_residual): each participating cell takes the
    plane with the smallest absolute residual at the cell centre
    against the DSM height; -1 where no DSM height exists. A plane
    carrying a mask competes only inside it — a plane fitted to one
    component must not win scattered cells across the roof where it
    happens to pass near the surface."""
    labels = np.full(grid.z.shape, -1, dtype=int)
    best = np.full(grid.z.shape, np.inf)
    valid = grid.inside & ~np.isnan(grid.z)
    if not planes or not valid.any():
        return labels, best
    resid = _lab_resid_stack(planes, grid, masks, curved)
    choice = np.argmin(resid, axis=0)
    best_vals = np.min(resid, axis=0)
    labels[valid] = choice[valid]
    best[valid] = best_vals[valid]
    return labels, best


def _lab_discover_planes(
    planes: list[tuple[float, float, float]],
    grid: _DsmGrid,
    points: np.ndarray,
    labels: np.ndarray,
    best: np.ndarray,
) -> tuple[
    list[tuple[float, float, float]],
    list[dict[str, Any]],
    np.ndarray,
    np.ndarray,
    list[np.ndarray | None],
]:
    """Grow the plane set from unexplained territory: connected
    components of cells whose best residual exceeds the tolerance,
    large enough to matter, get a trimmed-LSQ plane fitted to the
    raw fit-pool points inside them. Accepted planes join the set
    and the labelling repeats (at most _LAB_DISC_MAX_ROUNDS rounds).
    Each accepted plane carries a competition mask (its component,
    dilated by one cell) so it can only win territory near the
    evidence that created it. Returns (planes, discovered, labels,
    best, masks) — masks aligned with planes, None for the planes
    the caller started with. The acceptance gates are Phase 3's,
    unchanged."""
    from scipy import ndimage
    from shapely.geometry import box
    from shapely.ops import unary_union

    planes = list(planes)
    masks: list[np.ndarray | None] = [None] * len(planes)
    discovered: list[dict[str, Any]] = []
    ix, iy, ok = grid.point_cell
    point_flat = np.where(ok, iy * grid.nx + ix, -1)
    structure = np.ones((3, 3), dtype=int)
    for _round in range(_LAB_DISC_MAX_ROUNDS):
        unexplained = grid.inside & (labels >= 0) & (best > _LAB_DISC_SEED_TOL_M)
        if not unexplained.any():
            break
        comps, n = ndimage.label(unexplained, structure=structure)
        sizes = (
            ndimage.sum(unexplained, comps, index=np.arange(1, n + 1))
            * grid.cell**2
        )
        order = np.argsort(-sizes)
        accepted_any = False
        for comp_idx in order:
            area_m2 = float(sizes[comp_idx])
            if area_m2 < _LAB_DISC_MIN_AREA_M2:
                break
            comp = comps == (comp_idx + 1)
            cell_ids = set(np.where(comp.ravel())[0].tolist())
            sel = np.array([f in cell_ids for f in point_flat])
            pool = points[sel & (point_flat >= 0)]
            if len(pool) < _LAB_DISC_MIN_POINTS:
                continue
            keep = pool
            a = b = c = float("nan")
            for _trim in range(3):
                a, b, c, _rmse = _fit_plane_lsq(keep)
                resid = np.abs(
                    a * pool[:, 0] + b * pool[:, 1] + c - pool[:, 2]
                )
                keep = pool[resid <= 0.12]
                if len(keep) < _LAB_DISC_MIN_POINTS:
                    break
            if len(keep) < _LAB_DISC_MIN_POINTS:
                continue
            a2, b2, c2, rmse2 = _fit_plane_lsq(keep)
            if rmse2 > _LAB_DISC_MAX_RMSE_M:
                continue
            pitch = math.degrees(math.atan(math.hypot(a2, b2)))
            if pitch > _LAB_DISC_MAX_PITCH_DEG:
                continue
            # The new plane must actually explain the component: it
            # has to at least halve the component's mean residual.
            xs_g, ys_g = grid.centres()
            new_resid = np.abs(
                a2 * xs_g[comp] + b2 * ys_g[comp] + c2 - grid.z[comp]
            )
            if float(np.mean(new_resid)) > 0.5 * float(np.mean(best[comp])):
                continue
            ys_c, xs_c = np.where(comp)
            region = unary_union([
                box(
                    grid.x0 + gx * grid.cell,
                    grid.y0 + gy * grid.cell,
                    grid.x0 + (gx + 1) * grid.cell,
                    grid.y0 + (gy + 1) * grid.cell,
                )
                for gy, gx in zip(ys_c, xs_c)
            ])
            planes.append((a2, b2, c2))
            masks.append(
                ndimage.binary_dilation(comp, structure=structure)
                & grid.inside
            )
            discovered.append({
                "plane": (a2, b2, c2),
                "pitch_degrees": pitch,
                "point_count": int(len(keep)),
                "fit_rmse_m": float(rmse2),
                "region": region,
            })
            accepted_any = True
            break  # relabel before judging the next component
        labels, best = _lab_label_grid(planes, grid, masks)
        if not accepted_any:
            break
    return planes, discovered, labels, best, masks


def _lab_ransac_propose(
    pool: np.ndarray, excluded: np.ndarray | None = None
) -> np.ndarray | None:
    """Deterministic RANSAC plane proposal over a point pool: the
    service's own RANSAC shape (3-point minimal samples, fixed
    seeds, best inlier set wins). Returns the inlier mask over
    `pool` for the strongest hypothesis, or None. `excluded` drops
    points from consideration before proposing (used to re-propose
    past a rejected hypothesis without re-finding it)."""
    from sklearn.linear_model import LinearRegression, RANSACRegressor

    avail = np.ones(len(pool), dtype=bool)
    if excluded is not None:
        avail &= ~excluded
    pts = pool[avail]
    if len(pts) < _LAB_DISC_MIN_POINTS:
        return None
    best_inliers: np.ndarray | None = None
    for seed in _LAB_RANSAC_SEEDS:
        estimator = RANSACRegressor(
            estimator=LinearRegression(),
            min_samples=3,
            residual_threshold=_LAB_RANSAC_TOL_M,
            max_trials=_LAB_RANSAC_MAX_TRIALS,
            random_state=seed,
        )
        try:
            estimator.fit(pts[:, :2], pts[:, 2])
        except (ValueError, FloatingPointError):
            continue
        inliers = estimator.inlier_mask_
        if inliers is None:
            continue
        if best_inliers is None or int(inliers.sum()) > int(
            best_inliers.sum()
        ):
            best_inliers = inliers
    if best_inliers is None:
        return None
    out = np.zeros(len(pool), dtype=bool)
    out[np.where(avail)[0][best_inliers]] = True
    return out


def _lab_trimmed_refit(
    pool: np.ndarray, seed_inliers: np.ndarray
) -> tuple[tuple[float, float, float], int, float] | None:
    """Discovery's trimmed-LSQ procedure, seeded from a RANSAC
    inlier set instead of the whole pool: fit on the seed, then
    re-keep the pool at <= 0.12 m and refit (three rounds). A raw
    component pool is a mixture of faces, so discovery's
    whole-pool seed converges on a compromise; the RANSAC seed
    starts the same trim on one face's own points. Returns
    (plane, inlier count, trimmed rmse) or None."""
    keep = pool[seed_inliers]
    if len(keep) < _LAB_DISC_MIN_POINTS:
        return None
    a = b = c = float("nan")
    for _trim in range(3):
        a, b, c, _rmse = _fit_plane_lsq(keep)
        resid = np.abs(a * pool[:, 0] + b * pool[:, 1] + c - pool[:, 2])
        keep = pool[resid <= 0.12]
        if len(keep) < _LAB_DISC_MIN_POINTS:
            return None
    a2, b2, c2, rmse2 = _fit_plane_lsq(keep)
    return (a2, b2, c2), int(len(keep)), float(rmse2)


def _lab_plane_angle_deg(
    first: tuple[float, float, float], second: tuple[float, float, float]
) -> float:
    """Angle between two planes' normals, degrees."""
    n1 = np.array([-first[0], -first[1], 1.0])
    n2 = np.array([-second[0], -second[1], 1.0])
    cos = float(n1 @ n2) / (np.linalg.norm(n1) * np.linalg.norm(n2))
    return math.degrees(math.acos(max(-1.0, min(1.0, cos))))


def _lab_split_cell_mask(
    mask: np.ndarray, grid: _DsmGrid
) -> list[np.ndarray]:
    """Split a component's cells into two halves along its longer
    axis at the median cell centre; [] when the component is too
    thin to split (span under two cells on both axes)."""
    ys_c, xs_c = np.where(mask)
    if len(ys_c) < 2:
        return []
    xs_g, ys_g = grid.centres()
    cx = xs_g[ys_c, xs_c]
    cy = ys_g[ys_c, xs_c]
    span_x = float(cx.max() - cx.min())
    span_y = float(cy.max() - cy.min())
    if max(span_x, span_y) < 2 * grid.cell:
        return []
    halves = []
    if span_x >= span_y:
        med = float(np.median(cx))
        for side in (cx <= med, cx > med):
            half = np.zeros_like(mask)
            half[ys_c[side], xs_c[side]] = True
            halves.append(half)
    else:
        med = float(np.median(cy))
        for side in (cy <= med, cy > med):
            half = np.zeros_like(mask)
            half[ys_c[side], xs_c[side]] = True
            halves.append(half)
    return [h for h in halves if h.any()]


def _lab_hypotheses(
    pool: np.ndarray,
    pool_cells: np.ndarray,
    comp: np.ndarray,
    grid: _DsmGrid,
):
    """Yield trimmed-refit hypotheses (plane, inliers, rmse) for
    one component, strongest evidence first:

    1. whole-pool RANSAC, re-proposing past each hypothesis's
       inliers (a rejected dominant plane must not end the search);
    2. RANSAC seeded on spatial sub-pools — the component split
       into halves, then quarters. A mixture component's dominant
       face can starve a smaller real face out of every whole-pool
       proposal (the pool's points interleave), but a sub-pool the
       smaller face dominates proposes it directly. Refits and all
       gate statistics always run on the FULL component pool; a
       sub-pool only chooses the hypothesis.
    Duplicate hypotheses (same plane to 1e-6) are yielded once.
    """
    seen: set[tuple[int, int, int]] = set()

    def fresh(refit):
        if refit is None:
            return None
        key = tuple(round(v, 6) for v in refit[0])
        if key in seen:
            return None
        seen.add(key)
        return refit

    excluded: np.ndarray | None = None
    for _ in range(3):
        inliers = _lab_ransac_propose(pool, excluded)
        if inliers is None:
            break
        refit = fresh(_lab_trimmed_refit(pool, inliers))
        if refit is not None:
            yield refit
        excluded = inliers if excluded is None else (excluded | inliers)
    frontier = [comp]
    for _depth in range(2):
        nxt: list[np.ndarray] = []
        for sub in frontier:
            for half in _lab_split_cell_mask(sub, grid):
                nxt.append(half)
                ids = set(np.where(half.ravel())[0].tolist())
                sel = np.array([f in ids for f in pool_cells])
                sub_pool = pool[sel]
                if len(sub_pool) < _LAB_DISC_MIN_POINTS:
                    continue
                local = _lab_ransac_propose(sub_pool)
                if local is None:
                    continue
                inliers = np.zeros(len(pool), dtype=bool)
                inliers[np.where(sel)[0][local]] = True
                refit = fresh(_lab_trimmed_refit(pool, inliers))
                if refit is not None:
                    yield refit
        frontier = nxt


def _lab_judge_candidate(
    pool: np.ndarray,
    pool_cells: np.ndarray,
    comp: np.ndarray,
    grid: _DsmGrid,
    best: np.ndarray,
    planes: list[tuple[float, float, float]],
    angle_gate: list[tuple[float, float, float]] | None = None,
) -> tuple[
    tuple[float, float, float], np.ndarray, dict[str, Any]
] | None:
    """Judge a component's hypotheses (see _lab_hypotheses) by the
    Phase 5c gates; returns (plane, claim cells, descriptor) for
    the first hypothesis that passes all of them, else None.

    Gates (the discovery acceptance numbers, applied to the
    territory the plane claims rather than the whole component —
    a split plane by definition explains only part of its
    component):
    - trimmed refit gathers >= _LAB_DISC_MIN_POINTS inliers at
      rmse <= _LAB_DISC_MAX_RMSE_M and pitch <= _LAB_DISC_MAX_PITCH_DEG;
    - the claim (component cells the plane fits within
      _LAB_CLAIM_TOL_M on the DSM) covers >= _LAB_DISC_MIN_AREA_M2
      and the plane at least halves the claim's mean residual —
      discovery's >= 50% residual cut, localized to the claim;
    - claim coherence: the claim's largest connected component
      holds >= _LAB_CLAIM_MAIN_SHARE of it and becomes the claim
      (a real face is one territory; a RANSAC "densest slab"
      through scattered points peppers cells everywhere and has
      no dominant piece);
    - near-refit guard: a candidate within _LAB_REFIT_ANGLE_DEG of
      an existing plane and within _LAB_REFIT_OFFSET_M of it over
      the claim centroid is that face re-measured, not a new face;
    - `angle_gate`, when given, lists planes the candidate must
      differ from by >= _LAB_BOUNDARY_MIN_ANGLE_DEG (the boundary
      pass's displaced faces): a hip is a genuinely different
      surface from the slopes it displaces, and anything more
      parallel is a refit of one of them.
    """
    from shapely.geometry import box
    from shapely.ops import unary_union

    xs_g, ys_g = grid.centres()
    for (a, b, c), n_inliers, rmse in _lab_hypotheses(
        pool, pool_cells, comp, grid
    ):
        pitch = math.degrees(math.atan(math.hypot(a, b)))
        if rmse > _LAB_DISC_MAX_RMSE_M or pitch > _LAB_DISC_MAX_PITCH_DEG:
            continue
        claim = comp & (
            np.abs(a * xs_g + b * ys_g + c - grid.z) <= _LAB_CLAIM_TOL_M
        )
        if float(claim.sum()) * grid.cell**2 < _LAB_DISC_MIN_AREA_M2:
            continue
        # Claim coherence: a real face's claim is one territory.
        # RANSAC can also find a "densest slab" through scattered
        # points (noise, vegetation, mixed pixels) whose fitting
        # cells pepper the whole component — such a claim has no
        # dominant connected piece and is refused. The claim is
        # trimmed to its largest connected component either way.
        from scipy import ndimage

        claim_parts, n_parts = ndimage.label(
            claim, structure=np.ones((3, 3), int)
        )
        if n_parts > 1:
            part_sizes = ndimage.sum(
                claim, claim_parts, index=np.arange(1, n_parts + 1)
            )
            largest = int(np.argmax(part_sizes)) + 1
            if float(part_sizes[largest - 1]) < _LAB_CLAIM_MAIN_SHARE * float(
                claim.sum()
            ):
                continue
            claim = claim_parts == largest
            if float(claim.sum()) * grid.cell**2 < _LAB_DISC_MIN_AREA_M2:
                continue
        if (
            float(np.mean(np.abs(a * xs_g[claim] + b * ys_g[claim] + c - grid.z[claim])))
            > 0.5 * float(np.mean(best[claim]))
        ):
            continue
        centroid = (
            float(xs_g[claim].mean()),
            float(ys_g[claim].mean()),
        )
        refit_of_existing = False
        for existing in planes:
            if _lab_plane_angle_deg((a, b, c), existing) >= _LAB_REFIT_ANGLE_DEG:
                continue
            offset = abs(
                (a - existing[0]) * centroid[0]
                + (b - existing[1]) * centroid[1]
                + (c - existing[2])
            )
            if offset < _LAB_REFIT_OFFSET_M:
                refit_of_existing = True
                break
        if refit_of_existing:
            continue
        if angle_gate is not None and any(
            _lab_plane_angle_deg((a, b, c), other) < _LAB_BOUNDARY_MIN_ANGLE_DEG
            for other in angle_gate
        ):
            continue
        ys_c, xs_c = np.where(claim)
        region = unary_union([
            box(
                grid.x0 + gx * grid.cell,
                grid.y0 + gy * grid.cell,
                grid.x0 + (gx + 1) * grid.cell,
                grid.y0 + (gy + 1) * grid.cell,
            )
            for gy, gx in zip(ys_c, xs_c)
        ])
        descriptor = {
            "plane": (a, b, c),
            "pitch_degrees": pitch,
            "point_count": n_inliers,
            "fit_rmse_m": rmse,
            "region": region,
        }
        return (a, b, c), claim, descriptor
    return None


def _lab_ransac_stage(
    planes: list[tuple[float, float, float]],
    discovered: list[dict[str, Any]],
    labels: np.ndarray,
    best: np.ndarray,
    masks: list[np.ndarray | None],
    grid: _DsmGrid,
    points: np.ndarray,
    *,
    band: Any,
    max_accepted: int,
    boundary: bool,
) -> tuple[
    list[tuple[float, float, float]],
    list[dict[str, Any]],
    np.ndarray,
    np.ndarray,
    list[np.ndarray | None],
]:
    """One Phase 5c growth stage: while acceptances remain, take
    the largest candidate component in `band` (a boolean mask over
    the grid, recomputed after every acceptance), judge its point
    pool with _lab_judge_candidate, and on acceptance append the
    plane with a discovery-style competition mask (its claim,
    dilated one cell) and relabel. Mirrors the discovery loop's
    shape — largest first, one acceptance per pass, relabel before
    judging the next component — so the new planes enter the
    labelling on exactly the same terms as discovered ones. With
    `boundary=True`, each component's dominant current owners
    (>= 20% of its cells) form the candidate's angle gate."""
    from scipy import ndimage

    planes = list(planes)
    masks = list(masks)
    discovered = list(discovered)
    ix, iy, ok = grid.point_cell
    point_flat = np.where(ok, iy * grid.nx + ix, -1)
    structure = np.ones((3, 3), dtype=int)
    accepted = 0
    while accepted < max_accepted:
        seed = band(labels, best, grid)
        if not seed.any():
            break
        comps, n = ndimage.label(seed, structure=structure)
        sizes = (
            ndimage.sum(seed, comps, index=np.arange(1, n + 1))
            * grid.cell**2
        )
        first_cell = np.full(n, np.inf)
        flat_idx = np.arange(comps.size)
        for idx in range(n):
            cells = flat_idx[comps.ravel() == idx + 1]
            if len(cells):
                first_cell[idx] = cells.min()
        order = sorted(
            range(n), key=lambda i: (-sizes[i], first_cell[i])
        )
        progressed = False
        for comp_idx in order:
            if float(sizes[comp_idx]) < _LAB_DISC_MIN_AREA_M2:
                break
            comp = comps == (comp_idx + 1)
            cell_ids = set(np.where(comp.ravel())[0].tolist())
            sel = np.array([f in cell_ids for f in point_flat])
            pool_mask = sel & (point_flat >= 0)
            pool = points[pool_mask]
            pool_cells = point_flat[pool_mask]
            if len(pool) < _LAB_DISC_MIN_POINTS:
                continue
            angle_gate = None
            if boundary:
                owners, counts = np.unique(
                    labels[comp][labels[comp] >= 0], return_counts=True
                )
                angle_gate = [
                    planes[int(owner)]
                    for owner, count in zip(owners, counts)
                    if count >= 0.2 * counts.sum()
                ]
            judged = _lab_judge_candidate(
                pool, pool_cells, comp, grid, best, planes, angle_gate
            )
            if judged is None:
                continue
            plane, claim, descriptor = judged
            planes.append(plane)
            masks.append(
                ndimage.binary_dilation(claim, structure=structure)
                & grid.inside
            )
            discovered.append(descriptor)
            labels, best = _lab_label_grid(planes, grid, masks)
            accepted += 1
            progressed = True
            break
        if not progressed:
            break
    return planes, discovered, labels, best, masks


def _lab_split_planes(
    planes: list[tuple[float, float, float]],
    discovered: list[dict[str, Any]],
    labels: np.ndarray,
    best: np.ndarray,
    masks: list[np.ndarray | None],
    grid: _DsmGrid,
    points: np.ndarray,
) -> tuple[
    list[tuple[float, float, float]],
    list[dict[str, Any]],
    np.ndarray,
    np.ndarray,
    list[np.ndarray | None],
]:
    """Phase 5c split pass: multi-plane splitting of the
    unexplained components discovery refused. A component that no
    single plane fits (Miramar's valley-convergence core, Ave
    148's crossing surface) can still hold real faces — discovery's
    whole-pool trim converges on a compromise and correctly
    refuses, but a RANSAC proposal seeded on one face's points
    passes the same acceptance numbers on the territory that face
    claims. The pass works the same components discovery seeds
    from (best residual > _LAB_DISC_SEED_TOL_M); the discovery
    gates themselves are untouched."""

    def band(labels_: np.ndarray, best_: np.ndarray, grid_: _DsmGrid):
        return grid_.inside & (labels_ >= 0) & (best_ > _LAB_DISC_SEED_TOL_M)

    return _lab_ransac_stage(
        planes, discovered, labels, best, masks, grid, points,
        band=band, max_accepted=_LAB_SPLIT_MAX_ACCEPTED, boundary=False,
    )


def _lab_boundary_planes(
    planes: list[tuple[float, float, float]],
    discovered: list[dict[str, Any]],
    labels: np.ndarray,
    best: np.ndarray,
    masks: list[np.ndarray | None],
    grid: _DsmGrid,
    points: np.ndarray,
) -> tuple[
    list[tuple[float, float, float]],
    list[dict[str, Any]],
    np.ndarray,
    np.ndarray,
    list[np.ndarray | None],
]:
    """Phase 5c boundary pass: faces the seeding tolerance hides.
    A hip triangle at a roof end sits within ~0.3 m of the two
    slopes it joins over most of its small area, so its cells never
    cross the discovery seed and no component forms — but the
    cells ARE systematically worse-explained than their
    surroundings. This pass seeds components from the moderately
    explained band (_LAB_BOUNDARY_TOL_M < best residual <= the
    discovery seed) and holds each RANSAC proposal to the same
    acceptance numbers, plus an angle gate: the candidate must
    differ by >= _LAB_BOUNDARY_MIN_ANGLE_DEG from every plane
    owning a fifth or more of its component — a hip is a genuinely
    different surface from the slopes it displaces, and a
    near-parallel winner is a refit of one of them, which the
    near-refit guard also refuses."""

    def band(labels_: np.ndarray, best_: np.ndarray, grid_: _DsmGrid):
        return (
            grid_.inside
            & (labels_ >= 0)
            & (best_ > _LAB_BOUNDARY_TOL_M)
            & (best_ <= _LAB_DISC_SEED_TOL_M)
        )

    return _lab_ransac_stage(
        planes, discovered, labels, best, masks, grid, points,
        band=band, max_accepted=_LAB_BOUNDARY_MAX_ACCEPTED, boundary=True,
    )


def _cone_lsq(
    xs: np.ndarray, ys: np.ndarray, zs: np.ndarray, cx: float, cy: float
) -> tuple[float, float] | None:
    """Least-squares cone z = apex - slope * r about a FIXED centre
    (two parameters, closed form)."""
    u = -np.hypot(xs - cx, ys - cy)
    um = float(u.mean())
    zm = float(zs.mean())
    var = float(((u - um) ** 2).sum())
    if var <= 1e-12:
        return None
    slope = float(((u - um) * (zs - zm)).sum() / var)
    return zm - slope * um, slope


def _cone_trimmed_fit(
    xs: np.ndarray, ys: np.ndarray, zs: np.ndarray, cx: float, cy: float,
    init: tuple[float, float] | None = None,
) -> tuple[float, float, np.ndarray, float] | None:
    """Iteratively trimmed cone fit about a fixed centre: refit on
    the points within the claim tolerance until the inlier set is
    stable. Returns (apex_z, slope, inlier_mask, inlier_rmse).
    `init` seeds (apex, slope) directly — the RANSAC start below:
    a whole-population least-squares start is dragged by the
    neighbouring surfaces sharing the support disc (on Miramar
    the main slope sits ABOVE the turret cone's extension and the
    lower roof below it), and trimming from a dragged start
    converges to a compromise, not the section."""
    if init is not None:
        apex, slope = init
    else:
        fit = _cone_lsq(xs, ys, zs, cx, cy)
        if fit is None:
            return None
        apex, slope = fit
    inliers: np.ndarray | None = None
    for _ in range(3):
        resid = np.abs(zs - (apex - slope * np.hypot(xs - cx, ys - cy)))
        inliers = resid <= _LAB_CURVED_CLAIM_TOL_M
        if int(inliers.sum()) < _LAB_CURVED_MIN_INLIERS:
            return None
        fit = _cone_lsq(xs[inliers], ys[inliers], zs[inliers], cx, cy)
        if fit is None:
            return None
        apex, slope = fit
    assert inliers is not None
    resid = np.abs(
        zs[inliers] - (apex - slope * np.hypot(xs[inliers] - cx, ys[inliers] - cy))
    )
    rmse = float(np.sqrt(np.mean(resid**2))) if len(resid) else math.inf
    return apex, slope, inliers, rmse


def _cone_ransac_start(
    zs: np.ndarray, radii: np.ndarray
) -> tuple[float, float] | None:
    """A RANSAC (apex, slope) start for the trimmed cone fit about
    a fixed centre: two points at well-separated radii define a
    cone's parameters exactly, so deterministic pair sampling
    (fixed-seed, like the split pass's RANSAC) finds the section's
    own parameters even when its points are a minority of the
    support disc. Scored by inliers over the whole disc."""
    n = len(zs)
    if n < _LAB_CURVED_MIN_INLIERS:
        return None
    min_slope = math.tan(math.radians(_LAB_CURVED_MIN_PITCH_DEG))
    max_slope = math.tan(math.radians(_LAB_CURVED_MAX_PITCH_DEG))
    rng = np.random.default_rng(20261128)
    best: tuple[int, float, float] | None = None
    for _ in range(150):
        i, j = int(rng.integers(0, n)), int(rng.integers(0, n))
        if abs(radii[j] - radii[i]) < 0.8:
            continue
        slope = (zs[i] - zs[j]) / (radii[j] - radii[i])
        if not min_slope <= slope <= max_slope:
            continue
        apex = zs[i] + slope * radii[i]
        resid = np.abs(zs - (apex - slope * radii))
        count = int((resid <= _LAB_CURVED_CLAIM_TOL_M).sum())
        if best is None or count > best[0]:
            best = (count, apex, slope)
    if best is None or best[0] < _LAB_CURVED_MIN_INLIERS:
        return None
    return best[1], best[2]


def _cone_trimmed_at(
    xs: np.ndarray, ys: np.ndarray, zs: np.ndarray, cx: float, cy: float
) -> tuple[int, float, float, float] | None:
    """The trimmed cone fit about one centre, with the pitch and
    rmse gates applied. Returns (inliers, apex, slope, rmse) or
    None. The fit is tried at nested support radii, from both a
    least-squares start and a RANSAC start, and the best passing
    fit wins: a section is local — at the full support radius the
    neighbouring planes outnumber its points — and a dragged
    least-squares start converges to a compromise surface, while
    the RANSAC start begins on the section itself."""
    min_slope = math.tan(math.radians(_LAB_CURVED_MIN_PITCH_DEG))
    max_slope = math.tan(math.radians(_LAB_CURVED_MAX_PITCH_DEG))
    radii = np.hypot(xs - cx, ys - cy)
    best: tuple[int, float, float, float] | None = None
    for support in (4.0, 5.5, _LAB_CURVED_MAX_SUPPORT_M):
        local = radii <= support
        if int(local.sum()) < _LAB_CURVED_MIN_INLIERS:
            continue
        lx, ly, lz = xs[local], ys[local], zs[local]
        starts: list[tuple[float, float] | None] = [None]
        ransac = _cone_ransac_start(lz, radii[local])
        if ransac is not None:
            starts.append(ransac)
        for init in starts:
            result = _cone_trimmed_fit(lx, ly, lz, cx, cy, init=init)
            if result is None:
                continue
            apex, slope, inliers, rmse = result
            if not min_slope <= slope <= max_slope or rmse > _LAB_CURVED_MAX_RMSE_M:
                continue
            cand = (int(inliers.sum()), apex, slope, rmse)
            if best is None or (cand[0], -cand[3]) > (best[0], -best[3]):
                best = cand
    return best


def _cone_polish(
    xs: np.ndarray, ys: np.ndarray, zs: np.ndarray, cx: float, cy: float
) -> tuple[int, float, float, float, float, float, float] | None:
    """Polish one proposed centre: trimmed fits on a 0.25 m
    walking grid around it, keeping the best (inliers, rmse).
    Returns (inliers, -rmse, cx, cy, apex, slope, rmse) or None."""
    centre = (cx, cy)
    best: tuple[int, float, float, float, float, float] | None = None
    tried: set[tuple[float, float]] = set()
    for _round in range(3):
        improved = False
        offsets = (0.0,) if _round == 0 else (-0.25, 0.0, 0.25)
        for dx in offsets:
            for dy in offsets:
                key = (round(centre[0] + dx, 3), round(centre[1] + dy, 3))
                if key in tried:
                    continue
                tried.add(key)
                result = _cone_trimmed_at(xs, ys, zs, key[0], key[1])
                if result is None:
                    continue
                n_in, apex, slope, rmse = result
                if best is None or (n_in, -rmse) > (best[0], -best[5]):
                    best = (n_in, key[0], key[1], apex, slope, rmse)
                    centre = key
                    improved = True
        if not improved:
            break
    if best is None:
        return None
    n_in, bx, by, apex, slope, rmse = best
    return n_in, -rmse, bx, by, apex, slope, rmse


def _cone_scan_centres(
    xs: np.ndarray, ys: np.ndarray, zs: np.ndarray
) -> list[tuple[float, float]]:
    """Coarse centre proposals from a plain least-squares scan:
    centres on a 0.5 m grid over the points' extent (plus a metre
    of margin — a turret's apex can sit just outside the
    unexplained cells that seeded the search), ranked by
    single-fit inliers. Only a proposal mechanism: on a merged
    component the scan's winners are compromise centres, which is
    why the gradient vote below exists and why every proposal is
    polished and judged before it can ship."""
    min_slope = math.tan(math.radians(_LAB_CURVED_MIN_PITCH_DEG))
    max_slope = math.tan(math.radians(_LAB_CURVED_MAX_PITCH_DEG))
    scored: list[tuple[int, float, float]] = []
    for cx in np.arange(xs.min() - 1.0, xs.max() + 1.0 + 1e-9, 0.5):
        for cy in np.arange(ys.min() - 1.0, ys.max() + 1.0 + 1e-9, 0.5):
            radii = np.hypot(xs - cx, ys - cy)
            local = radii <= _LAB_CURVED_MAX_SUPPORT_M
            if int(local.sum()) < _LAB_CURVED_MIN_INLIERS:
                continue
            fit = _cone_lsq(xs[local], ys[local], zs[local], float(cx), float(cy))
            if fit is None:
                continue
            apex, slope = fit
            if not min_slope <= slope <= max_slope:
                continue
            resid = np.abs(zs[local] - (apex - slope * radii[local]))
            scored.append(
                (int((resid <= _LAB_CURVED_CLAIM_TOL_M).sum()), float(cx), float(cy))
            )
    scored.sort(key=lambda item: -item[0])
    return [(cx, cy) for _n, cx, cy in scored]


def _cone_centre_votes(
    grid: _DsmGrid, region_cells: np.ndarray
) -> list[tuple[float, float]]:
    """Centre proposals by gradient convergence (a Hough vote):
    on a cone, every surface cell's uphill direction points at
    the centre, so rays cast uphill from the component's measured
    DSM cells accumulate at the true centre even when the cone's
    points are a minority of the pool. Plane faces vote with
    parallel rays that disperse (their crossings are broad and
    weak next to a radial surface's focus). Returns up to six
    peak centres, strongest first."""
    xs_g, ys_g = grid.centres()
    grad_y, grad_x = np.gradient(grid.z, grid.cell, grid.cell)
    mag = np.hypot(grad_x, grad_y)
    voters = (
        region_cells
        & (grid.counts > 0)
        & np.isfinite(grid.z)
        & (mag >= 0.15)
        & (mag <= 1.8)
    )
    ys_c, xs_c = np.where(voters)
    if len(ys_c) < 10:
        return []
    # Uphill IS the gradient direction (the gradient points at
    # increasing height): on a cone z = apex - slope * r, the
    # gradient is -slope * r_hat — it aims at the centre.
    ux = grad_x[voters] / mag[voters]
    uy = grad_y[voters] / mag[voters]
    px = xs_g[voters]
    py = ys_g[voters]
    bin_m = 0.25
    origin_x, origin_y = grid.x0 - 1.0, grid.y0 - 1.0
    width = int((grid.nx * grid.cell + 2.0) / bin_m) + 1
    height = int((grid.ny * grid.cell + 2.0) / bin_m) + 1
    hist = np.zeros((height, width))
    for t in np.arange(0.25, _LAB_CURVED_MAX_SUPPORT_M, 0.25):
        vx = px + ux * t
        vy = py + uy * t
        ix = ((vx - origin_x) / bin_m).astype(int)
        iy = ((vy - origin_y) / bin_m).astype(int)
        ok = (ix >= 0) & (ix < width) & (iy >= 0) & (iy < height)
        np.add.at(hist, (iy[ok], ix[ok]), 1.0)
    centres: list[tuple[float, float]] = []
    work = hist.copy()
    suppress = int(1.0 / bin_m)
    for _ in range(6):
        flat = int(np.argmax(work))
        if work.flat[flat] < 5.0:
            break
        iy, ix = np.unravel_index(flat, work.shape)
        centres.append(
            (origin_x + (ix + 0.5) * bin_m, origin_y + (iy + 0.5) * bin_m)
        )
        work[
            max(0, iy - suppress): iy + suppress + 1,
            max(0, ix - suppress): ix + suppress + 1,
        ] = 0.0
    return centres


def _lab_fit_cone_candidates(
    pool: np.ndarray,
    grid: _DsmGrid | None = None,
    pool_cells: np.ndarray | None = None,
) -> list[dict[str, Any]]:
    """Cone hypotheses for a candidate component's point pool, best
    first: up to six mutually distinct candidates (centres at
    least 2 m apart). Centres are PROPOSED two ways — the gradient
    convergence vote over the component's DSM cells (the robust
    channel: it finds a radial surface's centre even when the
    surface is a minority of a merged component) and the top of a
    plain least-squares centre scan — then each proposal is
    polished by trimmed refits on the full pool. Proposals only
    propose: every candidate is judged against the full component
    (see _lab_judge_curved). A component can hold both a
    tangent-patch mirage and the real section — the judge, not
    the fit, decides which ships. Ranking is by inlier count,
    which systematically favours wide mirage cones over a compact
    real section; the candidate cap is therefore generous and the
    judge's section-ness gates do the actual sorting."""
    xs, ys, zs = pool[:, 0], pool[:, 1], pool[:, 2]
    seeds: list[tuple[float, float]] = []
    if grid is not None and pool_cells is not None:
        seeds.extend(_cone_centre_votes(grid, pool_cells))
    seeds.extend(_cone_scan_centres(xs, ys, zs)[:3])
    refined: list[tuple[int, float, float, float, float, float, float]] = []
    tried: list[tuple[float, float]] = []
    for cx, cy in seeds:
        if any(math.hypot(cx - tx, cy - ty) < 0.5 for tx, ty in tried):
            continue
        tried.append((cx, cy))
        result = _cone_polish(xs, ys, zs, cx, cy)
        if result is not None:
            refined.append(result)
    refined.sort(key=lambda item: (item[0], item[1]), reverse=True)
    candidates: list[dict[str, Any]] = []
    for n_in, _neg, cx, cy, apex, slope, rmse in refined:
        if any(
            math.hypot(cx - c["centre"][0], cy - c["centre"][1]) < 2.0
            for c in candidates
        ):
            continue
        radii = np.hypot(xs - cx, ys - cy)
        local = radii <= _LAB_CURVED_MAX_SUPPORT_M
        resid = np.abs(zs[local] - (apex - slope * radii[local]))
        inliers = resid <= _LAB_CURVED_CLAIM_TOL_M
        candidates.append({
            "kind": "cone",
            "centre": (float(cx), float(cy)),
            "apex_z": float(apex),
            "slope": float(slope),
            "radius_m": (
                float(radii[local][inliers].max()) if inliers.any() else 0.0
            ),
            "point_count": int(n_in),
            "fit_rmse_m": float(rmse),
        })
        if len(candidates) >= 6:
            break
    return candidates


def _cylinder_lsq(
    zs: np.ndarray, d: np.ndarray
) -> tuple[float, float] | None:
    """Linearized least-squares cylinder about a FIXED axis line:
    with d the signed distance from the axis, the arc satisfies
    (z - axis_z)^2 + d^2 = R^2, i.e. z^2 + d^2 = 2*axis_z*z +
    (R^2 - axis_z^2) — linear in (axis_z, R^2 - axis_z^2)."""
    design = np.column_stack((2.0 * zs, np.ones_like(zs)))
    target = zs * zs + d * d
    coef, *_ = np.linalg.lstsq(design, target, rcond=None)
    axis_z = float(coef[0])
    radius_sq = float(coef[1]) + axis_z * axis_z
    if radius_sq <= 0.25:
        return None
    return axis_z, math.sqrt(radius_sq)


def _cylinder_trimmed_fit(
    xs: np.ndarray, ys: np.ndarray, zs: np.ndarray,
    nx: float, ny: float, offset: float,
) -> tuple[float, float, np.ndarray, float] | None:
    """Trimmed cylinder fit about a fixed axis line, mirroring
    _cone_trimmed_fit. Returns (axis_z, radius, inliers, rmse,
    inlier_d) with the mask and distances over the near-axis
    subset the fit actually used."""
    d = xs * nx + ys * ny - offset
    # Locality, as for the cone: points farther across the axis
    # than a section can span do not belong to this barrel and
    # must not drag its fit.
    near = np.abs(d) <= _LAB_CURVED_MAX_SUPPORT_M
    if int(near.sum()) < _LAB_CURVED_MIN_INLIERS:
        return None
    xs, ys, zs, d = xs[near], ys[near], zs[near], d[near]
    fit = _cylinder_lsq(zs, d)
    if fit is None:
        return None
    axis_z, radius = fit
    inliers: np.ndarray | None = None
    for _ in range(3):
        z_hat = axis_z + np.sqrt(np.maximum(radius * radius - d * d, 0.0))
        inliers = (np.abs(d) < radius) & (np.abs(zs - z_hat) <= _LAB_CURVED_CLAIM_TOL_M)
        if int(inliers.sum()) < _LAB_CURVED_MIN_INLIERS:
            return None
        fit = _cylinder_lsq(zs[inliers], d[inliers])
        if fit is None:
            return None
        axis_z, radius = fit
    assert inliers is not None
    z_hat = axis_z + np.sqrt(
        np.maximum(radius * radius - d[inliers] * d[inliers], 0.0)
    )
    resid = np.abs(zs[inliers] - z_hat)
    rmse = float(np.sqrt(np.mean(resid**2))) if len(resid) else math.inf
    return axis_z, radius, inliers, rmse, d[inliers]


def _lab_fit_cylinder(pool: np.ndarray) -> dict[str, Any] | None:
    """Fit a barrel (cylinder) section: scan axis directions every
    15 degrees and axis offsets across the pool's across-axis
    extent, trimmed-refit each, keep the best by inliers then
    rmse. The pitch gate reads the arc's slope at the inliers'
    outer support — a barrel's crown is flat by nature, so the
    gate is on the slope the section actually reaches, not the
    crown's."""
    xs, ys, zs = pool[:, 0], pool[:, 1], pool[:, 2]
    best: tuple[int, float, dict[str, Any]] | None = None
    for theta_deg in range(0, 180, 15):
        theta = math.radians(theta_deg)
        nx, ny = -math.sin(theta), math.cos(theta)
        d0 = xs * nx + ys * ny
        for offset in np.quantile(d0, [0.15, 0.3, 0.45, 0.6, 0.75]):
            result = _cylinder_trimmed_fit(xs, ys, zs, nx, ny, float(offset))
            if result is None:
                continue
            axis_z, radius, inliers, rmse, d_inliers = result
            if radius < 0.8 or rmse > _LAB_CURVED_MAX_RMSE_M:
                continue
            d_in = np.abs(d_inliers)
            outer = float(np.quantile(d_in, 0.9)) if len(d_in) else 0.0
            outer = min(outer, radius * 0.999)
            edge_slope = outer / math.sqrt(radius * radius - outer * outer)
            edge_pitch = math.degrees(math.atan(edge_slope))
            if not _LAB_CURVED_MIN_PITCH_DEG <= edge_pitch <= _LAB_CURVED_MAX_PITCH_DEG:
                continue
            cand = (int(inliers.sum()), -rmse, {
                "kind": "cylinder",
                "normal": (float(nx), float(ny)),
                "offset": float(offset),
                "axis_z": float(axis_z),
                "radius_m": float(radius),
                "point_count": int(inliers.sum()),
                "fit_rmse_m": float(rmse),
            })
            if best is None or cand[:2] > best[:2]:
                best = cand
    return best[2] if best is not None else None


def _lab_judge_curved(
    surf: dict[str, Any],
    pool: np.ndarray,
    grid: _DsmGrid,
    pool_cells: np.ndarray,
    best: np.ndarray,
) -> np.ndarray | None:
    """Judge a fitted curved surface on the territory it would
    actually claim — the discovery discipline, plus the curved
    guards documented at the Phase 5d constants. Returns the claim
    (a boolean grid mask, restricted to its largest connected
    component) or None.

    * win margin: the best plane refit on the surface's own
      inlier points must fail discovery's rmse bar AND be at
      least _LAB_CURVED_PLANE_WIN_FACTOR times the surface's
      inlier rmse;
    * claim: cells in the component's dilated mask where the
      surface fits within the claim tolerance AND strictly beats
      the incumbent residual; at least the discovery minimum
      area, one coherent territory (largest component at least
      _LAB_CURVED_MIN_CLAIM_MAIN_SHARE of the raw claim);
    * incumbent median: the median incumbent residual over the
      claim must clear _LAB_CURVED_MIN_INCUMBENT_MEDIAN_M;
    * section-ness: the claim must contain the surface's centre
      (see the constants block): nearest claim cell within
      _LAB_CURVED_MAX_CENTRE_GAP_M of the cone's centre (the
      cylinder's axis), and the cone's explained territory — the
      cells the surface fits within the claim tolerance,
      contiguous with the claim — must wrap at least
      _LAB_CURVED_MIN_SPAN_DEG around the centre. (The territory,
      not just the claim: a section's interior can already be
      claimed, badly, by a plane, leaving the curved pass only
      its rim to win — the arc the surface explains is the honest
      span.)"""
    from scipy import ndimage

    px, py, pz = pool[:, 0], pool[:, 1], pool[:, 2]
    p_resid = np.abs(pz - _curved_surface_z(surf, px, py))
    inliers = p_resid <= _LAB_CURVED_CLAIM_TOL_M
    if int(inliers.sum()) < _LAB_CURVED_MIN_INLIERS:
        return None
    surf_rmse = float(np.sqrt(np.mean(p_resid[inliers] ** 2)))
    _a, _b, _c, plane_rmse = _fit_plane_lsq(pool[inliers])
    if not (
        plane_rmse > _LAB_CURVED_MAX_RMSE_M
        and plane_rmse >= _LAB_CURVED_PLANE_WIN_FACTOR * surf_rmse
    ):
        return None
    xs_g, ys_g = grid.centres()
    surf_resid = np.abs(_curved_surface_z(surf, xs_g, ys_g) - grid.z)
    claim = (
        pool_cells
        & np.isfinite(grid.z)
        & (surf_resid <= _LAB_CURVED_CLAIM_TOL_M)
        & (surf_resid < best)
    )
    if surf["kind"] == "cone":
        cx, cy = surf["centre"]
        claim &= (
            np.hypot(xs_g - cx, ys_g - cy)
            <= surf["radius_m"] + grid.cell
        )
    if not claim.any():
        return None
    structure = np.ones((3, 3), dtype=int)
    comps, n = ndimage.label(claim, structure=structure)
    if n == 0:
        return None
    sizes = ndimage.sum(claim, comps, index=np.arange(1, n + 1))
    core = int(np.argmax(sizes)) + 1
    if float(sizes[core - 1]) / float(claim.sum()) < _LAB_CURVED_MIN_CLAIM_MAIN_SHARE:
        return None
    claim = comps == core
    if float(claim.sum()) * grid.cell**2 < _LAB_CURVED_MIN_CLAIM_SQM:
        return None
    if float(np.median(best[claim])) < _LAB_CURVED_MIN_INCUMBENT_MEDIAN_M:
        return None
    # Section-ness: the claim must contain the surface's centre
    # (a tangent patch on a hip roof's convergence fails both
    # tests; a turret's claim wraps its own apex).
    ys_c, xs_c = np.where(claim)
    cell_x = xs_g[ys_c, xs_c]
    cell_y = ys_g[ys_c, xs_c]
    if surf["kind"] == "cone":
        cx, cy = surf["centre"]
        dists = np.hypot(cell_x - cx, cell_y - cy)
        if float(dists.min()) > _LAB_CURVED_MAX_CENTRE_GAP_M:
            return None
        explained = (
            np.isfinite(grid.z)
            & (surf_resid <= _LAB_CURVED_CLAIM_TOL_M)
            & (
                np.hypot(xs_g - cx, ys_g - cy)
                <= surf["radius_m"] + grid.cell
            )
        )
        sup_comps, _n = ndimage.label(explained, structure=structure)
        claim_ids = {
            int(v) for v in np.unique(sup_comps[claim]) if v > 0
        }
        territory = (
            np.isin(sup_comps, list(claim_ids))
            if claim_ids
            else claim
        )
        tys, txs = np.where(territory)
        angs = np.sort(
            np.arctan2(ys_g[tys, txs] - cy, xs_g[tys, txs] - cx)
        )
        if len(angs) > 1:
            gaps = np.diff(np.concatenate([angs, angs[:1] + 2.0 * math.pi]))
            span = 2.0 * math.pi - float(gaps.max())
        else:
            span = 0.0
        if span < math.radians(_LAB_CURVED_MIN_SPAN_DEG):
            return None
    else:
        nx, ny = surf["normal"]
        d_claim = np.abs(cell_x * nx + cell_y * ny - surf["offset"])
        if float(d_claim.min()) > _LAB_CURVED_MAX_CENTRE_GAP_M:
            return None
    return claim


def _lab_curved_pass(
    planes: list[tuple[float, float, float]],
    discovered: list[dict[str, Any]],
    labels: np.ndarray,
    best: np.ndarray,
    masks: list[np.ndarray | None],
    grid: _DsmGrid,
    points: np.ndarray,
) -> tuple[
    list[tuple[float, float, float]],
    list[dict[str, Any]],
    np.ndarray,
    np.ndarray,
    list[np.ndarray | None],
    dict[int, dict[str, Any]],
]:
    """Phase 5d curved pass: after the boundary pass, seed from
    the components still unexplained at the discovery seed
    tolerance and test each (largest first) against the cone and
    cylinder families. An accepted surface is appended exactly
    like a discovered plane — (pseudo-plane, competition mask,
    descriptor) — except its labelling residual is the surface's
    own (the returned curved map, keyed by plane index, is how
    every downstream residual read knows). Mirrors the other
    stages' loop shape: one acceptance per pass, relabel, repeat,
    at most _LAB_CURVED_MAX_ACCEPTED per house.

    Seeding differs from the plane stages in one principled way:
    a seed cell must carry fit-pool points (grid.counts > 0). A
    surface fit is a claim about points; the DSM's interpolated
    cells (nearest-measured fills, up to 1.5 m away) carry no
    evidence of their own, and left in the seed they bridge
    separate unexplained areas — a turret, a valley band, an
    eave-margin strip the outline overhangs — into one giant
    component whose point pool no single surface explains
    (measured on Miramar: a 33 m^2 bridged component). The claim
    and judging still read the full DSM grid; only the seed is
    restricted to evidenced cells."""
    from scipy import ndimage
    from shapely.geometry import box
    from shapely.ops import unary_union

    planes = list(planes)
    discovered = list(discovered)
    masks = list(masks)
    labels = labels.copy()
    best = best.copy()
    curved: dict[int, dict[str, Any]] = {}
    structure = np.ones((3, 3), dtype=int)
    ix, iy, ok = grid.point_cell
    point_flat = np.where(ok, iy * grid.nx + ix, -1)
    accepted = 0
    while accepted < _LAB_CURVED_MAX_ACCEPTED:
        seed = (
            grid.inside
            & (labels >= 0)
            & (best > _LAB_CURVED_SEED_TOL_M)
            & (grid.counts > 0)
        )
        if not seed.any():
            break
        comps, n = ndimage.label(seed, structure=structure)
        sizes = (
            ndimage.sum(seed, comps, index=np.arange(1, n + 1))
            * grid.cell**2
        )
        first_cell = np.full(n, np.inf)
        flat_idx = np.arange(comps.size)
        for idx in range(n):
            cells = flat_idx[comps.ravel() == idx + 1]
            if len(cells):
                first_cell[idx] = cells.min()
        order = sorted(range(n), key=lambda i: (-sizes[i], first_cell[i]))
        progressed = False
        for comp_idx in order:
            if float(sizes[comp_idx]) < _LAB_DISC_MIN_AREA_M2:
                break
            comp = comps == (comp_idx + 1)
            pool_cells = (
                ndimage.binary_dilation(comp, structure=structure, iterations=2)
                & grid.inside
            )
            cell_ids = set(np.where(pool_cells.ravel())[0].tolist())
            sel = np.array([f in cell_ids for f in point_flat])
            pool = points[sel & (point_flat >= 0)]
            if len(pool) < _LAB_CURVED_MIN_INLIERS:
                continue
            # Judge each distinct hypothesis in turn: a component
            # can hold both a tangent-patch mirage and the real
            # section, and only the judge can tell them apart.
            surf: dict[str, Any] | None = None
            claim: np.ndarray | None = None
            hypotheses = _lab_fit_cone_candidates(pool, grid, pool_cells)
            cylinder = _lab_fit_cylinder(pool)
            if cylinder is not None:
                hypotheses.append(cylinder)
            for cand in hypotheses:
                judged_claim = _lab_judge_curved(
                    cand, pool, grid, pool_cells, best
                )
                if judged_claim is not None:
                    surf, claim = cand, judged_claim
                    break
            if surf is None or claim is None:
                continue
            # The pseudo-plane: tangent to the surface at the
            # claim's centroid. It is what plane-shaped consumers
            # (serialization, pitch/azimuth fields, the converter)
            # hold; the labelling never judges it.
            xs_g, ys_g = grid.centres()
            cen_x = float(xs_g[claim].mean())
            cen_y = float(ys_g[claim].mean())
            ga, gb = _curved_surface_grad(surf, cen_x, cen_y)
            cen_z = float(_curved_surface_z(surf, cen_x, cen_y))
            pseudo = (ga, gb, cen_z - ga * cen_x - gb * cen_y)
            pitch = math.degrees(math.atan(math.hypot(ga, gb)))
            ys_c, xs_c = np.where(claim)
            region = unary_union([
                box(
                    grid.x0 + gx * grid.cell,
                    grid.y0 + gy * grid.cell,
                    grid.x0 + (gx + 1) * grid.cell,
                    grid.y0 + (gy + 1) * grid.cell,
                )
                for gy, gx in zip(ys_c, xs_c)
            ])
            index = len(planes)
            planes.append(pseudo)
            masks.append(
                ndimage.binary_dilation(claim, structure=structure)
                & grid.inside
            )
            discovered.append({
                "plane": pseudo,
                "pitch_degrees": pitch,
                "point_count": int(surf["point_count"]),
                "fit_rmse_m": float(surf["fit_rmse_m"]),
                "region": region,
                "curved": surf,
                "_claim_rc": (ys_c, xs_c),
            })
            curved[index] = surf
            labels, best = _lab_label_grid(planes, grid, masks, curved)
            accepted += 1
            progressed = True
            break
        if not progressed:
            break
    return planes, discovered, labels, best, masks, curved


def _curved_region_true_area_sqft(
    region: Any, surf: dict[str, Any], cell_m: float
) -> float:
    """A curved facet's TRUE surface area: the integral of
    sqrt(1 + |grad z|^2) over its region, sampled on a half-cell
    grid (the region is small; the sampling error is far below
    the measurement noise). For a cone the factor is constant, so
    this is exactly plan area x sqrt(1 + slope^2) up to the
    sampling of the region's edge."""
    if region is None or region.is_empty:
        return 0.0
    step = max(cell_m / 2.0, 0.05)
    minx, miny, maxx, maxy = region.bounds
    xs = np.arange(minx + step / 2.0, maxx, step)
    ys = np.arange(miny + step / 2.0, maxy, step)
    if len(xs) == 0 or len(ys) == 0:
        rep = region.representative_point()
        factor = float(_curved_surface_factor(surf, rep.x, rep.y))
        return region.area * factor * _SQFT_PER_SQM
    gx, gy = np.meshgrid(xs, ys)
    flat_x, flat_y = gx.ravel(), gy.ravel()
    try:
        import shapely

        inside = shapely.contains(region, flat_x, flat_y)
    except Exception:  # noqa: BLE001 — older shapely: point loop
        inside = np.array(
            [region.contains(Point(x, y)) for x, y in zip(flat_x, flat_y)]
        )
    if not inside.any():
        rep = region.representative_point()
        factor = float(_curved_surface_factor(surf, rep.x, rep.y))
        return region.area * factor * _SQFT_PER_SQM
    factors = _curved_surface_factor(surf, flat_x[inside], flat_y[inside])
    return float(step * step * float(factors.sum()) * _SQFT_PER_SQM)


def _lab_apply_cone_rims(
    regions: list[Any],
    discovered: list[dict[str, Any]],
    n_fitted: int,
    outline: Polygon,
    grid: _DsmGrid,
) -> list[Any]:
    """Redraw each accepted cone facet's rim onto its fitted
    circle, on the tiling itself (so every neighbour moves
    complementarily and the tiling stays exact).

    The polygonized region's outer boundary is a raster staircase
    around the true rim. Within a band of +/- _LAB_CURVED_RIM_BAND_M
    around the rim radius — restricted to the claim's angular
    span, so only the arc the evidence supports is redrawn —
    territory is reassigned by the fitted circle: inside the disc
    belongs to the cone, outside it to whichever neighbour shares
    the longest border with each outside piece (the codebase's
    remainder rule). The disc is a 64-gon: at turret radii its
    chords run ~0.3 m with a sagitta of millimetres — the drawing
    reads as a smooth arc, every vertex sits on the circle within
    the chord error, and the chords stay above the surgery's
    micro-segment contraction. The fitted rim radius (robust
    per-direction outer claim radius + half a cell) is recorded
    on the surface descriptor for the surgery's rim
    protections."""
    from shapely.geometry import Point as _Point
    from shapely.ops import unary_union

    regions = list(regions)
    xs_g, ys_g = grid.centres()
    for di, desc in enumerate(discovered):
        surf = desc.get("curved")
        claim_rc = desc.get("_claim_rc")
        if not surf or surf.get("kind") != "cone" or claim_rc is None:
            continue
        index = n_fitted + di
        region = regions[index]
        if region is None or region.is_empty:
            continue
        ys_c, xs_c = claim_rc
        px = xs_g[ys_c, xs_c]
        py = ys_g[ys_c, xs_c]
        cx, cy = surf["centre"]
        radii = np.hypot(px - cx, py - cy)
        angles = np.arctan2(py - cy, px - cx)
        # Robust rim radius: the outermost claim radius per
        # 15-degree direction bin, median across bins, plus half
        # a cell. A single far claim cell — where a neighbouring
        # plane crosses the cone's extension and also fits within
        # tolerance — must not drag the drawn arc off the
        # surface's true edge (Miramar: the z-profile steps down
        # at r ~3.25 m while one crossing cell sits at 3.8 m).
        bins = np.floor(
            (angles + math.pi) / math.radians(15.0)
        ).astype(int) % 24
        outer = np.full(24, -np.inf)
        np.maximum.at(outer, bins, radii)
        seen = outer[np.isfinite(outer)]
        if len(seen) >= 3:
            rim = float(np.median(seen)) + 0.5 * grid.cell
        else:
            rim = float(radii.max()) + 0.5 * grid.cell
        mean_dir = math.atan2(
            float(np.sin(angles).mean()), float(np.cos(angles).mean())
        )
        rel = (angles - mean_dir + math.pi) % (2.0 * math.pi) - math.pi
        pad = math.atan2(0.5 * grid.cell, max(rim, 0.5)) + 0.02
        a0 = mean_dir + float(rel.min()) - pad
        a1 = mean_dir + float(rel.max()) + pad
        surf["rim_radius_m"] = rim
        band_r = _LAB_CURVED_RIM_BAND_M
        disc = _Point(cx, cy).buffer(rim, resolution=16)
        outer = _Point(cx, cy).buffer(rim + band_r, resolution=16)
        inner = _Point(cx, cy).buffer(max(rim - band_r, 0.05), resolution=16)
        steps = max(2, int(math.ceil((a1 - a0) / math.radians(5.0))))
        fan = [(cx, cy)] + [
            (
                cx + (rim + band_r) * math.cos(a0 + (a1 - a0) * k / steps),
                cy + (rim + band_r) * math.sin(a0 + (a1 - a0) * k / steps),
            )
            for k in range(steps + 1)
        ]
        band = (
            outer.difference(inner)
            .intersection(Polygon(fan))
            .intersection(outline)
        )
        if band.is_empty or band.area <= 1e-9:
            continue
        inside_disc = disc.intersection(band)
        outside = band.difference(disc)
        adjusted = [
            r.difference(band)
            if r is not None and not r.is_empty
            else r
            for r in regions
        ]
        if adjusted[index].is_empty:
            adjusted[index] = inside_disc
        elif not inside_disc.is_empty:
            adjusted[index] = unary_union([adjusted[index], inside_disc])
        for piece in _polygon_parts(outside):
            best_k, best_key = -1, None
            for k, orig in enumerate(regions):
                if k == index or orig is None or orig.is_empty:
                    continue
                shared = orig.boundary.intersection(piece.boundary).length
                key = (shared, -orig.distance(piece))
                if best_key is None or key > best_key:
                    best_k, best_key = k, key
            if best_k < 0:
                adjusted[index] = unary_union([adjusted[index], piece])
            elif adjusted[best_k].is_empty:
                adjusted[best_k] = piece
            else:
                adjusted[best_k] = unary_union([adjusted[best_k], piece])
        regions = adjusted
    return regions


def _lab_evidence_masks(
    labels: np.ndarray,
    best: np.ndarray,
    grid: _DsmGrid,
    masks: list[np.ndarray | None],
) -> list[np.ndarray | None]:
    """Competition masks for every plane: a plane may only claim
    territory near its own point evidence (cells it wins with a
    residual <= _LAB_EVIDENCE_RESID_M, dilated by three cells).
    Without this, a plane extended across the map wins strips where
    its height merely coincides with another surface (Phase 3's type
    case: a flat patio plane claiming the eave strip whose edge
    height matches it). Discovered planes keep their tighter
    component masks; a plane with no evidence cells stays unmasked."""
    from scipy import ndimage

    out: list[np.ndarray | None] = []
    for i in range(len(masks)):
        if masks[i] is not None:
            out.append(masks[i])
            continue
        ev = (labels == i) & (best <= _LAB_EVIDENCE_RESID_M)
        if ev.any():
            out.append(
                ndimage.binary_dilation(
                    ev,
                    structure=np.ones((3, 3), int),
                    iterations=_LAB_EVIDENCE_DILATE_CELLS,
                )
                & grid.inside
            )
        else:
            out.append(None)
    return out


def _lab_smooth_labels(
    planes: list[tuple[float, float, float]],
    labels: np.ndarray,
    grid: _DsmGrid,
    masks: list[np.ndarray | None] | None = None,
    curved: dict[int, dict[str, Any]] | None = None,
) -> np.ndarray:
    """One Potts-style smoothing round: each cell's cost becomes its
    plane residual plus _LAB_POTTS_LAMBDA times the fraction of its
    8 neighbours carrying a different label, and the cell is
    relabelled by the new argmin. Cells where the point-cloud
    evidence is strong keep their label (a 0.05 m prior cannot
    override a real residual gap); cells in noisy tie zones settle
    onto the locally dominant plane, which removes isolated flips
    and straightens seams before polygonizing."""
    resid = _lab_resid_stack(planes, grid, masks, curved)
    padded = np.pad(labels, 1, constant_values=-2)
    disagree = np.zeros_like(resid)
    for i in range(len(planes)):
        neigh = np.stack([
            padded[dy:dy + labels.shape[0], dx:dx + labels.shape[1]]
            for dy in (0, 1, 2)
            for dx in (0, 1, 2)
            if not (dy == 1 and dx == 1)
        ])
        disagree[i] = np.mean((neigh != i) & (neigh >= 0), axis=0)
    cost = resid + _LAB_POTTS_LAMBDA * disagree
    choice = np.argmin(cost, axis=0)
    out = labels.copy()
    valid = grid.inside & (labels >= 0)
    out[valid] = choice[valid]
    return out


def _lab_fallback_grid(
    prior_regions: list[Polygon], grid: _DsmGrid
) -> np.ndarray:
    """Rasterize the prior (hull partition) tiling onto the grid —
    only used for cells the DSM cannot speak for."""
    out = np.full(grid.z.shape, -1, dtype=int)
    xs, ys = grid.centres()
    for gy in range(grid.ny):
        for gx in range(grid.nx):
            if not grid.inside[gy, gx]:
                continue
            pt = Point(xs[gy, gx], ys[gy, gx])
            for i, geom in enumerate(prior_regions):
                if (
                    geom is not None
                    and not geom.is_empty
                    and geom.covers(pt)
                ):
                    out[gy, gx] = i
                    break
    return out


def _lab_cleanup_labels(
    labels: np.ndarray,
    planes: list[tuple[float, float, float]],
    grid: _DsmGrid,
    fallback_labels: np.ndarray,
    masks: list[np.ndarray | None] | None = None,
    curved: dict[int, dict[str, Any]] | None = None,
) -> np.ndarray:
    """Deterministic label hygiene (Phase 3's, unchanged): fill
    unfilled cells from the prior tiling (or the nearest label),
    flip isolated cells (two passes, so noisy boundaries settle),
    and dissolve small components into their best neighbouring
    label: any component under _LAB_SLIVER_COMPONENT_M2, and any
    non-core component under the discovery minimum area (a facet's
    largest component is its core and is never dissolved here — the
    facet-death rule judges it later). Masked facets never receive
    cells outside their mask."""
    from scipy import ndimage
    from scipy.spatial import cKDTree

    labels = labels.copy()
    inside = grid.inside
    missing = inside & (labels < 0)
    if missing.any():
        labels[missing] = fallback_labels[missing]
        still = np.argwhere(inside & (labels < 0))
        if len(still):
            known = np.argwhere(inside & (labels >= 0))
            tree = cKDTree(known[:, ::-1].astype(float))
            _d, near = tree.query(still[:, ::-1].astype(float), k=1)
            for row, n in zip(still, near):
                src = known[n]
                labels[row[0], row[1]] = labels[src[0], src[1]]
    stack = _lab_resid_stack(planes, grid, masks, curved)
    resid = {i: stack[i] for i in range(len(planes))}
    # Isolated-cell flip: at least 6 of 8 neighbours share one other
    # label and that label's residual is nearly as good here.
    for _pass in range(2):
        padded = np.pad(labels, 1, constant_values=-2)
        own = labels.copy()
        for gy in range(labels.shape[0]):
            for gx in range(labels.shape[1]):
                if not inside[gy, gx] or own[gy, gx] < 0:
                    continue
                neigh = np.delete(padded[gy:gy + 3, gx:gx + 3].ravel(), 4)
                neigh = neigh[neigh >= 0]
                others = neigh[neigh != own[gy, gx]]
                if len(others) >= 6 and len(set(others.tolist())) == 1:
                    cand = int(others[0])
                    if resid[cand][gy, gx] <= resid[own[gy, gx]][gy, gx] + 0.05:
                        labels[gy, gx] = cand
    # Dissolve small components.
    structure = np.ones((3, 3), dtype=int)
    for li in range(len(planes)):
        mask = labels == li
        if not mask.any():
            continue
        comps, n = ndimage.label(mask, structure=structure)
        sizes = (
            ndimage.sum(mask, comps, index=np.arange(1, n + 1))
            * grid.cell**2
        )
        core = int(np.argmax(sizes)) + 1 if n else -1
        for comp in range(1, n + 1):
            cells = comps == comp
            area_m2 = float(sizes[comp - 1])
            if area_m2 >= _LAB_DISC_MIN_AREA_M2 or (
                comp == core and area_m2 >= _LAB_SLIVER_COMPONENT_M2
            ):
                continue
            dilated = ndimage.binary_dilation(cells, structure=structure)
            ring = labels[dilated & ~cells & inside]
            ring = ring[ring >= 0]
            if len(ring) == 0:
                continue
            cands_all = [int(v) for v in set(ring.tolist()) if v != li]
            if not cands_all:
                continue
            ys_c, xs_c = np.where(cells)
            for gy, gx in zip(ys_c, xs_c):
                labels[gy, gx] = min(
                    cands_all, key=lambda cand: resid[cand][gy, gx]
                )
    return labels


def _lab_polygonize(
    labels: np.ndarray, grid: _DsmGrid, outline: Polygon, n_planes: int
) -> list[Any]:
    """Per-plane region = union of its cells' squares, clipped to
    the outline (so the regions tile the outline exactly)."""
    from shapely.geometry import box
    from shapely.ops import unary_union

    regions: list[Polygon] = []
    for li in range(n_planes):
        ys_c, xs_c = np.where(labels == li)
        if len(ys_c) == 0:
            regions.append(Polygon())
            continue
        squares = [
            box(
                grid.x0 + gx * grid.cell,
                grid.y0 + gy * grid.cell,
                grid.x0 + (gx + 1) * grid.cell,
                grid.y0 + (gy + 1) * grid.cell,
            )
            for gy, gx in zip(ys_c, xs_c)
        ]
        region = unary_union(squares).intersection(outline)
        regions.append(region)
    return regions


def _exact_plane_groups(
    plane_models: list[tuple[float, float, float]],
) -> list[list[int]]:
    """Group facet indices carrying the identical fitted plane
    (RANSAC fragments of one physical face). Identical planes are
    indistinguishable to a residual labelling — their cells would
    all land on the first — so they label as one group and split
    the group's region afterwards. Greedy first-match, the Phase 1
    prototype's criterion (coefficients equal within 1e-9)."""
    groups: list[list[int]] = []
    representatives: list[tuple[float, float, float]] = []
    for index, plane in enumerate(plane_models):
        match = None
        for gi, rep in enumerate(representatives):
            if (
                abs(rep[0] - plane[0]) < 1e-9
                and abs(rep[1] - plane[1]) < 1e-9
                and abs(rep[2] - plane[2]) < 1e-9
            ):
                match = gi
                break
        if match is None:
            representatives.append(plane)
            groups.append([index])
        else:
            groups[match].append(index)
    return groups


def _lab_complete_labels(labels: np.ndarray, grid: _DsmGrid) -> np.ndarray:
    """Fill any still-unlabelled participating cell from its nearest
    labelled cell. Rim cells the DSM cannot speak for (no measured
    or filled height — the scan stops at the wall) and whose centres
    fall outside the outline defeat both the residual labelling and
    the centre-based fallback grid; left unlabelled, their squares
    leave sub-cell gaps along the perimeter, the regions no longer
    tile the outline, and the surgery's face recovery meets faces
    no region owns (its unowned_face veto). Completion is purely
    geometric — a rim cell joins its nearest labelled neighbour,
    exactly what any exact tiling does with such slivers — and it
    runs after cleanup, so it cannot affect discovery, smoothing,
    or facet survival."""
    from scipy import ndimage

    missing = grid.inside & (labels < 0)
    if not missing.any() or not (labels >= 0).any():
        return labels
    out = labels.copy()
    _, indices = ndimage.distance_transform_edt(
        out < 0, return_indices=True
    )
    rows, cols = np.where(missing)
    out[rows, cols] = out[indices[0][rows, cols], indices[1][rows, cols]]
    return out


def _dsm_labelling_tiling(
    fitted_polygons: list[Polygon],
    plane_models: list[tuple[float, float, float]],
    pitches: list[float],
    facet_areas_sqft: list[float],
    points: np.ndarray,
    outline: Polygon,
    prior_partition: list[Polygon],
    max_discovered: int | None = None,
) -> dict[str, Any] | None:
    """The Phase 4 tiling: DSM-residual labelling + bounded
    discovery over the fitted planes, as validated in Phase 3.
    Returns the extended facet geometry — regions aligned with
    `plane_models` plus one entry per discovered plane, the
    extended planes/pitches, the plane-based areas with discovery
    transfers applied, and the discovered facets' descriptors — or
    None when the labelling cannot be trusted for this house (a
    production facet's label died: the fitter measured a face the
    point cloud assigns almost no territory, a contradiction this
    path must not silently resolve by erasing a measured facet).
    Any exception is the caller's signal to fall back as well."""
    from shapely.ops import unary_union

    groups = _exact_plane_groups(plane_models)
    group_planes = [plane_models[g[0]] for g in groups]
    group_prior: list[Polygon] = []
    for g in groups:
        members = [
            prior_partition[i]
            for i in g
            if not prior_partition[i].is_empty
        ]
        group_prior.append(
            unary_union(members) if members else Polygon()
        )

    grid = _DsmGrid(points, outline)
    labels, best = _lab_label_grid(group_planes, grid)
    planes_all, discovered, labels, best, masks = _lab_discover_planes(
        group_planes, grid, points, labels, best
    )
    # Phase 5c fitter-stage passes: split the components discovery
    # refused into their real faces, then look for boundary faces
    # (hip triangles) hiding under the seeding tolerance. Both
    # append (plane, mask, descriptor) on discovery's terms, so
    # everything downstream treats their facets as discovered.
    n_discovery = len(discovered)
    planes_all, discovered, labels, best, masks = _lab_split_planes(
        planes_all, discovered, labels, best, masks, grid, points
    )
    n_split = len(discovered) - n_discovery
    planes_all, discovered, labels, best, masks = _lab_boundary_planes(
        planes_all, discovered, labels, best, masks, grid, points
    )
    n_boundary = len(discovered) - n_discovery - n_split
    # Phase 5d curved pass: sections no plane can express (a
    # turret's cone, a barrel vault) fitted as surfaces over the
    # still-unexplained components. Appended last, so arbitration
    # truncation withdraws a curved facet before any Phase 5c
    # admission, and the ladder can still try every suffix down to
    # the Phase 4 set.
    planes_all, discovered, labels, best, masks, curved_map = (
        _lab_curved_pass(
            planes_all, discovered, labels, best, masks, grid, points
        )
    )
    n_curved = len(discovered) - n_discovery - n_split - n_boundary
    if max_discovered is not None and len(discovered) > max_discovered:
        # Facet-admission arbitration (see _labelled_drawing_attempt):
        # rebuild the tiling as if the most recently accepted
        # discovered facets had never been admitted. Their planes,
        # competition masks and descriptors are dropped and the
        # label grid is recomputed from the surviving planes, so
        # the evidence masks below derive exactly as they would
        # have had the stages stopped at that facet. Discovery's
        # facets are never dropped here (the caller floors the
        # ladder at the discovery count) — only the Phase 5c
        # split/boundary admissions are arbitrated.
        keep = len(groups) + max_discovered
        planes_all = planes_all[:keep]
        discovered = discovered[:max_discovered]
        masks = masks[:keep]
        # Relabel WITH the surviving stage masks: the stages'
        # returned grid is itself a masked relabel over the full
        # plane set, so this reproduces — bit for bit — the state
        # the pipeline would have reached had the stages stopped
        # at the kept facet.
        labels, best = _lab_label_grid(planes_all, grid, masks)
        n_split = min(n_split, max(0, max_discovered - n_discovery))
        n_boundary = max(0, max_discovered - n_discovery - n_split)
        # A truncated curved facet is simply gone (it sits last in
        # the discovered order); a surviving one keeps its surface.
        curved_map = {
            i: surf for i, surf in curved_map.items() if i < keep
        }
        n_curved = len(discovered) - n_discovery - n_split - n_boundary
    masks = _lab_evidence_masks(labels, best, grid, masks)
    labels, best = _lab_label_grid(planes_all, grid, masks, curved_map)
    labels = _lab_smooth_labels(planes_all, labels, grid, masks, curved_map)
    fallback = _lab_fallback_grid(group_prior, grid)
    labels = _lab_cleanup_labels(
        labels, planes_all, grid, fallback, masks, curved_map
    )
    regions = _lab_polygonize(
        _lab_complete_labels(labels, grid), grid, outline, len(planes_all)
    )

    n_groups = len(groups)
    # Facet death: a label owning less than _LAB_DEAD_FACET_AREA_M2
    # of the outline is not a facet. A dead PRODUCTION group fails
    # the whole attempt (see the docstring); a dead discovered plane
    # is simply dropped, its cells remapped to the best surviving
    # plane exactly as Phase 3 remapped them.
    for k in range(n_groups):
        if regions[k].area < _LAB_DEAD_FACET_AREA_M2:
            return None
    dead = [
        k
        for k in range(n_groups, len(planes_all))
        if regions[k].area < _LAB_DEAD_FACET_AREA_M2
    ]
    if dead:
        survivors = [k for k in range(len(planes_all)) if k not in dead]
        xs_g, ys_g = grid.centres()
        remapped = labels.copy()
        for k in dead:
            ys_c, xs_c = np.where(labels == k)
            for gy, gx in zip(ys_c, xs_c):
                def death_resid(s: int) -> float:
                    if masks[s] is not None and not masks[s][gy, gx]:
                        return math.inf
                    if not np.isfinite(grid.z[gy, gx]):
                        return 0.0
                    if s in curved_map:
                        return abs(
                            float(
                                _curved_surface_z(
                                    curved_map[s],
                                    xs_g[gy, gx],
                                    ys_g[gy, gx],
                                )
                            )
                            - grid.z[gy, gx]
                        )
                    a, b, c = planes_all[s]
                    return abs(
                        a * xs_g[gy, gx] + b * ys_g[gy, gx] + c
                        - grid.z[gy, gx]
                    )

                remapped[gy, gx] = min(survivors, key=death_resid)
        new_index = {old: k for k, old in enumerate(survivors)}
        labels_final = np.full(labels.shape, -1, dtype=int)
        for gy in range(labels.shape[0]):
            for gx in range(labels.shape[1]):
                v = remapped[gy, gx]
                if v in new_index:
                    labels_final[gy, gx] = new_index[v]
        planes_all = [planes_all[s] for s in survivors]
        discovered = [
            discovered[s - n_groups]
            for s in survivors
            if s >= n_groups
        ]
        curved_map = {
            new_index[s]: surf
            for s, surf in curved_map.items()
            if s in new_index
        }
        regions = _lab_polygonize(
            _lab_complete_labels(labels_final, grid),
            grid,
            outline,
            len(planes_all),
        )
        for k in range(n_groups):
            if regions[k].area < _LAB_DEAD_FACET_AREA_M2:
                return None

    group_regions = regions[:n_groups]
    disc_regions = regions[n_groups:]

    # Expand identical-plane groups back to their member facets: the
    # members split the group's region through the hull partition
    # (their seams are pitch changes on one physical plane — the
    # hull traces there are what production ships today).
    raw_regions: list[Polygon] = [Polygon()] * len(fitted_polygons)
    for g, group_region in zip(groups, group_regions):
        if len(g) == 1:
            raw_regions[g[0]] = group_region
        else:
            sub = _partition_facets_to_outline(
                [fitted_polygons[i] for i in g], group_region
            )
            # The hull partition's own gap handling can drop a
            # disjoint piece of the group region (its largest-part
            # reduction): territory the labelling assigned to this
            # plane but no member's hull reaches. The labelled
            # tiling must stay exact, so any uncovered remainder
            # goes to the member sharing its longest border (the
            # nearest member when it touches none).
            covered = unary_union([s for s in sub if not s.is_empty])
            gap = group_region.difference(covered)
            if not gap.is_empty and gap.area > 1e-9:
                for piece in _polygon_parts(gap):
                    best_i, best_key = 0, None
                    for k, region in enumerate(sub):
                        if region.is_empty:
                            key = (0.0, -1e18)
                        else:
                            shared = region.boundary.intersection(
                                piece.boundary
                            ).length
                            key = (shared, -region.distance(piece))
                        if best_key is None or key > best_key:
                            best_i, best_key = k, key
                    sub[best_i] = unary_union([sub[best_i], piece])
            for i, region in zip(g, sub):
                raw_regions[i] = region
    regions_ext = raw_regions + disc_regions
    # Phase 5d: redraw accepted cones' rims onto their fitted
    # circles, on the tiling (neighbours move complementarily).
    regions_ext = _lab_apply_cone_rims(
        regions_ext, discovered, len(fitted_polygons), outline, grid
    )
    for desc in discovered:
        desc.pop("_claim_rc", None)
    planes_ext = list(plane_models) + [d["plane"] for d in discovered]
    pitches_ext = list(pitches) + [
        d["pitch_degrees"] for d in discovered
    ]

    # Plane-based areas with discovery transfers (see the block
    # comment): every production facet whose fitted polygon
    # overlaps a discovered facet's region is debited the overlap's
    # sloped area at ITS pitch — the territory was inside its
    # hull — and the discovered facet is credited exactly the
    # debited total, so discovery never moves the house's reported
    # area: the measurement stays the fitted facets' own, and the
    # discovered facet's area is the carved territory measured in
    # the same accounting. (Crediting the region at the discovered
    # plane's own pitch instead would let the pitch-factor spread
    # between the two planes drift the total by fractions of a
    # percent for no measured reason.) A region overlapping no
    # fitted polygon at all — territory no hull ever claimed — is
    # credited at its own pitch: there is nothing to debit.
    areas_ext = list(facet_areas_sqft)
    ext_disc_regions = regions_ext[len(fitted_polygons):]
    for desc, region in zip(discovered, ext_disc_regions):
        if desc.get("curved"):
            # Phase 5d: the curved facet is credited its TRUE
            # surface area (integrated over its region), and the
            # plane-scheme debits — the overlaps measured at each
            # source facet's pitch, exactly as for a discovery —
            # are scaled so they sum to that credit. The bookkeeping
            # stays total-preserving (the house's reported area
            # moves only by the difference between the curved
            # surface's true area and the flat accounting of the
            # same territory, which is the measurement the surface
            # fit exists to make), and a region overlapping no
            # fitted polygon is credited its true area outright,
            # mirroring the discovery fallback.
            true_area = _curved_region_true_area_sqft(
                region, desc["curved"], grid.cell
            )
            debits: list[tuple[int, float]] = []
            debited = 0.0
            for i, fitted in enumerate(fitted_polygons):
                if fitted.is_empty or region.is_empty:
                    continue
                overlap = region.intersection(fitted).area
                if overlap > 1e-9:
                    cos_i = max(math.cos(math.radians(pitches[i])), 1e-6)
                    debit = overlap / cos_i * _SQFT_PER_SQM
                    debits.append((i, debit))
                    debited += debit
            if debited > 0:
                scale = true_area / debited
                for i, debit in debits:
                    areas_ext[i] -= debit * scale
            desc["area_sqft"] = true_area
            areas_ext.append(true_area)
            continue
        debited = 0.0
        for i, fitted in enumerate(fitted_polygons):
            if fitted.is_empty or region.is_empty:
                continue
            overlap = region.intersection(fitted).area
            if overlap > 1e-9:
                cos_i = max(math.cos(math.radians(pitches[i])), 1e-6)
                debit = overlap / cos_i * _SQFT_PER_SQM
                areas_ext[i] -= debit
                debited += debit
        if debited > 0:
            desc_area = debited
        else:
            pitch_d = desc["pitch_degrees"]
            cos_d = max(math.cos(math.radians(pitch_d)), 1e-6)
            desc_area = region.area / cos_d * _SQFT_PER_SQM
        desc["area_sqft"] = desc_area
        areas_ext.append(desc_area)

    return {
        "regions": regions_ext,
        "planes": planes_ext,
        "pitches": pitches_ext,
        "areas_sqft": areas_ext,
        "discovered": discovered,
        "stats": {
            "cell_m": round(grid.cell, 3),
            "groups": len(groups),
            "discovered": len(discovered),
            "split": n_split,
            "boundary": n_boundary,
            "curved": n_curved,
            "interpolated_cells": int(
                (grid.inside & grid.interpolated).sum()
            ),
        },
    }


def _drawing_partition(
    fitted_polygons: list[Polygon],
    plane_models: list[tuple[float, float, float]],
    footprint: Polygon,
    footprint_provider: str | None,
    pitches: list[float] | None = None,
    totals_out: dict[str, float] | None = None,
    points: np.ndarray | None = None,
    facet_areas_sqft: list[float] | None = None,
    extension_out: dict[str, Any] | None = None,
) -> tuple[list[Polygon], bool]:
    """The drawing's facet geometry: the fitted facets re-rendered as
    an exact partition of the roof outline whose shared seams are the
    fitted planes' own intersection lines (see _drawing_outline,
    _partition_facets_to_outline, _surgery_partition_boundaries).
    This is a RENDERING of the fitted facets for the sketch — the
    service's reported areas and pitches are computed from the fitted
    polygons themselves and never from this partition. Any failure or
    sanity breach falls back to the fitted polygons unchanged, so the
    drawing can degrade to hull geometry but never break the response.

    When every facet's drawing polygon came from the partition, the
    drawing's edge totals are measured on the partition's boundary
    graph (_graph_edge_totals) and written into `totals_out` when the
    caller provides it: the totals then describe exactly the lines
    the drawing ships, classified by a chord test that depends only
    on the two planes and their seam.

    The boolean reports whether EVERY facet's drawing polygon came
    from the partition (no fitted-polygon fallback anywhere): the
    response advertises it as `drawing_ready`, and the CRM converter
    trusts flagged geometry enough to skip its own snap/trim surgery,
    which would otherwise introduce micro-defects (junction spikes,
    sliver overlaps) into an already exact tiling.

    Phase 4: when the caller supplies the fit pool (`points`) and
    the fitted areas, a fully-partitioned hull drawing is upgraded
    to the DSM-residual labelling tiling (_dsm_labelling_tiling):
    territory assigned by point-cloud evidence instead of hulls,
    plus any planes bounded discovery recovered. The upgrade is
    accepted only when it too partitions every facet (including the
    discovered ones) AND its shipped-ring divergent seam is no
    worse than the hull drawing's under the same ruler — a
    per-house fallback expressed as a relative comparison, with no
    house-specific constants. Phase 5c adds facet-admission
    arbitration inside the attempt: when the full facet set
    rebuilds worse than the hull, the newest (split/boundary)
    facets are withdrawn one at a time down to the Phase 4 set
    and the best-scoring variant is what faces the comparison.
    The extended facet set's
    planes/pitches/areas and the discovered facets' descriptors
    are then written into `extension_out` for the caller to
    serialize. Houses the hull path cannot fully partition never
    engage the labelling — the readiness gate is exactly the hull
    path's, untouched — and any labelling failure keeps the hull
    drawing, so the response can degrade to Phase 2 behaviour but
    never below it."""
    try:
        outline = _drawing_outline(footprint, fitted_polygons, footprint_provider)
        partition = _partition_facets_to_outline(fitted_polygons, outline)
        from shapely.ops import unary_union

        fitted_union = unary_union(
            [p for p in fitted_polygons if not p.is_empty]
        )
        partition_union = unary_union([p for p in partition if not p.is_empty])
        if (
            fitted_union.area <= 0
            or abs(partition_union.area - fitted_union.area)
            > 0.10 * fitted_union.area
        ):
            return fitted_polygons, False
        if pitches is None:
            pitches = [
                math.degrees(math.atan(math.hypot(a, b)))
                for a, b, _c in plane_models
            ]
        surgeried, _stats = _surgery_partition_boundaries(
            partition, plane_models, pitches, outline
        )
        # The surgery's faces are recovered by polygonizing the
        # rebuilt graph together with the outline boundary, so its
        # output already tiles the outline exactly — no re-tiling
        # pass is needed (the re-partition the old endpoint-matching
        # snap required would re-introduce hull-traced boundaries).
        result: list[Polygon] = []
        fully_partitioned = True
        for fitted, region in zip(fitted_polygons, surgeried):
            # A facet the partition erased (fully covered by a larger
            # neighbour inside the outline) keeps its fitted polygon —
            # dropping a measured facet from the drawing would be worse
            # than the overlap it causes.
            if region.is_empty:
                fully_partitioned = False
                result.append(fitted)
            else:
                result.append(region)
        if fully_partitioned and totals_out is not None:
            totals_out.update(
                _graph_edge_totals(result, plane_models, pitches, outline)
            )
        if (
            fully_partitioned
            and points is not None
            and facet_areas_sqft is not None
        ):
            # Per-house fallback, the Phase 4 gate in general
            # form: the labelled drawing ships only when its
            # shipped-ring divergent seam is no worse than the
            # hull drawing it would replace — same ruler, both
            # geometries, no house-specific constants. A house
            # whose evidence-based tiling rebuilds worse keeps
            # the hull drawing (and its production facet set:
            # the extension is discarded with the drawing). The
            # hull's score is computed first so the attempt can
            # arbitrate its Phase 5c facet admissions against it
            # (see _labelled_drawing_attempt).
            hull_divergent = _divergent_seam_ft(
                result, plane_models, outline
            )
            labelled = _labelled_drawing_attempt(
                fitted_polygons,
                plane_models,
                pitches,
                facet_areas_sqft,
                points,
                outline,
                partition,
                hull_divergent=hull_divergent,
            )
            if labelled is not None:
                lab_result, lab_totals, extension, lab_divergent = labelled
                if lab_divergent <= hull_divergent:
                    if totals_out is not None:
                        totals_out.clear()
                        totals_out.update(lab_totals)
                    if extension_out is not None:
                        extension_out.update(extension)
                    return lab_result, True
        return result, fully_partitioned
    except Exception:  # noqa: BLE001 — drawing geometry must never break a response
        return fitted_polygons, False


def _resolve_multipart_regions(
    regions: list[Any],
) -> tuple[list[Any], int]:
    """Make every facet's region a single polygon before the
    surgery, using the surgery's own reassignment rule: a facet
    keeps its largest part; each smaller part goes to the neighbour
    sharing its longest border. Raster labellings legitimately
    assign one plane several disjoint patches (a fragmented slope,
    the same face on both sides of a crossing gable), but the
    drawing schema ships one ring per facet, and the surgery's
    in-attempt reassignment cannot merge a part into a neighbour
    that is itself still multi-part — a case hull tilings never
    produce. Resolving on the input tiling keeps the boundary
    graph the phantom guard checks against identical to the tiling
    the surgery actually receives. Reported areas are plane-based
    and unaffected; only drawing territory moves. A part with no
    edge-sharing neighbour stays with its facet (the surgery's own
    reassignment, working on rebuilt faces, gets the final say).
    Returns (regions, parts_reassigned)."""
    from shapely.ops import unary_union

    regions = list(regions)
    reassigned = 0
    while True:
        moved = False
        for i, region in enumerate(regions):
            parts = _polygon_parts(region)
            if len(parts) <= 1:
                continue
            parts.sort(key=lambda part: -part.area)
            regions[i] = parts[0]
            for part in parts[1:]:
                best_k, best_len = -1, 0.0
                for k, other in enumerate(regions):
                    if k == i or other.is_empty:
                        continue
                    shared = part.boundary.intersection(other.boundary).length
                    if shared > best_len:
                        best_len, best_k = shared, k
                if best_k < 0 or best_len <= 1e-9:
                    regions[i] = unary_union([regions[i], part])
                else:
                    regions[best_k] = unary_union([regions[best_k], part])
                    reassigned += 1
                    moved = True
        if not moved:
            return regions, reassigned


def _labelled_attempt_once(
    fitted_polygons: list[Polygon],
    plane_models: list[tuple[float, float, float]],
    pitches: list[float],
    facet_areas_sqft: list[float],
    points: np.ndarray,
    outline: Polygon,
    partition: list[Polygon],
    max_discovered: int | None = None,
) -> tuple[list[Polygon], dict[str, float], dict[str, Any], float] | None:
    """One labelled-drawing attempt at a given discovered-facet
    budget: label the outline from the point cloud, run the
    boundary-graph surgery over the labelled tiling, and accept
    only a fully-partitioned, single-polygon-per-facet result.
    Returns (polygons, graph totals, extension, divergent_seam_ft)
    or None. The surgery runs with graph-level chain
    simplification: raster tilings carry per-cell staircase chains
    that hull tilings never produce (see
    _simplify_boundary_chains)."""
    labelled = _dsm_labelling_tiling(
        fitted_polygons,
        plane_models,
        pitches,
        facet_areas_sqft,
        points,
        outline,
        partition,
        max_discovered=max_discovered,
    )
    if labelled is None:
        return None
    ext_planes = labelled["planes"]
    ext_pitches = labelled["pitches"]
    ext_fitted = list(fitted_polygons) + [
        desc["region"] for desc in labelled["discovered"]
    ]
    # Phase 5d: curved facets (index space of the regions list)
    # for the surgery's and totals' surface-aware paths.
    curved_map: dict[int, dict[str, Any]] = {}
    for di, desc in enumerate(labelled["discovered"]):
        if desc.get("curved"):
            curved_map[len(fitted_polygons) + di] = desc["curved"]
    resolved_regions, parts_moved = _resolve_multipart_regions(
        labelled["regions"]
    )
    surgeried, _stats = _surgery_partition_boundaries(
        resolved_regions,
        ext_planes,
        ext_pitches,
        outline,
        simplify_tol_m=_LAB_CHAIN_SIMPLIFY_TOL_M,
        curved=curved_map or None,
    )
    result: list[Polygon] = []
    for fitted, region in zip(ext_fitted, surgeried):
        if region.is_empty or region.geom_type != "Polygon":
            # A facet the rebuild erased (or left as fragments)
            # voids the upgrade: the discovered facets have no
            # hull to fall back to, and a production facet
            # falling back would leave the totals describing a
            # different facet set than the areas do.
            return None
        result.append(region)
    totals = _graph_edge_totals(
        result, ext_planes, ext_pitches, outline, curved=curved_map or None
    )
    extension = {
        "areas_sqft": labelled["areas_sqft"],
        "discovered": labelled["discovered"],
        "stats": {
            **labelled["stats"],
            "multipart_parts_reassigned": parts_moved,
        },
    }
    divergent = _divergent_seam_ft(
        result, ext_planes, outline, curved=curved_map or None
    )
    return result, totals, extension, divergent


def _labelled_drawing_attempt(
    fitted_polygons: list[Polygon],
    plane_models: list[tuple[float, float, float]],
    pitches: list[float],
    facet_areas_sqft: list[float],
    points: np.ndarray,
    outline: Polygon,
    partition: list[Polygon],
    hull_divergent: float | None = None,
) -> tuple[list[Polygon], dict[str, float], dict[str, Any], float] | None:
    """The Phase 4 attempt, with Phase 5c facet-admission
    arbitration. Returns (polygons, graph totals, extension,
    divergent_seam_ft) or None — any doubt at all keeps the hull
    drawing the caller already has.

    The full attempt admits every discovered facet (Phase 4
    discovery plus the Phase 5c split/boundary passes). When the
    Phase 5c passes admitted facets and the full attempt's
    shipped-ring divergent seam is not already perfect, the
    attempt is retried with those facets withdrawn one at a
    time, most recent admission first, down to the Phase 4 facet
    set — a facet is only worth shipping if the drawing stays
    self-consistent with it in. The best (lowest-divergent)
    variant is returned; ties keep the variant with more facets,
    so the labelled candidate never scores worse than the Phase
    4 facet set's own attempt. The caller's divergent comparison
    (`hull_divergent`, same ruler) still arbitrates
    labelled-vs-hull exactly as in Phase 4, so arbitration can
    improve the labelled candidate but never weaken the hull
    fallback. Houses with no Phase 5c admissions, or a perfect
    full score, never pay for the ladder."""
    try:
        full = _labelled_attempt_once(
            fitted_polygons, plane_models, pitches, facet_areas_sqft,
            points, outline, partition,
        )
        if full is None:
            return None
        stats = full[2]["stats"]
        n_total = int(stats.get("discovered", 0))
        # The arbitrated admissions: Phase 5c's split/boundary
        # facets plus Phase 5d's curved facets (appended last, so
        # the suffix ladder withdraws a curved facet first).
        n_phase5c = (
            int(stats.get("split", 0))
            + int(stats.get("boundary", 0))
            + int(stats.get("curved", 0))
        )
        if n_phase5c == 0 or full[3] <= 0.0:
            return full
        best = full
        for keep in range(n_total - 1, n_total - n_phase5c - 1, -1):
            candidate = _labelled_attempt_once(
                fitted_polygons, plane_models, pitches, facet_areas_sqft,
                points, outline, partition, max_discovered=keep,
            )
            if candidate is None:
                continue
            if candidate[3] < best[3]:
                best = candidate
                if best[3] <= 0.0:
                    break
        if best is not full:
            best[2]["stats"]["arbitrated_to_discovered"] = len(
                best[2]["discovered"]
            )
        return best
    except Exception:  # noqa: BLE001 — the upgrade must never break a drawing
        return None


def _facets_from_local_points(
    unique_points: np.ndarray,
    polygon: Polygon,
    to_local: Transformer,
    from_local: Transformer,
    ring_points: np.ndarray | None = None,
    footprint_provider: str | None = None,
) -> tuple[list[dict[str, Any]], dict[str, float] | None, bool]:
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
    # Serialize the boundary from drawing-conditioned copies of the
    # facet rings (see _condition_polygons_for_emission): the reported
    # areas and pitches above all come from the fitted geometry, and
    # only the lat/lon rendering of the rings is conditioned, so the
    # CRM drawing path accepts it as emitted. The rendering itself is
    # the exact-shape partition of the roof outline (see
    # _drawing_partition): the sketch shows the footprint outline
    # tiled by the facets with straight plane-intersection seams, not
    # LiDAR hull traces. When the partition covers every facet, the
    # edge totals are re-measured on the drawing's boundary graph
    # (the totals then describe the shipped lines, classified by the
    # local chord test) and replace the fitted-geometry totals above;
    # the reported AREA stays plane-based regardless — it is summed
    # from the fitted facets in _structure_roof_payload and never
    # derives from the drawing rings.
    fitted_polygons = [Polygon(facet["boundary_xy"]) for facet in raw_facets]
    drawing_totals: dict[str, float] = {}
    drawing_extension: dict[str, Any] = {}
    drawing_polygons, drawing_ready = _drawing_partition(
        fitted_polygons,
        [
            tuple(facet["plane_model"]["z_equals_ax_plus_by_plus_c"])
            for facet in raw_facets
        ],
        footprint_local,
        footprint_provider,
        pitches=[float(facet["pitch_degrees"]) for facet in raw_facets],
        totals_out=drawing_totals,
        points=unique_points,
        facet_areas_sqft=[float(facet["area_sqft"]) for facet in raw_facets],
        extension_out=drawing_extension,
    )
    if drawing_ready and drawing_totals:
        edge_lengths = drawing_totals
    if drawing_extension:
        # Phase 4 upgrade accepted: apply the discovery area
        # transfers to the carved facets and serialize the
        # discovered planes as facets in their own right (same
        # schema the fitter emits; their boundary_xy is the
        # labelling region, used only as the conditioning fallback
        # ring — the drawing polygon itself is the surgeried one).
        for index, area in enumerate(
            drawing_extension["areas_sqft"][: len(raw_facets)]
        ):
            if abs(area - raw_facets[index]["area_sqft"]) > 1e-9:
                raw_facets[index]["area_sqft"] = round(float(area), 1)
                raw_facets[index]["squares"] = round(float(area) / 100.0, 3)
        for desc in drawing_extension["discovered"]:
            a, b, c = desc["plane"]
            region_part = _largest_polygon_part(desc["region"])
            ring_source = region_part if region_part is not None else desc["region"]
            raw_facets.append({
                "id": "facet-disc",
                "point_count": desc["point_count"],
                "fit_rmse_m": round(float(desc["fit_rmse_m"]), 4),
                "pitch_degrees": round(float(desc["pitch_degrees"]), 2),
                "pitch_rise_per_12": round(math.hypot(a, b) * 12.0, 2),
                "azimuth_degrees": round(
                    (math.degrees(math.atan2(-a, -b)) + 360.0) % 360.0, 1
                ),
                "area_sqft": round(float(desc["area_sqft"]), 1),
                "squares": round(float(desc["area_sqft"]) / 100.0, 3),
                "plane_model": {
                    "z_equals_ax_plus_by_plus_c": [
                        float(a), float(b), float(c)
                    ]
                },
                "boundary_xy": [
                    [round(float(x), 3), round(float(y), 3)]
                    for x, y in ring_source.exterior.coords
                ],
            })
            if desc.get("curved"):
                # Phase 5d: the facet ships its arc-chord polygon
                # (shape-correct in the segment-based drawing) plus
                # a compact curved descriptor. The drawing model
                # has no curved flag today; a future one would let
                # the CRM render the rim as a true arc and label
                # the facet's pitch as a cone's constant slope
                # rather than the tangent pseudo-plane's azimuth.
                surf = desc["curved"]
                public: dict[str, Any] = {"kind": surf["kind"]}
                if surf["kind"] == "cone":
                    clon, clat = from_local.transform(*surf["centre"])
                    public["centre_lat"] = round(float(clat), 7)
                    public["centre_lon"] = round(float(clon), 7)
                    public["slope"] = round(float(surf["slope"]), 3)
                public["radius_m"] = round(float(surf["radius_m"]), 2)
                raw_facets[-1]["curved"] = public
                raw_facets[-1]["_surface"] = surf
    boundary_polygons = _condition_polygons_for_emission(
        drawing_polygons, exact_tiling=drawing_ready
    )
    all_facets: list[dict[str, Any]] = []
    for facet, boundary_polygon in zip(raw_facets, boundary_polygons):
        facet["id"] = f"facet-{len(all_facets) + 1}"
        model_a, model_b, model_c = facet["plane_model"]["z_equals_ax_plus_by_plus_c"]
        surface = facet.pop("_surface", None)
        fitted_ring = facet.pop("boundary_xy")
        ring = _ring_coords(boundary_polygon) if not boundary_polygon.is_empty else []
        if len(ring) < 3:
            # Conditioning produced nothing usable for this facet (the
            # per-facet guard normally prevents this); fall back to the
            # fitted ring rather than emit a degenerate boundary. The
            # fitted ring carries its closing point; drop it here — it
            # is re-appended below in lat/lon form.
            ring = [tuple(point) for point in fitted_ring[:-1]]
        facet["boundary_latlon"] = []
        for xy in ring:
            lon, lat = from_local.transform(xy[0], xy[1])
            rounded_lat, rounded_lon = round(lat, 7), round(lon, 7)
            # No consecutive duplicates at emission precision (the
            # converter rejects them); a vertex that rounds onto its
            # predecessor carries no geometry.
            if (
                facet["boundary_latlon"]
                and facet["boundary_latlon"][-1][0] == rounded_lat
                and facet["boundary_latlon"][-1][1] == rounded_lon
            ):
                continue
            facet["boundary_latlon"].append([
                rounded_lat,
                rounded_lon,
                round(
                    float(_curved_surface_z(surface, xy[0], xy[1]))
                    if surface is not None
                    else model_a * xy[0] + model_b * xy[1] + model_c,
                    3,
                ),
            ])
        # The schema's ring is closed: repeat the first point at the end.
        if facet["boundary_latlon"]:
            facet["boundary_latlon"].append(facet["boundary_latlon"][0])
        all_facets.append(facet)
    # Verify the serialized rings survive the consumer's own
    # re-projection (see _repair_boundaries_for_converter).
    _repair_boundaries_for_converter(
        all_facets,
        float(polygon.centroid.y),
        float(polygon.centroid.x),
        to_local,
    )
    return all_facets, edge_lengths, drawing_ready


def _repair_boundaries_for_converter(
    facets: list[dict[str, Any]],
    origin_lat: float,
    origin_lon: float,
    to_local: Transformer,
) -> None:
    """Final validity pass over the serialized boundaries, in the CRM
    converter's own frame.

    Conditioning works in this service's projected CRS, but the
    consumer re-projects the lat/lon ring (rounded to 7 dp) through
    its own fixed constants (111320/110540 m per degree, feet). That
    round-trip can push a vertex across a nearby edge where a facet
    boundary runs through a narrow neck — Miramar's largest facet
    arrived with a self-crossing spike between two near-touching
    edges, which the drawing path rejects. So each emitted ring is
    re-projected exactly as the converter projects it, and any ring
    that is invalid there, or that overlaps a larger neighbour there
    by more than a sliver, is repaired in that frame (largest valid
    part; overlaps trimmed largest-first with a centimetre margin)
    and re-serialized, with elevations recomputed on the facet's
    plane. Facets that pass untouched keep their serialized ring
    byte-for-byte."""
    feet_per_degree_lon = 111320.0 * math.cos(math.radians(origin_lat)) / 0.3048
    feet_per_degree_lat = 110540.0 / 0.3048

    def to_feet(lat: float, lon: float) -> tuple[float, float]:
        return (
            (lon - origin_lon) * feet_per_degree_lon,
            (origin_lat - lat) * feet_per_degree_lat,
        )

    def to_latlon(x_ft: float, z_ft: float) -> tuple[float, float]:
        return (
            origin_lat - z_ft / feet_per_degree_lat,
            origin_lon + x_ft / feet_per_degree_lon,
        )

    projected: list[Polygon] = []
    for facet in facets:
        ring = [to_feet(lat, lon) for lat, lon, _elev in facet["boundary_latlon"][:-1]]
        projected.append(Polygon(ring))

    # Sanitation: partition junctions can leave a vertex smeared into
    # a micro-cluster (several points a centimetre apart at one
    # corner) or a spike (the ring returns to within millimetres of
    # an earlier vertex). The converter rejects both (duplicate-point
    # check; edge-crossing check). Merge every vertex within 0.25 ft
    # of another — across AND within rings, diameter-capped, to the
    # cluster centroid, identically in every ring that carries it —
    # then drop cyclically-consecutive duplicates. On partition
    # geometry (sparse rings, real vertices feet apart) this can only
    # ever merge true junction smears. Facets whose ring changed are
    # re-serialized below even when no repair was needed.
    dirty: set[int] = set()
    vertex_refs: list[tuple[int, int]] = []
    vertex_points: list[tuple[float, float]] = []
    rings_ft: list[list[tuple[float, float]]] = []
    for facet_index, polygon in enumerate(projected):
        ring = _ring_coords(polygon)
        rings_ft.append(ring)
        for vertex_index, point in enumerate(ring):
            vertex_refs.append((facet_index, vertex_index))
            vertex_points.append(point)
    parent = list(range(len(vertex_points)))

    def find_root(x: int) -> int:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    pairs: list[tuple[float, int, int]] = []
    for a in range(len(vertex_points)):
        for b in range(a + 1, len(vertex_points)):
            distance = math.hypot(
                vertex_points[a][0] - vertex_points[b][0],
                vertex_points[a][1] - vertex_points[b][1],
            )
            if distance <= 0.25:
                pairs.append((distance, a, b))
    pairs.sort()
    members: dict[int, list[int]] = {i: [i] for i in range(len(vertex_points))}
    for _distance, a, b in pairs:
        root_a, root_b = find_root(a), find_root(b)
        if root_a == root_b:
            continue
        merged = members[root_a] + members[root_b]
        if all(
            math.hypot(
                vertex_points[i][0] - vertex_points[j][0],
                vertex_points[i][1] - vertex_points[j][1],
            )
            <= 0.25
            for i in merged
            for j in merged
        ):
            parent[root_a] = root_b
            members[root_b] = merged
            del members[root_a]
    centroids: dict[int, tuple[float, float]] = {}
    for root, cluster in members.items():
        if len(cluster) > 1:
            centroids[root] = (
                sum(vertex_points[i][0] for i in cluster) / len(cluster),
                sum(vertex_points[i][1] for i in cluster) / len(cluster),
            )
    ref_root = {ref: find_root(i) for i, ref in enumerate(vertex_refs)}
    for facet_index, ring in enumerate(rings_ft):
        rewritten: list[tuple[float, float]] = []
        for vertex_index, point in enumerate(ring):
            centroid = centroids.get(ref_root[(facet_index, vertex_index)])
            rewritten.append(centroid if centroid is not None else point)
        # Drop every vertex that repeats an earlier kept one within
        # a centimetre — consecutive duplicates from the merge above,
        # and spikes (A -> B -> A'), which the converter's
        # duplicate-point check rejects just the same. The validity
        # check below keeps the original ring if dropping a repeat
        # would break a genuinely pinched facet.
        deduped: list[tuple[float, float]] = []
        for point in rewritten:
            if any(
                math.hypot(point[0] - kept[0], point[1] - kept[1]) <= 0.01
                for kept in deduped
            ):
                continue
            deduped.append(point)
        if len(deduped) < 3:
            continue
        changed = len(deduped) != len(ring) or any(
            math.hypot(p[0] - q[0], p[1] - q[1]) > 0.001
            for p, q in zip(deduped, ring)
        )
        if not changed:
            continue
        candidate = Polygon(deduped)
        if not candidate.is_valid:
            largest = _largest_polygon_part(make_valid(candidate))
            candidate = largest if largest is not None else candidate
        if candidate.is_empty or not candidate.is_valid:
            continue
        projected[facet_index] = candidate
        dirty.add(facet_index)

    order = sorted(range(len(facets)), key=lambda k: -projected[k].area)
    accepted: list[Polygon] = list(projected)
    claimed: Any = None
    for index in order:
        polygon = projected[index]
        repaired = polygon
        try:
            if not repaired.is_valid:
                largest = _largest_polygon_part(make_valid(repaired))
                repaired = largest if largest is not None else repaired
            if (
                claimed is not None
                and repaired.is_valid
                and repaired.intersects(claimed.buffer(0.03))
            ):
                overlap = repaired.intersection(claimed).area
                if overlap > 0.05:
                    remainder = _largest_polygon_part(
                        repaired.difference(claimed.buffer(0.03))
                    )
                    if remainder is not None and not remainder.is_empty:
                        # Same anti-amputation guard as the metric-frame
                        # resolver: a buffered cut that splits the facet
                        # and drops a lobe loses to the unbuffered cut.
                        plain = _largest_polygon_part(repaired.difference(claimed))
                        if plain is not None and remainder.area < 0.98 * plain.area:
                            remainder = plain
                        repaired = remainder
        except Exception:  # noqa: BLE001 — repair is best-effort only
            # A partition facet with a narrow neck can round-trip into
            # a shape GEOS refuses to boolean (side-location conflict).
            # The repair exists to help the converter; it must never
            # take the whole measurement down with it — the facet
            # keeps its serialized ring and the converter's own
            # trim remains as the next line of defence.
            repaired = polygon
        accepted[index] = repaired
        if not repaired.is_empty and repaired.is_valid:
            from shapely.ops import unary_union

            claimed = repaired if claimed is None else unary_union([claimed, repaired])
    def serialize(polygon: Polygon, facet: dict[str, Any]) -> list[list[float]]:
        model_a, model_b, model_c = facet["plane_model"]["z_equals_ax_plus_by_plus_c"]
        boundary: list[list[float]] = []
        for x_ft, z_ft in _ring_coords(polygon):
            lat, lon = to_latlon(x_ft, z_ft)
            rounded_lat, rounded_lon = round(lat, 7), round(lon, 7)
            # Validity repairs (make_valid, difference) leave cut
            # vertices millimetres apart along a pinched waist; at the
            # 7 dp emission grid they serialize as consecutive
            # duplicate points, which the converter rejects outright.
            # Such a point carries no geometry — drop it.
            if boundary and boundary[-1][0] == rounded_lat and boundary[-1][1] == rounded_lon:
                continue
            local_x, local_y = to_local.transform(lon, lat)
            boundary.append([
                rounded_lat,
                rounded_lon,
                round(model_a * local_x + model_b * local_y + model_c, 3),
            ])
        if (
            len(boundary) > 1
            and boundary[-1][0] == boundary[0][0]
            and boundary[-1][1] == boundary[0][1]
        ):
            boundary.pop()
        if len(boundary) >= 3:
            boundary.append(boundary[0])
        return boundary

    for index, facet in enumerate(facets):
        if accepted[index] is projected[index] and index not in dirty:
            boundary = facet["boundary_latlon"]
        else:
            boundary = serialize(accepted[index], facet)
        # Verify the round trip, for every facet: a repair can be
        # valid in this frame yet serialize into a self-crossing ring
        # — quantizing a hairline waist to the 7 dp grid pushes one
        # edge across the other (Ave148's largest facet). If the
        # emitted ring is not a valid polygon here, rebuild it from
        # the valid largest part of the round-tripped geometry
        # itself, whose boundaries are genuine cuts, not hairlines.
        ring_ft = (
            [to_feet(lat, lon) for lat, lon, _e in boundary[:-1]]
            if len(boundary) >= 4
            else []
        )
        if len(ring_ft) >= 3 and not Polygon(ring_ft).is_valid:
            largest = _largest_polygon_part(make_valid(Polygon(ring_ft)))
            if largest is not None and not largest.is_empty:
                boundary = serialize(largest, facet)
        if len(boundary) >= 4:
            facet["boundary_latlon"] = boundary


def _copc_item_horizontal_crs(item: Any) -> CRS | None:
    """Resolve a COPC item's horizontal CRS from its STAC projection fields.

    Items published with an explicit EPSG code (proj:epsg / proj:code)
    resolve exactly as they always have. A large share of the USGS
    LAS_2019 conversions, however, publish ONLY proj:projjson — a compound
    CRS (horizontal + NAVD88 height) with no EPSG code at all — and the
    horizontal CRS must be read out of it. Skipping those items silently
    zeroed every measurement under them (observed in Broward: a footprint
    whose only COPC item was projjson-only read as stac_items=1,
    tiles_used=0, 0 building points). Returns None only when no
    projection field yields a CRS.
    """
    properties = getattr(item, "properties", None) or {}
    epsg_value = properties.get("proj:epsg") or properties.get("proj:code")
    if epsg_value:
        try:
            return CRS.from_user_input(str(epsg_value))
        except Exception:  # noqa: BLE001 — fall through to projjson
            pass
    projjson = properties.get("proj:projjson")
    if projjson:
        try:
            crs = CRS.from_json(json.dumps(projjson))
        except Exception:  # noqa: BLE001 — unresolvable CRS: caller skips
            return None
        if crs.is_compound and crs.sub_crs_list:
            return crs.sub_crs_list[0]
        return crs
    return None


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
        tile_crs = _copc_item_horizontal_crs(item)
        if tile_crs is None:
            continue
        to_tile = Transformer.from_crs("EPSG:4326", tile_crs, always_xy=True)
        projected_polygon = _transform_polygon(polygon, to_tile)
        meters_per_unit = tile_crs.axis_info[0].unit_conversion_factor if tile_crs.axis_info else 1.0
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
    all_facets, edge_lengths, drawing_ready = _facets_from_local_points(
        unique_points, polygon, to_local, from_local,
        ring_points=unique_ring_points, footprint_provider=footprint_provider,
    )

    return all_facets, {
        "edge_lengths_lf": edge_lengths,
        "drawing_ready": drawing_ready,
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

def _plan_ranges(size: int, chunks: int) -> list[tuple[int, int]]:
    """Split [0, size) into at most `chunks` contiguous inclusive byte ranges."""
    if size <= 0 or chunks <= 1:
        return [(0, size - 1)] if size > 0 else []
    count = min(chunks, size)
    step = size // count
    ranges: list[tuple[int, int]] = []
    start = 0
    for index in range(count):
        end = size - 1 if index == count - 1 else start + step - 1
        ranges.append((start, end))
        start = end + 1
    return ranges


async def _download_tile_single_stream(
    url: str,
    dest: Path,
    on_progress: Callable[[int, "int | None"], None] | None = None,
) -> None:
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
                    headers = getattr(response, "headers", None) or {}
                    total_header = headers.get("content-length") if hasattr(headers, "get") else None
                    total = int(total_header) if total_header and str(total_header).isdigit() else None
                    downloaded = 0
                    with open(tmp, "wb") as handle:
                        async for chunk in response.aiter_bytes(1 << 20):
                            handle.write(chunk)
                            downloaded += len(chunk)
                            if on_progress:
                                on_progress(downloaded, total)
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


async def _download_tile_ranged(
    url: str,
    dest: Path,
    size: int,
    on_progress: Callable[[int, "int | None"], None] | None = None,
) -> None:
    """Fetch a tile as parallel byte ranges and reassemble it in order.

    The USGS download host throttles per connection, so one stream crawls;
    ranges multiply throughput. Every chunk is retried on transient errors,
    the assembled file must match the advertised size and carry the LASF
    signature, and no partial file is ever left where the cache can see it.
    """
    ranges = _plan_ranges(size, TILE_DOWNLOAD_CHUNKS)
    part_paths = [
        dest.with_suffix(dest.suffix + f".part{index}") for index in range(len(ranges))
    ]
    downloaded_per_chunk = [0] * len(ranges)

    def report_chunk_progress() -> None:
        if on_progress:
            on_progress(sum(downloaded_per_chunk), size)

    async def fetch_chunk(index: int, start: int, end: int) -> None:
        expected = end - start + 1
        last_error: Exception | None = None
        # Stagger chunk starts: the USGS front door answers bursts of
        # simultaneous connections with an HTML interstitial challenge
        # (observed live: parallel requests got a 476-byte spinner page
        # while a single request seconds later got real bytes). A small
        # per-chunk offset plus backoff retries ride out the challenge
        # instead of tripping it repeatedly.
        if index:
            await asyncio.sleep(1.0 * index)
        for attempt in range(3):
            if attempt:
                await asyncio.sleep(10 * attempt)
            try:
                async with httpx.AsyncClient(
                    timeout=httpx.Timeout(900.0, connect=15.0),
                    follow_redirects=True,
                    headers={"User-Agent": USER_AGENT, "Range": f"bytes={start}-{end}"},
                ) as client:
                    async with client.stream("GET", url) as response:
                        if response.status_code != 206:
                            raise httpx.HTTPStatusError(
                                f"Range request answered {response.status_code}, expected 206",
                                request=response.request,
                                response=response,
                            )
                        written = 0
                        with open(part_paths[index], "wb") as handle:
                            async for chunk in response.aiter_bytes(1 << 20):
                                handle.write(chunk)
                                written += len(chunk)
                                downloaded_per_chunk[index] = written
                                report_chunk_progress()
                if written != expected:
                    raise ValueError(
                        f"Range {start}-{end} delivered {written} of {expected} bytes"
                    )
                return
            except (httpx.HTTPStatusError, httpx.TransportError, ValueError) as exc:
                last_error = exc
                downloaded_per_chunk[index] = 0
                part_paths[index].unlink(missing_ok=True)
                # A non-206 answer from a host whose HEAD advertised ranges
                # is the USGS interstitial challenge (HTTP 200 + HTML) or a
                # transient throttle — both decay, so both are retried with
                # backoff. Only a hard client error (the tile is gone or
                # forbidden) aborts the chunk immediately.
                if isinstance(exc, httpx.HTTPStatusError) and exc.response.status_code in (
                    400,
                    401,
                    403,
                    404,
                    410,
                ):
                    raise
        raise last_error if last_error else RuntimeError(f"Range download failed: {url}")

    tmp = dest.with_suffix(dest.suffix + ".part")
    try:
        # A TaskGroup, not a bare gather: when one chunk fails, gather
        # would raise while its sibling chunks kept downloading detached
        # — writing into part files the cleanup below had already
        # unlinked and inflating the reported progress with bytes going
        # nowhere (observed live on the first cold Annel run). TaskGroup
        # cancels the siblings and waits for them before propagating.
        async with asyncio.TaskGroup() as group:
            for index, (start, end) in enumerate(ranges):
                group.create_task(fetch_chunk(index, start, end))
        with open(tmp, "wb") as out:
            for part in part_paths:
                with open(part, "rb") as handle:
                    while block := handle.read(1 << 22):
                        out.write(block)
        if tmp.stat().st_size != size:
            raise ValueError(f"Assembled tile is {tmp.stat().st_size} bytes, expected {size}")
        with open(tmp, "rb") as handle:
            if handle.read(4) != b"LASF":
                raise ValueError(f"Downloaded tile did not have a LASF signature: {url}")
        tmp.rename(dest)
    finally:
        for part in part_paths:
            part.unlink(missing_ok=True)
        if dest.exists():
            tmp.unlink(missing_ok=True)


async def _download_tile(
    url: str,
    dest: Path,
    on_progress: Callable[[int, "int | None"], None] | None = None,
) -> None:
    """Download a LAZ tile into the cache, ranged-parallel when possible.

    A HEAD probe decides: when the host advertises byte ranges and the tile
    is large enough for per-connection throttling to dominate, fetch it in
    parallel ranges; any failure in that path (or a host without range
    support) falls back to the single-stream download, so the ranged path
    can only ever make a download faster, never fail one that would have
    succeeded slowly.
    """
    size: int | None = None
    try:
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(30.0, connect=10.0),
            follow_redirects=True,
            headers={"User-Agent": USER_AGENT},
        ) as client:
            head = await client.head(url)
        length = head.headers.get("content-length", "")
        if (
            head.status_code == 200
            and "bytes" in head.headers.get("accept-ranges", "").lower()
            and length.isdigit()
        ):
            size = int(length)
    except Exception:  # noqa: BLE001 — the probe is best-effort; any failure means "stream it"
        size = None
    if size is not None and size >= TILE_DOWNLOAD_RANGED_MIN_BYTES and TILE_DOWNLOAD_CHUNKS > 1:
        # Two ranged attempts: a chunk failure is usually the USGS
        # interstitial challenge, which decays over seconds, so one
        # paused retry is worthwhile before giving up to the slow stream.
        for attempt in range(2):
            if attempt:
                await asyncio.sleep(20)
            try:
                await _download_tile_ranged(url, dest, size, on_progress)
                return
            except Exception:  # noqa: BLE001 — ranged failure must never fail the download
                dest.with_suffix(dest.suffix + ".part").unlink(missing_ok=True)
    await _download_tile_single_stream(url, dest, on_progress)


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
    all_facets, edge_lengths, drawing_ready = _facets_from_local_points(
        unique_points, polygon, to_local, from_local,
        ring_points=unique_ring_points, footprint_provider=footprint_provider,
    )
    return all_facets, {
        "edge_lengths_lf": edge_lengths,
        "drawing_ready": drawing_ready,
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


def _tnm_project_key(item: dict[str, Any]) -> str:
    parts = str(item.get("title", "")).split()
    return parts[4] if len(parts) > 4 else ""


def _tnm_project_groups(
    laz_items: list[dict[str, Any]],
) -> list[tuple[str, list[dict[str, Any]]]]:
    """Group TNM LAZ items into survey projects, newest project first.

    Tiles from different surveys of the same ground must never be mixed
    into one point set, so each project is attempted on its own. Within a
    project the established discipline applies unchanged: tiles over the
    download size limit are excluded and at most MAX_TNM_TILES are used.
    A project whose tiles are all over the limit groups to an empty list.
    """
    by_project: dict[str, list[dict[str, Any]]] = {}
    for item in laz_items:
        by_project.setdefault(_tnm_project_key(item), []).append(item)

    def project_newest(group: list[dict[str, Any]]) -> str:
        return max(str(item.get("dateCreated") or "") for item in group)

    groups: list[tuple[str, list[dict[str, Any]]]] = []
    for project, group in sorted(
        by_project.items(), key=lambda entry: project_newest(entry[1]), reverse=True
    ):
        usable = [
            item
            for item in group
            if float(item.get("sizeInBytes") or 0) <= MAX_TNM_TILE_MB * 1_000_000
        ][:MAX_TNM_TILES]
        groups.append((project, usable))
    return groups


class _RetryableLidarFailure(RuntimeError):
    """A LiDAR source failed transiently — USGS throttling, a tile
    download that never landed, a cache race between concurrent jobs.

    Transient failure carries no information about whether a survey
    covers the footprint, so it must never be read as "no data": the
    measurement fails retryably (HTTP 503, a failed job the CRM
    resubmits) instead of reporting the address unmeasurable or
    substituting an older, poorer survey's numbers. Only a tile that
    was downloaded and read, yet yielded no roof points, is evidence
    a survey does not cover the footprint.
    """


async def _read_lidar_facets_tnm(
    polygon: Polygon,
    footprint_provider: str | None = None,
    report: ProgressReporter | None = None,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Fallback LiDAR source: USGS Lidar Point Cloud tiles via The National Map.

    Planetary Computer's COPC conversion has no coverage for parts of South
    Florida (Miami-Dade and Broward included), while the same USGS surveys are
    published as LAZ tiles through TNM. Tiles are large, so they are cached on
    disk and reused for every nearby address.
    """
    minx, miny, maxx, maxy = polygon.bounds

    async def search_tiles(bbox: str) -> tuple[list[dict[str, Any]], dict[str, Any]]:
        # One retry with a pause: the product search answers transient
        # 429/5xx under load, and an unretried HTTP error here zeroes the
        # whole measurement (observed live: a single USGS HTTP error
        # briefly turned a validated address footprint_only). A hands-off
        # pipeline absorbs the transient instead of surfacing it.
        last_error: Exception | None = None
        payload: dict[str, Any] = {}
        for attempt in range(2):
            if attempt:
                await asyncio.sleep(15)
            try:
                async with httpx.AsyncClient(
                    timeout=httpx.Timeout(30.0, connect=10.0),
                    headers={"User-Agent": USER_AGENT},
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
                break
            except (httpx.HTTPStatusError, httpx.TransportError) as exc:
                last_error = exc
        else:
            # A search that stays down after the retry is a transient
            # USGS failure, not evidence that no tiles are published.
            raise _RetryableLidarFailure(
                f"USGS TNM product search failed: {last_error}"
            ) from last_error
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

    # Prefer the newest survey project; older legacy tiles of the same
    # ground must not be mixed into one point set. Projects are attempted
    # newest first, one at a time (see the attempt loop below).
    groups = _tnm_project_groups(laz_items)
    if not any(tiles for _project, tiles in groups):
        return [], {
            "tnm_products": len(items),
            "reason": "USGS Lidar tiles for this footprint exceed the download size limit.",
        }

    LIDAR_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    # Tiles are fetched concurrently: each tile's download is independent,
    # and the USGS host throttles per connection, so serial downloads of a
    # two-tile footprint multiply the cold-cache wait for no reason.
    download_progress: dict[str, tuple[int, int | None]] = {}
    last_reported_fraction = -1.0

    def tile_progress(url: str, downloaded: int, total: int | None) -> None:
        nonlocal last_reported_fraction
        if report is None:
            return
        download_progress[url] = (downloaded, total)
        done = sum(done for done, _ in download_progress.values())
        known_total = sum(total for _, total in download_progress.values() if total)
        fraction = (done / known_total) if known_total else None
        if fraction is not None and fraction - last_reported_fraction < 0.01 and fraction < 1.0:
            return
        if fraction is not None:
            last_reported_fraction = fraction
        report(
            "downloading_tiles",
            f"Downloading USGS LiDAR tiles — {done / 1_000_000:.0f} MB"
            + (f" of {known_total / 1_000_000:.0f} MB" if known_total else ""),
            fraction,
        )

    async def ensure_tile(item: dict[str, Any]) -> Path:
        url = str(item["downloadURL"])
        dest = LIDAR_CACHE_DIR / url.rsplit("/", 1)[-1]
        last_error: Exception | None = None
        for attempt in range(ENSURE_TILE_ATTEMPTS):
            if attempt:
                await asyncio.sleep(ENSURE_TILE_RETRY_DELAY_S * attempt)
            try:
                if dest.exists():
                    # Self-healing cache: a tile that entered the cache before
                    # the LASF check existed (or was truncated by a crashed
                    # write) must not poison every future analysis of this
                    # area — drop it and download a fresh copy instead of
                    # failing the request. Nobody babysits the cache.
                    try:
                        with open(dest, "rb") as handle:
                            if handle.read(4) != b"LASF":
                                dest.unlink(missing_ok=True)
                    except FileNotFoundError:
                        # A concurrent job replaced the file between the
                        # existence check and the read; the download below
                        # (or its own finished copy) settles it.
                        pass
                if not dest.exists():
                    await _download_tile(
                        url,
                        dest,
                        on_progress=lambda done, total: tile_progress(url, done, total),
                    )
                return dest
            except Exception as exc:  # noqa: BLE001 — retried below, then re-raised
                last_error = exc
                # A hard client error means the tile itself is gone or
                # forbidden; retrying cannot change that answer.
                if isinstance(exc, httpx.HTTPStatusError) and exc.response.status_code in (
                    400,
                    401,
                    403,
                    404,
                    410,
                ):
                    raise
        raise last_error if last_error else RuntimeError(f"Tile download failed: {url}")

    # A tile that fails to download must not zero the measurement when a
    # sibling tile already covers the footprint (points are clipped to the
    # footprint later, and most footprints need only one of their tiles).
    #
    # Projects are attempted newest first and never mixed. A survey whose
    # tile grid covers the footprint on paper can still yield no roof
    # points for it — a neighbouring county's tile bbox spills across the
    # county line while its flown coverage stops at the border (observed
    # with a Miami-Dade D23 tile over a Broward footprint in West Park,
    # where the 2018 Southeast survey covers the house fully). When a
    # project yields no facets, the next survey is tried instead of
    # reporting the address unmeasurable while a covering survey sits
    # unused.
    #
    # "Yields no facets" has a strict meaning, though: every tile of the
    # project was downloaded and read, and the points simply were not
    # there. A project whose tiles failed to download — all of them, or
    # some of them while the rest yielded nothing — is UNREADABLE, not
    # empty: the missing tile may be exactly the one covering the
    # footprint (observed in production at Miramar, where a transient
    # FileNotFoundError on the 2018 survey's tile let the chain fall
    # through to the coarse 2007 county scan and produce a deformed
    # measurement of a validated address). An unreadable project stops
    # the chain and raises a retryable failure: no older, poorer survey
    # may be substituted on the strength of a download error.
    projects_tried: list[str] = []
    attempt_metas: list[dict[str, Any]] = []
    blocked_project: str | None = None
    blocked_error: BaseException | None = None
    for project, tiles in groups:
        if not tiles:
            continue
        projects_tried.append(project)
        gathered = await asyncio.gather(
            *[ensure_tile(item) for item in tiles], return_exceptions=True
        )
        tile_paths: list[Path] = []
        download_errors: list[str] = []
        first_error: BaseException | None = None
        for item, outcome in zip(tiles, gathered):
            if isinstance(outcome, Path):
                tile_paths.append(outcome)
            else:
                if first_error is None and isinstance(outcome, BaseException):
                    first_error = outcome
                download_errors.append(
                    f"{str(item['downloadURL']).rsplit('/', 1)[-1]}: {type(outcome).__name__}"
                )
        if not tile_paths:
            blocked_project, blocked_error = project, first_error
            attempt_metas.append(
                {"tnm_project": project, "tile_download_failures": download_errors}
            )
            break
        if report is not None:
            report("fitting_planes", "Fitting roof planes to the LiDAR points", None)
        facets, meta = _tnm_points_local(polygon, tile_paths, footprint_provider)
        if facets:
            return facets, {
                "source": "USGS National Map (TNM) Lidar Point Cloud LAZ",
                "tnm_project": project,
                "tnm_products": len(items),
                **(
                    {"tnm_projects_tried": projects_tried}
                    if len(projects_tried) > 1
                    else {}
                ),
                **({"tile_download_failures": download_errors} if download_errors else {}),
                **meta,
            }
        attempt_metas.append(
            {
                "tnm_project": project,
                **meta,
                **({"tile_download_failures": download_errors} if download_errors else {}),
            }
        )
        if download_errors:
            blocked_project, blocked_error = project, first_error
            break

    if blocked_project is not None:
        raise _RetryableLidarFailure(
            f"USGS LiDAR project {blocked_project} could not be downloaded "
            f"({blocked_error}); whether it covers this footprint is unknown, "
            "so no older survey was substituted. Retry the measurement."
        )
    return [], {
        "tnm_products": len(items),
        "tnm_projects_attempted": attempt_metas,
        "reason": (
            "No USGS Lidar survey project yielded enough building-classified "
            "or elevated non-ground points for this footprint."
        ),
    }


@app.get("/health")
def health():
    return {"status": "ok", "service": APP_NAME, "lidar_collection": STAC_COLLECTION}


def _analysis_cache_key(request: AnalyzeRequest) -> str:
    key = (
        request.street_address.strip().casefold()
        if request.street_address
        else f"{float(request.lat):.6f},{float(request.lon):.6f}"
    ) + (f":candidate:{request.footprint_candidate_id}" if request.footprint_candidate_id else "")
    # A pin-steered run can select a different building than the plain
    # address run, so it must never share the plain run's cache entry.
    if request.pin_lat is not None and request.pin_lon is not None:
        key += f":pin:{float(request.pin_lat):.6f},{float(request.pin_lon):.6f}"
    # A multi-structure run returns extra payload the plain run does
    # not have; the two must never share a cache entry either.
    if request.include_outbuilding:
        key += ":structures"
    return key


async def _measure_footprint(
    footprint: Polygon,
    footprint_provider: Any,
    report: ProgressReporter | None = None,
) -> tuple[list[dict[str, Any]], dict[str, Any], Any]:
    """Measure one building footprint with the LiDAR facet pipeline:
    the COPC path first, the USGS TNM LAZ tiles as fallback — the
    exact sequence the main structure has always used, shared so a
    detached structure is measured identically to the main house.
    Returns (facets, lidar_meta, edge_lengths_lf); the edge totals
    are popped out of the metadata exactly as the single-structure
    flow did."""
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
            if report is not None:
                tnm_facets, tnm_meta = await _read_lidar_facets_tnm(
                    footprint, footprint_provider, report=report
                )
            else:
                tnm_facets, tnm_meta = await _read_lidar_facets_tnm(
                    footprint, footprint_provider
                )
        except _RetryableLidarFailure as exc:
            # Transient acquisition failure: fail the request retryably
            # (a failed job the CRM resubmits, a 503 on the sync path)
            # instead of letting the address read as unmeasurable.
            raise HTTPException(503, str(exc)) from exc
        except Exception as exc:
            tnm_facets, tnm_meta = [], {"reason": f"TNM lookup failed: {type(exc).__name__}"}
        if tnm_facets:
            facets, lidar_meta = tnm_facets, tnm_meta
        else:
            lidar_meta = {**lidar_meta, "tnm_fallback": tnm_meta}
    edge_lengths_lf = lidar_meta.pop("edge_lengths_lf", None)
    return facets, lidar_meta, edge_lengths_lf


def _structure_roof_payload(
    facets: list[dict[str, Any]], lidar_meta: dict[str, Any], edge_lengths_lf: Any
) -> dict[str, Any]:
    """The `roof` object for one structure, shaped exactly like the
    top-level response's roof object."""
    area = sum(facet["area_sqft"] for facet in facets)
    return {
        "facet_count": len(facets),
        "area_sqft": round(area, 1) if facets else None,
        "total_squares": round(area / 100.0, 3) if facets else None,
        "dominant_pitch_rise_per_12": (
            max(facets, key=lambda facet: facet["area_sqft"])["pitch_rise_per_12"]
            if facets
            else None
        ),
        "facets": facets,
        "edge_lengths_lf": edge_lengths_lf if facets else None,
        "drawing_ready": bool(lidar_meta.get("drawing_ready")) if facets else False,
    }


def _structure_footprint_payload(polygon: Polygon, meta: dict[str, Any]) -> dict[str, Any]:
    """The `footprint` object for one structure, shaped exactly like
    the top-level response's footprint object."""
    return {
        "source": meta.get("provider", "Unknown public footprint source"),
        "source_id": meta.get("source_id"),
        "osm_way_id": meta.get("source_id") if meta.get("provider") == "OpenStreetMap" else None,
        "area_sqft": round(_polygon_area_sqft(polygon), 1),
        **_footprint_match_fields(meta),
        "polygon_geojson": mapping(polygon),
        "building_tags": meta.get("building_tags", {}),
    }


async def _run_analysis(
    request: AnalyzeRequest, report: ProgressReporter | None = None
) -> dict[str, Any]:
    """The full address → measurement pipeline behind both analyze APIs.

    The synchronous endpoint awaits this inline; the jobs API runs it on a
    worker thread. `report` receives coarse progress (stage, detail,
    download fraction) so a polling client can show what a long cold-cache
    run is doing instead of a silent spinner.
    """
    cache_key = _analysis_cache_key(request)
    cached = _RESPONSE_CACHE.get(cache_key)
    if cached and cached[0] > monotonic():
        return cached[1]
    if report is not None:
        report("geocoding", "Locating the address", None)
    if request.street_address:
        lat, lon, matched_address, address_provenance = await geocode_with_provenance(request.street_address)
    else:
        lat, lon = float(request.lat), float(request.lon)
        matched_address = f"{lat:.7f}, {lon:.7f}"
        address_provenance = {"source": "User-provided coordinates"}
    # Pin steering: with a street address AND a user pin, the pin —
    # not the geocoded address point — is the point footprint search
    # and auto-selection score against (containment first, then
    # distance), which is what makes the CRM's movable pin meaningful.
    # The footprint match fields in the response then describe the pin
    # point, and the response location stays the geocoded point.
    pin_used = bool(
        request.street_address and request.pin_lat is not None and request.pin_lon is not None
    )
    selection_lat, selection_lon = (
        (float(request.pin_lat), float(request.pin_lon)) if pin_used else (lat, lon)
    )
    if report is not None:
        report("footprint", "Matching the building footprint", None)
    footprint, footprint_meta = await get_footprint(selection_lat, selection_lon, request.street_address, request.footprint_candidate_id)
    # Internal multi-structure evidence (see get_footprint); popped
    # unconditionally so it can never leak into a response.
    candidate_pool = footprint_meta.pop("_candidate_pool", [])
    footprint_sqft = _polygon_area_sqft(footprint)
    footprint_provider = footprint_meta.get("provider")
    if report is not None:
        report("lidar", "Reading public LiDAR coverage for the building", None)
    facets, lidar_meta, edge_lengths_lf = await _measure_footprint(
        footprint, footprint_provider, report
    )
    lidar_area = sum(facet["area_sqft"] for facet in facets)
    status = "lidar_facets" if facets else "footprint_only"
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
            **(
                {
                    "point_hint": {
                        "lat": round(selection_lat, 7),
                        "lon": round(selection_lon, 7),
                        "source": "user_pin",
                    }
                }
                if pin_used
                else {}
            ),
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
            "drawing_ready": bool(lidar_meta.get("drawing_ready")) if facets else False,
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
    if request.include_outbuilding:
        # Multi-structure mode: the top-level payload above always
        # describes the main structure; this additive block identifies
        # the detached structures on the same property from the
        # footprint candidate pool, measures each with the same
        # pipeline, and reports every structure in the same shape so
        # the CRM can swap between them without re-measuring.
        detached, classification_audit = _classify_detached_structures(
            footprint, footprint_meta, candidate_pool, request.street_address
        )
        selection = footprint_meta.get("selection")
        structures: list[dict[str, Any]] = [
            {
                "role": "main",
                "label": "Main house",
                "candidate_id": footprint_meta.get("candidate_id"),
                "status": result["status"],
                "provider": footprint_provider,
                "selection_basis": (
                    selection.get("basis", []) if isinstance(selection, dict) else []
                ),
                "distance_to_main_m": 0.0,
                "location": {
                    "lat": round(float(footprint.centroid.y), 7),
                    "lon": round(float(footprint.centroid.x), 7),
                },
                "footprint": result["footprint"],
                "lidar": result["lidar"],
                "roof": result["roof"],
            }
        ]
        audit_by_candidate = {
            entry.get("candidate_id"): entry for entry in classification_audit
        }
        for index, (gap_m, structure_polygon, structure_meta) in enumerate(detached, start=1):
            if report is not None:
                report(
                    "fitting_planes",
                    f"Measuring detached structure {index} of {len(detached)}",
                    None,
                )
            s_facets, s_lidar_meta, s_edges = await _measure_footprint(
                structure_polygon, structure_meta.get("provider"), report
            )
            audit_entry = audit_by_candidate.get(structure_meta.get("candidate_id")) or {}
            structures.append(
                {
                    "role": "detached",
                    "label": f"Detached structure {index}",
                    "candidate_id": structure_meta.get("candidate_id"),
                    "status": "lidar_facets" if s_facets else "footprint_only",
                    "provider": structure_meta.get("provider"),
                    "selection_basis": audit_entry.get("reasons", []),
                    "distance_to_main_m": round(gap_m, 2),
                    "location": {
                        "lat": round(float(structure_polygon.centroid.y), 7),
                        "lon": round(float(structure_polygon.centroid.x), 7),
                    },
                    "footprint": _structure_footprint_payload(
                        structure_polygon, structure_meta
                    ),
                    "lidar": {
                        "source": "Microsoft Planetary Computer / USGS 3DEP COPC",
                        **s_lidar_meta,
                    },
                    "roof": _structure_roof_payload(s_facets, s_lidar_meta, s_edges),
                }
            )
        result["structures"] = structures
        result["structures_audit"] = {
            "method": "same_property_footprint_classification",
            "main_candidate_id": footprint_meta.get("candidate_id"),
            "candidates_considered": len(classification_audit),
            "detached_max_gap_m": DETACHED_MAX_GAP_M,
            "detached_max_centroid_m": DETACHED_MAX_CENTROID_M,
            "detached_max_structures": DETACHED_MAX_STRUCTURES,
            "detached_max_area_sqft": DETACHED_MAX_AREA_SQFT,
            "detached_max_area_fraction": DETACHED_MAX_AREA_FRACTION,
            "candidates": classification_audit,
        }
    # Only successful measurements are cached. A footprint_only
    # result usually means a transient provider failure (a USGS
    # throttle or 5xx during tile download); caching it for the full
    # TTL would keep the address broken for a day and force a human
    # to notice — the hands-off flow must heal on the next request.
    if facets:
        if len(_RESPONSE_CACHE) >= MAX_RESPONSE_CACHE:
            expired_or_oldest = min(_RESPONSE_CACHE, key=lambda key: _RESPONSE_CACHE[key][0])
            _RESPONSE_CACHE.pop(expired_or_oldest, None)
        _RESPONSE_CACHE[cache_key] = (monotonic() + CACHE_TTL_SECONDS, result)
    return result


@app.post("/v1/roof/locate")
async def locate_building(request: LocateRequest):
    """Resolve a point/address to the building footprint the
    measurement pipeline would select for it — lookup only, no LiDAR
    and no measurement.

    Runs the exact candidate lookup + deterministic auto-selection
    behind `get_footprint` (the same code `_run_analysis` calls), so
    the returned candidate is the one a measurement of this point
    would measure. The CRM measurement-order form uses the returned
    centroid as its pin: geocoders land on the street in front of the
    lot, while the centroid sits on the house itself, which is both
    the honest visual and the stronger steering hint. A point with no
    eligible footprint nearby answers 200 {"status": "not_found"} so
    the form can fall back to the geocoded point; provider outages
    keep the 503 contract of the underlying lookup.
    """
    matched_address: str | None = None
    if request.lat is not None and request.lon is not None:
        lat, lon = float(request.lat), float(request.lon)
        matched_address = request.street_address
    else:
        lat, lon, matched_address, _provenance = await geocode_with_provenance(
            str(request.street_address)
        )
    try:
        polygon, metadata = await get_footprint(lat, lon, request.street_address)
    except HTTPException as exc:
        detail = exc.detail if isinstance(exc.detail, dict) else {}
        if exc.status_code == 404 and detail.get("code") == "building_footprint_not_found":
            return {
                "status": "not_found",
                "location": {"lat": round(lat, 7), "lon": round(lon, 7)},
                "matched_address": matched_address,
            }
        raise
    # Internal multi-structure evidence (see get_footprint); never
    # serialised into a response.
    metadata.pop("_candidate_pool", None)
    return {
        "status": "found",
        "location": {"lat": round(lat, 7), "lon": round(lon, 7)},
        "matched_address": matched_address,
        "footprint": {
            "provider": metadata.get("provider"),
            "source_id": metadata.get("source_id"),
            "area_sqft": metadata.get("area_sqft"),
            "centroid": metadata.get("centroid"),
            **_footprint_match_fields(metadata),
            "polygon_geojson": mapping(polygon),
        },
    }


@app.post("/v1/roof/analyze")
async def analyze_roof(request: AnalyzeRequest):
    return await _run_analysis(request)


def _job_envelope(job: dict[str, Any]) -> dict[str, Any]:
    envelope: dict[str, Any] = {
        "job_id": job["job_id"],
        "status": job["status"],
        "stage": job["stage"],
        "detail": job["detail"],
        "download_fraction": job["download_fraction"],
        "created_at": job["created_at"],
        "updated_at": job["updated_at"],
        "elapsed_seconds": round(job["updated_at"] - job["created_at"], 1),
    }
    if job["status"] == "complete":
        envelope["result"] = job["result"]
    if job["status"] == "failed":
        envelope["error"] = job["error"]
        envelope["error_status"] = job["error_status"]
        envelope["error_detail"] = job["error_detail"]
    return envelope


def _sweep_jobs() -> None:
    """Drop finished jobs past their TTL and cap the store's size.

    Queued/running jobs are never swept — only finished ones can expire.
    A swept job id answers 404 job_not_found, which the CRM treats as
    "lost, resubmit automatically" (the same contract as a job lost to an
    instance restart), so expiry never needs a human either.
    """
    now = epoch_seconds()
    with _JOBS_LOCK:
        expired = [
            job_id
            for job_id, job in _JOBS.items()
            if job["status"] in ("complete", "failed")
            and now - job["updated_at"] > JOB_TTL_SECONDS
        ]
        for job_id in expired:
            _JOBS.pop(job_id, None)
        if len(_JOBS) > MAX_STORED_JOBS:
            finished = sorted(
                (job for job in _JOBS.values() if job["status"] in ("complete", "failed")),
                key=lambda job: job["updated_at"],
            )
            for job in finished[: len(_JOBS) - MAX_STORED_JOBS]:
                _JOBS.pop(job["job_id"], None)


def _update_job(job_id: str, **fields: Any) -> None:
    with _JOBS_LOCK:
        job = _JOBS.get(job_id)
        if job is None:
            return
        job.update(fields)
        job["updated_at"] = epoch_seconds()


def _job_reporter(job_id: str) -> ProgressReporter:
    def report(stage: str, detail: str | None, download_fraction: float | None) -> None:
        _update_job(
            job_id, stage=stage, detail=detail, download_fraction=download_fraction
        )

    return report


def _execute_job(job_id: str, request: AnalyzeRequest) -> None:
    """Run one analysis job on its own thread with its own event loop.

    A dedicated thread keeps the server's event loop free for health
    checks and status polls while the pipeline blocks on CPU fitting and
    long downloads, and asyncio.run gives the job's httpx clients a loop
    of their own. The semaphore caps how many heavyweight analyses run at
    once on the small free-tier instance; the rest stay visibly queued.
    """
    with _JOB_SEMAPHORE:
        _update_job(job_id, status="running", stage="starting", detail="Analysis started")
        try:
            result = asyncio.run(_run_analysis(request, report=_job_reporter(job_id)))
        except HTTPException as exc:
            detail = exc.detail if isinstance(exc.detail, (str, dict, list)) else str(exc.detail)
            _update_job(
                job_id,
                status="failed",
                stage="failed",
                detail=None,
                error=detail if isinstance(detail, str) else "Analysis request was rejected.",
                error_status=exc.status_code,
                error_detail=detail,
            )
        except Exception as exc:  # noqa: BLE001 — the job must fail loudly, never hang
            _update_job(
                job_id,
                status="failed",
                stage="failed",
                detail=None,
                error=f"{type(exc).__name__}: {exc}",
                error_status=None,
                error_detail=None,
            )
        else:
            _update_job(
                job_id,
                status="complete",
                stage="complete",
                detail="Measurement complete",
                download_fraction=None,
                result=result,
            )


@app.post("/v1/roof/analyze/jobs", status_code=202)
async def submit_analysis_job(request: AnalyzeRequest):
    """Submit an analysis to run outside this request's lifecycle.

    Returns 202 immediately with a job id. Identical submissions dedupe
    onto the job already queued or running for them, and a submission
    whose result is already in the response cache completes on the first
    poll — the client flow is identical either way: submit, poll, read
    the result from the completed job.
    """
    _sweep_jobs()
    cache_key = _analysis_cache_key(request)
    with _JOBS_LOCK:
        for job in _JOBS.values():
            if job["cache_key"] == cache_key and job["status"] in ("queued", "running"):
                return _job_envelope(job)
        job_id = uuid.uuid4().hex
        now = epoch_seconds()
        job = {
            "job_id": job_id,
            "cache_key": cache_key,
            "status": "queued",
            "stage": "queued",
            "detail": "Waiting for a worker",
            "download_fraction": None,
            "created_at": now,
            "updated_at": now,
            "result": None,
            "error": None,
            "error_status": None,
            "error_detail": None,
        }
        _JOBS[job_id] = job
        envelope = _job_envelope(job)
    thread = threading.Thread(target=_execute_job, args=(job_id, request), daemon=True)
    thread.start()
    return envelope


@app.get("/v1/roof/analyze/jobs/{job_id}")
async def get_analysis_job(job_id: str):
    """Report a job's progress, or its result once complete.

    An unknown id — never submitted, expired, or lost when the instance
    restarted (job state is in-memory on a tier with no durable disk) —
    answers 404 with code job_not_found so the client resubmits
    automatically instead of waiting on a job that will never finish.
    """
    _sweep_jobs()
    with _JOBS_LOCK:
        job = _JOBS.get(job_id)
        if job is None:
            raise HTTPException(
                status_code=404,
                detail={
                    "code": "job_not_found",
                    "message": (
                        "This analysis job no longer exists (it expired or the "
                        "service restarted). Resubmit the address to start a new one."
                    ),
                },
            )
        return _job_envelope(job)
