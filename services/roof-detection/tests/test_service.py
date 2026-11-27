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
        lambda _polygon, _provider=None: ([], {"stac_items": 0, "tiles_used": 0, "building_class_points": 0}),
    )

    async def fake_tnm(_polygon, _provider=None):
        return [], {"reason": "test stub"}

    monkeypatch.setattr(roof_service, "_read_lidar_facets_tnm", fake_tnm)

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


def test_analyze_endpoint_falls_back_to_tnm_when_copc_items_yield_no_facets(monkeypatch):
    # Regression: a COPC item can intersect the search bbox (stac_items >= 1)
    # yet produce zero usable roof points. The TNM fallback must still run —
    # it previously required stac_items == 0, which left Broward addresses
    # footprint-only even though TNM tiles cover them.
    polygon = Polygon([
        (-80.0, 25.0),
        (-79.9999, 25.0),
        (-79.9999, 25.0001),
        (-80.0, 25.0001),
    ])

    async def fake_geocode(_address):
        return 25.00005, -79.99995, "TNM fallback test address", {"source": "Test geocoder"}

    async def fake_get_footprint(_lat, _lon, _street_address=None, _selected_candidate_id=None):
        return polygon, {"provider": "Broward County Building Footprints"}

    monkeypatch.setattr(roof_service, "geocode_with_provenance", fake_geocode)
    monkeypatch.setattr(roof_service, "get_footprint", fake_get_footprint)
    monkeypatch.setattr(
        roof_service,
        "_read_lidar_facets",
        lambda _polygon, _provider=None: ([], {"stac_items": 1, "tiles_used": 0, "building_class_points": 0}),
    )

    async def fake_tnm(_polygon, _provider=None):
        return (
            [{"area_sqft": 1200.0, "pitch_rise_per_12": 6.0}],
            {"source": "USGS National Map (TNM) Lidar Point Cloud LAZ", "tiles_used": 1},
        )

    monkeypatch.setattr(roof_service, "_read_lidar_facets_tnm", fake_tnm)

    response = TestClient(roof_service.app).post(
        "/v1/roof/analyze",
        json={"street_address": "Unique TNM fallback regression address"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "lidar_facets"
    assert payload["roof"]["area_sqft"] == 1200.0
    assert payload["lidar"]["source"] == "USGS National Map (TNM) Lidar Point Cloud LAZ"



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



def test_ransac_overlapping_planes_do_not_double_count_shared_area():
    # Two distinct planes whose point regions overlap in plan view (the
    # classic double-detection: a second plane fitted underneath the first)
    # produce hulls that stack on the same ground area. Summing both hulls
    # would count the overlap twice; the largest-first hull subtraction must
    # keep the combined area at the single-plane size instead.
    rng = np.random.default_rng(7)
    x1, y1 = np.meshgrid(np.linspace(0, 20, 26), np.linspace(0, 10, 13))
    first = np.column_stack((x1.ravel(), y1.ravel(), (0.5 * x1 + 12.0).ravel()))
    first[:, 2] += rng.normal(0, 0.01, len(first))
    # Opposing slope crossing the first plane at its ridge; its points span
    # x in [5, 20], so 75% of its hull overlaps the first plane's hull.
    x2, y2 = np.meshgrid(np.linspace(5, 20, 16), np.linspace(0, 10, 13))
    second = np.column_stack((x2.ravel(), y2.ravel(), (-0.5 * x2 + 22.0).ravel()))
    second[:, 2] += rng.normal(0, 0.01, len(second))

    single = _fit_facets(first)
    combined = _fit_facets(np.vstack((first, second)))

    assert single
    single_area = sum(facet["area_sqft"] for facet in single)
    combined_area = sum(facet["area_sqft"] for facet in combined)
    # The overlapping detection must not inflate the total beyond the
    # single-plane measurement (small tolerance for hull edge effects).
    assert combined_area <= single_area * 1.10
    # And the resolution must not throw the roof away either.
    assert combined_area >= single_area * 0.80


def test_ransac_tight_threshold_recovers_true_planes_from_noisy_two_face_data():
    # Heavily noised two-face gable (sigma 0.12 m — dirty LiDAR). At the old
    # 0.20 m RANSAC tolerance the refit gathers a band of the opposing face
    # along the ridge and reports compromise facets with RMSE ~0.09 m; the
    # tight 0.10 m threshold keeps each fit on its own face, so the facets
    # come back at the true 6/12 with fit RMSE that honestly reflects the
    # noise on one plane.
    rng = np.random.default_rng(11)
    x_left, y_left = np.meshgrid(
        np.linspace(0.25, 9.75, 28), np.linspace(0.25, 19.75, 40)
    )
    x_right, y_right = np.meshgrid(
        np.linspace(10.25, 19.75, 28), np.linspace(0.25, 19.75, 40)
    )
    left = np.column_stack((x_left.ravel(), y_left.ravel(), (10.0 + 0.5 * x_left).ravel()))
    right = np.column_stack((x_right.ravel(), y_right.ravel(), (20.0 - 0.5 * x_right).ravel()))
    points = np.vstack((left, right))
    points[:, 2] += rng.normal(0, 0.12, len(points))

    facets = _fit_facets(points)

    assert len(facets) == 2
    for facet in facets:
        assert facet["pitch_rise_per_12"] == pytest.approx(6.0, abs=0.25)
        assert facet["fit_rmse_m"] < 0.07
        assert facet["point_count"] >= 500


def test_coverage_completion_tessellates_evidenced_gap_between_facets():
    # Gable whose face samples stop 1 m short of the ridge; a sparse row of
    # mixed returns sits in the band at the two planes' average height
    # (what a LiDAR pulse straddling the ridge reports). Too sparse to fit
    # and claimed by neither face, but the returns near the intersection
    # line fit each plane within tolerance, so they evidence the seam. The
    # hulls alone leave the band unmeasured; coverage completion must
    # split it between the two facets along their intersection line
    # (x = 10), with no overlap and no growth into the evidence-free
    # margin beyond the footprint.
    rng = np.random.default_rng(23)
    footprint = Polygon([(0, 0), (20, 0), (20, 20), (0, 20)])
    x_left, y_left = np.meshgrid(
        np.arange(0.25, 9.0, 0.5), np.arange(0.25, 19.75, 0.5)
    )
    x_right, y_right = np.meshgrid(
        np.arange(11.0, 19.75, 0.5), np.arange(0.25, 19.75, 0.5)
    )
    left = np.column_stack((x_left.ravel(), y_left.ravel(), (10.0 + 0.5 * x_left).ravel()))
    right = np.column_stack((x_right.ravel(), y_right.ravel(), (20.0 - 0.5 * x_right).ravel()))
    left[:, 2] += rng.normal(0, 0.02, len(left))
    right[:, 2] += rng.normal(0, 0.02, len(right))
    x_band, y_band = np.meshgrid(
        np.arange(9.25, 10.75, 0.5), np.arange(1.0, 19.0, 2.0)
    )
    band = np.column_stack((x_band.ravel(), y_band.ravel(), np.full(len(x_band.ravel()), 15.0)))
    band[:, 2] += rng.normal(0, 0.05, len(band))

    facets = _fit_facets(np.vstack((left, right, band)), footprint)

    assert len(facets) == 2
    polygons = [Polygon(facet["boundary_xy"]) for facet in facets]
    # No double-counting: the tessellated facets are disjoint apart from
    # the 2 cm merge bridge along the shared seam (< 0.1 sq ft here),
    # which is not double-counted roof area in any meaningful sense.
    assert polygons[0].intersection(polygons[1]).area == pytest.approx(0, abs=0.01)
    plan_sqft = sum(
        facet["area_sqft"] * np.cos(np.radians(facet["pitch_degrees"]))
        for facet in facets
    )
    clip_plan_sqft = footprint.buffer(0.75).area * 10.7639104167
    # The evidenced band is filled (hulls alone cover ~3,480 plan sq ft),
    # while the total stays bounded by the clipped footprint region.
    assert plan_sqft > 3800
    assert plan_sqft <= clip_plan_sqft
    # The band is split along the planes' intersection line: points just
    # left and right of the ridge belong to different facets.
    left_owner = [i for i, polygon in enumerate(polygons) if polygon.covers(Point(9.5, 10.0))]
    right_owner = [i for i, polygon in enumerate(polygons) if polygon.covers(Point(10.5, 10.0))]
    assert len(left_owner) == 1
    assert len(right_owner) == 1
    assert left_owner != right_owner


def _fragment_candidate(x_range, slope, intercept, y_range=(0.0, 10.0), step=0.5):
    """Build one plane candidate the way the RANSAC loop in _fit_facets
    does: a fitted LinearRegression, its inlier grid points, and the convex
    hull of those points."""
    from sklearn.linear_model import LinearRegression
    from shapely.geometry import MultiPoint

    x, y = np.meshgrid(
        np.arange(x_range[0], x_range[1] + 1e-9, step),
        np.arange(y_range[0], y_range[1] + 1e-9, step),
    )
    points = np.column_stack((x.ravel(), y.ravel(), (slope * x + intercept).ravel()))
    model = LinearRegression().fit(points[:, :2], points[:, 2])
    a, b = (float(model.coef_[0]), float(model.coef_[1]))
    fitted_slope = float(np.hypot(a, b))
    return {
        "polygon": MultiPoint(points[:, :2]).convex_hull,
        "cluster": points,
        "point_count": len(points),
        "model": model,
        "a": a,
        "b": b,
        "pitch": float(np.degrees(np.arctan(fitted_slope))),
        "pitch_rise": fitted_slope * 12.0,
        "azimuth": (float(np.degrees(np.arctan2(-a, -b))) + 360.0) % 360.0,
    }


def test_merge_fragmented_candidates_reunites_split_face():
    # One true 6/12 face (z = 0.5x + 12 over x in [0, 20]) detected as two
    # near-parallel fragments: a later RANSAC pass fit the eastern piece
    # with a slightly different slope and intercept. The fragments cross
    # inside their overlap (x in [7, 13]) and their hulls overlap, so they
    # must merge into ONE candidate spanning the whole face — fed into hull
    # resolution separately, the smaller fragment's unique territory is
    # dropped as a "duplicate" and the face loses that area.
    from main import _merge_fragmented_candidates

    west = _fragment_candidate((0.0, 13.0), 0.50, 12.0)
    east = _fragment_candidate((7.0, 20.0), 0.47, 12.30)

    merged = _merge_fragmented_candidates([west, east], None)

    assert len(merged) == 1
    xs = merged[0]["cluster"][:, 0]
    assert xs.min() == pytest.approx(0.0)
    assert xs.max() == pytest.approx(20.0)
    assert merged[0]["point_count"] == merged[0]["cluster"].shape[0]
    # The refit over the pooled points stays close to the true 6/12 plane.
    assert merged[0]["pitch_rise"] == pytest.approx(6.0, abs=0.35)


def test_merge_fragmented_candidates_keeps_distinct_faces_apart():
    from main import _merge_fragmented_candidates

    # Opposing slopes of a gable: normals far apart, never one face.
    left = _fragment_candidate((0.0, 13.0), 0.50, 12.0)
    right = _fragment_candidate((7.0, 20.0), -0.50, 22.0)
    assert len(_merge_fragmented_candidates([left, right], None)) == 2

    # Parallel planes half a metre apart (a stepped lower roof section
    # under the main slope): same normal, but the planes do not coincide
    # where the hulls overlap, so they stay separate.
    main_slope = _fragment_candidate((0.0, 13.0), 0.50, 12.0)
    lower_step = _fragment_candidate((7.0, 20.0), 0.50, 12.50)
    assert len(_merge_fragmented_candidates([main_slope, lower_step], None)) == 2


def test_overhang_ring_points_extend_eave_facet_only_when_on_plane(monkeypatch):
    # One sloped face whose eave side is the footprint's east edge. The
    # fitting pool stops at the footprint + 0.75 m clip, but the true
    # roof continues past it (a wide overhang) and its returns arrive
    # only as ring points. On-plane ring points must extend the facet
    # past the clip; off-plane ring points (a taller neighbouring
    # surface crossing the plane's extension) must not move it at all.
    # The test pins the ring width explicitly (see OVERHANG_RING_M) and
    # passes no footprint provider, which is a wall-outline default:
    # growth may fire (see the provider-gating test below).
    import main as service

    monkeypatch.setattr(service, "OVERHANG_RING_M", 1.5)
    rng = np.random.default_rng(31)
    footprint = Polygon([(0, 0), (20, 0), (20, 10), (0, 10)])
    x, y = np.meshgrid(np.arange(0.25, 20.5, 0.5), np.arange(0.25, 9.75, 0.5))
    face = np.column_stack((x.ravel(), y.ravel(), (20.0 - 0.5 * x).ravel()))
    face[:, 2] += rng.normal(0, 0.02, len(face))

    control = _fit_facets(face, footprint)
    assert len(control) == 1
    control_area = control[0]["area_sqft"]
    control_max_x = max(point[0] for point in control[0]["boundary_xy"])
    # Without ring evidence the facet stops at its outermost returns,
    # short of the 20.75 m clip.
    assert control_max_x < 20.75

    x_ring, y_ring = np.meshgrid(
        np.arange(21.0, 21.5, 0.25), np.arange(0.5, 9.75, 0.5)
    )
    on_plane = np.column_stack(
        (x_ring.ravel(), y_ring.ravel(), (20.0 - 0.5 * x_ring).ravel())
    )
    on_plane[:, 2] += rng.normal(0, 0.02, len(on_plane))
    grown = _fit_facets(face, footprint, ring_points=on_plane)
    assert len(grown) == 1
    grown_max_x = max(point[0] for point in grown[0]["boundary_xy"])
    assert grown_max_x > control_max_x + 0.3
    assert grown[0]["area_sqft"] > control_area + 40.0

    off_plane = on_plane.copy()
    off_plane[:, 2] += 2.0
    blocked = _fit_facets(face, footprint, ring_points=off_plane)
    assert len(blocked) == 1
    assert blocked[0]["area_sqft"] == pytest.approx(control_area, rel=0.02)


def test_competing_planes_both_survive_with_split_boundary():
    # Two genuinely different planes facing the same way over one roof
    # section (the Miramar SE pattern): a broad 4.3/12 detection spanning
    # the whole section and a steeper 5.6/12 surface occupying its
    # eastern part. Sequential RANSAC fits the broad plane first and
    # consumes the band where the two planes agree, so the steep
    # candidate's hull ends up entirely inside the winner's — plain
    # largest-first resolution drops it as a duplicate and loses a real
    # roof plane. The steep plane's own points, which the broad plane
    # misses by decimetres away from the intersection line, must rescue
    # it: both facets survive, split where the planes cross.
    rng = np.random.default_rng(41)
    x_w, y_w = np.meshgrid(np.arange(0.0, 20.25, 0.5), np.arange(0.0, 10.25, 0.5))
    broad = np.column_stack((x_w.ravel(), y_w.ravel(), (0.36 * x_w + 12.0).ravel()))
    x_c, y_c = np.meshgrid(np.arange(12.0, 20.25, 0.5), np.arange(0.0, 10.25, 0.5))
    steep = np.column_stack((x_c.ravel(), y_c.ravel(), (0.47 * x_c + 10.6).ravel()))
    points = np.vstack((broad, steep))
    points[:, 2] += rng.normal(0, 0.02, len(points))

    facets = _fit_facets(points)

    assert len(facets) == 2
    by_pitch = sorted(facets, key=lambda facet: facet["pitch_rise_per_12"])
    assert by_pitch[0]["pitch_rise_per_12"] == pytest.approx(4.32, abs=0.3)
    assert by_pitch[1]["pitch_rise_per_12"] == pytest.approx(5.64, abs=0.3)
    steep_polygon = Polygon(by_pitch[1]["boundary_xy"])
    broad_polygon = Polygon(by_pitch[0]["boundary_xy"])
    # The steep facet keeps the eastern ground its points occupy (its
    # hull starts where the broad fit stopped consuming its returns,
    # east of the planes' crossing at x ≈ 12.7); the broad facet keeps
    # the west and does not double-count the east.
    steep_min_x = min(point[0] for point in by_pitch[1]["boundary_xy"])
    assert steep_min_x >= 13.0
    assert steep_polygon.covers(Point(18.0, 5.0))
    assert broad_polygon.covers(Point(4.0, 5.0))
    assert not steep_polygon.covers(Point(4.0, 5.0))
    assert steep_polygon.intersection(broad_polygon).area == pytest.approx(0, abs=0.01)


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
        lambda _polygon, _provider=None: ([], {"stac_items": 0, "tiles_used": 0, "building_class_points": 0}),
    )

    async def fake_tnm(_polygon, _provider=None):
        return [], {"reason": "test stub"}

    monkeypatch.setattr(roof_service, "_read_lidar_facets_tnm", fake_tnm)
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
            if "BuildingFootprint2D_gdb" in url:
                return FakeResponse({"features": []})
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


def test_miami_dade_county_footprints_are_used_when_other_providers_have_no_match(monkeypatch):
    import asyncio

    polygon = Polygon([
        (-80.34440, 25.74690),
        (-80.34410, 25.74690),
        (-80.34410, 25.74720),
        (-80.34440, 25.74720),
        (-80.34440, 25.74690),
    ])
    feature = {
        "type": "Feature",
        "properties": {"OBJECTID": 91246, "UNIQUEID": "D5_Small_Building_707", "SOURCE": "L", "YEARUPDATE": 2018},
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
                return FakeResponse({"features": []})
            if "BuildingFootprint2D_gdb" in url:
                return FakeResponse({"features": [feature]})
            raise AssertionError(f"Unexpected provider URL: {url}")

        async def post(self, *args, **kwargs):
            return FakeResponse({"elements": []})

    monkeypatch.setattr(roof_service.httpx, "AsyncClient", FakeAsyncClient)
    footprint, metadata = asyncio.run(
        roof_service.get_footprint(25.74705, -80.34425, "9211 Southwest 24th Terrace")
    )

    assert footprint.area == pytest.approx(polygon.area)
    assert metadata["provider"] == "Miami-Dade County Building Footprints"
    assert metadata["source_id"] == 91246


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


def test_resolve_miramar_parcel_returns_unique_polygon_and_folio(monkeypatch):
    import asyncio

    polygon = Polygon([(-80.4, 25.9), (-80.3, 25.9), (-80.3, 26.0), (-80.4, 26.0)])
    class Response:
        def raise_for_status(self): pass
        def json(self):
            return {"features": [{"geometry": mapping(polygon),
                "properties": {"OBJECTID": 42, "FOLIO": "514102000010"}}]}
    class Client:
        def __init__(self, *args, **kwargs): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *args): pass
        async def get(self, url, params=None):
            assert "MiramarParcels/FeatureServer/20/query" in url
            assert params["geometryType"] == "esriGeometryPoint"
            assert params["inSR"] == "4326"
            assert params["spatialRel"] == "esriSpatialRelIntersects"
            return Response()
    monkeypatch.setattr(roof_service.httpx, "AsyncClient", Client)
    found, evidence = asyncio.run(roof_service.resolve_miramar_parcel(25.95, -80.35))
    assert found.equals(polygon)
    assert evidence == {"status": "matched", "provider": "City of Miramar GIS",
                        "object_id": 42, "folio": "514102000010"}


@pytest.mark.parametrize(("features", "status", "count"), [
    ([], "not_found", 0),
    ([1, 2], "ambiguous", 2),
])
def test_resolve_miramar_parcel_fails_closed_without_unique_match(monkeypatch, features, status, count):
    import asyncio
    polygon = Polygon([(-80.4, 25.9), (-80.3, 25.9), (-80.3, 26.0), (-80.4, 26.0)])
    class Response:
        def raise_for_status(self): pass
        def json(self):
            rows = [{"geometry": mapping(polygon), "properties": {"OBJECTID": n, "FOLIO": str(n)}}
                    for n in features]
            return {"features": rows}
    class Client:
        def __init__(self, *args, **kwargs): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *args): pass
        async def get(self, *args, **kwargs): return Response()
    monkeypatch.setattr(roof_service.httpx, "AsyncClient", Client)
    found, evidence = asyncio.run(roof_service.resolve_miramar_parcel(25.95, -80.35))
    assert found is None
    assert evidence["status"] == status
    assert evidence["match_count"] == count


