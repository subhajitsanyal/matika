"""CareLog STT (Speech-to-Text) Service — port 8001.

Provides batch transcription via POST /transcribe and streaming transcription
via WebSocket /transcribe/stream.  Uses Whisper (or IndicWhisper) loaded at
startup.

P4 enhancements: inference timing (X-Inference-Duration-Ms header), model
warm-up on startup, early PCM format validation, chunked processing for
long audio.
"""

from __future__ import annotations

import asyncio
import io
import logging
import struct
import time
from contextlib import asynccontextmanager
from typing import AsyncIterator

import uvicorn
from fastapi import FastAPI, Header, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse

from shared.config import STT_MODEL_PATH, STT_PORT, SUPPORTED_LANGUAGES
from shared.models import StreamingMessage, TranscribeResponse, TranscribeSegment

logger = logging.getLogger("carelog.stt")

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
# Maximum audio duration we process in a single chunk (seconds).
# Audio longer than this is split at silence boundaries.
MAX_CHUNK_DURATION_SECONDS: float = 15.0

# Minimum valid PCM frame size (100 ms of 16-bit mono at 8 kHz)
MIN_PCM_BYTES: int = 800  # 8000 * 0.1 * 2 bytes

# ---------------------------------------------------------------------------
# Global model state
# ---------------------------------------------------------------------------
_model = None
_model_name: str = "whisper-large-v3"
_start_time: float = 0.0


def _load_model() -> bool:
    """Attempt to load the Whisper model from STT_MODEL_PATH.

    Returns True if the model is ready, False otherwise.
    In production this loads the real Whisper pipeline; for now we set up the
    structure and handle the case where model files are absent.
    """
    global _model, _start_time
    _start_time = time.time()

    if not STT_MODEL_PATH.exists():
        logger.warning("STT model path does not exist: %s — service will return 503", STT_MODEL_PATH)
        return False

    try:
        # ------------------------------------------------------------------
        # Production implementation would be:
        #   import torch
        #   from transformers import pipeline
        #   _model = pipeline(
        #       "automatic-speech-recognition",
        #       model=str(STT_MODEL_PATH),
        #       device="mps",           # Apple Silicon GPU
        #       torch_dtype=torch.float16,
        #   )
        # ------------------------------------------------------------------
        # Placeholder: mark model as loaded if the directory exists
        _model = "loaded"
        logger.info("STT model loaded from %s", STT_MODEL_PATH)
        return True
    except Exception:
        logger.exception("Failed to load STT model")
        return False


def _warm_up_model() -> None:
    """Run a dummy inference to prime the model (fills caches, JIT compile, etc.).

    This reduces latency on the first real request.
    """
    if not _model_ready():
        return
    logger.info("Warming up STT model with dummy inference...")
    # 100 ms of silence at 16 kHz, 16-bit mono
    num_samples = 1600
    dummy_audio = struct.pack(f"<{num_samples}h", *([0] * num_samples))
    _transcribe_audio(dummy_audio, 16000, "en")
    logger.info("STT model warm-up complete")


# ---------------------------------------------------------------------------
# Audio validation
# ---------------------------------------------------------------------------

def _validate_pcm_audio(audio_bytes: bytes, sample_rate: int) -> str | None:
    """Validate PCM audio format. Returns error message or None if valid."""
    if not audio_bytes:
        return "No audio data received"
    if len(audio_bytes) < MIN_PCM_BYTES:
        return f"Audio too short ({len(audio_bytes)} bytes); minimum is {MIN_PCM_BYTES} bytes"
    # PCM 16-bit samples must be even number of bytes
    if len(audio_bytes) % 2 != 0:
        return "Invalid PCM data: odd number of bytes (expected 16-bit samples)"
    if sample_rate < 8000 or sample_rate > 48000:
        return f"Invalid sample rate {sample_rate}; must be between 8000 and 48000"
    return None


# ---------------------------------------------------------------------------
# Lifespan
# ---------------------------------------------------------------------------
@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    _load_model()
    _warm_up_model()
    yield
    logger.info("STT service shutting down")


app = FastAPI(title="CareLog STT Service", lifespan=lifespan)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _model_ready() -> bool:
    return _model is not None


def _transcribe_audio(audio_bytes: bytes, sample_rate: int, language: str) -> TranscribeResponse:
    """Run inference on raw PCM audio bytes.

    In production this calls the Whisper pipeline.  The placeholder returns
    a stub response so that integration tests can validate the schema.
    """
    # Duration estimate: PCM 16-bit mono -> 2 bytes per sample
    num_samples = len(audio_bytes) // 2
    duration_ms = int(num_samples / sample_rate * 1000) if sample_rate else 0

    # --- Production code would go here ---
    # import numpy as np
    # audio_np = np.frombuffer(audio_bytes, dtype=np.int16).astype(np.float32) / 32768.0
    # result = _model(audio_np, generate_kwargs={"language": language})
    # text = result["text"]
    # -----------------------------------------

    text = ""  # placeholder — real model fills this in
    segments = [
        TranscribeSegment(
            start_ms=0,
            end_ms=duration_ms,
            text=text,
            confidence=0.0,
        )
    ]
    return TranscribeResponse(
        text=text,
        language=language,
        duration_ms=duration_ms,
        segments=segments,
    )


