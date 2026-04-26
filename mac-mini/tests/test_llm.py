"""Tests for the LLM service — comprehensive P1-P4 conversation engine tests."""

from __future__ import annotations

import shutil
import tempfile
import time
from datetime import datetime, timezone, timedelta
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

import llm_service
from llm_service import (
    SessionState,
    _sessions,
    _build_context_window,
    _build_system_prompt,
    _detect_confusion,
    _is_confirmation,
    _is_denial,
    _replace_number_words_in_text,
    _summarize_turns,
    _try_extract_values,
    app,
    classify_plausibility,
    detect_emergency,
    detect_value_jump,
    is_plausible,
    parse_number_words,
    Turn,
    CONFIRMATION_PATTERNS,
    DENIAL_PATTERNS,
    EMERGENCY_KEYWORDS,
    MAX_SESSION_AGE_SECONDS,
)
from shared.config import LLM_CONTEXT_WINDOW_TURNS, SESSION_TIMEOUT_SECONDS
from shared.models import (
    Action,
    CreateSessionRequest,
    ExtractedValue,
    ParameterConfig,
    SessionConfig,
    TopicConfig,
    ValueStatus,
)


@pytest.fixture(autouse=True)
def _mock_model_and_cleanup():
    """Ensure the model is 'loaded' and sessions are cleaned up after each test."""
    original = llm_service._model
    llm_service._model = "loaded"
    llm_service._start_time = time.time()
    tmp_dir = Path(tempfile.mkdtemp())
    original_tmp_dir = llm_service.TMP_DIR
    llm_service.TMP_DIR = tmp_dir
    yield
    llm_service._model = original
    llm_service.TMP_DIR = original_tmp_dir
    _sessions.clear()
    shutil.rmtree(tmp_dir, ignore_errors=True)


@pytest.fixture()
def client():
    return TestClient(app, raise_server_exceptions=False)


def _create_session_payload(language: str = "en", topics: list | None = None) -> dict:
    payload = {
        "session_type": "patient_logging",
        "patient_id": "test-patient-123",
        "language": language,
        "config": {
            "parameters": [
                {
                    "name": "blood_pressure",
                    "loinc_codes": ["8480-6", "8462-4"],
                    "unit": "mmHg",
                    "frequency_days": 1,
                },
                {
                    "name": "blood_glucose",
                    "loinc_codes": ["2339-0"],
                    "unit": "mg/dL",
                    "frequency_days": 1,
                },
            ],
            "topics": topics or [],
            "patient_name": "Ramesh",
            "last_session_summary": "Yesterday: BP 128/82",
        },
    }
    return payload


def _create_session_with_topics(client: TestClient, language: str = "en") -> str:
    """Create a session that includes topics."""
    topics = [
        {
            "id": "topic-1",
            "name": "medications",
            "description": "Current medications and recent changes",
            "status": "incomplete",
            "last_collected": None,
        }
    ]
    resp = client.post("/sessions", json=_create_session_payload(language, topics))
    return resp.json()["session_id"]


def _create_and_get_sid(client: TestClient, language: str = "en") -> str:
    resp = client.post("/sessions", json=_create_session_payload(language))
    return resp.json()["session_id"]


def _make_session_request(
    language: str = "en",
    parameters: list[ParameterConfig] | None = None,
    topics: list[TopicConfig] | None = None,
) -> CreateSessionRequest:
    if parameters is None:
        parameters = [
            ParameterConfig(name="blood_pressure", loinc_codes=["8480-6", "8462-4"], unit="mmHg"),
            ParameterConfig(name="blood_glucose", loinc_codes=["2339-0"], unit="mg/dL"),
        ]
    config = SessionConfig(
        parameters=parameters,
        topics=topics or [],
        patient_name="Ramesh",
        last_session_summary="Yesterday: BP 128/82",
    )
    return CreateSessionRequest(
        session_type="patient_logging",
        patient_id="test-patient-123",
        language=language,
        config=config,
    )


# ===========================================================================
# Health endpoint
# ===========================================================================

class TestLLMHealth:
    def test_health_up(self, client: TestClient) -> None:
        resp = client.get("/health")
        assert resp.status_code == 200
        assert resp.json()["status"] == "up"

    def test_health_down(self, client: TestClient) -> None:
        llm_service._model = None
        resp = client.get("/health")
        assert resp.status_code == 503
        assert resp.json()["status"] == "down"


# ===========================================================================
# Session CRUD
# ===========================================================================

class TestSessionCreate:
    def test_create_session_returns_201(self, client: TestClient) -> None:
        resp = client.post("/sessions", json=_create_session_payload())
        assert resp.status_code == 201
        body = resp.json()
        assert "session_id" in body
        assert "greeting_text" in body
        assert body["state"] == "active"

    def test_create_session_stores_in_memory(self, client: TestClient) -> None:
        resp = client.post("/sessions", json=_create_session_payload())
        sid = resp.json()["session_id"]
        assert sid in _sessions
        assert _sessions[sid].state == "active"

    def test_create_session_greeting_uses_patient_name(self, client: TestClient) -> None:
        resp = client.post("/sessions", json=_create_session_payload())
        body = resp.json()
        assert "Ramesh" in body["greeting_text"]

    def test_create_session_hindi_greeting(self, client: TestClient) -> None:
        resp = client.post("/sessions", json=_create_session_payload("hi"))
        body = resp.json()
        assert body["greeting_text"]  # non-empty Hindi greeting
        assert "Ramesh" in body["greeting_text"]

    def test_create_session_bengali_greeting(self, client: TestClient) -> None:
        resp = client.post("/sessions", json=_create_session_payload("bn"))
        body = resp.json()
        assert body["greeting_text"]
        assert "Ramesh" in body["greeting_text"]

    def test_create_session_rejects_unsupported_language(self, client: TestClient) -> None:
        payload = _create_session_payload()
        payload["language"] = "fr"
        resp = client.post("/sessions", json=payload)
        assert resp.status_code == 400

    def test_create_session_503_when_model_not_loaded(self, client: TestClient) -> None:
        llm_service._model = None
        resp = client.post("/sessions", json=_create_session_payload())
        assert resp.status_code == 503

    def test_create_session_initializes_remaining_parameters(self, client: TestClient) -> None:
        resp = client.post("/sessions", json=_create_session_payload())
        sid = resp.json()["session_id"]
        session = _sessions[sid]
        assert "blood_pressure" in session.remaining_parameters
        assert "blood_glucose" in session.remaining_parameters