def test_resolve_miramar_parcel_reports_provider_failure(monkeypatch):
    import asyncio
    class Client:
        def __init__(self, *args, **kwargs): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *args): pass
        async def get(self, *args, **kwargs): raise roof_service.httpx.ConnectError("offline")
    monkeypatch.setattr(roof_service.httpx, "AsyncClient", Client)
    found, evidence = asyncio.run(roof_service.resolve_miramar_parcel(25.95, -80.35))
    assert found is None
    assert evidence == {"status": "provider_error", "provider": "City of Miramar GIS"}


def _edge_facet(x0, x1, a, b, c, pitch_degrees=26.57):
    return {
        "boundary_xy": [[x0, 0.0], [x1, 0.0], [x1, 10.0], [x0, 10.0], [x0, 0.0]],
        "plane_model": {"z_equals_ax_plus_by_plus_c": [a, b, c]},
        "pitch_degrees": pitch_degrees,
    }


def test_edge_lengths_classify_gable_ridge_eaves_and_rakes():
    from main import _compute_edge_lengths

    facets = [
        _edge_facet(0.0, 10.0, 0.5, 0.0, 5.0),
        _edge_facet(10.0, 20.0, -0.5, 0.0, 15.0),
    ]
    edges = _compute_edge_lengths(facets)

    assert edges is not None
    assert edges["ridge"] == pytest.approx(32.8, rel=0.05)
    assert edges["valley"] == 0.0
    assert edges["hip"] == 0.0
    assert edges["eave"] == pytest.approx(65.6, rel=0.05)
    assert edges["rake"] > 120.0


