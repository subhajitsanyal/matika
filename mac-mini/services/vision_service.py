"""CareLog Vision Service — port 8004.

Accepts a device display photo and extracts readings (BP, glucose, etc.)
using a vision-language model (Qwen-VL / LLaVA).  The model may be loaded
on-demand to save memory, since vision is used infrequently.

P4 enhancements: on-demand model loading (deferred until first /extract),
configurable idle timeout for automatic model unload, and inference timing
(inference_duration_ms in response).
"""

from __future__ import annotations

import asyncio
import io
import logging
import time
from contextlib import asynccontextmanager
from typing import Any, AsyncIterator, Optional

import uvicorn
from fastapi import FastAPI, File, Form, UploadFile
from fastapi.responses import JSONResponse

from shared.config import VISION_IDLE_TIMEOUT_SECONDS, VISION_MODEL_PATH, VISION_PORT
from shared.models import BoundingBox, VisionExtractResponse, VisionReading

logger = logging.getLogger("carelog.vision")

# ---------------------------------------------------------------------------
# Global model state
# ---------------------------------------------------------------------------
_model: Any = None
_model_name: str = "qwen-vl-7b-q4"
_start_time: float = 0.0
_loaded_on_demand: bool = False  # True if we defer loading until first request
_last_inference_time: float = 0.0  # monotonic timestamp of last inference

# Allowed image MIME types
_ALLOWED_TYPES = {"image/jpeg", "image/png", "image/webp"}

# Background task for idle unload
_idle_unload_task: asyncio.Task | None = None


def _load_model(on_demand: bool = False) -> bool:
    """Load the vision model.

    Args:
        on_demand: If True, this is a lazy load triggered by the first request.
    """
    global _model, _start_time, _loaded_on_demand, _last_inference_time
    if not on_demand:
        _start_time = time.time()

    if not VISION_MODEL_PATH.exists():
        logger.warning("Vision model path does not exist: %s — service will return 503",
                        VISION_MODEL_PATH)
        return False

    try:
        # ------------------------------------------------------------------
        # Production implementation:
        #   from transformers import AutoModelForVision2Seq, AutoProcessor
        #   processor = AutoProcessor.from_pretrained(str(VISION_MODEL_PATH))
        #   model = AutoModelForVision2Seq.from_pretrained(
        #       str(VISION_MODEL_PATH),
        #       torch_dtype=torch.float16,
        #       device_map="mps",
        #   )
        #   _model = (processor, model)
        # ------------------------------------------------------------------
        _model = "loaded"
        _loaded_on_demand = on_demand
        _last_inference_time = time.monotonic()
        logger.info("Vision model loaded from %s (on_demand=%s)", VISION_MODEL_PATH, on_demand)
        return True
    except Exception:
        logger.exception("Failed to load Vision model")
        return False


def _unload_model() -> None:
    """Unload the vision model to free memory."""
    global _model, _loaded_on_demand
    if _model is not None:
        logger.info("Unloading vision model to free memory (idle timeout)")
        # Production: del _model; torch.mps.empty_cache()
        _model = None
        _loaded_on_demand = False


def _model_ready() -> bool:
    return _model is not None


def _ensure_model() -> bool:
    """Lazy-load the model if not already loaded."""
    if _model_ready():
        return True
    return _load_model(on_demand=True)


# ---------------------------------------------------------------------------
# Idle unload background task
# ---------------------------------------------------------------------------

async def _idle_unload_loop() -> None:
    """Periodically check if the vision model has been idle too long and unload it."""
    while True:
        await asyncio.sleep(30)  # check every 30 seconds
        if _model is not None and _last_inference_time > 0:
            idle_seconds = time.monotonic() - _last_inference_time
            if idle_seconds > VISION_IDLE_TIMEOUT_SECONDS:
                logger.info(
                    "Vision model idle for %.0fs (threshold %ds) — unloading",
                    idle_seconds, VISION_IDLE_TIMEOUT_SECONDS,
                )
                _unload_model()


# ---------------------------------------------------------------------------
# Extraction helpers
# ---------------------------------------------------------------------------