# ===========================================================================
# Utterance processing — schema and basic flow
# ===========================================================================

class TestSessionUtterance:
    def test_utterance_returns_correct_schema(self, client: TestClient) -> None:
        sid = _create_and_get_sid(client)
        resp = client.post(f"/sessions/{sid}/utterance", json={"text": "hello"})
        assert resp.status_code == 200
        body = resp.json()

        assert "response_text" in body
        assert "extracted_values" in body
        assert "session_state" in body
        assert "action" in body
        assert "requires_photo" in body

        state = body["session_state"]
        assert "confirmed_values" in state
        assert "pending_confirmation" in state
        assert "remaining_parameters" in state
        assert "topics_addressed" in state
        assert "turn_count" in state

    def test_utterance_returns_inference_duration(self, client: TestClient) -> None:
        """P4: utterance response includes inference_duration_ms."""
        sid = _create_and_get_sid(client)
        resp = client.post(f"/sessions/{sid}/utterance", json={"text": "hello"})
        body = resp.json()
        assert "inference_duration_ms" in body
        assert body["inference_duration_ms"] >= 0

    def test_utterance_increments_turn_count(self, client: TestClient) -> None:
        sid = _create_and_get_sid(client)
        client.post(f"/sessions/{sid}/utterance", json={"text": "hi"})
        resp = client.post(f"/sessions/{sid}/utterance", json={"text": "yes"})
        body = resp.json()
        # Greeting is turn 1, two utterances + two system responses = 5
        assert body["session_state"]["turn_count"] >= 3

    def test_utterance_404_for_missing_session(self, client: TestClient) -> None:
        resp = client.post("/sessions/nonexistent/utterance", json={"text": "hello"})
        assert resp.status_code == 404

    def test_utterance_action_is_valid_enum(self, client: TestClient) -> None:
        sid = _create_and_get_sid(client)
        resp = client.post(f"/sessions/{sid}/utterance", json={"text": "hello"})
        body = resp.json()
        valid_actions = {a.value for a in Action}
        assert body["action"] in valid_actions


# ===========================================================================
# Full session lifecycle: create -> extract -> confirm -> end
# ===========================================================================

class TestSessionLifecycle:
    def test_full_bp_extraction_and_confirmation(self, client: TestClient) -> None:
        """Full flow: create session, report BP, confirm, end."""
        sid = _create_and_get_sid(client)

        # Patient reports BP
        resp = client.post(
            f"/sessions/{sid}/utterance",
            json={"text": "my blood pressure is 130 over 85"},
        )
        body = resp.json()
        assert body["action"] == "confirm_value"
        assert len(body["extracted_values"]) == 2
        assert body["session_state"]["pending_confirmation"] == [
            "blood_pressure_systolic", "blood_pressure_diastolic"
        ]

        # Patient confirms
        resp = client.post(
            f"/sessions/{sid}/utterance",
            json={"text": "yes that's correct"},
        )
        body = resp.json()
        assert body["action"] == "ask_parameter"
        assert len(body["session_state"]["confirmed_values"]) == 2
        assert "blood_pressure_systolic" not in body["session_state"]["pending_confirmation"]
        # blood_pressure removed from remaining, blood_glucose still there
        assert "blood_glucose" in body["session_state"]["remaining_parameters"]

        # End session
        resp = client.post(f"/sessions/{sid}/end", json={"reason": "user_stopped"})
        body = resp.json()
        assert body["state"] == "ended"
        assert len(body["summary"]["confirmed_values"]) == 2
        assert body["summary"]["missed_parameters"] == ["blood_glucose"]

    def test_full_flow_all_parameters_captured(self, client: TestClient) -> None:
        """Complete all parameters and get session summary."""
        sid = _create_and_get_sid(client)

        # Report BP
        resp = client.post(
            f"/sessions/{sid}/utterance",
            json={"text": "bp 120 over 80"},
        )
        assert resp.json()["action"] == "confirm_value"

        # Confirm BP
        resp = client.post(
            f"/sessions/{sid}/utterance",
            json={"text": "yes correct"},
        )
        assert resp.json()["action"] == "ask_parameter"

        # Report glucose
        resp = client.post(
            f"/sessions/{sid}/utterance",
            json={"text": "sugar 135"},
        )
        assert resp.json()["action"] == "confirm_value"

        # Confirm glucose
        resp = client.post(
            f"/sessions/{sid}/utterance",
            json={"text": "haan sahi hai"},
        )
        body = resp.json()
        assert body["action"] == "session_summary"
        assert len(body["session_state"]["confirmed_values"]) == 3  # systolic + diastolic + glucose

        # End session
        resp = client.post(f"/sessions/{sid}/end", json={"reason": "all_captured"})
        assert resp.json()["summary"]["status"] == "complete"

    def test_denial_clears_pending_and_asks_repeat(self, client: TestClient) -> None:
        """When patient denies, pending values are cleared and repeat is requested."""
        sid = _create_and_get_sid(client)

        # Report BP
        client.post(
            f"/sessions/{sid}/utterance",
            json={"text": "bp 130 over 85"},
        )

        # Patient denies
        resp = client.post(
            f"/sessions/{sid}/utterance",
            json={"text": "no that's wrong"},
        )
        body = resp.json()
        assert body["action"] == "ask_repeat"
        assert body["session_state"]["pending_confirmation"] == []

    def test_correction_with_new_value(self, client: TestClient) -> None:
        """Patient provides a corrected value instead of simple yes/no."""
        sid = _create_and_get_sid(client)

        # Report BP
        client.post(
            f"/sessions/{sid}/utterance",
            json={"text": "bp 130 over 85"},
        )

        # Patient corrects with new value
        resp = client.post(
            f"/sessions/{sid}/utterance",
            json={"text": "no it's 125 over 80"},
        )
        body = resp.json()
        assert body["action"] == "confirm_value"
        # New extracted values should be 125 and 80
        values = {v["parameter"]: v["value"] for v in body["extracted_values"]}
        assert values.get("blood_pressure_systolic") == 125
        assert values.get("blood_pressure_diastolic") == 80


