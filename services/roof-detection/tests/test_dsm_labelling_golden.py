"""Golden tests for the Phase 4 DSM-residual labelling path over
the seven validation houses. The fixtures are GEOMETRY-ONLY
captures of the exact local-frame inputs _drawing_partition
receives in production — fitted facet polygons and the footprint
as lossless WKB (the partition arithmetic is sensitive to
sub-0.1mm perturbations), plane models, provider, pitches, the
per-facet fitted areas, and the fit point pool the labelling
reads. No addresses, no lat/lon: the geometry lives in local
metres around an omitted origin. The fixtures are regenerable
offline from the LiDAR tile cache by running the service pipeline
over the validation addresses, which are kept outside the repo.

What is pinned, per house: whether the labelling upgrade is
accepted on top of the hull partition, the extended facet areas
and discovered-plane count when it is, and the drawing's graph
edge totals either way. West Park's hull partition never completes
(the production drawing_ready=False case), so its fixture pins
exactly that: no labelling engagement, no extension.
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import numpy as np
import pytest
from shapely import wkb

from main import _drawing_partition

FIXTURES = Path(__file__).resolve().parent / "fixtures" / "dsm_labelling"

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


def _replay(slug: str):
    fixture = _load(slug)
    capture = fixture["capture"]
    fitted = [wkb.loads(bytes.fromhex(h)) for h in capture["fitted_wkb"]]
    footprint = wkb.loads(bytes.fromhex(capture["footprint_wkb"]))
    totals: dict = {}
    extension: dict = {}
    _result, fully = _drawing_partition(
        fitted,
        [tuple(m) for m in capture["plane_models"]],
        footprint,
        capture["provider"],
        pitches=capture["pitch_degrees"],
        totals_out=totals,
        points=np.array(capture["points"], dtype=float),
        facet_areas_sqft=capture["facet_area_sqft"],
        extension_out=extension,
    )
    return fixture, fully, totals, extension


@pytest.mark.parametrize("slug", SLUGS)
def test_labelling_outcome_matches_capture(slug: str):
    fixture, fully, _totals, extension = _replay(slug)
    expected = fixture["expected_extension"]
    if not fixture["drawing_ready"]:
        # The readiness gate is the hull path's, untouched: an
        # incomplete hull partition never engages the labelling.
        assert fully is False
        assert extension == {}
        return
    assert fully is True
    if expected is None:
        # The upgrade was refused for this house at capture time
        # (e.g. the surgery's phantom-adjacency guard vetoed the
        # rebuilt tiling): the hull drawing must come back instead,
        # with no extension leaked into the response.
        assert extension == {}
        return
    assert extension != {}
    assert len(extension["areas_sqft"]) == len(expected["areas_sqft"])
    for got, want in zip(extension["areas_sqft"], expected["areas_sqft"]):
        assert got == pytest.approx(want, abs=1.0)
    assert len(extension["discovered"]) == expected["n_discovered"]


@pytest.mark.parametrize("slug", SLUGS)
def test_drawing_totals_match_capture(slug: str):
    fixture, fully, totals, _extension = _replay(slug)
    expected = fixture["expected_totals"]
    if not fixture["drawing_ready"]:
        assert totals == {}
        return
    assert fully is True
    assert set(totals) == set(expected)
    for key, want in expected.items():
        assert totals[key] == pytest.approx(want, abs=1.0)


@pytest.mark.parametrize("slug", SLUGS)
def test_reported_area_stays_within_gate(slug: str):
    fixture, _fully, _totals, extension = _replay(slug)
    # The reported area is the sum of the (possibly transfer-
    # adjusted) facet areas; the capture's reported area is the
    # pipeline's own sum. Both must sit within +-0.5% of the
    # production constant.
    assert fixture["reported_area_sqft"] == pytest.approx(
        PRODUCTION_AREA_SQFT[slug], rel=0.005
    )
    if extension:
        assert sum(extension["areas_sqft"]) == pytest.approx(
            fixture["reported_area_sqft"], abs=1.0
        )
