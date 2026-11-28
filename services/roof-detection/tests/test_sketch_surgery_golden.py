"""Golden tests for the Phase 2 drawing surgery over the seven
validation houses. The fixtures are GEOMETRY-ONLY captures of the
exact local-frame inputs _drawing_partition receives in production
— fitted facet polygons and the footprint as lossless WKB (the
partition arithmetic is sensitive to sub-0.1mm perturbations, so
rounded coordinate rings cannot reproduce production behaviour),
plane models, provider, pitches — plus the per-facet fitted areas
and the production-reported totals. No addresses, no lat/lon: the
geometry lives in local metres around an omitted origin. The
fixtures are regenerable offline from the LiDAR tile cache by
running the service pipeline over the validation addresses, which
are kept outside the repo.

The hard gate: the reported roof area is PLANE-BASED (summed from
the fitted facets) and must stay within ±0.5% of the production
numbers below — the surgery changes the drawing's lines and the
graph-measured edge totals, never the reported area."""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest
from shapely import wkb
from shapely.ops import unary_union

from main import (
    _boundary_chains,
    _condition_polygons_for_emission,
    _divergent_seam_ft,
    _drawing_outline,
    _drawing_partition,
    _partition_facets_to_outline,
)

FIXTURES = Path(__file__).resolve().parent / "fixtures" / "sketch_surgery"

# Production-reported roof areas (sq ft) — the gate constants.
PRODUCTION_AREA_SQFT = {
    "annel": 2758.9,
    "miramar": 4882.8,
    "maria": 1801.0,
    "francisco": 2303.4,
    "ave148": 1836.4,
    "westpark": 1461.9,
    "sw139": 2616.7,
}

SLUGS = sorted(PRODUCTION_AREA_SQFT)


def _load(slug: str) -> dict:
    return json.loads((FIXTURES / f"{slug}.json").read_text())


@pytest.mark.parametrize("slug", SLUGS)
def test_reported_area_stays_plane_based(slug: str):
    fixture = _load(slug)
    fitted_area = sum(fixture["facet_area_sqft"])
    production = PRODUCTION_AREA_SQFT[slug]
    # The fixture's fitted facets ARE the production measurement:
    # their areas sum to the reported roof area.
    assert abs(fitted_area - production) <= 0.005 * production
    assert abs(fixture["reported_area_sqft"] - production) <= 0.005 * production


@pytest.mark.parametrize("slug", SLUGS)
def test_drawing_partition_matches_production_readiness(slug: str):
    fixture = _load(slug)
    capture = fixture["capture"]
    assert capture is not None, "fixture lacks the drawing-partition capture"
    fitted = [wkb.loads(h, hex=True) for h in capture["fitted_wkb"]]
    planes = [tuple(model) for model in capture["plane_models"]]
    footprint = wkb.loads(capture["footprint_wkb"], hex=True)
    totals: dict = {}
    result, fully = _drawing_partition(
        fitted,
        planes,
        footprint,
        capture["footprint_provider"],
        pitches=capture["pitches_arg"],
        totals_out=totals,
    )
    # drawing_ready in production is the readiness gate: the surgery
    # must not change which houses ship a partition (West Park ships
    # none — a fitter-confidence question, not a drawing one).
    assert fully == fixture["drawing_ready"]
    if not fully:
        assert totals == {}
        return
    expected = fixture["expected_after"]
    assert totals.keys() == expected["graph_totals"].keys()
    for key, want in expected["graph_totals"].items():
        assert totals[key] == pytest.approx(want, abs=2.5), (
            f"{slug} {key}: graph total {totals[key]} vs golden {want}"
        )
    # The emitted tiling is exact: no overlaps, union == outline.
    outline = _drawing_outline(footprint, fitted, capture["footprint_provider"])
    union = unary_union([p for p in result if not p.is_empty])
    assert abs(union.area - outline.area) <= 0.01 * outline.area
    for i in range(len(result)):
        for j in range(i + 1, len(result)):
            assert result[i].intersection(result[j]).area < 0.01
    # Divergent seam (doubled traces) does not regress past golden.
    divergent = _divergent_seam_ft(result, planes, outline)
    assert divergent <= expected["divergent_after_ft"] + 1.0
    # Coincidence-preserving conditioning keeps the tiling intact and
    # within the emission vertex cap.
    conditioned = _condition_polygons_for_emission(result, exact_tiling=True)
    assert len(conditioned) == len(result)
    for polygon in conditioned:
        assert not polygon.is_empty and polygon.is_valid
        assert len(polygon.exterior.coords) - 1 <= 96
    for i in range(len(conditioned)):
        for j in range(i + 1, len(conditioned)):
            assert conditioned[i].intersection(conditioned[j]).area < 0.01
    # Partition validity (Phase 3): the rebuilt rings must not invent
    # an adjacency the tiling's boundary graph does not have — the
    # phantom-edge failure (sw139) is coincident in both rings, so
    # only this adjacency comparison can catch it.
    tiling = _partition_facets_to_outline(fitted, outline)
    active = [i for i, p in enumerate(tiling) if not p.is_empty]
    graph = _boundary_chains([tiling[i] for i in active], outline)
    graph_pairs = {
        (active[a], active[b])
        for a, b in (
            tuple(sorted(chain["pair"]))
            for chain in graph["chains"]
            if len(chain["pair"]) == 2 and -1 not in chain["pair"]
        )
    }
    for i in range(len(result)):
        for j in range(i + 1, len(result)):
            if result[i].is_empty or result[j].is_empty:
                continue
            shared = result[i].boundary.intersection(
                result[j].boundary
            ).length
            if shared > 0.05:
                assert (i, j) in graph_pairs, (
                    f"{slug}: phantom adjacency {i}-{j} "
                    f"({shared:.2f} m shared edge)"
                )
