"""Regression tests for the surgery's partition-validity guard
(Phase 3 finding, sw139): a rebuilt tiling must not invent an
adjacency the boundary graph does not have, and must not overlap.
The phantom case is invisible to the divergent-seam guard because
the invented edge is coincident in both rings."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import main as svc
from shapely.geometry import Polygon
from shapely.ops import unary_union


def _box(x0, y0, x1, y1):
    return Polygon([(x0, y0), (x1, y0), (x1, y1), (x0, y1)])


def test_phantom_adjacency_flagged_sw139_configuration():
    # The tiling: facet 0 | facet 1 | facet 2 in a row — facet 1 sits
    # between the other two, so the graph has (0,1) and (1,2) only.
    graph_pairs = {(0, 1), (1, 2)}
    # The rebuilt rings (the Phase 3 failure shape): facet 1 is
    # redrawn as only the top strip and facet 2 wraps underneath it,
    # so facets 0 and 2 share a 15 m (~49 ft) coincident edge that
    # exists in neither the tiling nor the graph.
    regions = [
        _box(0, 0, 10, 30),
        _box(10, 15, 20, 30),
        Polygon(
            [(10, 0), (30, 0), (30, 30), (20, 30), (20, 15), (10, 15)]
        ),
    ]
    assert svc._surgery_partition_violation(regions, graph_pairs) == (
        "phantom_adjacency_0_2"
    )


def test_overlap_flagged_even_for_graph_neighbours():
    regions = [_box(0, 0, 10, 10), _box(5, 0, 15, 10)]
    assert svc._surgery_partition_violation(regions, {(0, 1)}) == (
        "overlap_0_1"
    )


def test_clean_partition_and_point_touch_pass():
    regions = [_box(0, 0, 10, 10), _box(10, 0, 20, 10), _box(20, 0, 30, 10)]
    assert svc._surgery_partition_violation(regions, {(0, 1), (1, 2)}) is None
    # A corner (point) contact is not an edge: length 0, no violation
    # even though the pair is absent from the graph.
    diagonal = [_box(0, 0, 10, 10), _box(10, 10, 20, 20)]
    assert svc._surgery_partition_violation(diagonal, set()) is None


def test_guard_failure_falls_back_to_tiling(monkeypatch):
    # Two rectangles sharing the ridge line x=10 — a normal surgery
    # input. Force the guard to flag every attempt: the veto ladder
    # must exhaust and the surgery must return today's tiling
    # unchanged, with the violation recorded in the fallback reason.
    partition = [_box(0, 0, 10, 10), _box(10, 0, 20, 10)]
    planes = [(0.4, 0.0, 1.0), (-0.4, 0.0, 9.0)]
    pitches = [21.8, 21.8]
    outline = unary_union(partition)

    def forced_violation(regions, graph_pairs):
        return "phantom_adjacency_0_1"

    monkeypatch.setattr(
        svc, "_surgery_partition_violation", forced_violation
    )
    result, stats = svc._surgery_partition_boundaries(
        partition, planes, pitches, outline
    )
    assert result == partition
    assert "phantom_adjacency_0_1" in stats["fallback_reason"]
