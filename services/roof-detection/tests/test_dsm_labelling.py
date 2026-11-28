"""Phase 4 unit tests: DSM-residual labelling + bounded discovery.

Synthetic roofs in local metric coordinates. The gates under test
are Phase 3's, unchanged: unexplained components need >= 2 m^2 to
seed a candidate; a discovered plane needs >= 40 inliers, trimmed
rmse <= 0.08 m, and a >= 50% residual cut; a production facet whose
labelling region dies (< 0.5 m^2) voids the upgrade (None) instead
of silently erasing a measured facet.
"""
from __future__ import annotations

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import numpy as np
import pytest
from shapely.geometry import Polygon
from shapely.ops import unary_union

import main

SQFT = 10.7639104167

# Two planes meeting at a ridge over x = 10 in a 20 x 12 m outline.
PLANE_LEFT = (0.3, 0.0, 5.0)
PLANE_RIGHT = (-0.3, 0.0, 11.0)
OUTLINE = Polygon([(0, 0), (20, 0), (20, 12), (0, 12)])


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
            plane, extra = plane_at(float(x), float(y))
            z = _z(plane, float(x), float(y)) + extra
            z += float(rng.normal(0, noise))
            pts.append((float(x), float(y), z))
    return np.array(pts, dtype=float)


def _areas(fitted: list[Polygon], planes) -> list[float]:
    return [
        poly.area / math.cos(math.radians(_pitch(plane))) * SQFT
        for poly, plane in zip(fitted, planes)
    ]


def _gabled_pool(**kwargs):
    return _pool(
        lambda x, y: (PLANE_LEFT, 0.0) if x <= 10 else (PLANE_RIGHT, 0.0),
        **kwargs,
    )


def test_labelling_assigns_territory_by_residual_not_hulls():
    # The fitted hulls deliberately disagree about the seam (left
    # claims x <= 13, right claims x >= 7); the point cloud says
    # the ridge is at x = 10, and the labelling must follow it.
    fitted = [
        Polygon([(0, 0), (13, 0), (13, 12), (0, 12)]),
        Polygon([(7, 0), (20, 0), (20, 12), (7, 12)]),
    ]
    planes = [PLANE_LEFT, PLANE_RIGHT]
    pitches = [_pitch(p) for p in planes]
    partition = main._partition_facets_to_outline(fitted, OUTLINE)
    result = main._dsm_labelling_tiling(
        fitted, planes, pitches, _areas(fitted, planes),
        _gabled_pool(), OUTLINE, partition,
    )
    assert result is not None
    assert result["discovered"] == []
    regions = result["regions"]
    assert len(regions) == 2
    union = unary_union(regions)
    assert union.area == pytest.approx(OUTLINE.area, rel=0.01)
    # The seam sits on the true ridge, not on either hull's claim.
    assert regions[0].bounds[2] == pytest.approx(10.0, abs=0.75)
    assert regions[1].bounds[0] == pytest.approx(10.0, abs=0.75)


def test_discovery_recovers_an_unfitted_face_and_moves_its_area():
    # A flat patio (z = 4) hides inside the right plane's hull
    # territory: 6 x 3 m of points no fitted plane explains.
    def plane_at(x, y):
        if 14 <= x <= 20 and 9 <= y <= 12:
            return (0.0, 0.0, 4.0), 0.0
        return (PLANE_LEFT, 0.0) if x <= 10 else (PLANE_RIGHT, 0.0)

    fitted = [
        Polygon([(0, 0), (10.5, 0), (10.5, 12), (0, 12)]),
        Polygon([(9.5, 0), (20, 0), (20, 12), (9.5, 12)]),
    ]
    planes = [PLANE_LEFT, PLANE_RIGHT]
    pitches = [_pitch(p) for p in planes]
    areas = _areas(fitted, planes)
    partition = main._partition_facets_to_outline(fitted, OUTLINE)
    result = main._dsm_labelling_tiling(
        fitted, planes, pitches, areas, _pool(plane_at), OUTLINE, partition,
    )
    assert result is not None
    assert len(result["discovered"]) == 1
    discovered = result["discovered"][0]
    a, b, c = discovered["plane"]
    assert abs(a) < 0.05 and abs(b) < 0.05 and c == pytest.approx(4.0, abs=0.1)
    # The patio's ~18 m^2 lands on the discovered facet; the carved
    # facet is debited the same territory at its own pitch, and the
    # discovered facet is credited exactly the debited total — the
    # house's reported area does not move when a plane is carved
    # out of existing hulls.
    assert discovered["area_sqft"] == pytest.approx(18 * SQFT, rel=0.15)
    assert result["areas_sqft"][1] < areas[1]
    total_before = sum(areas)
    total_after = sum(result["areas_sqft"])
    assert abs(total_after - total_before) / total_before < 0.001


def test_discovery_ignores_sub_threshold_components():
    # A 1 x 1 m unexplained patch is below the 2 m^2 seed gate.
    def plane_at(x, y):
        if 15 <= x <= 16 and 5 <= y <= 6:
            return (0.0, 0.0, 4.0), 0.0
        return (PLANE_LEFT, 0.0) if x <= 10 else (PLANE_RIGHT, 0.0)

    fitted = [
        Polygon([(0, 0), (10.5, 0), (10.5, 12), (0, 12)]),
        Polygon([(9.5, 0), (20, 0), (20, 12), (9.5, 12)]),
    ]
    planes = [PLANE_LEFT, PLANE_RIGHT]
    partition = main._partition_facets_to_outline(fitted, OUTLINE)
    result = main._dsm_labelling_tiling(
        fitted, planes, [_pitch(p) for p in planes], _areas(fitted, planes),
        _pool(plane_at), OUTLINE, partition,
    )
    assert result is not None
    assert result["discovered"] == []