def _extract_readings(image_bytes: bytes, device_hint: Optional[str] = None) -> VisionExtractResponse:
    """Run vision model inference on an image.

    In production this sends the image through the VLM with a prompt asking
    it to identify the device type and extract all visible readings.
    Placeholder returns a stub response.
    """
    global _last_inference_time

    t0 = time.monotonic()

    # --- Production code ---
    # from PIL import Image
    # image = Image.open(io.BytesIO(image_bytes))
    # processor, model = _model
    # prompt = "Extract all numerical readings from this medical device display..."
    # inputs = processor(images=image, text=prompt, return_tensors="pt").to("mps")
    # output = model.generate(**inputs)
    # parsed = _parse_vision_output(processor.decode(output[0]))
    # -----------------------

    inference_ms = round((time.monotonic() - t0) * 1000, 2)
    _last_inference_time = time.monotonic()

    # Placeholder response
    return VisionExtractResponse(
        device_type="unknown",
        confidence=0.0,
        readings=[],
        raw_text_detected="",
        inference_duration_ms=inference_ms,
    )


# ---------------------------------------------------------------------------
# Lifespan
# ---------------------------------------------------------------------------
@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    global _start_time, _idle_unload_task
    _start_time = time.time()
    # Do NOT eagerly load the model (P4: on-demand loading saves ~5 GB memory)
    # Just check if the path exists so health can report correctly
    if VISION_MODEL_PATH.exists():
        logger.info("Vision model path exists at %s — model will be loaded on first /extract request", VISION_MODEL_PATH)
    else:
        logger.warning("Vision model path does not exist: %s", VISION_MODEL_PATH)

    # Start idle unload background task
    _idle_unload_task = asyncio.create_task(_idle_unload_loop())

    yield

    # Cleanup
    if _idle_unload_task:
        _idle_unload_task.cancel()
        try:
            await _idle_unload_task
        except asyncio.CancelledError:
            pass
    _unload_model()
    logger.info("Vision service shutting down")


app = FastAPI(title="CareLog Vision Service", lifespan=lifespan)


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.get("/health")
async def health() -> JSONResponse:
    # Vision service reports "up" even if model is not yet loaded,
    # because the model may be loaded on-demand.  It reports "down"
    # only if the model path doesn't exist at all.
    if not VISION_MODEL_PATH.exists():
        return JSONResponse(
            {"status": "down", "model": _model_name, "uptime_seconds": 0},
            status_code=503,
        )
    return JSONResponse({
        "status": "up",
        "model": _model_name,
        "model_loaded": _model_ready(),
        "uptime_seconds": round(time.time() - _start_time, 1),
    })


@app.post("/extract", response_model=VisionExtractResponse)
async def extract(
    image: UploadFile = File(...),
    device_hint: Optional[str] = Form(None),
) -> JSONResponse:
    # Validate content type
    content_type = image.content_type or ""
    if content_type not in _ALLOWED_TYPES:
        return JSONResponse(
            {"error": "invalid_image", "message": f"Expected JPEG/PNG/WebP, got: {content_type}"},
            status_code=400,
        )

    # Ensure model is loaded (on-demand if needed)
    if not _ensure_model():
        return JSONResponse({"error": "model_not_loaded"}, status_code=503)

    image_bytes = await image.read()
    if not image_bytes:
        return JSONResponse({"error": "empty_image", "message": "No image data received"}, status_code=400)

    try:
        result = _extract_readings(image_bytes, device_hint)
    except Exception:
        logger.exception("Vision extraction failed")
        return JSONResponse(
            {"error": "extraction_failed", "message": "Could not extract readings from image"},
            status_code=422,
        )

    if not result.readings and result.raw_text_detected == "":
        return JSONResponse(
            {"error": "no_readings", "message": "Image processed but no readings could be extracted"},
            status_code=422,
        )

    return JSONResponse(content=result.model_dump())


# ---------------------------------------------------------------------------
# Entrypoint
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    uvicorn.run(app, host="0.0.0.0", port=VISION_PORT)
