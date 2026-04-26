"""Tests for the TTS service — including P4 latency optimisations."""

from __future__ import annotations

from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

import tts_service
from tts_service import _cache_key, _cache_get, _cache_put, _phrase_cache, app


@pytest.fixture(autouse=True)
def _mock_models():
    """Ensure at least one model is 'loaded' for all tests and clear cache."""
    original = dict(tts_service._models)
    original_cache = dict(tts_service._phrase_cache)
    original_hits = tts_service._cache_hits
    original_misses = tts_service._cache_misses

    tts_service._models = {"en": "loaded", "hi": "loaded", "bn": "loaded"}
    tts_service._start_time = 1000.0
    tts_service._phrase_cache.clear()
    tts_service._cache_hits = 0
    tts_service._cache_misses = 0

    yield

    tts_service._models = original
    tts_service._phrase_cache.clear()
    tts_service._phrase_cache.update(original_cache)
    tts_service._cache_hits = original_hits
    tts_service._cache_misses = original_misses


@pytest.fixture()
def client():
    return TestClient(app, raise_server_exceptions=False)


# ---------------------------------------------------------------------------
# Health endpoint
# ---------------------------------------------------------------------------

class TestTTSHealth:
    def test_health_up(self, client: TestClient) -> None:
        resp = client.get("/health")
        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "up"
        assert body["model"] == "piper"

    def test_health_down_when_no_models(self, client: TestClient) -> None:
        tts_service._models = {}
        resp = client.get("/health")
        assert resp.status_code == 503
        assert resp.json()["status"] == "down"

    def test_health_includes_cache_stats(self, client: TestClient) -> None:
        """P4: Health endpoint reports cache statistics."""
        resp = client.get("/health")
        body = resp.json()
        assert "cache_stats" in body
        assert "size" in body["cache_stats"]
        assert "hits" in body["cache_stats"]
        assert "misses" in body["cache_stats"]


# ---------------------------------------------------------------------------
# POST /synthesize
# ---------------------------------------------------------------------------

class TestSynthesize:
    def test_synthesize_returns_pcm_audio(self, client: TestClient) -> None:
        resp = client.post("/synthesize", json={
            "text": "Hello, how are you?",
            "language": "en",
            "format": "pcm",
            "sample_rate": 16000,
        })
        assert resp.status_code == 200
        assert resp.headers["content-type"] == "audio/pcm"
        assert "X-Sample-Rate" in resp.headers
        assert "X-Duration-Ms" in resp.headers
        assert len(resp.content) > 0

    def test_synthesize_returns_correct_sample_rate_header(self, client: TestClient) -> None:
        resp = client.post("/synthesize", json={
            "text": "Test",
            "language": "en",
            "sample_rate": 22050,
        })
        assert resp.status_code == 200
        assert resp.headers["X-Sample-Rate"] == "22050"

    def test_synthesize_rejects_unsupported_language(self, client: TestClient) -> None:
        resp = client.post("/synthesize", json={
            "text": "Test",
            "language": "fr",
        })
        assert resp.status_code == 400

    def test_synthesize_rejects_empty_text(self, client: TestClient) -> None:
        resp = client.post("/synthesize", json={
            "text": "   ",
            "language": "en",
        })
        assert resp.status_code == 400

    def test_synthesize_503_when_no_models(self, client: TestClient) -> None:
        tts_service._models = {}
        resp = client.post("/synthesize", json={
            "text": "Test",
            "language": "en",
        })
        assert resp.status_code == 503

    def test_synthesize_503_when_language_model_missing(self, client: TestClient) -> None:
        tts_service._models = {"en": "loaded"}  # only English loaded
        resp = client.post("/synthesize", json={
            "text": "Test",
            "language": "hi",
        })
        assert resp.status_code == 503

    def test_synthesize_hindi(self, client: TestClient) -> None:
        resp = client.post("/synthesize", json={
            "text": "\u0928\u092e\u0938\u094d\u0924\u0947",
            "language": "hi",
        })
        assert resp.status_code == 200
        assert len(resp.content) > 0

    def test_synthesize_response_is_binary(self, client: TestClient) -> None:
        resp = client.post("/synthesize", json={
            "text": "Hello",
            "language": "en",
        })
        # PCM audio should be raw bytes, not JSON
        assert resp.headers["content-type"] == "audio/pcm"
        # Should not be parseable as JSON
        with pytest.raises(Exception):
            resp.json()