# ===========================================================================
# Value extraction (regex-based mock)
# ===========================================================================

class TestValueExtraction:
    def _make_session(self, remaining: list[str] | None = None) -> SessionState:
        req = _make_session_request()
        session = SessionState(req)
        if remaining is not None:
            session.remaining_parameters = remaining
        return session

    def test_extract_bp_slash_format(self) -> None:
        session = self._make_session(["blood_pressure"])
        values = _try_extract_values(session, "my bp is 130/85")
        assert len(values) == 2
        assert values[0]["parameter"] == "blood_pressure_systolic"
        assert values[0]["value"] == 130
        assert values[1]["parameter"] == "blood_pressure_diastolic"
        assert values[1]["value"] == 85

    def test_extract_bp_over_format(self) -> None:
        session = self._make_session(["blood_pressure"])
        values = _try_extract_values(session, "blood pressure 140 over 90")
        assert len(values) == 2
        assert values[0]["value"] == 140
        assert values[1]["value"] == 90

    def test_extract_glucose(self) -> None:
        session = self._make_session(["blood_glucose"])
        values = _try_extract_values(session, "sugar 135")
        assert len(values) == 1
        assert values[0]["parameter"] == "blood_glucose"
        assert values[0]["value"] == 135

    def test_extract_glucose_with_level(self) -> None:
        session = self._make_session(["blood_glucose"])
        values = _try_extract_values(session, "blood glucose level 120")
        assert len(values) == 1
        assert values[0]["value"] == 120

    def test_no_extraction_when_param_not_remaining(self) -> None:
        session = self._make_session(["blood_glucose"])  # no BP in remaining
        values = _try_extract_values(session, "bp 130/85")
        assert len(values) == 0

    def test_extract_spo2(self) -> None:
        req = _make_session_request(
            parameters=[ParameterConfig(name="spo2", loinc_codes=["2708-6"], unit="%")]
        )
        session = SessionState(req)
        values = _try_extract_values(session, "oxygen 97")
        assert len(values) == 1
        assert values[0]["parameter"] == "spo2"
        assert values[0]["value"] == 97

    def test_extract_heart_rate(self) -> None:
        req = _make_session_request(
            parameters=[ParameterConfig(name="heart_rate", loinc_codes=["8867-4"], unit="/min")]
        )
        session = SessionState(req)
        values = _try_extract_values(session, "pulse 72")
        assert len(values) == 1
        assert values[0]["parameter"] == "heart_rate"
        assert values[0]["value"] == 72

    def test_extract_nothing_from_greeting(self) -> None:
        session = self._make_session()
        values = _try_extract_values(session, "hello how are you")
        assert len(values) == 0


# ===========================================================================
# Plausibility validation — soft/hard (P4)
# ===========================================================================

class TestPlausibility:
    def test_normal_bp_systolic_is_plausible(self) -> None:
        assert is_plausible("blood_pressure_systolic", 120) is True

    def test_extreme_bp_systolic_is_not_plausible(self) -> None:
        assert is_plausible("blood_pressure_systolic", 300) is False

    def test_low_bp_systolic_is_not_plausible(self) -> None:
        assert is_plausible("blood_pressure_systolic", 50) is False

    def test_boundary_bp_systolic(self) -> None:
        assert is_plausible("blood_pressure_systolic", 60) is True
        assert is_plausible("blood_pressure_systolic", 250) is True

    def test_normal_glucose_is_plausible(self) -> None:
        assert is_plausible("blood_glucose", 120) is True

    def test_extreme_glucose_is_not_plausible(self) -> None:
        assert is_plausible("blood_glucose", 700) is False

    def test_low_glucose_is_not_plausible(self) -> None:
        assert is_plausible("blood_glucose", 10) is False

    def test_normal_spo2_is_plausible(self) -> None:
        assert is_plausible("spo2", 97) is True

    def test_heart_rate_boundaries(self) -> None:
        assert is_plausible("heart_rate", 30) is True
        assert is_plausible("heart_rate", 250) is True
        assert is_plausible("heart_rate", 29) is False
        assert is_plausible("heart_rate", 251) is False

    def test_unknown_parameter_is_plausible(self) -> None:
        assert is_plausible("unknown_param", 999) is True

    def test_body_temperature_f(self) -> None:
        assert is_plausible("body_temperature_f", 98.6) is True
        assert is_plausible("body_temperature_f", 85) is False

    def test_body_weight(self) -> None:
        assert is_plausible("body_weight", 70) is True
        assert is_plausible("body_weight", 5) is False
        assert is_plausible("body_weight", 350) is False

    def test_implausible_bp_triggers_action(self, client: TestClient) -> None:
        """Integration: hard-implausible value gets flagged at the API level."""
        sid = _create_and_get_sid(client)
        resp = client.post(
            f"/sessions/{sid}/utterance",
            json={"text": "bp 400 over 250"},
        )
        body = resp.json()
        assert body["action"] == "implausible_value"
        assert len(body["extracted_values"]) == 0  # not added to pending