def test_edge_lengths_classify_valley_between_opposing_slopes():
    from main import _compute_edge_lengths

    facets = [
        _edge_facet(0.0, 10.0, -0.5, 0.0, 10.0),
        _edge_facet(10.0, 20.0, 0.5, 0.0, 0.0),
    ]
    edges = _compute_edge_lengths(facets)

    assert edges is not None
    assert edges["valley"] == pytest.approx(32.8, rel=0.05)
    assert edges["ridge"] == 0.0
    assert edges["hip"] == 0.0


def test_edge_lengths_classify_sloped_peak_as_hip_not_ridge():
    from main import _compute_edge_lengths

    facets = [
        _edge_facet(0.0, 10.0, 0.5, 0.3, 5.0),
        _edge_facet(10.0, 20.0, -0.5, 0.3, 15.0),
    ]
    edges = _compute_edge_lengths(facets)

    assert edges is not None
    assert edges["hip"] == pytest.approx(34.3, rel=0.05)
    assert edges["ridge"] == 0.0
    assert edges["valley"] == 0.0


def test_download_tile_retries_after_rate_limit(tmp_path, monkeypatch):
    """USGS answers 429 under load; the download must back off and retry."""
    import asyncio as asyncio_module

    import httpx

    import main as service

    class FakeResponse:
        def __init__(self, status, chunks):
            self.status_code = status
            self._chunks = chunks

        def raise_for_status(self):
            if self.status_code >= 400:
                request = httpx.Request("GET", "https://example.test/tile.laz")
                raise httpx.HTTPStatusError(
                    "rate limited", request=request, response=httpx.Response(self.status_code, request=request)
                )

        async def aiter_bytes(self, _chunk_size):
            for chunk in self._chunks:
                yield chunk

    class FakeStream:
        def __init__(self, response):
            self._response = response

        async def __aenter__(self):
            return self._response

        async def __aexit__(self, *_exc):
            return False

    attempts: list[str] = []

    class FakeClient:
        def __init__(self, *_args, **_kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_exc):
            return False

        def stream(self, _method, url):
            attempts.append(url)
            if len(attempts) == 1:
                return FakeStream(FakeResponse(429, []))
            return FakeStream(FakeResponse(200, [b"LASF" + b"\x00" * 64]))

    async def no_sleep(_seconds):
        return None

    monkeypatch.setattr(service.httpx, "AsyncClient", FakeClient)
    monkeypatch.setattr(asyncio_module, "sleep", no_sleep)

    dest = tmp_path / "tile.laz"
    asyncio_module.run(service._download_tile("https://example.test/tile.laz", dest))
    assert attempts == ["https://example.test/tile.laz"] * 2
    assert dest.read_bytes().startswith(b"LASF")


