"""Tests for the asynchronous analyze jobs API and accelerated tile downloads.

The jobs API exists because a cold-cache analysis (USGS tile downloads of
~180 MB at throttled speeds) outlives the hosting tier's request window:
submission returns 202 immediately, the analysis runs on a worker thread,
and polling reports progress plus the final payload. Job state is
in-memory only, so a job lost to a restart must fail loudly — GET answers
404 job_not_found and the client resubmits automatically.
"""

import asyncio
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from shapely.geometry import Polygon

import main as roof_service


@pytest.fixture(autouse=True)
def clean_job_state():
    roof_service._JOBS.clear()
    roof_service._RESPONSE_CACHE.clear()
    yield
    roof_service._JOBS.clear()
    roof_service._RESPONSE_CACHE.clear()


def _poll_until_finished(client: TestClient, job_id: str, timeout: float = 10.0) -> dict:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        response = client.get(f"/v1/roof/analyze/jobs/{job_id}")
        assert response.status_code == 200
        body = response.json()
        if body["status"] in ("complete", "failed"):
            return body
        time.sleep(0.05)
    raise AssertionError(f"job {job_id} did not finish within {timeout}s")


def test_plan_ranges_cover_the_file_exactly_once():
    for size, chunks in [(0, 4), (1, 4), (10, 3), (100, 6), (101, 6), (7, 100)]:
        ranges = roof_service._plan_ranges(size, chunks)
        covered = [byte for start, end in ranges for byte in range(start, end + 1)]
        assert covered == list(range(size))
        assert len(ranges) <= max(1, chunks)


def test_job_submit_poll_complete_returns_the_analysis_payload(monkeypatch):
    payload = {"status": "lidar_facets", "roof": {"area_sqft": 1234.5}}

    async def fake_run_analysis(_request, report=None):
        if report is not None:
            report("lidar", "Reading public LiDAR coverage", None)
        return payload

    monkeypatch.setattr(roof_service, "_run_analysis", fake_run_analysis)
    client = TestClient(roof_service.app)

    submit = client.post(
        "/v1/roof/analyze/jobs", json={"street_address": "100 Jobs Test Way, Miami, FL"}
    )
    assert submit.status_code == 202
    submitted = submit.json()
    assert submitted["status"] in ("queued", "running")
    assert submitted["job_id"]

    finished = _poll_until_finished(client, submitted["job_id"])
    assert finished["status"] == "complete"
    assert finished["result"] == payload


def test_job_submission_dedupes_onto_the_running_job(monkeypatch):
    async def slow_run_analysis(_request, report=None):
        await asyncio.sleep(1.5)
        return {"status": "footprint_only"}

    monkeypatch.setattr(roof_service, "_run_analysis", slow_run_analysis)
    client = TestClient(roof_service.app)
    body = {"street_address": "200 Dedupe Test Way, Miami, FL"}

    first = client.post("/v1/roof/analyze/jobs", json=body).json()
    second = client.post("/v1/roof/analyze/jobs", json=body).json()
    assert second["job_id"] == first["job_id"]
    assert _poll_until_finished(client, first["job_id"])["status"] == "complete"


def test_job_failure_surfaces_the_error(monkeypatch):
    async def failing_run_analysis(_request, report=None):
        raise RuntimeError("tile host exploded")

    monkeypatch.setattr(roof_service, "_run_analysis", failing_run_analysis)
    client = TestClient(roof_service.app)
    submitted = client.post(
        "/v1/roof/analyze/jobs", json={"street_address": "300 Failure Test Way, Miami, FL"}
    ).json()
    finished = _poll_until_finished(client, submitted["job_id"])
    assert finished["status"] == "failed"
    assert "tile host exploded" in finished["error"]


def test_job_failure_preserves_http_rejection_detail(monkeypatch):
    detail = {"candidates": [{"candidate_id": "abc12345"}], "message": "pick one"}

    async def rejecting_run_analysis(_request, report=None):
        raise HTTPException(status_code=409, detail=detail)

    monkeypatch.setattr(roof_service, "_run_analysis", rejecting_run_analysis)
    client = TestClient(roof_service.app)
    submitted = client.post(
        "/v1/roof/analyze/jobs", json={"street_address": "400 Reject Test Way, Miami, FL"}
    ).json()
    finished = _poll_until_finished(client, submitted["job_id"])
    assert finished["status"] == "failed"
    assert finished["error_status"] == 409
    assert finished["error_detail"] == detail


def test_unknown_job_is_a_loud_404_with_resubmit_code():
    client = TestClient(roof_service.app)
    response = client.get("/v1/roof/analyze/jobs/does-not-exist")
    assert response.status_code == 404
    assert response.json()["detail"]["code"] == "job_not_found"