class TestSoftHardImplausibility:
    """P4: Soft vs hard implausibility classification."""

    def test_normal_value_classified_as_ok(self) -> None:
        assert classify_plausibility("blood_pressure_systolic", 120) == "ok"

    def test_high_but_possible_bp_classified_as_soft(self) -> None:
        # 190 is outside soft_max (180) but inside hard_max (300)
        assert classify_plausibility("blood_pressure_systolic", 190) == "soft"

    def test_low_but_possible_bp_classified_as_soft(self) -> None:
        # 85 is below soft_min (90) but above hard_min (40)
        assert classify_plausibility("blood_pressure_systolic", 85) == "soft"

    def test_impossible_bp_classified_as_hard(self) -> None:
        # 500 exceeds hard_max (300)
        assert classify_plausibility("blood_pressure_systolic", 500) == "hard"
        # 10 is below hard_min (40)
        assert classify_plausibility("blood_pressure_systolic", 10) == "hard"

    def test_soft_glucose(self) -> None:
        # 350 is above soft_max (300) but below hard_max (800)
        assert classify_plausibility("blood_glucose", 350) == "soft"

    def test_hard_glucose(self) -> None:
        # 900 exceeds hard_max (800)
        assert classify_plausibility("blood_glucose", 900) == "hard"

    def test_unknown_parameter_is_ok(self) -> None:
        assert classify_plausibility("unknown_param", 999) == "ok"

    def test_hard_implausible_bp_triggers_reject(self, client: TestClient) -> None:
        """Hard implausible values are rejected (action=implausible_value)."""
        sid = _create_and_get_sid(client)
        resp = client.post(
            f"/sessions/{sid}/utterance",
            json={"text": "bp 500 over 300"},
        )
        body = resp.json()
        assert body["action"] == "implausible_value"
        assert "outside" in body["response_text"].lower() or "possible" in body["response_text"].lower()
        assert len(body["extracted_values"]) == 0

    def test_soft_implausible_bp_triggers_confirm_with_warning(self, client: TestClient) -> None:
        """Soft implausible values are extracted but with a warning note."""
        sid = _create_and_get_sid(client)
        resp = client.post(
            f"/sessions/{sid}/utterance",
            json={"text": "bp 190 over 110"},
        )
        body = resp.json()
        assert body["action"] == "confirm_value"
        assert "unusual" in body["response_text"].lower()
        # Values are still extracted
        assert len(body["extracted_values"]) == 2


class TestValueJumpDetection:
    """P4: Context-aware value jump detection."""

    def test_large_jump_detected(self) -> None:
        previous = [
            ExtractedValue(parameter="blood_pressure_systolic", loinc_code="8480-6",
                           value=130, unit="mmHg", status=ValueStatus.confirmed),
        ]
        # 190 is a 46% jump from 130 (> 40% threshold)
        assert detect_value_jump("blood_pressure_systolic", 190, previous) is True

    def test_small_change_not_flagged(self) -> None:
        previous = [
            ExtractedValue(parameter="blood_pressure_systolic", loinc_code="8480-6",
                           value=130, unit="mmHg", status=ValueStatus.confirmed),
        ]
        # 140 is only ~8% change
        assert detect_value_jump("blood_pressure_systolic", 140, previous) is False

    def test_no_previous_value_not_flagged(self) -> None:
        assert detect_value_jump("blood_pressure_systolic", 190, []) is False


# ===========================================================================
# Emergency detection — enhanced (P4)
# ===========================================================================

