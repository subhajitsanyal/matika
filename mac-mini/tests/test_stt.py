"""Tests for the STT service — including P4 latency optimisations."""

from __future__ import annotations

import struct
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

import stt_service
from stt_service import (
    _split_long_audio,
    _validate_pcm_audio,
    app,
    MAX_CHUNK_DURATION_SECONDS,
    MIN_PCM_BYTES,
)


@pytest.fixture(autouse=True)
def _mock_model():
    """Ensure the model is 'loaded' for all tests."""
    original = stt_service._model
    stt_service._model = "loaded"
    stt_service._start_time = 1000.0
    yield
    stt_service._model = original


@pytest.fixture()
def client():
    return TestClient(app, raise_server_exceptions=False)


def _pcm_silence(duration_seconds: float = 0.1, sample_rate: int = 16000) -> bytes:
    """Generate silent PCM audio bytes."""
    num_samples = int(sample_rate * duration_seconds)
    return struct.pack(f"<{num_samples}h", *([0] * num_samples))


# ---------------------------------------------------------------------------
# Health endpoint
# ---------------------------------------------------------------------------

class TestSTTHealth:
    def test_health_up(self, client: TestClient) -> None:
        resp = client.get("/health")
        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "up"
        assert body["model"] == "whisper-large-v3"

    def test_health_down_when_model_not_loaded(self, client: TestClient) -> None:
        stt_service._model = None
        resp = client.get("/health")
        assert resp.status_code == 503
        assert resp.json()["status"] == "down"


# ---------------------------------------------------------------------------
# POST /transcribe
# ---------------------------------------------------------------------------

class TestTranscribe:
    def test_transcribe_returns_correct_schema(self, client: TestClient) -> None:
        audio = _pcm_silence(0.5)
        resp = client.post(
            "/transcribe",
            content=audio,
            headers={
                "Content-Type": "audio/pcm",
                "X-Sample-Rate": "16000",
                "X-Language": "en",
            },
        )
        assert resp.status_code == 200
        body = resp.json()
        assert "text" in body
        assert "language" in body
        assert body["language"] == "en"
        assert "duration_ms" in body
        assert "segments" in body
        assert isinstance(body["segments"], list)

    def test_transcribe_duration_calculation(self, client: TestClient) -> None:
        audio = _pcm_silence(1.0, sample_rate=16000)
        resp = client.post(
            "/transcribe",
            content=audio,
            headers={
                "Content-Type": "audio/pcm",
                "X-Sample-Rate": "16000",
                "X-Language": "en",
            },
        )
        body = resp.json()
        assert body["duration_ms"] == 1000

    def test_transcribe_rejects_wrong_content_type(self, client: TestClient) -> None:
        resp = client.post(
            "/transcribe",
            content=b"not audio",
            headers={"Content-Type": "application/json", "X-Language": "en"},
        )
        assert resp.status_code == 400

    def test_transcribe_rejects_unsupported_language(self, client: TestClient) -> None:
        audio = _pcm_silence()
        resp = client.post(
            "/transcribe",
            content=audio,
            headers={
                "Content-Type": "audio/pcm",
                "X-Sample-Rate": "16000",
                "X-Language": "fr",
            },
        )
        assert resp.status_code == 400

    def test_transcribe_rejects_empty_body(self, client: TestClient) -> None:
        resp = client.post(
            "/transcribe",
            content=b"",
            headers={
                "Content-Type": "audio/pcm",
                "X-Sample-Rate": "16000",
                "X-Language": "en",
            },
        )
        assert resp.status_code == 400

    def test_transcribe_503_when_model_not_loaded(self, client: TestClient) -> None:
        stt_service._model = None
        audio = _pcm_silence()
        resp = client.post(
            "/transcribe",
            content=audio,
            headers={
                "Content-Type": "audio/pcm",
                "X-Sample-Rate": "16000",
                "X-Language": "en",
            },
        )
        assert resp.status_code == 503

    def test_transcribe_segment_schema(self, client: TestClient) -> None:
        audio = _pcm_silence(0.2)
        resp = client.post(
            "/transcribe",
            content=audio,
            headers={
                "Content-Type": "audio/pcm",
                "X-Sample-Rate": "16000",
                "X-Language": "hi",
            },
        )
        body = resp.json()
        assert len(body["segments"]) > 0
        seg = body["segments"][0]
        assert "start_ms" in seg
        assert "end_ms" in seg
        assert "text" in seg
        assert "confidence" in seg