def test_select_building_points_prefers_asprs_class_6():
    import numpy as np

    from main import _select_building_points

    building = np.column_stack(
        (np.zeros(120), np.zeros(120), np.full(120, 4.0))
    )
    elevated = np.column_stack(
        (np.ones(400), np.ones(400), np.full(400, 5.0))
    )
    coords = np.vstack((building, elevated))
    classes = np.concatenate((np.full(120, 6), np.full(400, 1)))
    selected, source = _select_building_points(coords, classes, 0.5)
    assert source == "asprs_class_6"
    assert len(selected) == 120


def test_select_building_points_falls_back_to_elevated_non_ground():
    import numpy as np

    from main import _select_building_points

    roof = np.column_stack((np.zeros(300), np.zeros(300), np.full(300, 4.2)))
    ground_level = np.column_stack(
        (np.ones(50), np.ones(50), np.full(50, 0.6))
    )
    coords = np.vstack((roof, ground_level))
    classes = np.concatenate((np.full(300, 1), np.full(50, 1)))
    selected, source = _select_building_points(coords, classes, 0.5)
    assert source == "elevated_non_ground"
    assert len(selected) == 300


def test_select_building_points_rejects_low_and_ground_points():
    import numpy as np

    from main import _select_building_points

    low = np.column_stack((np.zeros(300), np.zeros(300), np.full(300, 1.2)))
    selected, source = _select_building_points(low, np.full(300, 1), 0.5)
    assert source is None
    assert len(selected) == 0
    ground = np.column_stack((np.zeros(300), np.zeros(300), np.full(300, 9.0)))
    selected, source = _select_building_points(ground, np.full(300, 2), 0.5)
    assert source is None
    assert len(selected) == 0


