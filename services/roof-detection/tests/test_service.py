import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import numpy as np
import pytest
from fastapi import HTTPException

from main import AnalyzeRequest, _distance_to_footprint_meters, _fit_facets, _polygon_area_sqft
from shapely.geometry import Polygon


def test_request_requires_address_or_complete_coordinates():
    with pytest.raises(ValueError):
        AnalyzeRequest()
    with pytest.raises(ValueError):
        AnalyzeRequest(lat=25.0)
    assert AnalyzeRequest(lat=25.0, lon=-80.0).lat == 25.0
    assert AnalyzeRequest(street_address="100 Main Street").street_address


def test_polygon_area_is_projected_to_square_feet():
    polygon = Polygon([(-80.0, 25.0), (-79.9999, 25.0), (-79.9999, 25.0001), (-80.0, 25.0001)])
    area = _polygon_area_sqft(polygon)
    assert area > 0
    assert np.isfinite(area)


def test_ransac_recovers_candidate_plane_pitch_and_area():
    x, y = np.meshgrid(np.linspace(0, 20, 25), np.linspace(0, 10, 15))
    z = 0.5 * x + 12.0
    points = np.column_stack((x.ravel(), y.ravel(), z.ravel()))
    facets = _fit_facets(points)
    assert facets
    assert facets[0]["pitch_rise_per_12"] == pytest.approx(6.0, abs=0.15)
    assert facets[0]["area_sqft"] > 0
    assert facets[0]["point_count"] >= 80
    assert 0 <= facets[0]["azimuth_degrees"] < 360

    
def test_ransac_skips_degenerate_collinear_facet_hulls():
    x = np.linspace(0, 20, 200)
    y = np.zeros_like(x)
    z = 0.5 * x + 12.0
    points = np.column_stack((x, y, z))
    assert _fit_facets(points) == []


def test_ransac_rejects_near_vertical_building_walls():
    x, y = np.meshgrid(np.linspace(0, 20, 25), np.linspace(0, 10, 15))
    z = 5.0 * x + 12.0
    points = np.column_stack((x.ravel(), y.ravel(), z.ravel()))
    assert _fit_facets(points) == []



def test_footprint_match_distance_uses_meters_and_accepts_roof_point():
    polygon = Polygon([
        (-80.0, 25.0),
        (-79.9999, 25.0),
        (-79.9999, 25.0001),
        (-80.0, 25.0001),
    ])
    assert _distance_to_footprint_meters(polygon, 25.00005, -79.99995) == pytest.approx(0, abs=0.01)


def test_footprint_match_distance_rejects_neighboring_building_scale_offset():
    polygon = Polygon([
        (-80.0, 25.0),
        (-79.9999, 25.0),
        (-79.9999, 25.0001),
        (-80.0, 25.0001),
    ])
    # Roughly 11 m north of the footprint, beyond the 5 m match tolerance.
    assert _distance_to_footprint_meters(polygon, 25.0002, -79.99995) > 5
