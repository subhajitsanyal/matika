"""Tests for the Vision service — including P4 on-demand loading and idle unload."""

from __future__ import annotations

import io
import time
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

import vision_service
from shared.config import VISION_MODEL_PATH
from vision_service import app, _unload_model


@pytest.fixture(autouse=True)
def _mock_model(tmp_path):
    """Ensure the model is 'loaded' and model path exists for all tests."""
    original_model = vision_service._model
    original_path = vision_service.VISION_MODEL_PATH
    original_last = vision_service._last_inference_time

    # Create a fake model path so health check works
    fake_path = tmp_path / "current-vision"
    fake_path.mkdir()

    vision_service._model = "loaded"
    vision_service._start_time = 1000.0
    vision_service._last_inference_time = time.monotonic()
    # Patch the module-level reference
    vision_service.VISION_MODEL_PATH = fake_path

    yield

    vision_service._model = original_model
    vision_service.VISION_MODEL_PATH = original_path
    vision_service._last_inference_time = original_last


@pytest.fixture()
def client():
    return TestClient(app, raise_server_exceptions=False)


def _make_jpeg_bytes() -> bytes:
    """Create minimal valid JPEG bytes for testing."""
    return b"\xff\xd8\xff\xe0" + b"\x00" * 100 + b"\xff\xd9"


def _make_png_bytes() -> bytes:
    """Create minimal PNG header bytes for testing."""
    return b"\x89PNG\r\n\x1a\n" + b"\x00" * 100


# ---------------------------------------------------------------------------
# Health endpoint
# ---------------------------------------------------------------------------

class TestVisionHealth:
    def test_health_up(self, client: TestClient) -> None:
        resp = client.get("/health")
        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "up"
        assert body["model"] == "qwen-vl-7b-q4"

    def test_health_down_when_model_path_missing(self, client: TestClient, tmp_path) -> None:
        vision_service.VISION_MODEL_PATH = tmp_path / "nonexistent"
        resp = client.get("/health")
        assert resp.status_code == 503
        assert resp.json()["status"] == "down"

    def test_health_reports_model_loaded_status(self, client: TestClient) -> None:
        """Health reports whether the model is currently loaded."""
        resp = client.get("/health")
        body = resp.json()
        assert "model_loaded" in body
        assert body["model_loaded"] is True

    def test_health_up_even_when_model_not_loaded(self, client: TestClient) -> None:
        """Vision reports 'up' if model path exists but model not yet loaded (on-demand)."""
        vision_service._model = None
        resp = client.get("/health")
        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "up"
        assert body["model_loaded"] is False


# ---------------------------------------------------------------------------
# POST /extract
# ---------------------------------------------------------------------------

class TestExtract:
    def test_extract_rejects_non_image(self, client: TestClient) -> None:
        resp = client.post(
            "/extract",
            files={"image": ("test.txt", b"not an image", "text/plain")},
        )
        assert resp.status_code == 400
        assert "invalid_image" in resp.json()["error"]

    def test_extract_accepts_jpeg(self, client: TestClient) -> None:
        """Endpoint should accept JPEG and return a response (may be 422 if no readings)."""
        resp = client.post(
            "/extract",
            files={"image": ("device.jpg", _make_jpeg_bytes(), "image/jpeg")},
        )
        # Placeholder returns empty readings, so we expect 422
        assert resp.status_code in (200, 422)

    def test_extract_accepts_png(self, client: TestClient) -> None:
        resp = client.post(
            "/extract",
            files={"image": ("device.png", _make_png_bytes(), "image/png")},
        )
        assert resp.status_code in (200, 422)

    def test_extract_with_device_hint(self, client: TestClient) -> None:
        resp = client.post(
            "/extract",
            files={"image": ("bp.jpg", _make_jpeg_bytes(), "image/jpeg")},
            data={"device_hint": "blood_pressure_monitor"},
        )
        assert resp.status_code in (200, 422)

    def test_extract_503_when_model_not_loaded(self, client: TestClient) -> None:
        vision_service._model = None
        # Also make ensure_model fail
        vision_service.VISION_MODEL_PATH = vision_service.VISION_MODEL_PATH.parent / "nonexistent"
        resp = client.post(
            "/extract",
            files={"image": ("bp.jpg", _make_jpeg_bytes(), "image/jpeg")},
        )
        assert resp.status_code == 503

    def test_extract_response_schema_when_readings_found(self, client: TestClient) -> None:
        """Mock _extract_readings to return actual readings and validate schema."""
        from shared.models import VisionExtractResponse, VisionReading

        mock_result = VisionExtractResponse(
            device_type="blood_pressure_monitor",
            confidence=0.92,
            readings=[
                VisionReading(label="systolic", value=130, unit="mmHg"),
                VisionReading(label="diastolic", value=85, unit="mmHg"),
            ],
            raw_text_detected="130 85",
            inference_duration_ms=42.5,
        )

        with patch.object(vision_service, "_extract_readings", return_value=mock_result):
            resp = client.post(
                "/extract",
                files={"image": ("bp.jpg", _make_jpeg_bytes(), "image/jpeg")},
            )
            assert resp.status_code == 200
            body = resp.json()

            assert body["device_type"] == "blood_pressure_monitor"
            assert body["confidence"] == 0.92
            assert len(body["readings"]) == 2
            assert body["readings"][0]["label"] == "systolic"
            assert body["readings"][0]["value"] == 130
            assert body["readings"][0]["unit"] == "mmHg"
            assert body["raw_text_detected"] == "130 85"

    def test_extract_422_when_no_readings(self, client: TestClient) -> None:
        """Placeholder returns empty readings, which should yield 422."""
        resp = client.post(
            "/extract",
            files={"image": ("device.jpg", _make_jpeg_bytes(), "image/jpeg")},
        )
        assert resp.status_code == 422
        assert "no_readings" in resp.json()["error"]