class TestEmergencyDetection:
    def test_english_emergency_keywords(self) -> None:
        assert detect_emergency("I have chest pain", "en") is True
        assert detect_emergency("I can't breathe", "en") is True
        assert detect_emergency("she is unconscious", "en") is True
        assert detect_emergency("I fell down", "en") is False  # "fell down" not exact match
        assert detect_emergency("falling", "en") is True

    def test_hindi_emergency_keywords(self) -> None:
        assert detect_emergency("seene mein dard ho raha hai", "hi") is True
        assert detect_emergency("saans nahi aa rahi", "hi") is True
        assert detect_emergency("behosh ho gaya", "hi") is True

    def test_bengali_emergency_keywords(self) -> None:
        assert detect_emergency("bukey byatha hocche", "bn") is True
        assert detect_emergency("swas nite parchhi na", "bn") is True
        assert detect_emergency("gyan hariye felechhe", "bn") is True

    def test_no_emergency_in_normal_text(self) -> None:
        assert detect_emergency("my blood pressure is 120 over 80", "en") is False
        assert detect_emergency("sugar 135 hai", "hi") is False

    def test_cross_language_detection(self) -> None:
        """Emergency keywords detected even if language doesn't match."""
        assert detect_emergency("seene mein dard", "en") is True  # Hindi keyword detected in English session
        assert detect_emergency("chest pain ho raha hai", "hi") is True  # English keyword in Hindi session

    def test_emergency_triggers_action(self, client: TestClient) -> None:
        """Integration: emergency stops normal flow."""
        sid = _create_and_get_sid(client)
        resp = client.post(
            f"/sessions/{sid}/utterance",
            json={"text": "I have chest pain and can't breathe"},
        )
        body = resp.json()
        assert body["action"] == "emergency"
        assert "emergency" in body["response_text"].lower() or "caregiver" in body["response_text"].lower() or "serious" in body["response_text"].lower()

    def test_emergency_in_hindi_session(self, client: TestClient) -> None:
        sid = _create_and_get_sid(client, language="hi")
        resp = client.post(
            f"/sessions/{sid}/utterance",
            json={"text": "seene mein dard ho raha hai"},
        )
        body = resp.json()
        assert body["action"] == "emergency"

    def test_fuzzy_emergency_misspelling(self) -> None:
        """P4: Fuzzy matching catches misspelled emergency keywords."""
        # "chst pain" is close to "chest pain"
        assert detect_emergency("I have chst pain", "en") is True

    def test_fuzzy_hindi_misspelling(self) -> None:
        """P4: Fuzzy matching for transliteration variants."""
        # "seene me dard" is close to "seene mein dard"
        assert detect_emergency("seene me dard", "hi") is True

    def test_enhanced_bengali_keywords(self) -> None:
        """P4: Additional Bengali emergency keywords."""
        assert detect_emergency("jnan hariye phelchhi", "bn") is True
        assert detect_emergency("pore gechhi", "bn") is True


# ===========================================================================
# Confused patient detection (P4)
# ===========================================================================

class TestConfusedPatientDetection:
    def test_repeated_responses_detected(self) -> None:
        req = _make_session_request()
        session = SessionState(req)
        # Simulate 3 identical responses
        session.record_patient_text("what")
        session.record_patient_text("what")
        session.record_patient_text("what")
        assert _detect_confusion(session, "what") is True

    def test_varied_responses_not_detected(self) -> None:
        req = _make_session_request()
        session = SessionState(req)
        session.record_patient_text("hello")
        session.record_patient_text("my bp is 130 over 85")
        session.record_patient_text("yes correct")
        assert _detect_confusion(session, "thank you") is False

    def test_very_short_non_yesno_detected(self) -> None:
        req = _make_session_request()
        session = SessionState(req)
        assert _detect_confusion(session, "x") is True

    def test_short_yesno_not_detected(self) -> None:
        req = _make_session_request()
        session = SessionState(req)
        assert _detect_confusion(session, "ok") is False
        assert _detect_confusion(session, "ha") is False
        assert _detect_confusion(session, "no") is False

    def test_confusion_triggers_simplified_response(self, client: TestClient) -> None:
        """P4: After 3 confused turns, system offers to simplify/stop."""
        sid = _create_and_get_sid(client)
        session = _sessions[sid]
        # Pre-set confusion state
        session.confusion_count = 2
        session._recent_patient_texts = ["x", "x", "x"]

        resp = client.post(f"/sessions/{sid}/utterance", json={"text": "x"})
        body = resp.json()
        assert body["action"] == "ask_repeat"
        assert "stop" in body["response_text"].lower() or "simpler" in body["response_text"].lower() or "difficulty" in body["response_text"].lower()

    def test_confusion_count_tracked_in_session(self) -> None:
        req = _make_session_request()
        session = SessionState(req)
        assert session.confusion_count == 0


# ===========================================================================
# Code-mixing and number word extraction (P4)
# ===========================================================================

class TestNumberWordParsing:
    """P4: Parse English number words into numeric values."""

    def test_simple_numbers(self) -> None:
        assert parse_number_words("five") == 5
        assert parse_number_words("twenty") == 20
        assert parse_number_words("ninety") == 90

    def test_compound_numbers(self) -> None:
        assert parse_number_words("eighty five") == 85
        assert parse_number_words("thirty two") == 32

    def test_hundreds_pattern(self) -> None:
        assert parse_number_words("one thirty") == 130
        assert parse_number_words("one twenty") == 120
        assert parse_number_words("two fifty") == 250

    def test_full_hundreds(self) -> None:
        assert parse_number_words("one hundred thirty") == 130
        assert parse_number_words("two hundred fifty") == 250

    def test_plain_digits(self) -> None:
        assert parse_number_words("130") == 130.0

    def test_no_numbers(self) -> None:
        assert parse_number_words("hello world") is None