# ---------------------------------------------------------------------------
# P4: Timing header
# ---------------------------------------------------------------------------

class TestInferenceTiming:
    def test_synthesize_returns_inference_duration_header(self, client: TestClient) -> None:
        """P4: Response includes X-Inference-Duration-Ms header."""
        resp = client.post("/synthesize", json={
            "text": "Hello, how are you today?",
            "language": "en",
        })
        assert resp.status_code == 200
        assert "X-Inference-Duration-Ms" in resp.headers
        duration = float(resp.headers["X-Inference-Duration-Ms"])
        assert duration >= 0

    def test_timing_header_is_numeric(self, client: TestClient) -> None:
        resp = client.post("/synthesize", json={
            "text": "Test timing",
            "language": "en",
        })
        val = resp.headers.get("X-Inference-Duration-Ms")
        assert val is not None
        float(val)  # should not raise


# ---------------------------------------------------------------------------
# P4: Phrase cache
# ---------------------------------------------------------------------------

class TestPhraseCache:
    def test_cache_key_consistency(self) -> None:
        """Same input produces same cache key."""
        key1 = _cache_key("Hello", "en", 16000)
        key2 = _cache_key("Hello", "en", 16000)
        assert key1 == key2

    def test_cache_key_differs_by_language(self) -> None:
        key_en = _cache_key("Hello", "en", 16000)
        key_hi = _cache_key("Hello", "hi", 16000)
        assert key_en != key_hi

    def test_cache_key_differs_by_sample_rate(self) -> None:
        key1 = _cache_key("Hello", "en", 16000)
        key2 = _cache_key("Hello", "en", 22050)
        assert key1 != key2

    def test_cache_key_case_insensitive(self) -> None:
        key1 = _cache_key("Hello", "en", 16000)
        key2 = _cache_key("hello", "en", 16000)
        assert key1 == key2

    def test_cache_put_and_get(self) -> None:
        _cache_put("test-key", b"\x00\x00", 100)
        result = _cache_get("test-key")
        assert result is not None
        assert result == (b"\x00\x00", 100)

    def test_cache_miss(self) -> None:
        result = _cache_get("nonexistent-key")
        assert result is None

    def test_cache_hit_on_second_request(self, client: TestClient) -> None:
        """P4: Second identical request is a cache hit."""
        payload = {"text": "Hello friend", "language": "en", "sample_rate": 16000}

        # First request — cache miss
        resp1 = client.post("/synthesize", json=payload)
        assert resp1.status_code == 200
        assert resp1.headers.get("X-Cache") == "miss"

        # Second request — cache hit
        resp2 = client.post("/synthesize", json=payload)
        assert resp2.status_code == 200
        assert resp2.headers.get("X-Cache") == "hit"

    def test_cache_miss_for_different_text(self, client: TestClient) -> None:
        """Different text produces a cache miss."""
        resp1 = client.post("/synthesize", json={
            "text": "Hello", "language": "en", "sample_rate": 16000,
        })
        assert resp1.headers.get("X-Cache") == "miss"

        resp2 = client.post("/synthesize", json={
            "text": "Goodbye", "language": "en", "sample_rate": 16000,
        })
        assert resp2.headers.get("X-Cache") == "miss"

    def test_cache_eviction_when_full(self) -> None:
        """P4: LRU eviction works when cache reaches max size."""
        original_max = tts_service._cache_max_size
        tts_service._cache_max_size = 3

        _cache_put("k1", b"\x01", 10)
        _cache_put("k2", b"\x02", 20)
        _cache_put("k3", b"\x03", 30)
        # k1 is oldest
        _cache_put("k4", b"\x04", 40)
        # k1 should be evicted
        assert _cache_get("k1") is None
        assert _cache_get("k4") is not None

        tts_service._cache_max_size = original_max

    def test_health_reports_cache_size(self, client: TestClient) -> None:
        """P4: After caching a phrase, health shows updated cache size."""
        client.post("/synthesize", json={
            "text": "cached phrase", "language": "en", "sample_rate": 16000,
        })
        resp = client.get("/health")
        body = resp.json()
        assert body["cache_stats"]["size"] >= 1
        assert body["cache_stats"]["misses"] >= 1
