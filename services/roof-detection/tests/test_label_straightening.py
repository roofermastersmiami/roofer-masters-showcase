"""Phase 5: straightening of DSM-labelled facet boundaries.

The labelling's seams are residual-competition raster paths: their
junctions sit metres off the pair's plane-intersection line (or the
planes are parallel and no line exists), so the Phase 2 snap guards
refuse them and the raw staircase would ship. On the labelled path
(simplify_tol_m > 0) the surgery now straightens a refused chain on
the shared boundary graph — TLS line through the chain's own
vertices, corners split, per-piece fallback — while the hull path
(tol 0) keeps the Phase 2 behaviour exactly. Synthetic geometry
only; the validation houses are covered by
test_dsm_labelling_golden.py.
"""

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from shapely.geometry import Polygon
from shapely.ops import unary_union

from main import (
    _boundary_chains,
    _straighten_chain_pieces,
    _surgery_partition_boundaries,
    _tls_line,
)


def _staircase_roof():
    """Two facets tiling a 24x20 m outline, sharing a staircase
    seam at x ~= 10 (1 m treads, 0.4 m steps). The planes are
    PARALLEL (same gradient, different height), so the pair has no
    intersection line and the Phase 2 snap can never engage — the
    labelled path's situation for fragment seams."""
    steps = [(10.0 + 0.4 * (k % 2), float(k)) for k in range(21)]
    left = Polygon([(0, 0), (10, 0)] + steps[1:] + [(0, 20)])
    right = Polygon(
        [(10, 0)] + steps[1:] + [(24, 20), (24, 0)]
    )
    outline = Polygon([(0, 0), (24, 0), (24, 20), (0, 20)])
    planes = [(0.30, 0.0, 0.0), (0.30, 0.0, -1.0)]
    pitches = [math.degrees(math.atan(0.3))] * 2
    return outline, [left, right], planes, pitches


def _seam_chain(rings, outline):
    graph = _boundary_chains(rings, outline)
    seams = [
        c for c in graph["chains"]
        if len(c["pair"]) == 2 and -1 not in c["pair"]
    ]
    assert len(seams) == 1
    return seams[0]


def _reversals(verts) -> int:
    count, prev = 0, 0.0
    for a, b, c in zip(verts, verts[1:], verts[2:]):
        cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0])
        if abs(cross) < 1e-12:
            continue
        if prev and (cross > 0) != (prev > 0):
            count += 1
        prev = cross
    return count


def test_labelled_path_straightens_a_stepped_seam():
    outline, partition, planes, pitches = _staircase_roof()
    result, stats = _surgery_partition_boundaries(
        partition, planes, pitches, outline, simplify_tol_m=0.15
    )
    assert "fallback_reason" not in stats
    assert stats["chains_snapped"] == 0  # parallel planes: no snap
    assert stats["chains_straightened"] == 1
    # The tiling stays exact.
    union = unary_union(result)
    assert abs(union.area - outline.area) < 1e-6
    assert result[0].intersection(result[1]).area < 1e-9
    # The shipped seam is ONE straight run: no staircase reversals,
    # and every vertex sits on the end-to-end chord.
    chain = _seam_chain(result, outline)
    verts = chain["verts"]
    assert _reversals(verts) == 0
    (x0, y0), (x1, y1) = verts[0], verts[-1]
    chord = math.hypot(x1 - x0, y1 - y0)
    for x, y in verts:
        dev = abs((x1 - x0) * (y - y0) - (y1 - y0) * (x - x0)) / chord
        assert dev < 0.05


def test_hull_path_keeps_the_stepped_seam_untouched():
    outline, partition, planes, pitches = _staircase_roof()
    result, stats = _surgery_partition_boundaries(
        partition, planes, pitches, outline, simplify_tol_m=0.0
    )
    assert stats["chains_straightened"] == 0
    chain = _seam_chain(result, outline)
    # The raster staircase ships as drawn on the Phase 2 path.
    assert len(chain["verts"]) >= 10
    assert _reversals(chain["verts"]) >= 5


def test_tls_line_recovers_a_noisy_trend():
    verts = [
        (float(i), 0.5 * i + (0.02 if i % 2 else -0.02))
        for i in range(21)
    ]
    line = _tls_line(verts)
    assert line is not None
    la, lb, lc = line
    norm = math.hypot(la, lb)
    # Points on the true trend sit on the fitted line.
    for x, y in ((0.0, 0.0), (10.0, 5.0), (20.0, 10.0)):
        assert abs(la * x + lb * y + lc) / norm < 0.05
    # The line's direction is parallel to (1, 0.5).
    cross = lb * 0.5 + la * 1.0
    assert abs(cross) / norm < 0.02


def test_tls_line_rejects_isotropic_scatter():
    verts = [
        (5.0 * math.cos(t), 5.0 * math.sin(t))
        for t in [i * math.pi / 8 for i in range(16)]
    ]
    assert _tls_line(verts) is None
    assert _tls_line([(1.0, 1.0)]) is None
    assert _tls_line([(0.0, 0.0), (3.0, 4.0)]) is not None


def test_arc_chain_splits_into_straight_pieces():
    # A semicircular arc: no single segment can represent it (its
    # chord deviation is the radius), so it must split at its bends
    # into pieces that each qualify, meeting exactly at the split
    # vertices, endpoints unchanged.
    verts = [
        (5.0 * math.cos(t), 5.0 * math.sin(t))
        for t in [math.pi - i * math.pi / 12 for i in range(13)]
    ]
    chain = {"pair": frozenset({0, 1}), "verts": verts, "snap": False,
             "hausdorff": 0.0}
    pieces = _straighten_chain_pieces(chain)
    assert pieces is not None
    assert len(pieces) >= 2
    assert all(p["snap"] and p["straightened"] for p in pieces)
    assert pieces[0]["verts"][0] == verts[0]
    assert pieces[-1]["verts"][-1] == verts[-1]
    for first, second in zip(pieces, pieces[1:]):
        assert first["verts"][-1] == second["verts"][0]


def test_doubling_back_chain_keeps_its_trace():
    # A thin spike out and back: chord a twentieth of the traced
    # length and no sharp bend to split at — no piece qualifies.
    chain = {
        "pair": frozenset({0, 1}),
        "verts": [(0.0, 0.0), (10.0, 0.2), (0.4, 0.4)],
        "snap": False,
        "hausdorff": 0.0,
    }
    assert _straighten_chain_pieces(chain) is None
