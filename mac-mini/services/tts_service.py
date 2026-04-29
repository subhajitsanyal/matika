"""CareLog TTS (Text-to-Speech) Service — port 8003.

Provides batch synthesis via POST /synthesize (returns raw PCM audio bytes)
and streaming synthesis via WebSocket /synthesize/stream.
Uses Piper TTS with per-language ONNX voice models.

P4 enhancements: inference timing (X-Inference-Duration-Ms header), LRU cache
for common phrases (greetings, confirmations), short-text optimisation.
"""

from __future__ import annotations

import hashlib
import json
import logging
import struct
import time
from collections import OrderedDict
from contextlib import asynccontextmanager
from typing import Any, AsyncIterator

import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse, Response

from shared.config import SUPPORTED_LANGUAGES, TTS_PHRASE_CACHE_SIZE, TTS_PORT, tts_model_path
from shared.models import SynthesizeRequest

logger = logging.getLogger("carelog.tts")

# ---------------------------------------------------------------------------
# Global model state
# ---------------------------------------------------------------------------
_models: dict[str, Any] = {}  # language -> loaded Piper model
_model_name: str = "piper"
_start_time: float = 0.0

# ---------------------------------------------------------------------------
# LRU phrase cache: (text, language, sample_rate) -> (pcm_bytes, duration_ms)
# ---------------------------------------------------------------------------
_phrase_cache: OrderedDict[str, tuple[bytes, int]] = OrderedDict()
_cache_max_size: int = TTS_PHRASE_CACHE_SIZE
_cache_hits: int = 0
_cache_misses: int = 0

# Short text threshold: texts under this many characters get priority caching
_SHORT_TEXT_THRESHOLD: int = 80


def _cache_key(text: str, language: str, sample_rate: int) -> str:
    """Generate a cache key for a TTS request."""
    raw = f"{text.strip().lower()}|{language}|{sample_rate}"
    return hashlib.md5(raw.encode()).hexdigest()


def _cache_get(key: str) -> tuple[bytes, int] | None:
    """Look up a cached synthesis result. Returns (pcm_bytes, duration_ms) or None."""
    global _cache_hits, _cache_misses
    if key in _phrase_cache:
        _cache_hits += 1
        # Move to end (most recently used)
        _phrase_cache.move_to_end(key)
        return _phrase_cache[key]
    _cache_misses += 1
    return None


def _cache_put(key: str, pcm_bytes: bytes, duration_ms: int) -> None:
    """Store a synthesis result in the cache."""
    if key in _phrase_cache:
        _phrase_cache.move_to_end(key)
        _phrase_cache[key] = (pcm_bytes, duration_ms)
    else:
        if len(_phrase_cache) >= _cache_max_size:
            _phrase_cache.popitem(last=False)  # evict oldest
        _phrase_cache[key] = (pcm_bytes, duration_ms)


def _load_models() -> bool:
    """Attempt to load Piper ONNX models for each supported language.

    Returns True if at least one model is loaded.
    """
    global _start_time
    _start_time = time.time()
    loaded_any = False

    for lang in SUPPORTED_LANGUAGES:
        model_path = tts_model_path(lang)
        if not model_path.exists():
            logger.warning("TTS model not found for language '%s': %s", lang, model_path)
            continue

        try:
            from piper import PiperVoice
            _models[lang] = PiperVoice.load(str(model_path))
            loaded_any = True
            logger.info("TTS model loaded for '%s' from %s", lang, model_path)
        except Exception:
            logger.exception("Failed to load TTS model for '%s'", lang)

    if not loaded_any:
        logger.warning("No TTS models loaded — service will return 503")
    return loaded_any


def _model_ready() -> bool:
    return len(_models) > 0


# ---------------------------------------------------------------------------
# Synthesis helpers
# ---------------------------------------------------------------------------

def _synthesize(text: str, language: str, sample_rate: int = 16000) -> tuple[bytes, int]:
    """Run TTS inference and return (pcm_bytes, duration_ms)."""
    model = _models.get(language)
    if model is None:
        # Fallback to English if requested language model not available
        model = _models.get("en")
    if model is None:
        logger.warning("No TTS model available for language '%s'", language)
        num_samples = sample_rate // 10
        pcm_bytes = struct.pack(f"<{num_samples}h", *([0] * num_samples))
        return pcm_bytes, int(num_samples / sample_rate * 1000)

    # Synthesize using Piper — collect all audio chunks
    raw_audio = b""
    for chunk in model.synthesize(text):
        raw_audio += chunk.audio_int16_bytes

    # Piper outputs at model.config.sample_rate (22050 typically)
    # Resample to requested sample_rate if different
    model_sr = model.config.sample_rate
    if model_sr != sample_rate and len(raw_audio) > 0:
        import numpy as np
        audio_np = np.frombuffer(raw_audio, dtype=np.int16).astype(np.float32)
        # Simple linear interpolation resampling
        ratio = sample_rate / model_sr
        new_length = int(len(audio_np) * ratio)
        indices = np.linspace(0, len(audio_np) - 1, new_length)
        resampled = np.interp(indices, np.arange(len(audio_np)), audio_np)
        raw_audio = resampled.astype(np.int16).tobytes()

    duration_ms = int(len(raw_audio) / (sample_rate * 2) * 1000)
    logger.info("Synthesized %d ms audio for '%s' (%s)", duration_ms, text[:40], language)
    return raw_audio, duration_ms


