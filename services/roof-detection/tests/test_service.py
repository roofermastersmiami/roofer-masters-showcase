import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import numpy as np
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

import main as roof_service
from main import AnalyzeRequest, _deduplicate_lidar_points, _distance_to_footprint_meters, _fit_facets, _polygon_area_sqft, _project_polygon
from shapely.geometry import Point, Polygon, mapping


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
    assert facets[0]["fit_rmse_m"] == pytest.approx(0, abs=1e-6)
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
        return 25.00005, -79.99995, "Endpoint test address", {"source": "Test geocoder"}

    async def fake_get_footprint(_lat, _lon, _street_address=None, _selected_candidate_id=None):
        return polygon, {
            "osm_way_id": 123,
            "building_tags": {"building": "house"},
            "address_point_inside_footprint": False,
            "address_to_footprint_distance_m": 3.27,
        }

    monkeypatch.setattr(roof_service, "geocode_with_provenance", fake_geocode)
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
    assert payload["address_match"] == {"source": "Test geocoder"}



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

def test_ransac_separates_two_adjacent_roof_slopes_sharing_a_ridge():
    # Two roof planes meet at the same ridge line. This is the critical case
    # for eliminating manual pitch entry: the point cloud must produce two
    # distinct facets, not one averaged plane spanning both slopes.
    x_left, y_left = np.meshgrid(
        np.linspace(0.25, 9.75, 25), np.linspace(0.25, 19.75, 25)
    )
    x_right, y_right = np.meshgrid(
        np.linspace(10.25, 19.75, 25), np.linspace(0.25, 19.75, 25)
    )
    z_left = 10.0 + 0.5 * x_left
    z_right = 20.0 - 0.5 * x_right
    left = np.column_stack((x_left.ravel(), y_left.ravel(), z_left.ravel()))
    right = np.column_stack((x_right.ravel(), y_right.ravel(), z_right.ravel()))
    rng = np.random.default_rng(42)
    left[:, 2] += rng.normal(0, 0.025, len(left))
    right[:, 2] += rng.normal(0, 0.025, len(right))

    facets = _fit_facets(np.vstack((left, right)))

    assert len(facets) == 2
    pitches = sorted(facet["pitch_rise_per_12"] for facet in facets)
    assert pitches == pytest.approx([6.0, 6.0], abs=0.2)
    assert all(facet["point_count"] >= 500 for facet in facets)
    assert all(0 < facet["fit_rmse_m"] < 0.12 for facet in facets)
    # Each half is 9.5 m × 19.5 m in plan; at 6/12 pitch the
    # sloped surface is approximately 2,225 sq ft per facet.
    assert all(2100 < facet["area_sqft"] < 2350 for facet in facets)



def test_street_address_normalization_matches_directional_and_suffix_variants():
    from main import _normalize_street_address

    assert _normalize_street_address("3062 Southwest 189th Avenue, Miramar, FL 33029") == (
        _normalize_street_address("3062 SW 189th Ave")
    )


def test_street_address_normalization_does_not_match_different_house_numbers():
    from main import _normalize_street_address

    assert _normalize_street_address("3062 SW 189th Ave") != (
        _normalize_street_address("3064 SW 189th Ave")
    )



def test_analyze_endpoint_forwards_explicit_building_candidate_id(monkeypatch):
    polygon = Polygon([
        (-80.0, 25.0),
        (-79.9999, 25.0),
        (-79.9999, 25.0001),
        (-80.0, 25.0001),
    ])
    selected = {}

    async def fake_geocode(_address):
        return 25.00005, -79.99995, "Candidate selection test address", {"source": "Test geocoder"}

    async def fake_get_footprint(_lat, _lon, _street_address=None, _selected_candidate_id=None):
        selected["candidate_id"] = _selected_candidate_id
        return polygon, {
            "provider": "test",
            "source_id": "candidate-1",
            "address_point_inside_footprint": True,
            "address_to_footprint_distance_m": 0.0,
        }

    monkeypatch.setattr(roof_service, "geocode_with_provenance", fake_geocode)
    monkeypatch.setattr(roof_service, "get_footprint", fake_get_footprint)
    monkeypatch.setattr(
        roof_service,
        "_read_lidar_facets",
        lambda _polygon: ([], {"stac_items": 0, "tiles_used": 0, "building_class_points": 0}),
    )
    roof_service._RESPONSE_CACHE.clear()

    response = TestClient(roof_service.app).post(
        "/v1/roof/analyze",
        json={
            "street_address": "Candidate selection endpoint test address",
            "footprint_candidate_id": "candidate-id-123456",
        },
    )

    assert response.status_code == 200
    assert selected["candidate_id"] == "candidate-id-123456"



