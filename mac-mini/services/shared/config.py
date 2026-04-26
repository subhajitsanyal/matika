"""Centralised configuration for all CareLog Mac Mini model services."""

from __future__ import annotations

import os
from pathlib import Path


# ---------------------------------------------------------------------------
# Service ports
# ---------------------------------------------------------------------------
HEALTH_PORT: int = int(os.getenv("CARELOG_HEALTH_PORT", "8000"))
STT_PORT: int = int(os.getenv("CARELOG_STT_PORT", "8001"))
LLM_PORT: int = int(os.getenv("CARELOG_LLM_PORT", "8002"))
TTS_PORT: int = int(os.getenv("CARELOG_TTS_PORT", "8003"))
VISION_PORT: int = int(os.getenv("CARELOG_VISION_PORT", "8004"))

SERVICE_PORTS: dict[str, int] = {
    "stt": STT_PORT,
    "llm": LLM_PORT,
    "tts": TTS_PORT,
    "vision": VISION_PORT,
}

# ---------------------------------------------------------------------------
# Model paths (symlinks managed by the update/rollback script)
# ---------------------------------------------------------------------------
MODEL_BASE: Path = Path(os.getenv("CARELOG_MODEL_BASE", "/opt/carelog/models"))

STT_MODEL_PATH: Path = MODEL_BASE / "current-stt"
LLM_MODEL_PATH: Path = MODEL_BASE / "current-llm"
VISION_MODEL_PATH: Path = MODEL_BASE / "current-vision"


def tts_model_path(language: str) -> Path:
    """Return the Piper ONNX voice model path for the given language code."""
    return MODEL_BASE / f"piper-{language}.onnx"


# ---------------------------------------------------------------------------
# mDNS / Bonjour
# ---------------------------------------------------------------------------
MDNS_SERVICE_TYPE: str = "_carelog._tcp.local."
MDNS_SERVICE_NAME: str = "CareLog Mac Mini._carelog._tcp.local."
MDNS_SERVICE_PORT: int = HEALTH_PORT
MDNS_TXT_RECORDS: dict[str, str] = {
    "version": "1.0",
    "device": "macmini-m4",
}

# ---------------------------------------------------------------------------
# Directories
# ---------------------------------------------------------------------------
TMP_DIR: Path = Path(os.getenv("CARELOG_TMP_DIR", "/opt/carelog/tmp"))
LOG_DIR: Path = Path(os.getenv("CARELOG_LOG_DIR", "/opt/carelog/logs"))

# ---------------------------------------------------------------------------
# Session settings
# ---------------------------------------------------------------------------
SESSION_TIMEOUT_SECONDS: int = 300  # 5 minutes

# ---------------------------------------------------------------------------
# Supported languages
# ---------------------------------------------------------------------------
SUPPORTED_LANGUAGES: list[str] = ["en", "hi", "bn"]

# ---------------------------------------------------------------------------
# Health aggregator polling
# ---------------------------------------------------------------------------
HEALTH_POLL_INTERVAL_SECONDS: int = 5

# ---------------------------------------------------------------------------
# Sliding-window context for LLM
# ---------------------------------------------------------------------------
LLM_CONTEXT_WINDOW_TURNS: int = 20

# ---------------------------------------------------------------------------
# Vision idle unload timeout (seconds)
# ---------------------------------------------------------------------------
VISION_IDLE_TIMEOUT_SECONDS: int = int(os.getenv("CARELOG_VISION_IDLE_TIMEOUT", "300"))

# ---------------------------------------------------------------------------
# TTS phrase cache size (LRU)
# ---------------------------------------------------------------------------
TTS_PHRASE_CACHE_SIZE: int = int(os.getenv("CARELOG_TTS_CACHE_SIZE", "128"))

# ---------------------------------------------------------------------------
# LLM context limit warning threshold (fraction of max tokens)
# ---------------------------------------------------------------------------
LLM_CONTEXT_LIMIT_WARN_FRACTION: float = 0.8
LLM_MAX_CONTEXT_TOKENS: int = 4096
