"""Pydantic models shared across all CareLog Mac Mini services.

These models match the API contracts defined in docs/carelog_spec.md Section 4.1.
"""

from __future__ import annotations

import enum
from typing import Any, Optional

from pydantic import BaseModel, Field


# ============================================================
# Enums
# ============================================================


class Action(str, enum.Enum):
    greeting = "greeting"
    confirm_value = "confirm_value"
    ask_parameter = "ask_parameter"
    suggest_photo = "suggest_photo"
    ask_topic = "ask_topic"
    implausible_value = "implausible_value"
    emergency = "emergency"
    session_summary = "session_summary"
    ask_repeat = "ask_repeat"
    fallback_text = "fallback_text"


class ValueStatus(str, enum.Enum):
    pending_confirmation = "pending_confirmation"
    confirmed = "confirmed"


class SessionStateName(str, enum.Enum):
    active = "active"
    paused = "paused"
    ended = "ended"


class EndReason(str, enum.Enum):
    user_stopped = "user_stopped"
    pause_timeout = "pause_timeout"
    all_captured = "all_captured"


# ============================================================
# Health Aggregator (Section 4.1.1)
# ============================================================


class ServiceStatus(BaseModel):
    status: str = Field(..., description="'up' or 'down'")
    port: int
    model: Optional[str] = None
    uptime_seconds: Optional[float] = None


class HealthResponse(BaseModel):
    status: str = Field(..., description="'healthy' or 'degraded'")
    services: dict[str, ServiceStatus]


# ============================================================
# STT Service (Section 4.1.2 / 4.1.3)
# ============================================================


class TranscribeSegment(BaseModel):
    start_ms: int
    end_ms: int
    text: str
    confidence: float


class TranscribeResponse(BaseModel):
    text: str
    language: str
    duration_ms: int
    segments: list[TranscribeSegment]


class StreamingMessage(BaseModel):
    """WebSocket message sent from the STT streaming endpoint."""
    type: str = Field(..., description="'partial' or 'final'")
    text: str
    confidence: Optional[float] = None
    duration_ms: Optional[int] = None


# ============================================================
# LLM Service (Section 4.1.4)
# ============================================================


class ParameterConfig(BaseModel):
    name: str
    loinc_codes: list[str]
    unit: str
    frequency_days: int = 1
    threshold_min: Optional[list[float]] = None
    threshold_max: Optional[list[float]] = None


class TopicConfig(BaseModel):
    id: str
    name: str
    description: str
    status: str = "incomplete"
    last_collected: Optional[str] = None


class SessionConfig(BaseModel):
    parameters: list[ParameterConfig] = Field(default_factory=list)
    topics: list[TopicConfig] = Field(default_factory=list)
    system_prompt: Optional[str] = None
    patient_name: Optional[str] = None
    last_session_summary: Optional[str] = None


class CreateSessionRequest(BaseModel):
    session_type: str = "patient_logging"
    patient_id: str
    language: str = "en"
    config: SessionConfig = Field(default_factory=SessionConfig)


class CreateSessionResponse(BaseModel):
    session_id: str
    greeting_text: str
    state: str = "active"


class ExtractedValue(BaseModel):
    parameter: str
    loinc_code: str
    value: float
    unit: str
    status: ValueStatus = ValueStatus.pending_confirmation


class SessionStateResponse(BaseModel):
    """Inline session_state object returned in utterance responses."""
    confirmed_values: list[ExtractedValue] = Field(default_factory=list)
    pending_confirmation: list[str] = Field(default_factory=list)
    remaining_parameters: list[str] = Field(default_factory=list)
    topics_addressed: list[str] = Field(default_factory=list)
    turn_count: int = 0


class UtteranceRequest(BaseModel):
    text: str
    turn_number: Optional[int] = None


class UtteranceResponse(BaseModel):
    response_text: str
    extracted_values: list[ExtractedValue] = Field(default_factory=list)
    session_state: SessionStateResponse
    action: Action
    requires_photo: bool = False
    inference_duration_ms: Optional[float] = None


class EndSessionRequest(BaseModel):
    reason: EndReason = EndReason.user_stopped


class TranscriptTurn(BaseModel):
    turn: int
    role: str
    text: str


class SessionSummary(BaseModel):
    confirmed_values: list[ExtractedValue] = Field(default_factory=list)
    missed_parameters: list[str] = Field(default_factory=list)
    topics_addressed: list[str] = Field(default_factory=list)
    turn_count: int = 0
    language: str = "en"
    duration_ms: int = 0
    status: str = "incomplete"


class EndSessionResponse(BaseModel):
    session_id: str
    summary: SessionSummary
    full_transcript: list[TranscriptTurn] = Field(default_factory=list)
    state: str = "ended"


class PauseSessionResponse(BaseModel):
    session_id: str
    state: str = "paused"
    timeout_seconds: int = 300


class ResumeSessionResponse(BaseModel):
    session_id: str
    state: str = "active"
    response_text: str = ""


# ============================================================
# TTS Service (Section 4.1.5)
# ============================================================


class SynthesizeRequest(BaseModel):
    text: str
    language: str = "en"
    format: str = "pcm"
    sample_rate: int = 16000
    voice_id: Optional[str] = None


class SynthesizeResponse(BaseModel):
    """Not used for the HTTP endpoint (which returns raw audio bytes),
    but useful for internal representations."""
    audio_bytes: bytes
    sample_rate: int = 16000
    duration_ms: int = 0


# ============================================================
# Vision Service (Section 4.1.6)
# ============================================================


class BoundingBox(BaseModel):
    x: int
    y: int
    w: int
    h: int


class VisionReading(BaseModel):
    label: str
    value: float
    unit: str
    bounding_box: Optional[BoundingBox] = None


class VisionExtractResponse(BaseModel):
    device_type: str
    confidence: float
    readings: list[VisionReading]
    raw_text_detected: str
    inference_duration_ms: Optional[float] = None


class VisionExtractRequest(BaseModel):
    """Represents the non-file fields of the multipart /extract request."""
    device_hint: Optional[str] = None