# ---------------------------------------------------------------------------
# Lifespan
# ---------------------------------------------------------------------------
@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    _load_models()
    yield
    logger.info("TTS service shutting down")


app = FastAPI(title="CareLog TTS Service", lifespan=lifespan)


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.get("/health")
async def health() -> JSONResponse:
    if not _model_ready():
        return JSONResponse(
            {"status": "down", "model": _model_name, "uptime_seconds": 0},
            status_code=503,
        )
    return JSONResponse({
        "status": "up",
        "model": _model_name,
        "languages": list(_models.keys()),
        "uptime_seconds": round(time.time() - _start_time, 1),
        "cache_stats": {
            "size": len(_phrase_cache),
            "hits": _cache_hits,
            "misses": _cache_misses,
        },
    })


@app.post("/synthesize")
async def synthesize(request: SynthesizeRequest) -> Response:
    if not _model_ready():
        return JSONResponse({"error": "model_not_loaded"}, status_code=503)

    if request.language not in SUPPORTED_LANGUAGES:
        return JSONResponse(
            {"error": "unsupported_language", "message": f"Supported: {SUPPORTED_LANGUAGES}"},
            status_code=400,
        )

    if request.language not in _models:
        return JSONResponse(
            {"error": "language_model_not_loaded",
             "message": f"TTS model for '{request.language}' is not available"},
            status_code=503,
        )

    if not request.text.strip():
        return JSONResponse({"error": "empty_text", "message": "No text to synthesize"}, status_code=400)

    # P4: Check phrase cache first
    key = _cache_key(request.text, request.language, request.sample_rate)
    cached = _cache_get(key)

    t0 = time.monotonic()

    if cached is not None:
        pcm_bytes, duration_ms = cached
        inference_ms = round((time.monotonic() - t0) * 1000, 2)
        logger.info("TTS cache HIT key=%s inference_duration_ms=%.2f", key[:8], inference_ms)
    else:
        pcm_bytes, duration_ms = _synthesize(request.text, request.language, request.sample_rate)
        inference_ms = round((time.monotonic() - t0) * 1000, 2)
        logger.info("TTS cache MISS key=%s inference_duration_ms=%.2f", key[:8], inference_ms)
        # Cache the result
        _cache_put(key, pcm_bytes, duration_ms)

    return Response(
        content=pcm_bytes,
        media_type="audio/pcm",
        headers={
            "X-Sample-Rate": str(request.sample_rate),
            "X-Duration-Ms": str(duration_ms),
            "X-Inference-Duration-Ms": str(inference_ms),
            "X-Cache": "hit" if cached is not None else "miss",
        },
    )


@app.websocket("/synthesize/stream")
async def synthesize_stream(
    websocket: WebSocket,
    language: str = "en",
    sample_rate: int = 16000,
) -> None:
    """Streaming TTS via WebSocket.

    Client sends JSON text messages.
    Server responds with binary PCM audio chunks.
    """
    if not _model_ready():
        await websocket.close(code=1013, reason="Model not loaded")
        return

    if language not in SUPPORTED_LANGUAGES:
        await websocket.close(code=1008, reason=f"Unsupported language: {language}")
        return

    await websocket.accept()

    try:
        while True:
            raw = await websocket.receive_text()
            try:
                data = json.loads(raw)
            except (json.JSONDecodeError, TypeError):
                continue

            text = data.get("text", "")
            lang = data.get("language", language)

            if not text.strip():
                continue

            if lang not in _models:
                await websocket.send_json({"error": f"Language model '{lang}' not loaded"})
                continue

            pcm_bytes, _ = _synthesize(text, lang, sample_rate)

            # Stream audio in chunks (4096 bytes per frame, matching STT chunk size)
            chunk_size = 4096
            for offset in range(0, len(pcm_bytes), chunk_size):
                await websocket.send_bytes(pcm_bytes[offset : offset + chunk_size])
    except WebSocketDisconnect:
        logger.debug("TTS WebSocket client disconnected")
    finally:
        await websocket.close()


# ---------------------------------------------------------------------------
# Entrypoint
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    uvicorn.run(app, host="0.0.0.0", port=TTS_PORT)
