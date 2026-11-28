"""Phase 5b perimeter totals: single-counting on the outline and
the eave/rake water rule. Synthetic geometry only; the validation
houses are covered by the golden fixtures.

The two defects pinned here:

* Double trace — the boundary graph walks the outline AND each
  facet ring, so a ring running parallel to the outline a hair
  inside it gives the graph two traces of one physical edge, both
  labelled perimeter, and chain-summing counted the perimeter
  twice (Miramar: 169 m counted against an 85.9 m outline).
  _perimeter_totals measures the outline itself, once.

* Class split — the alignment-only rule called every segment the
  downslope runs along a rake, including oblique hip facets whose
  bottom edge the water drains off at an angle (Miramar's big
  south-east slope: alignment 0.96, outward flow +0.27). A rake
  now requires the downslope to run along the segment WITHOUT
  draining across it (a gable end: outward flow ~0).
"""

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest
from shapely.geometry import Polygon

from main import (
    _compute_edge_lengths,
    _graph_edge_totals,
    _perimeter_edge_class,
)

FT = 3.280839895
PITCH = 26.565  # atan(0.5)


def _class_for_downslope(dx: float, dy: float, ux: float, uy: float,
                         nx: float, ny: float) -> str:
    """_perimeter_edge_class for a facet whose downslope unit
    vector is (dx, dy): gradient (a, b) = -0.5 * downslope."""
    return _perimeter_edge_class(-0.5 * dx, -0.5 * dy, ux, uy, nx, ny)


def test_class_rule_water_off_the_edge_is_eave():
    # Dip straight across the segment, out of the roof: eave.
    assert _class_for_downslope(0.0, -1.0, 1.0, 0.0, 0.0, -1.0) == "eave"
    # Dip across the segment but INTO the roof (the facet's high
    # side): not parallel, so still an eave by the rule — a rake is
    # only ever the along-the-edge case.
    assert _class_for_downslope(0.0, 1.0, 1.0, 0.0, 0.0, -1.0) == "eave"


def test_class_rule_gable_end_is_rake():
    # Dip parallel to the segment, no outward component: the water
    # runs along the edge and off its end — a gable-end rake.
    assert _class_for_downslope(-1.0, 0.0, 1.0, 0.0, 0.0, 1.0) == "rake"
    # Fitted-plane noise on a true gable end: a few hundredths of
    # outward flow either way stays a rake.
    assert _class_for_downslope(-0.999, 0.03, 1.0, 0.0, 0.0, 1.0) == "rake"
    assert _class_for_downslope(-0.999, -0.03, 1.0, 0.0, 0.0, 1.0) == "rake"


def test_class_rule_oblique_drainer_is_eave_not_rake():
    # The Miramar case: dip ~16 degrees off the segment, tilted
    # OUTWARD (flow +0.27): the water does drain off this edge.
    dx, dy = math.cos(math.radians(16)), -math.sin(math.radians(16))
    assert _class_for_downslope(dx, dy, 1.0, 0.0, 0.0, -1.0) == "eave"
    # The same dip tilted INWARD (flow -0.27): nothing drains
    # across the edge; the water runs along it — a rake.
    assert _class_for_downslope(dx, -dy, 1.0, 0.0, 0.0, -1.0) == "rake"


def test_class_rule_flat_facet_is_eave():
    assert _perimeter_edge_class(0.0, 0.0, 1.0, 0.0, 0.0, -1.0) == "eave"