def test_broward_county_footprints_are_used_when_nationwide_provider_has_no_match(monkeypatch):
    import asyncio

    polygon = Polygon([
        (-80.39960, 25.98015),
        (-80.39940, 25.98015),
        (-80.39940, 25.98030),
        (-80.39960, 25.98030),
        (-80.39960, 25.98015),
    ])
    feature = {
        "type": "Feature",
        "properties": {"OBJECTID": 77, "AREA": 1000, "COUNTY_NAM": "Broward", "capture_dates_range": "2020"},
        "geometry": mapping(polygon),
    }

    class FakeResponse:
        def __init__(self, payload):
            self.payload = payload

        def raise_for_status(self):
            return None

        def json(self):
            return self.payload

    class FakeAsyncClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def get(self, url, params=None):
            if "USA_Buildings" in url:
                return FakeResponse({"features": []})
            if "Broward_BuildingFootPrints" in url:
                return FakeResponse({"features": [feature]})
            raise AssertionError(f"Unexpected provider URL: {url}")

        async def post(self, *args, **kwargs):
            return FakeResponse({"elements": []})

    monkeypatch.setattr(roof_service.httpx, "AsyncClient", FakeAsyncClient)
    footprint, metadata = asyncio.run(
        roof_service.get_footprint(25.98021, -80.39952, "3062 Southwest 189th Avenue")
    )

    assert footprint.area == pytest.approx(polygon.area)
    assert metadata["provider"] == "Broward County Building Footprints"
    assert metadata["source_id"] == 77


def test_broward_address_point_requires_one_exact_normalized_match(monkeypatch):
    import asyncio

    class FakeResponse:
        def raise_for_status(self):
            return None

        def json(self):
            return {"features": [{
                "attributes": {
                    "FULL_SITE_ADDRESS": "3062 SW 189TH AVE",
                    "FOLIO_NUMBER": "5141-02-00-0010",
                    "CITY_NAME": "MIRAMAR",
                    "ZIP_CODE": "33029",
                },
                "geometry": {"x": -80.3995, "y": 25.9804},
            }]}

    class FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def get(self, url, params=None):
            assert "ZoningApp/FeatureServer/0/query" in url
            assert "SITUS_HOUSE_NUMBER" in params["where"]
            return FakeResponse()

    monkeypatch.setattr(roof_service.httpx, "AsyncClient", FakeClient)
    match = asyncio.run(
        roof_service.resolve_broward_address_point(
            "3062 Southwest 189th Avenue, Miramar, FL 33029"
        )
    )
    assert match is not None
    lat, lon, address, provenance = match
    assert (lat, lon) == pytest.approx((25.9804, -80.3995))
    assert address == "3062 SW 189TH AVE"
    assert provenance["folio_number"] == "5141-02-00-0010"


def test_broward_address_point_rejects_multiple_exact_records(monkeypatch):
    import asyncio

    class FakeResponse:
        def raise_for_status(self):
            return None

        def json(self):
            feature = {
                "attributes": {"FULL_SITE_ADDRESS": "3062 SW 189TH AVE"},
                "geometry": {"x": -80.3995, "y": 25.9804},
            }
            return {"features": [feature, feature]}

    class FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def get(self, *args, **kwargs):
            return FakeResponse()

    monkeypatch.setattr(roof_service.httpx, "AsyncClient", FakeClient)
    assert asyncio.run(
        roof_service.resolve_broward_address_point(
            "3062 Southwest 189th Avenue, Miramar, FL 33029"
        )
    ) is None


def test_geocode_prefers_exact_broward_county_address_point(monkeypatch):
    import asyncio

    async def fake_county(_address):
        return (
            25.9804,
            -80.3995,
            "3062 SW 189TH AVE",
            {"source": "Broward County Address Points"},
        )

    async def forbidden_fallback(_address):
        raise AssertionError("General geocoder should not run after exact county match")

    monkeypatch.setattr(roof_service, "resolve_broward_address_point", fake_county)
    monkeypatch.setattr(roof_service, "_geocode_census", forbidden_fallback)
    monkeypatch.setattr(roof_service.httpx, "AsyncClient", lambda *args, **kwargs: (_ for _ in ()).throw(
        AssertionError("Nominatim should not run after exact county match")
    ))
    result = asyncio.run(roof_service.geocode("3062 Southwest 189th Avenue, Miramar, FL 33029"))
    assert result == (25.9804, -80.3995, "3062 SW 189TH AVE")