class TestCodeMixingExtraction:
    """P4: Extract values from code-mixed Hindi/Bengali sentences."""

    def _make_session(self, remaining: list[str]) -> SessionState:
        req = _make_session_request()
        session = SessionState(req)
        session.remaining_parameters = remaining
        return session

    def test_hindi_bp_with_english_numbers(self) -> None:
        """'mera BP one thirty over eighty five hai' -> extract 130/85."""
        session = self._make_session(["blood_pressure"])
        values = _try_extract_values(session, "mera BP one thirty over eighty five hai")
        assert len(values) == 2
        assert values[0]["value"] == 130
        assert values[1]["value"] == 85

    def test_bengali_sugar_with_english_number(self) -> None:
        """'amar sugar two hundred fifty' -> extract 250."""
        session = self._make_session(["blood_glucose"])
        values = _try_extract_values(session, "amar sugar two hundred fifty")
        assert len(values) == 1
        assert values[0]["value"] == 250

    def test_mixed_digits_and_words(self) -> None:
        """Digits still work normally even with number word support."""
        session = self._make_session(["blood_pressure"])
        values = _try_extract_values(session, "bp 130/85")
        assert len(values) == 2
        assert values[0]["value"] == 130

    def test_replace_number_words_in_bp(self) -> None:
        result = _replace_number_words_in_text("mera BP one thirty over eighty five hai")
        assert "130" in result
        assert "85" in result

    def test_replace_number_words_in_sugar(self) -> None:
        result = _replace_number_words_in_text("amar sugar two hundred fifty")
        assert "250" in result


# ===========================================================================
# Multi-language confirmation patterns
# ===========================================================================

class TestConfirmationPatterns:
    def test_english_confirmations(self) -> None:
        assert _is_confirmation("yes", "en") is True
        assert _is_confirmation("correct", "en") is True
        assert _is_confirmation("that's right", "en") is True
        assert _is_confirmation("Yeah", "en") is True

    def test_hindi_confirmations(self) -> None:
        assert _is_confirmation("haan", "hi") is True
        assert _is_confirmation("sahi hai", "hi") is True
        assert _is_confirmation("theek hai", "hi") is True
        assert _is_confirmation("bilkul", "hi") is True
        assert _is_confirmation("ji haan", "hi") is True

    def test_bengali_confirmations(self) -> None:
        assert _is_confirmation("hyan", "bn") is True
        assert _is_confirmation("thik achhe", "bn") is True
        assert _is_confirmation("sohomot", "bn") is True

    def test_english_denials(self) -> None:
        assert _is_denial("no", "en") is True
        assert _is_denial("wrong", "en") is True
        assert _is_denial("incorrect", "en") is True

    def test_hindi_denials(self) -> None:
        assert _is_denial("nahi", "hi") is True
        assert _is_denial("galat", "hi") is True
        assert _is_denial("nahi hai", "hi") is True

    def test_bengali_denials(self) -> None:
        assert _is_denial("na", "bn") is True
        assert _is_denial("bhul", "bn") is True
        assert _is_denial("thik noy", "bn") is True

    def test_not_confirmation(self) -> None:
        assert _is_confirmation("I don't know", "en") is False
        assert _is_confirmation("maybe", "en") is False

    def test_not_denial(self) -> None:
        assert _is_denial("yes", "en") is False
        assert _is_denial("okay", "en") is False

    def test_cross_language_confirmation(self) -> None:
        """Hindi word works in English session as fallback."""
        assert _is_confirmation("haan", "en") is True

    def test_hindi_confirmation_flow(self, client: TestClient) -> None:
        """Integration: Hindi confirmation words work in Hindi session."""
        sid = _create_and_get_sid(client, language="hi")
        # Report BP
        client.post(
            f"/sessions/{sid}/utterance",
            json={"text": "bp 130 over 85"},
        )
        # Confirm in Hindi
        resp = client.post(
            f"/sessions/{sid}/utterance",
            json={"text": "haan sahi hai"},
        )
        body = resp.json()
        assert body["action"] in ("ask_parameter", "session_summary")
        assert len(body["session_state"]["confirmed_values"]) == 2

    def test_bengali_confirmation_flow(self, client: TestClient) -> None:
        """Integration: Bengali confirmation words work in Bengali session."""
        sid = _create_and_get_sid(client, language="bn")
        client.post(
            f"/sessions/{sid}/utterance",
            json={"text": "bp 120 over 80"},
        )
        resp = client.post(
            f"/sessions/{sid}/utterance",
            json={"text": "thik achhe"},
        )
        body = resp.json()
        assert len(body["session_state"]["confirmed_values"]) == 2


# ===========================================================================
# Consecutive failures and fallback
# ===========================================================================

class TestFallbackText:
    def test_fallback_after_two_failures(self, client: TestClient) -> None:
        sid = _create_and_get_sid(client)

        # Report BP to get pending confirmation
        client.post(
            f"/sessions/{sid}/utterance",
            json={"text": "bp 130 over 85"},
        )

        # Two denials trigger fallback
        client.post(
            f"/sessions/{sid}/utterance",
            json={"text": "no that's wrong"},
        )
        # First denial -> ask_repeat, consecutive_failures=1

        resp = client.post(
            f"/sessions/{sid}/utterance",
            json={"text": "some unclear gibberish"},
        )
        body = resp.json()
        # At this point consecutive_failures >= 2
        assert body["action"] == "fallback_text"
        assert "type" in body["response_text"].lower()

    def test_failure_counter_resets_on_success(self, client: TestClient) -> None:
        sid = _create_and_get_sid(client)
        session = _sessions[sid]

        # Manually set failures
        session.consecutive_failures = 1

        # Successful extraction resets counter
        resp = client.post(
            f"/sessions/{sid}/utterance",
            json={"text": "bp 130 over 85"},
        )
        assert resp.json()["action"] == "confirm_value"
        assert session.consecutive_failures == 0


# ===========================================================================
# Sliding window context management
# ===========================================================================