def test_job_lost_to_a_restart_is_a_loud_404(monkeypatch):
    async def fake_run_analysis(_request, report=None):
        return {"status": "footprint_only"}

    monkeypatch.setattr(roof_service, "_run_analysis", fake_run_analysis)
    client = TestClient(roof_service.app)
    submitted = client.post(
        "/v1/roof/analyze/jobs", json={"street_address": "500 Restart Test Way, Miami, FL"}
    ).json()
    assert _poll_until_finished(client, submitted["job_id"])["status"] == "complete"

    # An instance restart wipes the in-memory store; the id must then fail
    # loudly (404 job_not_found) so the client resubmits — never hang.
    roof_service._JOBS.clear()
    response = client.get(f"/v1/roof/analyze/jobs/{submitted['job_id']}")
    assert response.status_code == 404
    assert response.json()["detail"]["code"] == "job_not_found"


def test_expired_finished_job_is_swept_to_the_same_404():
    now = roof_service.epoch_seconds()
    roof_service._JOBS["stale-job"] = {
        "job_id": "stale-job",
        "cache_key": "stale",
        "status": "complete",
        "stage": "complete",
        "detail": None,
        "download_fraction": None,
        "created_at": now - roof_service.JOB_TTL_SECONDS - 60,
        "updated_at": now - roof_service.JOB_TTL_SECONDS - 60,
        "result": {"status": "footprint_only"},
        "error": None,
        "error_status": None,
        "error_detail": None,
    }
    client = TestClient(roof_service.app)
    response = client.get("/v1/roof/analyze/jobs/stale-job")
    assert response.status_code == 404
    assert response.json()["detail"]["code"] == "job_not_found"


def test_job_runs_the_real_pipeline_and_shares_the_response_cache(monkeypatch):
    polygon = Polygon(
        [(-80.0, 25.0), (-79.9999, 25.0), (-79.9999, 25.0001), (-80.0, 25.0001)]
    )

    async def fake_geocode(_address):
        return 25.00005, -79.99995, "Job pipeline test address", {"source": "Test geocoder"}

    async def fake_get_footprint(_lat, _lon, _street_address=None, _selected=None):
        return polygon, {"provider": "Test footprints", "building_tags": {}}

    monkeypatch.setattr(roof_service, "geocode_with_provenance", fake_geocode)
    monkeypatch.setattr(roof_service, "get_footprint", fake_get_footprint)
    monkeypatch.setattr(
        roof_service,
        "_read_lidar_facets",
        lambda _polygon, _provider=None: (
            [{"area_sqft": 500.0, "pitch_rise_per_12": 6.0}],
            {"stac_items": 1, "tiles_used": 1},
        ),
    )
    client = TestClient(roof_service.app)
    address = "600 Pipeline Test Way, Miami, FL"

    submitted = client.post("/v1/roof/analyze/jobs", json={"street_address": address}).json()
    finished = _poll_until_finished(client, submitted["job_id"])
    assert finished["status"] == "complete"
    assert finished["result"]["roof"]["area_sqft"] == 500.0

    # The completed job populated the shared response cache, so the
    # synchronous endpoint answers the same address instantly.
    sync = client.post("/v1/roof/analyze", json={"street_address": address})
    assert sync.status_code == 200
    assert sync.json()["roof"]["area_sqft"] == 500.0


# --- Tile download acceleration --------------------------------------------

TILE_PAYLOAD = b"LASF" + bytes(range(256)) * 12000  # ~3 MB of deterministic bytes


class _TileHandler(BaseHTTPRequestHandler):
    support_ranges = True
    honor_ranges = True
    ranged_gets = 0
    plain_gets = 0

    def log_message(self, *_args):  # keep test output clean
        pass

    def do_HEAD(self):
        self.send_response(200)
        self.send_header("Content-Length", str(len(TILE_PAYLOAD)))
        if self.support_ranges:
            self.send_header("Accept-Ranges", "bytes")
        self.end_headers()

    def do_GET(self):
        range_header = self.headers.get("Range")
        if range_header and self.support_ranges and self.honor_ranges:
            type(self).ranged_gets += 1
            start_s, end_s = range_header.removeprefix("bytes=").split("-")
            start, end = int(start_s), int(end_s)
            body = TILE_PAYLOAD[start : end + 1]
            self.send_response(206)
            self.send_header("Content-Range", f"bytes {start}-{end}/{len(TILE_PAYLOAD)}")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        type(self).plain_gets += 1
        self.send_response(200)
        self.send_header("Content-Length", str(len(TILE_PAYLOAD)))
        self.end_headers()
        self.wfile.write(TILE_PAYLOAD)