def test_outline_completion_tiles_l_shaped_footprint():
    from main import _complete_outline
    from shapely.ops import unary_union

    # L-shaped plan: a 20x20 square missing its north-east quadrant.
    # The inner corner is (10, 10); the notch void is x > 10, y > 10.
    footprint = Polygon([(0, 0), (20, 0), (20, 10), (10, 10), (10, 20), (0, 20)])
    # One facet whose hull stopped at the south arm: the north arm and
    # the notch corner are still bare.
    record = {
        "polygon": Polygon([(0, 0), (20, 0), (20, 10), (0, 10)]),
        "point_count": 500,
        "a": 0.0, "b": -0.3, "c": 12.0, "pitch": 16.7,
    }
    records = [record]
    assert not record["polygon"].covers(Point(5, 15))

    _complete_outline(records, footprint)

    merged = unary_union([r["polygon"] for r in records])
    # The facet now tiles the whole L: the north arm is claimed and the
    # notch corner sits on its boundary, while the notch void stays
    # empty — the outer edge followed the traced outline instead of
    # bulging across the notch the way a hull perimeter would.
    assert merged.area == pytest.approx(footprint.area, rel=0.001)
    assert merged.covers(Point(5, 15))
    assert merged.boundary.distance(Point(10, 10)) < 0.05
    assert not merged.covers(Point(15, 15))