# ---------------------------------------------------------------------------
# P4: Inference duration in response
# ---------------------------------------------------------------------------

class TestInferenceDuration:
    def test_response_includes_inference_duration(self, client: TestClient) -> None:
        """P4: VisionExtractResponse includes inference_duration_ms."""
        from shared.models import VisionExtractResponse, VisionReading

        mock_result = VisionExtractResponse(
            device_type="glucometer",
            confidence=0.88,
            readings=[VisionReading(label="glucose", value=135, unit="mg/dL")],
            raw_text_detected="135",
            inference_duration_ms=150.0,
        )

        with patch.object(vision_service, "_extract_readings", return_value=mock_result):
            resp = client.post(
                "/extract",
                files={"image": ("device.jpg", _make_jpeg_bytes(), "image/jpeg")},
            )
            assert resp.status_code == 200
            body = resp.json()
            assert "inference_duration_ms" in body
            assert body["inference_duration_ms"] == 150.0


# ---------------------------------------------------------------------------
# P4: On-demand model loading
# ---------------------------------------------------------------------------

class TestOnDemandLoading:
    def test_model_loads_on_first_extract(self, client: TestClient) -> None:
        """P4: Model is not loaded at startup; loads on first /extract request."""
        vision_service._model = None  # simulate not loaded at startup

        # /extract triggers on-demand load (via _ensure_model)
        resp = client.post(
            "/extract",
            files={"image": ("bp.jpg", _make_jpeg_bytes(), "image/jpeg")},
        )
        # Model loads on demand — check it was loaded
        assert vision_service._model is not None

    def test_ensure_model_returns_true_when_already_loaded(self) -> None:
        """If model is already loaded, _ensure_model is a no-op."""
        vision_service._model = "loaded"
        assert vision_service._ensure_model() is True

    def test_ensure_model_loads_on_demand(self) -> None:
        vision_service._model = None
        result = vision_service._ensure_model()
        assert result is True
        assert vision_service._model is not None

    def test_ensure_model_fails_when_path_missing(self, tmp_path) -> None:
        vision_service._model = None
        vision_service.VISION_MODEL_PATH = tmp_path / "nonexistent"
        result = vision_service._ensure_model()
        assert result is False


# ---------------------------------------------------------------------------
# P4: Idle model unload
# ---------------------------------------------------------------------------

class TestIdleUnload:
    def test_unload_model_clears_model(self) -> None:
        """P4: _unload_model sets _model to None."""
        vision_service._model = "loaded"
        _unload_model()
        assert vision_service._model is None

    def test_unload_idempotent(self) -> None:
        """Unloading when already unloaded is safe."""
        vision_service._model = None
        _unload_model()  # should not raise
        assert vision_service._model is None

    def test_model_reloads_after_unload(self, client: TestClient) -> None:
        """P4: After idle unload, model reloads on next /extract request."""
        vision_service._model = "loaded"
        _unload_model()
        assert vision_service._model is None

        # Next /extract triggers reload
        resp = client.post(
            "/extract",
            files={"image": ("bp.jpg", _make_jpeg_bytes(), "image/jpeg")},
        )
        assert vision_service._model is not None

    def test_last_inference_time_updated(self) -> None:
        """P4: _last_inference_time is updated after extraction."""
        from vision_service import _extract_readings
        before = vision_service._last_inference_time
        _extract_readings(b"\x00" * 100)
        after = vision_service._last_inference_time
        assert after >= before