@pytest.fixture()
def tile_server(monkeypatch):
    monkeypatch.setenv("NO_PROXY", "localhost,127.0.0.1")
    monkeypatch.setenv("no_proxy", "localhost,127.0.0.1")
    _TileHandler.support_ranges = True
    _TileHandler.honor_ranges = True
    _TileHandler.ranged_gets = 0
    _TileHandler.plain_gets = 0
    server = ThreadingHTTPServer(("127.0.0.1", 0), _TileHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{server.server_address[1]}/tile.laz", _TileHandler
    server.shutdown()


async def _no_sleep(_seconds):
    return None


def test_download_tile_uses_parallel_ranges_when_the_host_supports_them(
    tile_server, tmp_path, monkeypatch
):
    url, handler = tile_server
    monkeypatch.setattr(roof_service, "TILE_DOWNLOAD_RANGED_MIN_BYTES", 1)
    monkeypatch.setattr(roof_service, "TILE_DOWNLOAD_CHUNKS", 4)
    monkeypatch.setattr(asyncio, "sleep", _no_sleep)
    dest = tmp_path / "tile.laz"
    asyncio.run(roof_service._download_tile(url, dest))
    assert dest.read_bytes() == TILE_PAYLOAD
    assert handler.ranged_gets == 4
    assert handler.plain_gets == 0


def test_ranged_download_cancels_sibling_chunks_when_one_fails(tmp_path, monkeypatch):
    """Regression: a bare asyncio.gather raises on the first chunk failure
    while sibling chunks keep downloading detached — writing into part
    files that cleanup already unlinked and reporting phantom progress.
    The ranged download must cancel its siblings before it propagates."""
    import time as time_module

    class FlakyHandler(_TileHandler):
        def do_GET(self):
            range_header = self.headers.get("Range")
            if range_header and range_header.startswith("bytes=0-"):
                self.send_response(403)
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
            if range_header:
                time_module.sleep(0.5)
            super().do_GET()

    monkeypatch.setenv("NO_PROXY", "localhost,127.0.0.1")
    monkeypatch.setenv("no_proxy", "localhost,127.0.0.1")
    monkeypatch.setattr(asyncio, "sleep", _no_sleep)
    monkeypatch.setattr(roof_service, "TILE_DOWNLOAD_CHUNKS", 4)
    server = ThreadingHTTPServer(("127.0.0.1", 0), FlakyHandler)
    server.handle_error = lambda *_args: None  # cancelled clients break pipes
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        url = f"http://127.0.0.1:{server.server_address[1]}/tile.laz"
        progress_calls: list[int] = []
        dest = tmp_path / "tile.laz"
        with pytest.raises(BaseException):
            asyncio.run(
                roof_service._download_tile_ranged(
                    url,
                    dest,
                    len(TILE_PAYLOAD),
                    on_progress=lambda done, _total: progress_calls.append(done),
                )
            )
        calls_at_raise = len(progress_calls)
        time_module.sleep(1.2)  # longer than the sibling handlers' delay
        assert len(progress_calls) == calls_at_raise  # no orphan kept reporting
        assert not list(tmp_path.glob("*.part*"))  # and no part files remain
    finally:
        server.shutdown()


def test_download_tile_falls_back_to_one_stream_without_range_support(
    tile_server, tmp_path, monkeypatch
):
    url, handler = tile_server
    handler.support_ranges = False
    monkeypatch.setattr(roof_service, "TILE_DOWNLOAD_RANGED_MIN_BYTES", 1)
    dest = tmp_path / "tile.laz"
    asyncio.run(roof_service._download_tile(url, dest))
    assert dest.read_bytes() == TILE_PAYLOAD
    assert handler.ranged_gets == 0
    assert handler.plain_gets >= 1


def test_download_tile_falls_back_when_range_requests_are_ignored(
    tile_server, tmp_path, monkeypatch
):
    url, handler = tile_server
    handler.honor_ranges = False  # HEAD advertises ranges; GET answers 200
    monkeypatch.setattr(roof_service, "TILE_DOWNLOAD_RANGED_MIN_BYTES", 1)
    monkeypatch.setattr(roof_service, "TILE_DOWNLOAD_CHUNKS", 4)
    monkeypatch.setattr(asyncio, "sleep", _no_sleep)
    dest = tmp_path / "tile.laz"
    asyncio.run(roof_service._download_tile(url, dest))
    assert dest.read_bytes() == TILE_PAYLOAD
    assert handler.plain_gets >= 1