def test_snap_shared_boundaries_registers_ridge():
    from main import _shared_edge_span, _snap_shared_boundaries

    # Two opposing slopes whose planes meet at x = 10 (both give
    # z = 10 there), but whose polygons stop 0.3 m apart: two
    # almost-touching perimeters instead of one shared edge.
    def record(x0, x1, a, c):
        return {
            "polygon": Polygon([(x0, 0), (x1, 0), (x1, 10), (x0, 10)]),
            "point_count": 100,
            "a": a, "b": 0.0, "c": c, "pitch": 26.57,
        }

    records = [record(0.0, 9.85, 0.5, 5.0), record(10.15, 20.0, -0.5, 15.0)]
    gap_midpoint = Point(10.0, 5.0)
    assert not any(r["polygon"].covers(gap_midpoint) for r in records)

    _snap_shared_boundaries(records)

    first, second = records
    # The boundaries now coincide along the seam: no gap, no overlap,
    # and the pair's shared edge registers as the ridge it is.
    assert first["polygon"].boundary.distance(second["polygon"].boundary) == pytest.approx(0.0, abs=0.01)
    assert first["polygon"].intersection(second["polygon"]).area == pytest.approx(0.0, abs=0.01)
    assert first["polygon"].covers(gap_midpoint) or second["polygon"].covers(gap_midpoint)
    span = _shared_edge_span(
        first["polygon"], first["a"], first["b"], first["c"], first["pitch"],
        second["polygon"], second["a"], second["b"], second["c"], second["pitch"],
    )
    assert span is not None
    length_m, classification, _seam = span
    assert classification == "ridge"
    assert length_m == pytest.approx(10.0, rel=0.05)