class TestSlidingWindow:
    def test_context_turns_returns_recent_window(self) -> None:
        req = _make_session_request()
        session = SessionState(req)
        # Add more turns than the window size
        for i in range(30):
            session.add_turn("patient", f"Patient message {i}")
            session.add_turn("system", f"System response {i}")

        context = session.context_turns()
        assert len(context) == LLM_CONTEXT_WINDOW_TURNS

    def test_build_context_window_small_session(self) -> None:
        req = _make_session_request()
        session = SessionState(req)
        session.add_turn("patient", "hello")
        session.add_turn("system", "hi there")

        recent, summary = _build_context_window(session)
        assert len(recent) == 2
        assert summary == ""

    def test_build_context_window_large_session(self) -> None:
        req = _make_session_request()
        session = SessionState(req)
        for i in range(30):
            session.add_turn("patient", f"Message {i}")
            session.add_turn("system", f"Response {i}")

        recent, summary = _build_context_window(session)
        assert len(recent) == LLM_CONTEXT_WINDOW_TURNS
        assert "Earlier Conversation Summary" in summary

    def test_summarize_turns_empty(self) -> None:
        result = _summarize_turns([])
        assert result == ""

    def test_summarize_turns_with_data(self) -> None:
        turns = [
            Turn("patient", "Hello there"),
            Turn("system", "Hi! How are you?"),
        ]
        result = _summarize_turns(turns)
        assert "Patient: Hello there" in result
        assert "System: Hi! How are you?" in result

    def test_summarize_truncates_long_turns(self) -> None:
        long_text = "x" * 200
        turns = [Turn("patient", long_text)]
        result = _summarize_turns(turns)
        assert "..." in result


# ===========================================================================
# System prompt builder
# ===========================================================================

class TestSystemPrompt:
    def test_prompt_contains_language(self) -> None:
        req = _make_session_request(language="hi")
        session = SessionState(req)
        prompt = _build_system_prompt(session)
        assert "Hindi" in prompt
        assert "hi" in prompt

    def test_prompt_contains_parameters(self) -> None:
        req = _make_session_request()
        session = SessionState(req)
        prompt = _build_system_prompt(session)
        assert "blood_pressure" in prompt
        assert "blood_glucose" in prompt

    def test_prompt_contains_confirmed_values(self) -> None:
        req = _make_session_request()
        session = SessionState(req)
        session.confirmed_values.append(
            ExtractedValue(
                parameter="blood_pressure_systolic",
                loinc_code="8480-6",
                value=130,
                unit="mmHg",
                status=ValueStatus.confirmed,
            )
        )
        prompt = _build_system_prompt(session)
        assert "130" in prompt
        assert "confirmed" in prompt

    def test_prompt_contains_last_session_summary(self) -> None:
        req = _make_session_request()
        session = SessionState(req)
        prompt = _build_system_prompt(session)
        assert "Yesterday: BP 128/82" in prompt

    def test_prompt_contains_conversation_summary(self) -> None:
        req = _make_session_request()
        session = SessionState(req)
        prompt = _build_system_prompt(session, "Earlier context: patient reported headache")
        assert "Earlier context: patient reported headache" in prompt

    def test_prompt_caching(self) -> None:
        """P4: System prompt is cached and reused when state hasn't changed."""
        req = _make_session_request()
        session = SessionState(req)
        prompt1 = _build_system_prompt(session)
        prompt2 = _build_system_prompt(session)
        assert prompt1 is prompt2  # same object from cache

    def test_prompt_cache_invalidated_on_state_change(self) -> None:
        """P4: Cache is invalidated when session state changes."""
        req = _make_session_request()
        session = SessionState(req)
        prompt1 = _build_system_prompt(session)
        session.remaining_parameters.remove("blood_pressure")
        session.invalidate_prompt_cache()
        prompt2 = _build_system_prompt(session)
        assert prompt1 is not prompt2
        assert "blood_pressure" not in prompt2 or "blood_glucose" in prompt2


# ===========================================================================
# Session end
# ===========================================================================

class TestSessionEnd:
    def test_end_session(self, client: TestClient) -> None:
        resp = client.post("/sessions", json=_create_session_payload())
        sid = resp.json()["session_id"]

        resp = client.post(f"/sessions/{sid}/end", json={"reason": "user_stopped"})
        assert resp.status_code == 200
        body = resp.json()

        assert body["session_id"] == sid
        assert body["state"] == "ended"
        assert "summary" in body
        assert "full_transcript" in body

    def test_end_session_cleans_up_memory(self, client: TestClient) -> None:
        resp = client.post("/sessions", json=_create_session_payload())
        sid = resp.json()["session_id"]
        assert sid in _sessions

        client.post(f"/sessions/{sid}/end", json={"reason": "user_stopped"})
        assert sid not in _sessions

    def test_end_session_summary_schema(self, client: TestClient) -> None:
        resp = client.post("/sessions", json=_create_session_payload())
        sid = resp.json()["session_id"]

        resp = client.post(f"/sessions/{sid}/end", json={"reason": "user_stopped"})
        summary = resp.json()["summary"]

        assert "confirmed_values" in summary
        assert "missed_parameters" in summary
        assert "topics_addressed" in summary
        assert "turn_count" in summary
        assert "language" in summary
        assert "duration_ms" in summary
        assert "status" in summary

    def test_end_session_transcript_schema(self, client: TestClient) -> None:
        resp = client.post("/sessions", json=_create_session_payload())
        sid = resp.json()["session_id"]
        client.post(f"/sessions/{sid}/utterance", json={"text": "hello"})

        resp = client.post(f"/sessions/{sid}/end", json={"reason": "user_stopped"})
        transcript = resp.json()["full_transcript"]
        assert len(transcript) >= 2
        assert transcript[0]["role"] in ("system", "patient")
        assert "turn" in transcript[0]
        assert "text" in transcript[0]

    def test_end_session_with_confirmed_values_shows_complete(self, client: TestClient) -> None:
        """If all params captured, status is complete."""
        sid = _create_and_get_sid(client)

        # Complete BP
        client.post(f"/sessions/{sid}/utterance", json={"text": "bp 120 over 80"})
        client.post(f"/sessions/{sid}/utterance", json={"text": "yes"})

        # Complete glucose
        client.post(f"/sessions/{sid}/utterance", json={"text": "sugar 135"})
        client.post(f"/sessions/{sid}/utterance", json={"text": "correct"})

        resp = client.post(f"/sessions/{sid}/end", json={"reason": "all_captured"})
        assert resp.json()["summary"]["status"] == "complete"
        assert resp.json()["summary"]["missed_parameters"] == []


