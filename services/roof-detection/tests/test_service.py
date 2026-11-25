import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import numpy as np
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

import main as roof_service
from main import AnalyzeRequest, _deduplicate_lidar_points, _distance_to_footprint_meters, _fit_facets, _polygon_area_sqft, _project_polygon
from shapely.geometry import Point, Polygon


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



def test_polygon_projection_preserves_interior_courtyard_rings():
    footprint = Polygon(
        [(0, 0), (0.001, 0), (0.001, 0.001), (0, 0.001)],
        [[(0.0004, 0.0004), (0.0006, 0.0004), (0.0006, 0.0006), (0.0004, 0.0006)]],
    )
    projected, _, _ = _project_polygon(footprint, 4326)
    assert len(projected.interiors) == 1
    assert projected.area == pytest.approx(footprint.area)


def test_local_polygon_transform_preserves_interior_courtyard_rings():
    from pyproj import Transformer
    from main import _transform_polygon

    footprint = Polygon(
        [(0, 0), (0.001, 0), (0.001, 0.001), (0, 0.001)],
        [[(0.0004, 0.0004), (0.0006, 0.0004), (0.0006, 0.0006), (0.0004, 0.0006)]],
    )
    transformed = _transform_polygon(
        footprint,
        Transformer.from_crs("EPSG:4326", "EPSG:3857", always_xy=True),
    )
    assert len(transformed.interiors) == 1
    assert transformed.area < Polygon(
        [Transformer.from_crs("EPSG:4326", "EPSG:3857", always_xy=True).transform(x, y)
         for x, y in footprint.exterior.coords]
    ).area


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





def test_analyze_endpoint_returns_address_footprint_match_evidence(monkeypatch):
    polygon = Polygon([
        (-80.0, 25.0),
        (-79.9999, 25.0),
        (-79.9999, 25.0001),
        (-80.0, 25.0001),
    ])

    async def fake_geocode(_address):
        return 25.00005, -79.99995, "Endpoint test address"

    async def fake_get_footprint(_lat, _lon):
        return polygon, {
            "osm_way_id": 123,
            "building_tags": {"building": "house"},
            "address_point_inside_footprint": False,
            "address_to_footprint_distance_m": 3.27,
        }

    monkeypatch.setattr(roof_service, "geocode", fake_geocode)
    monkeypatch.setattr(roof_service, "get_footprint", fake_get_footprint)
    monkeypatch.setattr(
        roof_service,
        "_read_lidar_facets",
        lambda _polygon: ([], {"stac_items": 0, "tiles_used": 0, "building_class_points": 0}),
    )

    response = TestClient(roof_service.app).post(
        "/v1/roof/analyze",
        json={"street_address": "Unique endpoint contract test address"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["footprint"]["address_point_inside_footprint"] is False
    assert payload["footprint"]["address_to_footprint_distance_m"] == 3.27
    assert payload["status"] == "footprint_only"



def test_footprint_match_fields_preserve_address_mismatch_evidence():
    from main import _footprint_match_fields

    fields = _footprint_match_fields({
        "address_point_inside_footprint": False,
        "address_to_footprint_distance_m": 3.27,
    })
    assert fields == {
        "address_point_inside_footprint": False,
        "address_to_footprint_distance_m": 3.27,
    }


def test_footprint_match_fields_omit_invalid_distance_values():
    from main import _footprint_match_fields

    fields = _footprint_match_fields({
        "address_point_inside_footprint": True,
        "address_to_footprint_distance_m": float("nan"),
    })
    assert fields == {"address_point_inside_footprint": True}


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



def test_overlapping_lidar_tiles_are_deduplicated_before_plane_fitting():
    points = np.array([
        [1.000, 2.000, 3.000],
        [1.004, 2.003, 3.002],
        [4.000, 5.000, 6.000],
    ])
    unique = _deduplicate_lidar_points(points, precision_m=0.02)
    assert len(unique) == 2
    assert any(np.allclose(row, points[0]) for row in unique)
    assert any(np.allclose(row, points[2]) for row in unique)


def test_lidar_deduplication_keeps_empty_input_shape():
    assert _deduplicate_lidar_points(np.empty((0, 3))).shape == (0, 3)



def test_ransac_splits_detached_coplanar_roof_surfaces_before_area_calculation():
    x1, y1 = np.meshgrid(np.linspace(0, 20, 25), np.linspace(0, 10, 15))
    x2, y2 = np.meshgrid(np.linspace(40, 60, 25), np.linspace(0, 10, 15))
    x = np.concatenate((x1.ravel(), x2.ravel()))
    y = np.concatenate((y1.ravel(), y2.ravel()))
    z = 0.5 * x + 12.0
    facets = _fit_facets(np.column_stack((x, y, z)))

    assert len(facets) == 2
    assert all(facet["point_count"] >= 80 for facet in facets)
    assert all(facet["area_sqft"] == pytest.approx(2405, rel=0.03) for facet in facets)
    assert sum(facet["area_sqft"] for facet in facets) < 5000



def test_ransac_clips_convex_facet_hulls_to_concave_building_footprints():
    # An L-shaped building has a large courtyard/cutout that a convex hull
    # would incorrectly fill when all roof points share one fitted plane.
    footprint = Polygon([
        (0, 0), (20, 0), (20, 5), (5, 5), (5, 20), (0, 20)
    ])
    points_xy = [
        (float(x), float(y))
        for x in np.arange(0.25, 20, 0.5)
        for y in np.arange(0.25, 20, 0.5)
        if footprint.covers(Point(float(x), float(y)))
    ]
    x = np.array([point[0] for point in points_xy])
    y = np.array([point[1] for point in points_xy])
    z = 0.5 * x + 12.0
    points = np.column_stack((x, y, z))

    unbounded = _fit_facets(points)
    bounded = _fit_facets(points, footprint)

    assert len(unbounded) == 1
    assert len(bounded) == 1
    assert bounded[0]["area_sqft"] < unbounded[0]["area_sqft"] * 0.8
    # A 0.75 m buffer preserves ordinary roof overhang around the footprint.
    assert bounded[0]["area_sqft"] > 1500
    assert bounded[0]["point_count"] == len(points)


def test_ransac_does_not_create_facets_from_small_spatial_noise_clusters():
    x, y = np.meshgrid(np.linspace(0, 20, 25), np.linspace(0, 10, 15))
    roof = np.column_stack((x.ravel(), y.ravel(), (0.5 * x + 12.0).ravel()))
    noise = np.array([[100.0, 100.0, 62.0], [100.2, 100.1, 62.1], [100.1, 100.2, 62.05]])
    facets = _fit_facets(np.vstack((roof, noise)))
    assert len(facets) == 1
    assert facets[0]["point_count"] == len(roof)