def test_ring_growth_gated_by_footprint_provider():
    # The same face and ring evidence as the ring test above, through
    # the two provenance classes. A Miami-Dade footprint traces the
    # ROOF outline — the overhang is already inside the polygon — so
    # ring growth must never fire and the facet is clipped to the
    # traced outline. A Broward footprint traces the WALL line, so the
    # ring beyond it is real roof and the facet grows on the evidence.
    rng = np.random.default_rng(31)
    footprint = Polygon([(0, 0), (20, 0), (20, 10), (0, 10)])
    x, y = np.meshgrid(np.arange(0.25, 20.5, 0.5), np.arange(0.25, 9.75, 0.5))
    face = np.column_stack((x.ravel(), y.ravel(), (20.0 - 0.5 * x).ravel()))
    face[:, 2] += rng.normal(0, 0.02, len(face))
    x_ring, y_ring = np.meshgrid(
        np.arange(21.0, 21.5, 0.25), np.arange(0.5, 9.75, 0.5)
    )
    on_plane = np.column_stack(
        (x_ring.ravel(), y_ring.ravel(), (20.0 - 0.5 * x_ring).ravel())
    )
    on_plane[:, 2] += rng.normal(0, 0.02, len(on_plane))

    miami = _fit_facets(
        face, footprint, ring_points=on_plane,
        footprint_provider="Miami-Dade County Building Footprints",
    )
    broward = _fit_facets(
        face, footprint, ring_points=on_plane,
        footprint_provider="Broward County Building Footprints",
    )

    assert len(miami) == 1 and len(broward) == 1
    miami_max_x = max(point[0] for point in miami[0]["boundary_xy"])
    broward_max_x = max(point[0] for point in broward[0]["boundary_xy"])
    # Roof outline: nothing past the traced east edge at x = 20.
    assert miami_max_x <= 20.0 + 0.01
    # Wall outline: the facet grows past the wall on ring evidence.
    assert broward_max_x > miami_max_x + 0.3
    assert broward[0]["area_sqft"] > miami[0]["area_sqft"] + 40.0