# ===========================================================================
# Pause / Resume
# ===========================================================================

class TestSessionPauseResume:
    def test_pause_session(self, client: TestClient) -> None:
        resp = client.post("/sessions", json=_create_session_payload())
        sid = resp.json()["session_id"]

        resp = client.post(f"/sessions/{sid}/pause")
        assert resp.status_code == 200
        body = resp.json()
        assert body["state"] == "paused"
        assert body["timeout_seconds"] == 300

    def test_resume_session(self, client: TestClient) -> None:
        resp = client.post("/sessions", json=_create_session_payload())
        sid = resp.json()["session_id"]

        client.post(f"/sessions/{sid}/pause")
        resp = client.post(f"/sessions/{sid}/resume")
        assert resp.status_code == 200
        body = resp.json()
        assert body["state"] == "active"
        assert "response_text" in body

    def test_resume_expired_session_returns_410(self, client: TestClient) -> None:
        resp = client.post("/sessions", json=_create_session_payload())
        sid = resp.json()["session_id"]

        client.post(f"/sessions/{sid}/pause")
        # Manually expire the session
        _sessions[sid].paused_at = datetime(2020, 1, 1, tzinfo=timezone.utc)

        resp = client.post(f"/sessions/{sid}/resume")
        assert resp.status_code == 410
        assert resp.json()["error"] == "session_expired"

    def test_cannot_pause_paused_session(self, client: TestClient) -> None:
        resp = client.post("/sessions", json=_create_session_payload())
        sid = resp.json()["session_id"]

        client.post(f"/sessions/{sid}/pause")
        resp = client.post(f"/sessions/{sid}/pause")
        assert resp.status_code == 409

    def test_utterance_on_paused_session_returns_409(self, client: TestClient) -> None:
        resp = client.post("/sessions", json=_create_session_payload())
        sid = resp.json()["session_id"]

        client.post(f"/sessions/{sid}/pause")
        resp = client.post(f"/sessions/{sid}/utterance", json={"text": "hello"})
        assert resp.status_code == 409


# ===========================================================================
# Session timeout cleanup
# ===========================================================================

class TestSessionTimeout:
    def test_paused_session_marked_as_timed_out(self, client: TestClient) -> None:
        """Verify that the resume endpoint correctly detects expired sessions."""
        resp = client.post("/sessions", json=_create_session_payload())
        sid = resp.json()["session_id"]

        client.post(f"/sessions/{sid}/pause")
        _sessions[sid].paused_at = datetime(2020, 1, 1, tzinfo=timezone.utc)

        resp = client.post(f"/sessions/{sid}/resume")
        assert resp.status_code == 410

    def test_session_state_includes_paused_at(self, client: TestClient) -> None:
        resp = client.post("/sessions", json=_create_session_payload())
        sid = resp.json()["session_id"]

        client.post(f"/sessions/{sid}/pause")
        session = _sessions[sid]
        assert session.paused_at is not None
        assert session.state == "paused"


# ===========================================================================
# Topics flow
# ===========================================================================

class TestTopics:
    def test_topics_asked_after_all_params_captured(self, client: TestClient) -> None:
        """When all parameters are done, the engine should ask about pending topics."""
        sid = _create_session_with_topics(client)

        # Complete BP
        client.post(f"/sessions/{sid}/utterance", json={"text": "bp 120 over 80"})
        client.post(f"/sessions/{sid}/utterance", json={"text": "yes"})

        # Complete glucose
        client.post(f"/sessions/{sid}/utterance", json={"text": "sugar 135"})
        resp = client.post(f"/sessions/{sid}/utterance", json={"text": "yes correct"})
        body = resp.json()
        # Should transition to ask_topic since all params are done but topics remain
        assert body["action"] == "ask_topic"
        assert "medications" in body["response_text"].lower()


# ===========================================================================
# Session state response
# ===========================================================================

class TestSessionStateResponse:
    def test_session_state_response_format(self) -> None:
        req = _make_session_request()
        session = SessionState(req)
        session.add_turn("patient", "hello")

        state = session.session_state_response()
        assert state.confirmed_values == []
        assert state.pending_confirmation == []
        assert "blood_pressure" in state.remaining_parameters
        assert state.turn_count == 1

    def test_session_state_after_confirmation(self) -> None:
        req = _make_session_request()
        session = SessionState(req)
        session.confirmed_values.append(
            ExtractedValue(
                parameter="blood_pressure_systolic",
                loinc_code="8480-6",
                value=130,
                unit="mmHg",
                status=ValueStatus.confirmed,
            )
        )
        state = session.session_state_response()
        assert len(state.confirmed_values) == 1
        assert state.confirmed_values[0].parameter == "blood_pressure_systolic"
