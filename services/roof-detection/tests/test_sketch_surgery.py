"""Phase 2 drawing surgery: boundary-graph seam rebuild, graph edge
totals, local chord classification, coincidence-preserving tiling
conditioning. Synthetic geometry only; the validation houses are
covered by test_sketch_surgery_golden.py."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import math

import pytest
from shapely.geometry import Polygon
from shapely.ops import unary_union

from main import (
    _boundary_chains,
    _classify_pair_local_chord,
    _condition_polygons_for_emission,
    _condition_tiling_for_emission,
    _drawing_partition,
    _graph_edge_totals,
    _surgery_partition_boundaries,
)

ROOF_PROVIDER = "Miami-Dade County Building Footprints"


def _gable():
    """A 30x20 m gable: two planes sloping away from a ridge at
    x = 15.7, hulls wobbling across the seam and overshooting the
    eave line (the same hulls as the long-standing drawing partition
    test — whose planes, read carefully, slope INTO the seam and so
    describe a valley; a ridge needs the signs swapped, as here)."""
    footprint = Polygon([(0, 0), (30, 0), (30, 20), (0, 20)])
    left_hull = Polygon([
        (0, 0), (16, 0), (15.2, 6), (16.4, 12), (15.4, 18), (15.8, 21),
        (0, 21),
    ])
    right_hull = Polygon([
        (15.5, -1), (30, -1), (30, 20), (15.8, 20), (16.4, 12),
        (15.2, 6),
    ])
    planes = [(0.4, 0.0, -6.28), (-0.4, 0.0, 6.28)]
    pitches = [math.degrees(math.atan(0.4))] * 2
    return footprint, [left_hull, right_hull], planes, pitches


def test_surgery_puts_the_seam_on_the_plane_intersection_line():
    footprint, hulls, planes, pitches = _gable()
    totals: dict = {}
    result, fully = _drawing_partition(
        hulls, planes, footprint, ROOF_PROVIDER,
        pitches=pitches, totals_out=totals,
    )
    assert fully
    # Exact tiling of the outline.
    union = unary_union(result)
    assert abs(union.area - footprint.area) < 1e-6
    assert result[0].intersection(result[1]).area < 1e-9
    # The shared boundary is one straight run on x = 15.7 (a T-junction
    # vertex may split it into collinear parts; the top junction's
    # least-squares solve may sit a few centimetres off the line).
    shared = result[0].boundary.intersection(result[1].boundary)
    parts = list(getattr(shared, "geoms", [shared]))
    xs = [coord[0] for part in parts for coord in part.coords]
    assert abs(shared.length - 20.0) < 0.05
    assert max(xs) - 15.7 < 0.05 and 15.7 - min(xs) < 0.05
    # Graph totals: a level 20 m ridge; eaves are the 20 m sides
    # across the slope (x = 0 and x = 30), rakes the 30 m gable ends
    # along it, at the planes' 3D length.
    assert totals["ridge"] == pytest.approx(20 * 3.28084, abs=0.2)
    assert totals["hip"] == 0.0 and totals["valley"] == 0.0
    assert totals["eave"] == pytest.approx(40 * 3.28084, abs=0.5)
    assert totals["rake"] == pytest.approx(60 * math.sqrt(1.16) * 3.28084, abs=0.5)


def test_surgery_keeps_a_polyline_when_the_planes_disagree_with_it():
    # The right facet's plane is shifted so the pair's intersection
    # line sits ~3 m from the drawn seam: the snap guard must refuse
    # and the tiling must survive unchanged in structure.
    footprint, hulls, planes, pitches = _gable()
    shifted = [(planes[0]), (-0.4, 0.0, 6.28 - 2.4)]
    partition, stats = _surgery_partition_boundaries(
        _partition(hulls, footprint), shifted, pitches, footprint
    )
    assert stats["chains_snapped"] == 0
    union = unary_union(partition)
    assert abs(union.area - footprint.area) < 1e-6


def _partition(hulls, footprint):
    from main import _partition_facets_to_outline

    return _partition_facets_to_outline(hulls, footprint)


def test_boundary_chains_contract_micro_segments_on_the_shared_graph():
    # Two facets sharing a seam that carries a 0.1 m jog: after graph
    # construction the jog is gone and both sides still coincide.
    left = Polygon([(0, 0), (10, 0), (10, 5), (10.1, 5.05), (10, 5.1),
                    (10, 10), (0, 10)])
    right = Polygon([(10, 0), (20, 0), (20, 10), (10, 10), (10, 5.1),
                     (10.1, 5.05), (10, 5)])
    outline = unary_union([left, right])
    graph = _boundary_chains([left, right], outline)
    for chain in graph["chains"]:
        verts = chain["verts"]
        for a, b in zip(verts, verts[1:]):
            assert math.hypot(a[0] - b[0], a[1] - b[1]) >= 0.15 - 1e-9


def test_local_chord_classifier_reads_valley_ridge_and_pitch_change():
    # Valley: both surfaces DESCEND toward the seam (a V in section).
    left = Polygon([(0, 0), (10, 0), (10, 10), (0, 10)])
    right = Polygon([(10, 0), (20, 0), (20, 10), (10, 10)])
    valley = _classify_pair_local_chord(
        left, (-0.4, 0.0, 4.0), 21.8, right, (0.4, 0.0, -4.0), 21.8
    )
    assert valley == "valley"
    # Ridge: both surfaces RISE toward the seam (a peak in section).
    ridge = _classify_pair_local_chord(
        left, (0.4, 0.0, -4.0), 21.8, right, (-0.4, 0.0, 4.0), 21.8
    )
    assert ridge == "ridge"
    # Flat pair: parallel near-flat planes share a pitch-change seam.
    flat = _classify_pair_local_chord(
        left, (0.01, 0.0, 1.0), 0.6, right, (0.01, 0.0, 1.2), 0.6
    )
    assert flat == "pitch_change"
    # Parallel non-flat planes have no intersection line and no class.
    none = _classify_pair_local_chord(
        left, (0.4, 0.0, 0.0), 21.8, right, (0.4, 0.0, 1.0), 21.8
    )
    assert none is None


def test_graph_totals_measure_the_shipped_lines_not_the_hulls():
    # On the raw hulls the pair's seam wobbles; the graph totals of
    # the SURGERIED tiling must reflect the single straight ridge.
    footprint, hulls, planes, pitches = _gable()
    result, fully = _drawing_partition(
        hulls, planes, footprint, ROOF_PROVIDER, pitches=pitches
    )
    assert fully
    totals = _graph_edge_totals(result, planes, pitches, footprint)
    assert totals["ridge"] == pytest.approx(65.6, abs=0.3)
    assert totals["valley"] == 0.0


def test_tiling_conditioning_preserves_coincidence_exactly():
    footprint, hulls, planes, pitches = _gable()
    result, fully = _drawing_partition(
        hulls, planes, footprint, ROOF_PROVIDER, pitches=pitches
    )
    assert fully
    conditioned = _condition_polygons_for_emission(result, exact_tiling=True)
    # The tiling passes through untouched: same rings, and the shared
    # boundary is still exactly one geometry in both facets.
    for before, after in zip(result, conditioned):
        assert list(before.exterior.coords) == list(after.exterior.coords)
    shared_before = result[0].boundary.intersection(result[1].boundary)
    shared_after = conditioned[0].boundary.intersection(
        conditioned[1].boundary
    )
    assert abs(shared_before.length - shared_after.length) < 1e-9
    # And the direct entry point agrees.
    direct = _condition_tiling_for_emission(result)
    assert direct is not None and len(direct) == 2


def test_tiling_conditioning_rejects_a_broken_tiling():
    # Overlapping polygons are not an exact tiling: the coincidence-
    # preserving path must refuse (None) so the caller falls back to
    # the legacy conditioning, which still returns a whole response.
    big = Polygon([(0, 0), (20, 0), (20, 20), (0, 20)])
    overlap = Polygon([(10, 0), (30, 0), (30, 20), (10, 20)])
    assert _condition_tiling_for_emission([big, overlap]) is None
    out = _condition_polygons_for_emission([big, overlap], exact_tiling=True)
    assert len(out) == 2
