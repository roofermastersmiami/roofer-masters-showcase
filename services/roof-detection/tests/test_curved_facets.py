"""Phase 5d unit tests: curved (cone) facet detection, true-area
measurement, and rim drawing.

Synthetic scenes in local metric coordinates, built through the
same _dsm_labelling_tiling entry as the Phase 4 tests:

- a gabled roof with a true cone turret section must yield
  exactly one curved facet, fitted back to the scene's centre
  and slope, credited the cone's TRUE surface area (plan area
  times sqrt(1 + slope^2)) rather than a flat facet's, with the
  house total preserved, and its region's rim vertices must sit
  on the fitted rim circle (the drawn arc);
- plain gabled and flat-patio scenes must never produce a
  curved facet.
"""
from __future__ import annotations

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import numpy as np
import pytest
from shapely.geometry import Polygon

import main

SQFT = 10.7639104167

PLANE_LEFT = (0.3, 0.0, 5.0)
PLANE_RIGHT = (-0.3, 0.0, 11.0)
OUTLINE = Polygon([(0, 0), (20, 0), (20, 12), (0, 12)])

# The synthetic turret: a full cone section standing on the
# right slope, fully inside the outline. The slope (0.8, ~39
# degrees — a typical turret pitch) is steep enough that no
# plane patch can fit a piece of the surface within the
# discovery rmse gate: over a 2 m patch the cone's sagitta is
# ~0.2 m. (A shallow cone whose patches planes CAN explain is
# legitimately planed by the pipeline — the curved win-margin
# gate exists exactly for that contest.)
CONE_CENTRE = (16.0, 6.0)
CONE_APEX_Z = 8.2
CONE_SLOPE = 0.8
CONE_RADIUS = 3.5


def _pitch(plane: tuple[float, float, float]) -> float:
    a, b, _c = plane
    return math.degrees(math.atan(math.hypot(a, b)))


def _z(plane: tuple[float, float, float], x: float, y: float) -> float:
    a, b, c = plane
    return a * x + b * y + c


def _pool(plane_at, spacing: float = 0.25, noise: float = 0.004, seed: int = 7):
    rng = np.random.default_rng(seed)
    xs = np.arange(spacing / 2, 20, spacing)
    ys = np.arange(spacing / 2, 12, spacing)
    pts = []
    for x in xs:
        for y in ys:
            z = plane_at(float(x), float(y)) + float(rng.normal(0, noise))
            pts.append((float(x), float(y), z))
    return np.array(pts, dtype=float)


def _areas(fitted: list[Polygon], planes) -> list[float]:
    return [
        poly.area / math.cos(math.radians(_pitch(plane))) * SQFT
        for poly, plane in zip(fitted, planes)
    ]


def _fitted() -> list[Polygon]:
    return [
        Polygon([(0, 0), (10.5, 0), (10.5, 12), (0, 12)]),
        Polygon([(9.5, 0), (20, 0), (20, 12), (9.5, 12)]),
    ]


def _tiling(pool):
    fitted = _fitted()
    planes = [PLANE_LEFT, PLANE_RIGHT]
    pitches = [_pitch(p) for p in planes]
    areas = _areas(fitted, planes)
    partition = main._partition_facets_to_outline(fitted, OUTLINE)
    result = main._dsm_labelling_tiling(
        fitted, planes, pitches, areas, pool, OUTLINE, partition,
    )
    return result, areas


def _cone_pool():
    def plane_at(x, y):
        r = math.hypot(x - CONE_CENTRE[0], y - CONE_CENTRE[1])
        if r <= CONE_RADIUS:
            return CONE_APEX_Z - CONE_SLOPE * r
        return _z(PLANE_LEFT, x, y) if x <= 10 else _z(PLANE_RIGHT, x, y)

    return _pool(plane_at)


def test_cone_section_detected_and_measured_to_true_area():
    result, areas_in = _tiling(_cone_pool())
    assert result is not None
    curved = [
        (di, d)
        for di, d in enumerate(result["discovered"])
        if d.get("curved")
    ]
    assert len(curved) == 1
    di, desc = curved[0]
    surf = desc["curved"]
    assert surf["kind"] == "cone"
    # The fit recovers the scene's geometry.
    cx, cy = surf["centre"]
    assert cx == pytest.approx(CONE_CENTRE[0], abs=0.6)
    assert cy == pytest.approx(CONE_CENTRE[1], abs=0.6)
    assert surf["slope"] == pytest.approx(CONE_SLOPE, abs=0.10)
    assert surf["fit_rmse_m"] <= main._LAB_CURVED_MAX_RMSE_M
    assert surf["point_count"] >= main._LAB_CURVED_MIN_INLIERS

    index = 2 + di  # two fitted facets precede the discoveries
    region = result["regions"][index]
    area_sqft = result["areas_sqft"][index]
    # True curved area: over the facet's own territory the cone's
    # surface factor is sqrt(1 + slope^2) everywhere (apex point
    # aside), so the credited area must be the plan area times
    # that factor — NOT the flat plan area, and NOT a plane's
    # pitch factor.
    plan_sqft = region.area * SQFT
    expected = plan_sqft * math.sqrt(1.0 + CONE_SLOPE**2)
    assert area_sqft == pytest.approx(expected, rel=0.07)
    assert area_sqft > plan_sqft * 1.05
    # The territory is the part of the turret the planes could
    # not explain — the cone's core sector (the flanks of a cone
    # are locally near-planar and legitimately go to plane
    # facets, exactly as on Miramar). It must be a substantial
    # piece of the disc, centred on the turret, not a sliver.
    assert 7.0 <= region.area <= math.pi * CONE_RADIUS**2
    assert surf["rim_radius_m"] >= 1.5
    # Total-preserving bookkeeping: carving the cone out of the
    # fitted facets does not move the house's reported total.
    total_after = sum(result["areas_sqft"])
    assert abs(total_after - sum(areas_in)) / sum(areas_in) < 0.001

    # The drawn rim: the region's outer vertices sit ON the
    # fitted rim circle (the arc the CRM drawing will render).
    rim = surf["rim_radius_m"]
    on_circle = 0
    for part in main._polygon_parts(region):
        verts = np.array(part.exterior.coords)
        radii = np.hypot(verts[:, 0] - cx, verts[:, 1] - cy)
        on_circle += int((np.abs(radii - rim) <= 0.15).sum())
    assert on_circle >= 8


def test_gabled_roof_is_never_curved():
    pool = _pool(
        lambda x, y: _z(PLANE_LEFT, x, y) if x <= 10 else _z(PLANE_RIGHT, x, y)
    )
    result, _areas_in = _tiling(pool)
    assert result is not None
    assert all(not d.get("curved") for d in result["discovered"])


def test_flat_patio_is_never_curved():
    # A flat unexplained patch is legitimately discovered — as a
    # PLANE. A cone/cylinder fit over it has ~zero slope and must
    # be refused by the curved pitch window.
    def plane_at(x, y):
        if 14 <= x <= 20 and 9 <= y <= 12:
            return 4.0
        return _z(PLANE_LEFT, x, y) if x <= 10 else _z(PLANE_RIGHT, x, y)

    result, _areas_in = _tiling(_pool(plane_at))
    assert result is not None
    assert len(result["discovered"]) == 1
    assert not result["discovered"][0].get("curved")