def test_discovery_rejects_noisy_components():
    # A 4 x 3 m patch scattered +/- 0.25 m around the right plane
    # cannot produce a trimmed fit at rmse <= 0.08 m.
    rng = np.random.default_rng(11)

    def plane_at(x, y):
        if 14 <= x <= 18 and 4 <= y <= 7:
            return PLANE_RIGHT, float(rng.normal(0, 0.25))
        return (PLANE_LEFT, 0.0) if x <= 10 else (PLANE_RIGHT, 0.0)

    fitted = [
        Polygon([(0, 0), (10.5, 0), (10.5, 12), (0, 12)]),
        Polygon([(9.5, 0), (20, 0), (20, 12), (9.5, 12)]),
    ]
    planes = [PLANE_LEFT, PLANE_RIGHT]
    partition = main._partition_facets_to_outline(fitted, OUTLINE)
    result = main._dsm_labelling_tiling(
        fitted, planes, [_pitch(p) for p in planes], _areas(fitted, planes),
        _pool(plane_at), OUTLINE, partition,
    )
    assert result is not None
    assert result["discovered"] == []


def test_exact_plane_facets_share_the_group_region():
    # Facets 2 and 3 carry the identical plane (the fitter's
    # fragment pattern): labelling sees ONE group plane, then the
    # members split the group's region by their hull partition —
    # neither member may come back empty.
    fitted = [
        Polygon([(0, 0), (10.5, 0), (10.5, 12), (0, 12)]),
        Polygon([(9.5, 0), (20, 0), (20, 6), (9.5, 6)]),
        Polygon([(9.5, 6), (20, 6), (20, 12), (9.5, 12)]),
    ]
    planes = [PLANE_LEFT, PLANE_RIGHT, PLANE_RIGHT]
    pitches = [_pitch(p) for p in planes]
    partition = main._partition_facets_to_outline(fitted, OUTLINE)
    result = main._dsm_labelling_tiling(
        fitted, planes, pitches, _areas(fitted, planes),
        _gabled_pool(), OUTLINE, partition,
    )
    assert result is not None
    regions = result["regions"]
    assert len(regions) == 3
    assert all(region.area > 1.0 for region in regions)
    union = unary_union(regions)
    assert union.area == pytest.approx(OUTLINE.area, rel=0.01)


def test_production_facet_death_voids_the_upgrade():
    # A fitted plane 500 m above the roof wins no cells: the
    # labelling must refuse (None) rather than erase the facet.
    absurd = (0.3, 0.0, 505.0)
    fitted = [
        Polygon([(0, 0), (7, 0), (7, 12), (0, 12)]),
        Polygon([(0, 0), (10.5, 0), (10.5, 12), (0, 12)]),
        Polygon([(9.5, 0), (20, 0), (20, 12), (9.5, 12)]),
    ]
    planes = [absurd, PLANE_LEFT, PLANE_RIGHT]
    pitches = [_pitch(p) for p in planes]
    partition = main._partition_facets_to_outline(fitted, OUTLINE)
    result = main._dsm_labelling_tiling(
        fitted, planes, pitches, _areas(fitted, planes),
        _gabled_pool(), OUTLINE, partition,
    )
    assert result is None


def test_multipart_resolution_moves_small_parts_to_longest_border():
    # Facet 0 owns a big part and a small island wedged between
    # facets 1 and 2 (longer border with 2); the island must move
    # to facet 2 and every region must come back a single polygon.
    big = Polygon([(0, 0), (8, 0), (8, 10), (0, 10)])
    island = Polygon([(10, 4), (12, 4), (12, 6), (10, 6)])
    facet0 = big.union(island)
    facet1 = Polygon([(8, 0), (14, 0), (14, 4), (12, 4), (12, 2), (8, 2)])
    facet2 = Polygon([(8, 2), (12, 2), (12, 4), (10, 4), (10, 6), (12, 6),
                      (12, 10), (8, 10)])
    facet3 = Polygon([(12, 6), (14, 6), (14, 10), (12, 10)])
    regions = [facet0, facet1, facet2, facet3]
    resolved, moved = main._resolve_multipart_regions(regions)
    assert moved == 1
    assert all(r.geom_type == "Polygon" for r in resolved)
    assert resolved[0].area == pytest.approx(big.area)
    assert resolved[2].area == pytest.approx(facet2.area + island.area)
    total = sum(r.area for r in resolved)
    assert total == pytest.approx(sum(r.area for r in regions))


def test_chain_simplification_thins_staircases_keeps_endpoints():
    # A raster staircase: 21 vertices hugging a straight run with
    # 0.05 m steps, plus one genuine 0.6 m jog in the middle.
    verts = [(float(i), 0.05 * (i % 2)) for i in range(11)]
    verts.append((11.0, 0.6))
    verts += [(float(i), 0.6 + 0.05 * (i % 2)) for i in range(12, 21)]
    chain = {"pair": (0, 1), "verts": verts}
    main._simplify_boundary_chains([chain], 0.15)
    kept = chain["verts"]
    assert kept[0] == verts[0]
    assert kept[-1] == verts[-1]
    assert (11.0, 0.6) in kept
    assert len(kept) < len(verts) // 2