def _hip_facets(inset: float = 0.0):
    """A 20x20 m hip roof: four triangular facets dipping outward
    from a centre point. ``inset`` pulls every ring that many
    metres inside the outline, the labelled path's situation —
    each ring then runs parallel to the outline a hair inside it
    and the boundary graph carries two traces per edge."""
    lo, hi = inset, 20.0 - inset
    centre = (10.0, 10.0)
    facets = [
        (Polygon([(lo, lo), (hi, lo), centre]), (0.0, 0.5, 0.0)),
        (Polygon([(hi, lo), (hi, hi), centre]), (-0.5, 0.0, 10.0)),
        (Polygon([(hi, hi), (lo, hi), centre]), (0.0, -0.5, 10.0)),
        (Polygon([(lo, hi), (lo, lo), centre]), (0.5, 0.0, 0.0)),
    ]
    outline = Polygon([(0, 0), (20, 0), (20, 20), (0, 20)])
    polygons = [facet for facet, _plane in facets]
    planes = [plane for _facet, plane in facets]
    return polygons, planes, [PITCH] * 4, outline


def test_graph_totals_hip_roof_perimeter_is_all_eave():
    polygons, planes, pitches, outline = _hip_facets()
    totals = _graph_edge_totals(polygons, planes, pitches, outline)
    # Four level 20 m eaves; no rakes anywhere on a hip roof. (The
    # total sits ~1% under the outline: the 0.3 m segment floor
    # drops the 0.1 m claim-bleed pieces at each corner, the
    # service's long-standing convention.)
    assert totals["rake"] == 0.0
    assert totals["eave"] == pytest.approx(4 * 20 * FT, abs=3.0)


def test_graph_totals_double_trace_counts_perimeter_once():
    # Regression: with the rings inset 2 mm, the old chain-summing
    # counted ~2x the outline (both traces are perimeter chains).
    polygons, planes, pitches, outline = _hip_facets(inset=0.002)
    totals = _graph_edge_totals(polygons, planes, pitches, outline)
    assert totals["rake"] == 0.0
    assert totals["eave"] == pytest.approx(4 * 20 * FT, abs=3.0)
    counted = totals["eave"] + totals["rake"]
    assert counted < 1.05 * outline.boundary.length * FT


def test_graph_totals_gable_roof_eaves_and_gable_end_rakes():
    outline = Polygon([(0, 0), (20, 0), (20, 10), (0, 10)])
    west = Polygon([(0, 0), (10, 0), (10, 10), (0, 10)])
    east = Polygon([(10, 0), (20, 0), (20, 10), (10, 10)])
    planes = [(0.5, 0.0, 0.0), (-0.5, 0.0, 10.0)]
    totals = _graph_edge_totals([west, east], planes, [PITCH, PITCH], outline)
    # The two long sides are level eaves (10 m each).
    assert totals["eave"] == pytest.approx(2 * 10 * FT, abs=1.0)
    # The four gable-end runs (10 m each, sloping at the full
    # pitch) are rakes — they must SURVIVE the water rule.
    rake_each = 10 * math.sqrt(1.25) * FT
    assert totals["rake"] == pytest.approx(4 * rake_each, abs=1.5)


def test_legacy_totals_oblique_drainer_is_eave():
    # _compute_edge_lengths (the drawing_ready=False path) shares
    # the class rule: a facet dipping diagonally (a=0.5, b=0.1)
    # drains obliquely off its south edge (alignment 0.98, outward
    # flow +0.20) — eave under the water rule, rake under the old
    # alignment-only rule. Its north edge has the dip running
    # along it with flow -0.20: a rake.
    facets = [{
        "boundary_xy": [[0.0, 0.0], [10.0, 0.0], [10.0, 10.0],
                        [0.0, 10.0], [0.0, 0.0]],
        "plane_model": {"z_equals_ax_plus_by_plus_c": [0.5, 0.1, 0.0]},
        "pitch_degrees": PITCH,
    }]
    edges = _compute_edge_lengths(facets)
    assert edges is not None
    sloped = 10 * math.sqrt(1.25) * FT   # south + north edges
    shallow = 10 * math.sqrt(1.01) * FT  # east + west edges
    assert edges["rake"] == pytest.approx(sloped, abs=1.0)
    assert edges["eave"] == pytest.approx(sloped + 2 * shallow, abs=1.0)