def _split_long_audio(audio_bytes: bytes, sample_rate: int) -> list[bytes]:
    """Split audio into chunks of at most MAX_CHUNK_DURATION_SECONDS.

    Simple fixed-size split (production would split at silence boundaries).
    Returns a list of PCM byte chunks.
    """
    max_bytes = int(MAX_CHUNK_DURATION_SECONDS * sample_rate * 2)  # 16-bit = 2 bytes/sample
    if len(audio_bytes) <= max_bytes:
        return [audio_bytes]
    chunks = []
    for offset in range(0, len(audio_bytes), max_bytes):
        chunk = audio_bytes[offset: offset + max_bytes]
        # Ensure even byte count
        if len(chunk) % 2 != 0:
            chunk = chunk[:-1]
        if chunk:
            chunks.append(chunk)
    return chunks


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
        "uptime_seconds": round(time.time() - _start_time, 1),
    })


@app.post("/transcribe", response_model=TranscribeResponse)
async def transcribe(
    request: Request,
    x_sample_rate: int = Header(16000, alias="X-Sample-Rate"),
    x_language: str = Header("en", alias="X-Language"),
) -> JSONResponse:
    if not _model_ready():
        return JSONResponse({"error": "model_not_loaded"}, status_code=503)

    content_type = request.headers.get("content-type", "")
    if "audio/pcm" not in content_type:
        return JSONResponse(
            {"error": "invalid_content_type", "message": "Expected Content-Type: audio/pcm"},
            status_code=400,
        )

    if x_language not in SUPPORTED_LANGUAGES:
        return JSONResponse(
            {"error": "unsupported_language", "message": f"Supported: {SUPPORTED_LANGUAGES}"},
            status_code=400,
        )

    audio_bytes = await request.body()

    # Early PCM validation (P4 optimisation — reject before inference)
    validation_error = _validate_pcm_audio(audio_bytes, x_sample_rate)
    if validation_error:
        return JSONResponse(
            {"error": "invalid_audio", "message": validation_error},
            status_code=400,
        )

    # Timing (P4)
    t0 = time.monotonic()

    # Chunked processing for long audio (P4)
    chunks = _split_long_audio(audio_bytes, x_sample_rate)
    if len(chunks) == 1:
        result = _transcribe_audio(audio_bytes, x_sample_rate, x_language)
    else:
        # Process chunks and merge
        all_text_parts: list[str] = []
        all_segments: list[TranscribeSegment] = []
        offset_ms = 0
        for chunk in chunks:
            chunk_result = _transcribe_audio(chunk, x_sample_rate, x_language)
            all_text_parts.append(chunk_result.text)
            for seg in chunk_result.segments:
                all_segments.append(TranscribeSegment(
                    start_ms=seg.start_ms + offset_ms,
                    end_ms=seg.end_ms + offset_ms,
                    text=seg.text,
                    confidence=seg.confidence,
                ))
            offset_ms += chunk_result.duration_ms

        total_duration = int(len(audio_bytes) / 2 / x_sample_rate * 1000)
        result = TranscribeResponse(
            text=" ".join(all_text_parts).strip(),
            language=x_language,
            duration_ms=total_duration,
            segments=all_segments,
        )

    inference_ms = round((time.monotonic() - t0) * 1000, 2)
    logger.info("STT inference_duration_ms=%.2f audio_duration_ms=%d", inference_ms, result.duration_ms)

    return JSONResponse(
        content=result.model_dump(),
        headers={"X-Inference-Duration-Ms": str(inference_ms)},
    )


toplevel_lock = asyncio.Lock()


@app.websocket("/transcribe/stream")
async def transcribe_stream(
    websocket: WebSocket,
    language: str = "en",
    sample_rate: int = 16000,
) -> None:
    """Streaming STT via WebSocket.

    Client sends raw PCM audio chunks as binary frames.
    Server responds with partial/final JSON transcript messages.
    Client sends {"type": "end"} to signal end of audio.
    """
    if not _model_ready():
        await websocket.close(code=1013, reason="Model not loaded")
        return

    if language not in SUPPORTED_LANGUAGES:
        await websocket.close(code=1008, reason=f"Unsupported language: {language}")
        return

    await websocket.accept()
    audio_buffer = bytearray()

    try:
        while True:
            message = await websocket.receive()

            if "bytes" in message and message["bytes"]:
                audio_buffer.extend(message["bytes"])

                # Send a partial transcript periodically
                # In production, the Whisper streaming decoder produces partials
                partial = StreamingMessage(type="partial", text="")
                await websocket.send_json(partial.model_dump())

            elif "text" in message and message["text"]:
                import json
                try:
                    data = json.loads(message["text"])
                except (json.JSONDecodeError, TypeError):
                    continue

                if data.get("type") == "end":
                    # Process the accumulated audio buffer
                    t0 = time.monotonic()
                    result = _transcribe_audio(bytes(audio_buffer), sample_rate, language)
                    inference_ms = round((time.monotonic() - t0) * 1000, 2)

                    final = StreamingMessage(
                        type="final",
                        text=result.text,
                        confidence=result.segments[0].confidence if result.segments else 0.0,
                        duration_ms=result.duration_ms,
                    )
                    await websocket.send_json(final.model_dump())
                    break
    except WebSocketDisconnect:
        logger.debug("STT WebSocket client disconnected")
    finally:
        await websocket.close()


# ---------------------------------------------------------------------------
# Entrypoint
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    uvicorn.run(app, host="0.0.0.0", port=STT_PORT)