# ---------------------------------------------------------------------------
# P4: Timing header
# ---------------------------------------------------------------------------

class TestInferenceTiming:
    def test_transcribe_returns_inference_duration_header(self, client: TestClient) -> None:
        """P4: Response includes X-Inference-Duration-Ms header."""
        audio = _pcm_silence(0.5)
        resp = client.post(
            "/transcribe",
            content=audio,
            headers={
                "Content-Type": "audio/pcm",
                "X-Sample-Rate": "16000",
                "X-Language": "en",
            },
        )
        assert resp.status_code == 200
        assert "X-Inference-Duration-Ms" in resp.headers
        duration = float(resp.headers["X-Inference-Duration-Ms"])
        assert duration >= 0

    def test_timing_header_is_numeric(self, client: TestClient) -> None:
        audio = _pcm_silence(0.2)
        resp = client.post(
            "/transcribe",
            content=audio,
            headers={
                "Content-Type": "audio/pcm",
                "X-Sample-Rate": "16000",
                "X-Language": "en",
            },
        )
        val = resp.headers.get("X-Inference-Duration-Ms")
        assert val is not None
        float(val)  # should not raise


# ---------------------------------------------------------------------------
# P4: Audio validation
# ---------------------------------------------------------------------------

class TestAudioValidation:
    def test_valid_pcm_passes(self) -> None:
        audio = _pcm_silence(0.5)
        assert _validate_pcm_audio(audio, 16000) is None

    def test_empty_audio_rejected(self) -> None:
        err = _validate_pcm_audio(b"", 16000)
        assert err is not None
        assert "No audio" in err

    def test_too_short_audio_rejected(self) -> None:
        short = b"\x00" * 10
        err = _validate_pcm_audio(short, 16000)
        assert err is not None
        assert "too short" in err

    def test_odd_byte_count_rejected(self) -> None:
        odd = b"\x00" * (MIN_PCM_BYTES + 1)
        err = _validate_pcm_audio(odd, 16000)
        assert err is not None
        assert "odd" in err.lower()

    def test_invalid_sample_rate_rejected(self) -> None:
        audio = _pcm_silence(0.1)
        err = _validate_pcm_audio(audio, 100)
        assert err is not None
        assert "sample rate" in err.lower()

    def test_transcribe_rejects_too_short_audio(self, client: TestClient) -> None:
        """P4 integration: audio that's too short gets 400 before inference."""
        resp = client.post(
            "/transcribe",
            content=b"\x00\x00",  # 2 bytes = 1 sample
            headers={
                "Content-Type": "audio/pcm",
                "X-Sample-Rate": "16000",
                "X-Language": "en",
            },
        )
        assert resp.status_code == 400
        assert "too short" in resp.json().get("message", "").lower()


# ---------------------------------------------------------------------------
# P4: Chunked processing for long audio
# ---------------------------------------------------------------------------

class TestChunkedProcessing:
    def test_short_audio_not_split(self) -> None:
        audio = _pcm_silence(5.0)
        chunks = _split_long_audio(audio, 16000)
        assert len(chunks) == 1

    def test_long_audio_split_into_chunks(self) -> None:
        # 30 seconds of audio at 16kHz should be split into 2 chunks (15s each)
        audio = _pcm_silence(30.0)
        chunks = _split_long_audio(audio, 16000)
        assert len(chunks) == 2

    def test_very_long_audio_split_into_multiple_chunks(self) -> None:
        # 45 seconds -> 3 chunks
        audio = _pcm_silence(45.0)
        chunks = _split_long_audio(audio, 16000)
        assert len(chunks) == 3

    def test_chunks_have_even_byte_count(self) -> None:
        audio = _pcm_silence(20.0)
        chunks = _split_long_audio(audio, 16000)
        for chunk in chunks:
            assert len(chunk) % 2 == 0

    def test_long_audio_transcribe_works(self, client: TestClient) -> None:
        """P4 integration: long audio is chunked and merged transparently."""
        audio = _pcm_silence(20.0)
        resp = client.post(
            "/transcribe",
            content=audio,
            headers={
                "Content-Type": "audio/pcm",
                "X-Sample-Rate": "16000",
                "X-Language": "en",
            },
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["duration_ms"] == 20000
        assert "X-Inference-Duration-Ms" in resp.headers