def test_ring_growth_refuses_to_cross_valley():
    from main import _grow_into_overhang_ring, _valley_seams
    from shapely.ops import unary_union

    # A valley pair: two slopes descending to their shared seam at
    # x = 10 (the geometry of the valley edge test). The valley runs
    # out of the footprint's south edge, and ring points evidence both
    # planes across the whole south strip.
    def record(x0, x1, a, c):
        return {
            "polygon": Polygon([(x0, 0), (x1, 0), (x1, 10), (x0, 10)]),
            "point_count": 100,
            "a": a, "b": 0.0, "c": c, "pitch": 26.57,
        }

    footprint = Polygon([(0, 0), (20, 0), (20, 10), (0, 10)])
    xs = np.arange(0.5, 20.0, 0.5)
    ys = np.array([-0.3, -0.6, -0.9, -1.2])
    gx, gy = np.meshgrid(xs, ys)
    gz = np.where(gx < 10.0, 10.0 - 0.5 * gx, 0.5 * gx)
    ring_points = np.column_stack((gx.ravel(), gy.ravel(), gz.ravel()))

    def grown_union(protected_zones):
        records = [record(0.0, 10.0, -0.5, 10.0), record(10.0, 20.0, 0.5, 0.0)]
        _grow_into_overhang_ring(
            records, footprint, ring_points, protected_zones=protected_zones
        )
        return unary_union([r["polygon"] for r in records])

    corridor_point = Point(9.7, -0.5)  # in the valley corridor, on facet A's side
    eave_point = Point(5.0, -1.0)  # ordinary overhang south of facet A

    unprotected = grown_union(None)
    # Without protection the growth reaches the corridor point: the
    # valley's mouth would be paved over.
    assert unprotected.covers(corridor_point)
    assert unprotected.covers(eave_point)

    records = [record(0.0, 10.0, -0.5, 10.0), record(10.0, 20.0, 0.5, 0.0)]
    zones = _valley_seams(records)
    assert zones  # the pair's seam is a valley and earns its corridor
    protected = grown_union(zones)
    # With the corridor, growth still takes the ordinary overhang but
    # refuses the strip the valley runs out through.
    assert not protected.covers(corridor_point)
    assert protected.covers(eave_point)


def test_frozen_pair_classes_override_live_classification():
    from main import _compute_edge_lengths

    # The gable pair from the ridge test: live classification is ridge.
    facets = [
        _edge_facet(0.0, 10.0, 0.5, 0.0, 5.0),
        _edge_facet(10.0, 20.0, -0.5, 0.0, 15.0),
    ]
    live = _compute_edge_lengths(facets)
    assert live is not None and live["ridge"] > 0.0

    # A classification frozen when the facet structure was established
    # wins over the live verdict for that pair, at the pair's live
    # length (see _classify_record_pairs).
    frozen = _compute_edge_lengths(facets, frozen_pair_classes={(0, 1): "valley"})
    assert frozen is not None
    assert frozen["ridge"] == 0.0
    assert frozen["valley"] == pytest.approx(live["ridge"], rel=0.02)


def test_fit_facets_reports_frozen_pair_classes():
    # The competing-planes roof (two facets, one shared seam): the
    # frozen map must carry the pair so the edge totals can use the
    # verdict from when the structure was established.
    rng = np.random.default_rng(41)
    x_w, y_w = np.meshgrid(np.arange(0.0, 20.25, 0.5), np.arange(0.0, 10.25, 0.5))
    broad = np.column_stack((x_w.ravel(), y_w.ravel(), (0.36 * x_w + 12.0).ravel()))
    x_c, y_c = np.meshgrid(np.arange(12.0, 20.25, 0.5), np.arange(0.0, 10.25, 0.5))
    steep = np.column_stack((x_c.ravel(), y_c.ravel(), (0.47 * x_c + 10.6).ravel()))
    points = np.vstack((broad, steep))
    points[:, 2] += rng.normal(0, 0.02, len(points))

    pair_classes: dict = {}
    facets = _fit_facets(points, pair_classes_out=pair_classes)

    assert len(facets) == 2
    assert set(pair_classes) == {(0, 1)}
    assert pair_classes[(0, 1)] in {"ridge", "hip", "valley", "pitch_change"}