def test_vertical_unit_to_meters_reads_metric_vertical_crs():
    from pyproj import CRS
    from types import SimpleNamespace

    header = SimpleNamespace(parse_crs=lambda: CRS.from_epsg(5703))
    assert roof_service._vertical_unit_to_meters(header) == pytest.approx(1.0)


def test_vertical_unit_to_meters_converts_us_survey_feet():
    from pyproj import CRS
    from types import SimpleNamespace

    header = SimpleNamespace(parse_crs=lambda: CRS.from_epsg(6360))
    assert roof_service._vertical_unit_to_meters(header) == pytest.approx(0.30480060960121924)


def test_vertical_unit_to_meters_rejects_missing_or_ambiguous_crs():
    from types import SimpleNamespace

    assert roof_service._vertical_unit_to_meters(SimpleNamespace(parse_crs=lambda: None)) is None
    assert roof_service._vertical_unit_to_meters(SimpleNamespace()) is None


def test_vertical_unit_to_meters_rejects_non_up_axis():
    from types import SimpleNamespace

    axis = SimpleNamespace(direction="east", unit_conversion_factor=1.0)
    crs = SimpleNamespace(axis_info=[axis])
    header = SimpleNamespace(parse_crs=lambda: crs)
    assert roof_service._vertical_unit_to_meters(header) is None



def test_geocode_with_provenance_preserves_official_broward_folio_without_second_lookup(monkeypatch):
    import asyncio

    calls = {"county": 0}

    async def fake_county(_address):
        calls["county"] += 1
        return (
            25.9804,
            -80.3995,
            "3062 SW 189TH AVE",
            {
                "source": "Broward County Address Points",
                "folio_number": "5141-02-00-0010",
                "city": "MIRAMAR",
                "zip_code": "33029",
            },
        )

    monkeypatch.setattr(roof_service, "resolve_broward_address_point", fake_county)
    result = asyncio.run(
        roof_service.geocode_with_provenance(
            "3062 Southwest 189th Avenue, Miramar, FL 33029"
        )
    )
    assert result == (
        25.9804,
        -80.3995,
        "3062 SW 189TH AVE",
        {
            "source": "Broward County Address Points",
            "folio_number": "5141-02-00-0010",
            "city": "MIRAMAR",
            "zip_code": "33029",
        },
    )
    assert calls["county"] == 1


def test_geocode_with_provenance_labels_nominatim_fallback(monkeypatch):
    import asyncio

    class FakeResponse:
        def raise_for_status(self):
            return None

        def json(self):
            return [{"lat": "25.98", "lon": "-80.39", "display_name": "Matched address"}]

    class FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def get(self, *args, **kwargs):
            return FakeResponse()

    async def no_county_match(_address):
        return None

    monkeypatch.setattr(roof_service, "resolve_broward_address_point", no_county_match)
    monkeypatch.setattr(roof_service.httpx, "AsyncClient", FakeClient)
    assert asyncio.run(roof_service.geocode_with_provenance("100 Main Street")) == (
        25.98,
        -80.39,
        "Matched address",
        {"source": "OpenStreetMap Nominatim"},
    )


def test_geocode_with_provenance_labels_census_fallback(monkeypatch):
    import asyncio

    async def no_county_match(_address):
        return None

    async def census(_address):
        return 25.9, -80.3, "Census matched address"

    class FakeResponse:
        def raise_for_status(self):
            return None

        def json(self):
            return []

    class FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def get(self, *args, **kwargs):
            return FakeResponse()

    monkeypatch.setattr(roof_service, "resolve_broward_address_point", no_county_match)
    monkeypatch.setattr(roof_service, "_geocode_census", census)
    monkeypatch.setattr(roof_service.httpx, "AsyncClient", FakeClient)
    assert asyncio.run(roof_service.geocode_with_provenance("100 Main Street")) == (
        25.9,
        -80.3,
        "Census matched address",
        {"source": "US Census Geocoder"},
    )
