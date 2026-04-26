"""CareLog LLM (Conversation Engine) Service — port 8002.

Manages conversational sessions with in-memory state, parameter extraction,
plausibility validation, multi-turn context management, emergency detection,
and multi-language confirmation flows.

P4 enhancements: latency optimisation (inference timing, compiled regex,
cached system prompts), soft/hard implausibility, enhanced emergency detection
with fuzzy matching, confused-patient handling, and code-mixing number-word
extraction.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import shutil
import time
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from difflib import SequenceMatcher
from functools import lru_cache
from pathlib import Path
from typing import Any, AsyncIterator, Optional

import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse

from shared.config import (
    LLM_CONTEXT_LIMIT_WARN_FRACTION,
    LLM_CONTEXT_WINDOW_TURNS,
    LLM_MAX_CONTEXT_TOKENS,
    LLM_MODEL_PATH,
    LLM_PORT,
    SESSION_TIMEOUT_SECONDS,
    SUPPORTED_LANGUAGES,
    TMP_DIR,
)
from shared.models import (
    Action,
    CreateSessionRequest,
    CreateSessionResponse,
    EndReason,
    EndSessionRequest,
    EndSessionResponse,
    ExtractedValue,
    PauseSessionResponse,
    ResumeSessionResponse,
    SessionStateResponse,
    SessionSummary,
    TranscriptTurn,
    UtteranceRequest,
    UtteranceResponse,
    ValueStatus,
)

logger = logging.getLogger("carelog.llm")

# ============================================================
# Constants
# ============================================================

# Maximum session age regardless of state (30 minutes)
MAX_SESSION_AGE_SECONDS: int = 1800

# ============================================================
# Plausibility ranges (from spec Section 6.3) — now with soft/hard
# ============================================================
# "soft" = outside normal but physiologically possible (warn + confirm)
# "hard" = outside physiological range (reject outright)
PLAUSIBILITY_RANGES: dict[str, dict[str, Any]] = {
    "blood_pressure_systolic": {
        "min": 60, "max": 250, "unit": "mmHg",
        "soft_min": 90, "soft_max": 180,   # normal range
        "hard_min": 40, "hard_max": 300,   # physiological limits
    },
    "blood_pressure_diastolic": {
        "min": 30, "max": 150, "unit": "mmHg",
        "soft_min": 60, "soft_max": 120,
        "hard_min": 20, "hard_max": 200,
    },
    "blood_glucose": {
        "min": 20, "max": 600, "unit": "mg/dL",
        "soft_min": 60, "soft_max": 300,
        "hard_min": 10, "hard_max": 800,
    },
    "body_temperature_f": {
        "min": 90, "max": 110, "unit": "degF",
        "soft_min": 96, "soft_max": 103,
        "hard_min": 85, "hard_max": 115,
    },
    "body_temperature_c": {
        "min": 32, "max": 43, "unit": "degC",
        "soft_min": 35.5, "soft_max": 39.5,
        "hard_min": 29, "hard_max": 46,
    },
    "spo2": {
        "min": 50, "max": 100, "unit": "%",
        "soft_min": 90, "soft_max": 100,
        "hard_min": 30, "hard_max": 100,
    },
    "heart_rate": {
        "min": 30, "max": 250, "unit": "/min",
        "soft_min": 50, "soft_max": 120,
        "hard_min": 20, "hard_max": 300,
    },
    "body_weight": {
        "min": 10, "max": 300, "unit": "kg",
        "soft_min": 30, "soft_max": 200,
        "hard_min": 5, "hard_max": 400,
    },
}


def is_plausible(parameter: str, value: float) -> bool:
    """Check whether an extracted value falls within physiological limits.

    Returns True if inside the original [min, max] range (backward-compatible).
    """
    bounds = PLAUSIBILITY_RANGES.get(parameter)
    if bounds is None:
        return True  # unknown parameter — accept
    return bounds["min"] <= value <= bounds["max"]


def classify_plausibility(parameter: str, value: float) -> str:
    """Classify a value as 'ok', 'soft' (warn), or 'hard' (reject).

    - 'ok': within normal clinical range
    - 'soft': outside normal but physiologically possible
    - 'hard': outside physiological range — must reject
    """
    bounds = PLAUSIBILITY_RANGES.get(parameter)
    if bounds is None:
        return "ok"

    hard_min = bounds.get("hard_min", bounds["min"])
    hard_max = bounds.get("hard_max", bounds["max"])
    soft_min = bounds.get("soft_min", bounds["min"])
    soft_max = bounds.get("soft_max", bounds["max"])

    if value < hard_min or value > hard_max:
        return "hard"
    if value < soft_min or value > soft_max:
        return "soft"
    return "ok"


def detect_value_jump(
    parameter: str, new_value: float, previous_values: list[ExtractedValue],
) -> bool:
    """Return True if new_value differs from the most recent confirmed value
    for the same parameter by more than 40 %."""
    for v in reversed(previous_values):
        if v.parameter == parameter:
            if v.value == 0:
                return False
            pct = abs(new_value - v.value) / v.value
            return pct > 0.40
    return False


# ============================================================
# Number-word parsing for code-mixing
# ============================================================

_NUMBER_WORDS: dict[str, int] = {
    "zero": 0, "one": 1, "two": 2, "three": 3, "four": 4,
    "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9,
    "ten": 10, "eleven": 11, "twelve": 12, "thirteen": 13,
    "fourteen": 14, "fifteen": 15, "sixteen": 16, "seventeen": 17,
    "eighteen": 18, "nineteen": 19, "twenty": 20, "thirty": 30,
    "forty": 40, "fifty": 50, "sixty": 60, "seventy": 70,
    "eighty": 80, "ninety": 90, "hundred": 100,
}


def parse_number_words(text: str) -> Optional[float]:
    """Parse English number words into a numeric value.

    Handles patterns like:
    - "one thirty" -> 130
    - "eighty five" -> 85
    - "two hundred fifty" -> 250
    - "one hundred thirty" -> 130
    """
    words = text.lower().strip().split()
    if not words:
        return None

    # Try direct integer parse first
    try:
        return float(text.strip())
    except ValueError:
        pass

    total = 0
    current = 0
    found_any = False

    for w in words:
        val = _NUMBER_WORDS.get(w)
        if val is None:
            # skip non-number words
            continue
        found_any = True
        if val == 100:
            # "one hundred", "two hundred"
            current = (current if current > 0 else 1) * 100
        elif val >= 10 and current >= 100:
            # "one hundred thirty" -> 100 + 30
            total += current
            current = val
        elif val >= 10:
            # "thirty", "eighty" etc.
            if current > 0 and current < 10:
                # "one thirty" pattern -> 1*100 + 30 = 130
                current = current * 100 + val
            else:
                current += val
        else:
            # units digit: "five", "eight"
            current += val

    if not found_any:
        return None

    total += current
    return float(total) if total > 0 else None


def _replace_number_words_in_text(text: str) -> str:
    """Replace number word sequences in text with digits for extraction.

    Handles code-mixing like:
    "mera BP one thirty over eighty five hai" -> "mera BP 130 over 85 hai"
    "amar sugar two hundred fifty" -> "amar sugar 250"
    """
    number_word_set = set(_NUMBER_WORDS.keys())
    words = text.lower().split()
    result: list[str] = []
    i = 0

    while i < len(words):
        if words[i] in number_word_set:
            # Collect consecutive number words
            start = i
            while i < len(words) and words[i] in number_word_set:
                i += 1
            number_text = " ".join(words[start:i])
            parsed = parse_number_words(number_text)
            if parsed is not None:
                int_val = int(parsed) if parsed == int(parsed) else parsed
                result.append(str(int_val))
            else:
                # Could not parse — keep original words
                result.extend(words[start:i])
        else:
            result.append(words[i])
            i += 1

    return " ".join(result)


# ============================================================
# Language-specific patterns — compiled regex sets for speed
# ============================================================

# Confirmation patterns per language
CONFIRMATION_PATTERNS: dict[str, set[str]] = {
    "en": {"yes", "correct", "right", "that's right", "thats right", "yeah", "yep", "ok", "okay"},
    "hi": {"haan", "ha", "sahi hai", "theek hai", "bilkul", "sahi", "theek", "ji haan", "ji"},
    "bn": {"hyan", "thik achhe", "sohomot", "ha", "haan", "thik", "ji"},
}

# Pre-compiled confirmation regex per language for fast matching
_COMPILED_CONFIRMATION: dict[str, re.Pattern] = {}
_COMPILED_DENIAL: dict[str, re.Pattern] = {}

# Denial patterns per language
DENIAL_PATTERNS: dict[str, set[str]] = {
    "en": {"no", "wrong", "incorrect", "not right", "nope", "that's wrong", "thats wrong"},
    "hi": {"nahi", "galat", "nahi hai", "galat hai", "nahin"},
    "bn": {"na", "bhul", "thik noy", "na na"},
}


def _compile_pattern_sets() -> None:
    """Pre-compile confirmation/denial patterns as regex for fast matching."""
    for lang, patterns in CONFIRMATION_PATTERNS.items():
        escaped = [re.escape(p) for p in sorted(patterns, key=len, reverse=True)]
        _COMPILED_CONFIRMATION[lang] = re.compile(
            r"(?:^|\b)(?:" + "|".join(escaped) + r")(?:\b|$)", re.IGNORECASE
        )
    for lang, patterns in DENIAL_PATTERNS.items():
        escaped = [re.escape(p) for p in sorted(patterns, key=len, reverse=True)]
        _COMPILED_DENIAL[lang] = re.compile(
            r"(?:^|\b)(?:" + "|".join(escaped) + r")(?:\b|$)", re.IGNORECASE
        )


_compile_pattern_sets()

# Emergency keywords per language — enhanced set
EMERGENCY_KEYWORDS: dict[str, list[str]] = {
    "en": [
        "chest pain", "can't breathe", "cannot breathe", "cant breathe",
        "falling", "fell down", "unconscious", "fainted", "heart attack",
        "stroke", "seizure", "choking", "severe pain", "bleeding heavily",
    ],
    "hi": [
        "seene mein dard", "saans nahi aa rahi", "gir gaya", "gir gayi",
        "behosh", "behosh ho gaya", "dil ka daura", "bahut dard",
        "tez dard", "khoon bah raha hai", "saans nahi le pa raha",
        "saans nahi le pa rahi", "chakkar aa raha hai",
    ],
    "bn": [
        "bukey byatha", "swas nite parchhi na", "pore gechi", "pore gechhe",
        "gyan hariye felechhe", "gyan nei", "hridroghe", "khub byatha",
        "rokto porchhe", "swas bondho", "matha ghurchhe",
        "jnan hariye phelchhi", "pore gechhi",
    ],
}

# Language display names for prompt templates
LANGUAGE_NAMES: dict[str, str] = {
    "en": "English",
    "hi": "Hindi",
    "bn": "Bengali",
}


# ============================================================
# System prompt template (spec Section 6.2.1)
# ============================================================

PATIENT_LOGGING_SYSTEM_PROMPT = """\
You are CareLog, a compassionate and patient health companion for elderly patients.
You help patients log their daily health measurements through natural conversation.

## Your Personality
- Warm, respectful, and empathetic
- Address the patient by name with appropriate honorifics (e.g., "रमेश जी" in Hindi)
- Never sound clinical, robotic, or impatient
- Celebrate small wins ("Very good! That's a healthy reading.")

## Language Rules
- Respond ONLY in {language} ({language_name})
- The patient may use English medical terms mixed into {language_name} — this is normal
- Always use the patient's name in your responses

## Your Task
You are conducting a health check-in conversation. The patient needs to log these measurements today:

### Required Parameters:
{parameters_list}

### Already Captured This Session:
{confirmed_values}

### Pending Confirmation:
{pending_values}

### Still Needed:
{remaining_parameters}

### Last Session Context:
{last_session_summary}

{conversation_summary}

## Conversation Rules
1. Start with a warm, open-ended greeting. Ask how they are feeling.
2. LISTEN to what the patient says. Extract any health values mentioned.
3. Confirm EACH value individually: read it back and ask if it's correct.
4. If a value seems implausible (e.g., BP > 250 or < 50), flag it gently:
   "That seems unusual. Could you please check the reading again?"
5. If the patient mentions measuring something but doesn't know the value,
   suggest taking a photo of the device display.
6. Ask about ONE missing parameter at a time. Never list multiple.
7. If the patient mentions a symptom NOT in the required parameters,
   acknowledge it and note it as a free-text observation.
8. If the patient expresses distress, pain, or emergency keywords
   (chest pain, can't breathe, falling, unconscious), immediately:
   - Advise them to contact their caregiver or call emergency services
   - Do NOT continue normal logging
9. After 2 failed attempts to understand the patient, suggest they type instead.
10. When all parameters are captured, give a brief summary and a warm closing.

## Output Format
For each response, you must produce valid JSON with these fields:
- response_text: Your spoken response in {language_name}
- extracted_values: Array of {{parameter, loinc_code, value, unit, status}}
- action: One of [greeting, confirm_value, ask_parameter, suggest_photo,
  ask_topic, implausible_value, emergency, session_summary, ask_repeat, fallback_text]
- requires_photo: boolean

Respond ONLY with valid JSON matching the schema above.
"""


# ============================================================
# In-memory session store
# ============================================================

class Turn:
    __slots__ = ("role", "text", "timestamp")

    def __init__(self, role: str, text: str) -> None:
        self.role = role
        self.text = text
        self.timestamp = datetime.now(timezone.utc)

    def to_dict(self) -> dict[str, Any]:
        return {"role": self.role, "text": self.text, "timestamp": self.timestamp.isoformat()}


class SessionState:
    """In-memory session object — see spec Section 6.4."""

    def __init__(self, request: CreateSessionRequest) -> None:
        self.session_id: str = str(uuid.uuid4())
        self.session_type: str = request.session_type
        self.patient_id: str = request.patient_id
        self.language: str = request.language
        self.config = request.config

        # Conversation history
        self.turns: list[Turn] = []

        # Summarised context for turns that have fallen out of the sliding window
        self.conversation_summary: str = ""

        # Parameter tracking
        self.confirmed_values: list[ExtractedValue] = []
        self.pending_confirmation: list[ExtractedValue] = []
        self.remaining_parameters: list[str] = [p.name for p in request.config.parameters]

        # Topic tracking
        self.topics_addressed: list[str] = []

        # Retry tracking
        self.consecutive_failures: int = 0

        # Confusion tracking (P4 edge case)
        self.confusion_count: int = 0
        self._recent_patient_texts: list[str] = []

        # State
        self.state: str = "active"
        self.paused_at: Optional[datetime] = None
        self.created_at: datetime = datetime.now(timezone.utc)
        self.last_activity: datetime = datetime.now(timezone.utc)
        self.turn_count: int = 0

        # Cached system prompt (P4 optimisation) — invalidated when session state changes
        self._cached_prompt: Optional[str] = None
        self._cached_prompt_key: Optional[str] = None

    def touch(self) -> None:
        self.last_activity = datetime.now(timezone.utc)

    def invalidate_prompt_cache(self) -> None:
        self._cached_prompt = None
        self._cached_prompt_key = None

    def session_state_response(self) -> SessionStateResponse:
        return SessionStateResponse(
            confirmed_values=list(self.confirmed_values),
            pending_confirmation=[v.parameter for v in self.pending_confirmation],
            remaining_parameters=list(self.remaining_parameters),
            topics_addressed=list(self.topics_addressed),
            turn_count=self.turn_count,
        )

    def add_turn(self, role: str, text: str) -> None:
        self.turns.append(Turn(role, text))
        self.turn_count += 1
        self.touch()
        self.invalidate_prompt_cache()

    def record_patient_text(self, text: str) -> None:
        """Track recent patient texts for confusion detection."""
        self._recent_patient_texts.append(text.strip().lower())
        # Keep only last 5
        if len(self._recent_patient_texts) > 5:
            self._recent_patient_texts = self._recent_patient_texts[-5:]

    def context_turns(self) -> list[Turn]:
        """Return the sliding-window of recent turns for LLM context."""
        return self.turns[-LLM_CONTEXT_WINDOW_TURNS:]

    @property
    def tmp_dir(self) -> Path:
        return TMP_DIR / self.session_id


# Global session store — single dict, keyed by session_id
_sessions: dict[str, SessionState] = {}

# Global model state
_model: Any = None
_model_name: str = "qwen-2.5-7b-q4"
_start_time: float = 0.0


# ============================================================
# Model loading
# ============================================================

def _load_model() -> bool:
    global _model, _start_time
    _start_time = time.time()

    if not LLM_MODEL_PATH.exists():
        logger.warning("LLM model path does not exist: %s — service will return 503", LLM_MODEL_PATH)
        return False

    try:
        # ------------------------------------------------------------------
        # Production implementation:
        #   from llama_cpp import Llama
        #   _model = Llama(
        #       model_path=str(LLM_MODEL_PATH / "model.gguf"),
        #       n_ctx=4096,
        #       n_gpu_layers=-1,
        #   )
        # ------------------------------------------------------------------
        _model = "loaded"
        logger.info("LLM model loaded from %s", LLM_MODEL_PATH)
        return True
    except Exception:
        logger.exception("Failed to load LLM model")
        return False


def _model_ready() -> bool:
    return _model is not None


# ============================================================
# Emergency detection — enhanced with fuzzy matching
# ============================================================

def _fuzzy_match(text: str, keyword: str, threshold: float = 0.80) -> bool:
    """Check if any substring of `text` fuzzy-matches `keyword`."""
    kw_len = len(keyword)
    text = text.lower()
    # Slide a window across text
    for start in range(len(text)):
        end = min(len(text), start + kw_len + 3)
        # Skip windows that are too short to meaningfully match
        if end - start < max(kw_len - 2, 3):
            continue
        window = text[start:end]
        ratio = SequenceMatcher(None, keyword, window).ratio()
        if ratio >= threshold:
            return True
    return False


def detect_emergency(text: str, language: str) -> bool:
    """Check if the utterance contains emergency keywords in any supported language.

    We always check all languages because patients may code-switch.
    Uses exact substring match first, then fuzzy matching for misspellings.
    """
    text_lower = text.lower()
    for lang in SUPPORTED_LANGUAGES:
        keywords = EMERGENCY_KEYWORDS.get(lang, [])
        for keyword in keywords:
            # Exact substring match (fast path)
            if keyword in text_lower:
                return True
            # Fuzzy match for misspellings/transliterations (only for multi-word keywords)
            if len(keyword) > 4 and _fuzzy_match(text_lower, keyword, threshold=0.75):
                return True
    return False


# ============================================================
# Confused patient detection (P4 edge case)
# ============================================================

def _detect_confusion(session: SessionState, text: str) -> bool:
    """Detect signs of patient confusion.

    Signs:
    - Repeated identical responses (3+ consecutive)
    - Very short responses (< 3 chars, not yes/no)
    - Off-topic: not a confirmation, denial, value, or keyword
    """
    recent = session._recent_patient_texts
    text_lower = text.strip().lower()

    # Check for repeated identical responses (3+ in a row)
    if len(recent) >= 3 and all(r == text_lower for r in recent[-3:]):
        return True

    # Very short / empty response that isn't a simple yes/no
    if len(text_lower) <= 2:
        if text_lower not in {"ok", "ha", "na", "no", "ji"}:
            return True

    return False


# ============================================================
# Confirmation / denial detection — using compiled regex
# ============================================================

def _is_confirmation(text: str, language: str) -> bool:
    """Check if the patient's utterance is an affirmative confirmation."""
    text_stripped = text.strip()
    # Check the session language first, then all languages as fallback
    langs_to_check = [language] + [l for l in SUPPORTED_LANGUAGES if l != language]
    for lang in langs_to_check:
        pattern = _COMPILED_CONFIRMATION.get(lang)
        if pattern and pattern.search(text_stripped):
            return True
    return False


def _is_denial(text: str, language: str) -> bool:
    """Check if the patient's utterance is a denial/correction signal."""
    text_stripped = text.strip()
    langs_to_check = [language] + [l for l in SUPPORTED_LANGUAGES if l != language]
    for lang in langs_to_check:
        pattern = _COMPILED_DENIAL.get(lang)
        if pattern and pattern.search(text_stripped):
            return True
    return False


# ============================================================
# Sliding window context management (Epic 1.3.3)
# ============================================================

def _summarize_turns(turns: list[Turn]) -> str:
    """Create a brief summary of older turns that have fallen out of the sliding window.

    In production the LLM itself would produce this summary. For now we build
    a simple textual recap.
    """
    if not turns:
        return ""

    lines: list[str] = []
    for t in turns:
        role_label = "Patient" if t.role == "patient" else "System"
        # Truncate long turns for the summary
        snippet = t.text[:120] + "..." if len(t.text) > 120 else t.text
        lines.append(f"  {role_label}: {snippet}")

    return "### Earlier Conversation Summary:\n" + "\n".join(lines)


def _build_context_window(session: SessionState) -> tuple[list[Turn], str]:
    """Return (recent_turns, conversation_summary) for LLM context.

    Keeps the last LLM_CONTEXT_WINDOW_TURNS turns in the context and
    summarises any older turns.
    """
    all_turns = session.turns
    window_size = LLM_CONTEXT_WINDOW_TURNS

    if len(all_turns) <= window_size:
        return all_turns, session.conversation_summary

    # Turns that fall outside the window
    older_turns = all_turns[:-window_size]
    recent_turns = all_turns[-window_size:]

    # Update the running summary with newly-evicted turns.
    # We only summarise turns that haven't been summarised yet.
    if session.conversation_summary:
        # Append to existing summary
        new_summary = _summarize_turns(older_turns)
        conversation_summary = session.conversation_summary + "\n" + new_summary
    else:
        conversation_summary = _summarize_turns(older_turns)

    # Store back on the session so we don't re-summarise
    session.conversation_summary = conversation_summary

    return recent_turns, conversation_summary


# ============================================================
# System prompt builder — with caching
# ============================================================

def _prompt_cache_key(session: SessionState, conversation_summary: str) -> str:
    """Generate a cache key based on mutable session state that affects the prompt."""
    parts = [
        session.language,
        str(len(session.confirmed_values)),
        str(len(session.pending_confirmation)),
        ",".join(session.remaining_parameters),
        str(len(conversation_summary)),
    ]
    return "|".join(parts)


def _build_system_prompt(session: SessionState, conversation_summary: str = "") -> str:
    """Construct the system prompt from the template, filling in session state.

    Uses a per-session cache: if the session state hasn't changed since the last
    call, the cached prompt is returned without rebuilding.
    """
    cache_key = _prompt_cache_key(session, conversation_summary)
    if session._cached_prompt_key == cache_key and session._cached_prompt is not None:
        return session._cached_prompt

    # Build parameters list
    params_list_parts = []
    for p in session.config.parameters:
        params_list_parts.append(f"- {p.name} ({p.unit}) [LOINC: {', '.join(p.loinc_codes)}]")
    parameters_list = "\n".join(params_list_parts) if params_list_parts else "None"

    # Build confirmed values
    confirmed_parts = []
    for v in session.confirmed_values:
        confirmed_parts.append(f"- {v.parameter}: {v.value} {v.unit} (confirmed)")
    confirmed_values = "\n".join(confirmed_parts) if confirmed_parts else "None yet"

    # Build pending values
    pending_parts = []
    for v in session.pending_confirmation:
        pending_parts.append(f"- {v.parameter}: {v.value} {v.unit} (awaiting confirmation)")
    pending_values = "\n".join(pending_parts) if pending_parts else "None"

    # Remaining parameters
    remaining = "\n".join(f"- {p}" for p in session.remaining_parameters) if session.remaining_parameters else "None — all captured!"

    # Last session summary
    last_summary = session.config.last_session_summary or "No previous session data"

    # Conversation summary block
    summary_block = f"\n### Conversation History Summary:\n{conversation_summary}" if conversation_summary else ""

    language = session.language
    language_name = LANGUAGE_NAMES.get(language, "English")

    prompt = PATIENT_LOGGING_SYSTEM_PROMPT.format(
        language=language,
        language_name=language_name,
        parameters_list=parameters_list,
        confirmed_values=confirmed_values,
        pending_values=pending_values,
        remaining_parameters=remaining,
        last_session_summary=last_summary,
        conversation_summary=summary_block,
    )

    # Cache
    session._cached_prompt = prompt
    session._cached_prompt_key = cache_key

    # Prompt length tracking
    approx_tokens = len(prompt.split())  # rough word-based estimate
    if approx_tokens > LLM_MAX_CONTEXT_TOKENS * LLM_CONTEXT_LIMIT_WARN_FRACTION:
        logger.warning(
            "Session %s: system prompt approaching context limit (~%d words, limit %d tokens)",
            session.session_id, approx_tokens, LLM_MAX_CONTEXT_TOKENS,
        )

    return prompt


# ============================================================
# LLM inference (Epic 1.3.2)
# ============================================================

def _build_messages_array(session: SessionState) -> list[dict[str, str]]:
    """Build the messages array for LLM chat completion.

    Structure: [system_prompt, ...sliding_window_turns]
    """
    recent_turns, conversation_summary = _build_context_window(session)
    system_prompt = _build_system_prompt(session, conversation_summary)

    messages: list[dict[str, str]] = [
        {"role": "system", "content": system_prompt},
    ]

    for turn in recent_turns:
        role = "user" if turn.role == "patient" else "assistant"
        messages.append({"role": role, "content": turn.text})

    return messages


def _generate_llm_response(session: SessionState, utterance_text: str) -> dict[str, Any]:
    """Call the loaded LLM model and return parsed response.

    In production this calls llama-cpp-python or similar. For now it returns
    a structured mock response that implements the state machine logic,
    allowing the full conversation flow to work without a real model.
    """
    messages = _build_messages_array(session)

    # ------------------------------------------------------------------
    # Production implementation:
    #   response = _model.create_chat_completion(
    #       messages=messages,
    #       response_format={"type": "json_object"},
    #       max_tokens=512,
    #       temperature=0.7,
    #   )
    #   content = response["choices"][0]["message"]["content"]
    #   return json.loads(content)
    # ------------------------------------------------------------------

    # Mock implementation: use rule-based logic to simulate LLM output
    return _rule_based_response(session, utterance_text)


def _rule_based_response(session: SessionState, text: str) -> dict[str, Any]:
    """Rule-based mock that simulates LLM output for the conversation state machine.

    This is the fallback/testing implementation. In production the LLM generates
    the JSON response directly.
    """
    name = session.config.patient_name or "Patient"
    language = session.language

    # 0. Check for confusion (P4)
    if _detect_confusion(session, text):
        session.confusion_count += 1
    else:
        session.confusion_count = 0

    if session.confusion_count >= 3:
        return {
            "response_text": _confused_patient_response(name, language),
            "extracted_values": [],
            "action": Action.ask_repeat.value,
            "requires_photo": False,
        }

    # 1. Check for emergency keywords
    if detect_emergency(text, language):
        return {
            "response_text": _emergency_response(name, language),
            "extracted_values": [],
            "action": Action.emergency.value,
            "requires_photo": False,
        }

    # 2. Check for consecutive failures -> fallback to text
    if session.consecutive_failures >= 2:
        return {
            "response_text": _fallback_text_response(name, language),
            "extracted_values": [],
            "action": Action.fallback_text.value,
            "requires_photo": False,
        }

    # 3. If there are pending confirmations, handle confirmation flow
    if session.pending_confirmation:
        return _handle_confirmation(session, text, name, language)

    # 4. Try to extract values from the utterance (with code-mixing support)
    extracted = _try_extract_values(session, text)

    if extracted:
        # Check plausibility — enhanced soft/hard classification
        hard_implausible = []
        soft_implausible = []
        jump_warnings = []
        ok_values = []

        for v in extracted:
            classification = classify_plausibility(v["parameter"], v["value"])
            if classification == "hard":
                hard_implausible.append(v)
            elif classification == "soft":
                soft_implausible.append(v)
                # Also check for value jumps on soft values
                if detect_value_jump(v["parameter"], v["value"], session.confirmed_values):
                    jump_warnings.append(v)
                ok_values.append(v)  # soft values are still extractable
            else:
                # Check for large jumps even within normal range
                if detect_value_jump(v["parameter"], v["value"], session.confirmed_values):
                    jump_warnings.append(v)
                ok_values.append(v)

        if hard_implausible:
            return {
                "response_text": _hard_implausible_response(hard_implausible, name, language),
                "extracted_values": [],
                "action": Action.implausible_value.value,
                "requires_photo": False,
            }

        # For soft implausible or jumps, still extract but add a warning note
        if soft_implausible or jump_warnings:
            warning_values = soft_implausible or jump_warnings
            return {
                "response_text": _soft_implausible_response(warning_values, ok_values, name, language),
                "extracted_values": ok_values,
                "action": Action.confirm_value.value,
                "requires_photo": False,
            }

        return {
            "response_text": _confirm_value_response(extracted, name, language),
            "extracted_values": extracted,
            "action": Action.confirm_value.value,
            "requires_photo": False,
        }

    # 5. No values extracted — increment failure counter and ask for next parameter
    session.consecutive_failures += 1
    if session.consecutive_failures >= 2:
        return {
            "response_text": _fallback_text_response(name, language),
            "extracted_values": [],
            "action": Action.fallback_text.value,
            "requires_photo": False,
        }

    if session.remaining_parameters:
        next_param = session.remaining_parameters[0]
        return {
            "response_text": _ask_parameter_response(next_param, name, language),
            "extracted_values": [],
            "action": Action.ask_parameter.value,
            "requires_photo": False,
        }

    # 6. All params done, check topics
    if session.config.topics:
        pending_topics = [
            t for t in session.config.topics if t.name not in session.topics_addressed
        ]
        if pending_topics:
            topic = pending_topics[0]
            return {
                "response_text": _ask_topic_response(topic.name, name, language),
                "extracted_values": [],
                "action": Action.ask_topic.value,
                "requires_photo": False,
            }

    # 7. Everything done — session summary
    return {
        "response_text": _session_summary_response(session, name, language),
        "extracted_values": [],
        "action": Action.session_summary.value,
        "requires_photo": False,
    }


# ============================================================
# Value extraction (rule-based mock) — enhanced with code-mixing
# ============================================================

# Pre-compiled extraction patterns
_BP_PATTERN = re.compile(
    r'(?:bp|blood\s*pressure|b\.p\.?)?\s*(\d{2,3})\s*(?:over|/|by)\s*(\d{2,3})',
    re.IGNORECASE,
)
_GLUCOSE_PATTERN = re.compile(
    r'(?:sugar|glucose|blood\s*sugar|blood\s*glucose)\s*(?:is|hai|level)?\s*(\d{2,3})',
    re.IGNORECASE,
)
_SPO2_PATTERN = re.compile(
    r'(?:spo2|oxygen|oxygen\s*level|o2)\s*(?:is|hai)?\s*(\d{2,3})',
    re.IGNORECASE,
)
_HR_PATTERN = re.compile(
    r'(?:heart\s*rate|pulse|hr)\s*(?:is|hai)?\s*(\d{2,3})',
    re.IGNORECASE,
)
_TEMP_PATTERN = re.compile(
    r'(?:temperature|temp|bukhar|tapman|jor)\s*(?:is|hai)?\s*(\d{2,3}(?:\.\d)?)',
    re.IGNORECASE,
)
_WEIGHT_PATTERN = re.compile(
    r'(?:weight|vajan|wazan|\u0993\u099c\u09a8)\s*(?:is|hai)?\s*(\d{2,3}(?:\.\d)?)',
    re.IGNORECASE,
)


def _try_extract_values(session: SessionState, text: str) -> list[dict[str, Any]]:
    """Attempt to extract health values from patient utterance using regex patterns.

    Enhanced with code-mixing support: number words in English within Hindi/Bengali
    are first converted to digits.
    """
    # P4: Replace English number words with digits before extraction
    processed_text = _replace_number_words_in_text(text)

    extracted: list[dict[str, Any]] = []

    # Build a lookup from parameter name to config
    param_configs = {p.name: p for p in session.config.parameters}

    # BP pattern: "130 over 85", "130/85", "bp 130 85"
    bp_match = _BP_PATTERN.search(processed_text)
    if bp_match and "blood_pressure" in session.remaining_parameters:
        systolic = float(bp_match.group(1))
        diastolic = float(bp_match.group(2))
        bp_config = param_configs.get("blood_pressure")
        loinc_codes = bp_config.loinc_codes if bp_config else ["8480-6", "8462-4"]
        extracted.append({
            "parameter": "blood_pressure_systolic",
            "loinc_code": loinc_codes[0] if len(loinc_codes) > 0 else "8480-6",
            "value": systolic,
            "unit": "mmHg",
            "status": ValueStatus.pending_confirmation.value,
        })
        extracted.append({
            "parameter": "blood_pressure_diastolic",
            "loinc_code": loinc_codes[1] if len(loinc_codes) > 1 else "8462-4",
            "value": diastolic,
            "unit": "mmHg",
            "status": ValueStatus.pending_confirmation.value,
        })

    # Glucose pattern: "sugar 135", "glucose 120", "blood sugar 140"
    glucose_match = _GLUCOSE_PATTERN.search(processed_text)
    if glucose_match and "blood_glucose" in session.remaining_parameters:
        value = float(glucose_match.group(1))
        glucose_config = param_configs.get("blood_glucose")
        loinc_code = glucose_config.loinc_codes[0] if glucose_config and glucose_config.loinc_codes else "2339-0"
        extracted.append({
            "parameter": "blood_glucose",
            "loinc_code": loinc_code,
            "value": value,
            "unit": "mg/dL",
            "status": ValueStatus.pending_confirmation.value,
        })

    # SpO2 pattern: "oxygen 97", "spo2 98", "oxygen level 95"
    spo2_match = _SPO2_PATTERN.search(processed_text)
    if spo2_match and "spo2" in session.remaining_parameters:
        value = float(spo2_match.group(1))
        spo2_config = param_configs.get("spo2")
        loinc_code = spo2_config.loinc_codes[0] if spo2_config and spo2_config.loinc_codes else "2708-6"
        extracted.append({
            "parameter": "spo2",
            "loinc_code": loinc_code,
            "value": value,
            "unit": "%",
            "status": ValueStatus.pending_confirmation.value,
        })

    # Heart rate pattern: "heart rate 72", "pulse 80", "hr 75"
    hr_match = _HR_PATTERN.search(processed_text)
    if hr_match and "heart_rate" in session.remaining_parameters:
        value = float(hr_match.group(1))
        hr_config = param_configs.get("heart_rate")
        loinc_code = hr_config.loinc_codes[0] if hr_config and hr_config.loinc_codes else "8867-4"
        extracted.append({
            "parameter": "heart_rate",
            "loinc_code": loinc_code,
            "value": value,
            "unit": "/min",
            "status": ValueStatus.pending_confirmation.value,
        })

    # Temperature pattern: "temperature 98.6", "temp 99", "bukhar 100"
    temp_match = _TEMP_PATTERN.search(processed_text)
    if temp_match and "body_temperature_f" in session.remaining_parameters:
        value = float(temp_match.group(1))
        temp_config = param_configs.get("body_temperature_f")
        loinc_code = temp_config.loinc_codes[0] if temp_config and temp_config.loinc_codes else "8310-5"
        extracted.append({
            "parameter": "body_temperature_f",
            "loinc_code": loinc_code,
            "value": value,
            "unit": "degF",
            "status": ValueStatus.pending_confirmation.value,
        })

    # Weight pattern: "weight 70", "vajan 65", "wazan 72"
    weight_match = _WEIGHT_PATTERN.search(processed_text)
    if weight_match and "body_weight" in session.remaining_parameters:
        value = float(weight_match.group(1))
        wt_config = param_configs.get("body_weight")
        loinc_code = wt_config.loinc_codes[0] if wt_config and wt_config.loinc_codes else "29463-7"
        extracted.append({
            "parameter": "body_weight",
            "loinc_code": loinc_code,
            "value": value,
            "unit": "kg",
            "status": ValueStatus.pending_confirmation.value,
        })

    return extracted


# ============================================================
# Confirmation flow handling
# ============================================================

def _handle_confirmation(
    session: SessionState, text: str, name: str, language: str
) -> dict[str, Any]:
    """Handle the confirmation flow when values are pending."""

    if _is_confirmation(text, language):
        # Patient confirmed — move pending to confirmed
        confirmed_now = []
        for val in session.pending_confirmation:
            confirmed = val.model_copy(update={"status": ValueStatus.confirmed})
            session.confirmed_values.append(confirmed)
            confirmed_now.append(confirmed)
            # Remove the base parameter from remaining
            # Handle BP special case: "blood_pressure" covers both systolic/diastolic
            for rp in list(session.remaining_parameters):
                if val.parameter.startswith(rp.replace("blood_pressure", "blood_pressure")):
                    pass  # handled below
            if val.parameter.startswith("blood_pressure"):
                if "blood_pressure" in session.remaining_parameters:
                    # Only remove once both systolic and diastolic are confirmed
                    bp_pending = [
                        v for v in session.pending_confirmation
                        if v.parameter.startswith("blood_pressure") and v not in [val]
                    ]
                    # All BP values confirmed (since we're confirming all pending)
                    session.remaining_parameters = [
                        r for r in session.remaining_parameters if r != "blood_pressure"
                    ]
            elif val.parameter in session.remaining_parameters:
                session.remaining_parameters.remove(val.parameter)

        session.pending_confirmation.clear()
        session.consecutive_failures = 0
        session.invalidate_prompt_cache()

        # Determine next action
        if not session.remaining_parameters:
            # Check topics
            pending_topics = [
                t for t in (session.config.topics or [])
                if t.name not in session.topics_addressed
            ]
            if pending_topics:
                response_text = _confirmed_and_ask_topic(
                    confirmed_now, pending_topics[0].name, name, language
                )
                return {
                    "response_text": response_text,
                    "extracted_values": [],
                    "action": Action.ask_topic.value,
                    "requires_photo": False,
                }
            response_text = _session_summary_response(session, name, language)
            return {
                "response_text": response_text,
                "extracted_values": [],
                "action": Action.session_summary.value,
                "requires_photo": False,
            }
        else:
            next_param = session.remaining_parameters[0]
            response_text = _confirmed_and_ask_next(confirmed_now, next_param, name, language)
            return {
                "response_text": response_text,
                "extracted_values": [],
                "action": Action.ask_parameter.value,
                "requires_photo": False,
            }

    elif _is_denial(text, language):
        # Check if the denial also contains a new value (correction pattern)
        # e.g. "no it's 125 over 80" — denial + new value = correction
        correction_values = _try_extract_values(session, text)
        if correction_values:
            # Treat as correction: replace pending with new values
            session.pending_confirmation.clear()
            session.invalidate_prompt_cache()

            # Check plausibility
            hard_implausible = [v for v in correction_values if classify_plausibility(v["parameter"], v["value"]) == "hard"]
            if hard_implausible:
                return {
                    "response_text": _hard_implausible_response(hard_implausible, name, language),
                    "extracted_values": [],
                    "action": Action.implausible_value.value,
                    "requires_photo": False,
                }

            soft_implausible = [v for v in correction_values if classify_plausibility(v["parameter"], v["value"]) == "soft"]
            if soft_implausible:
                return {
                    "response_text": _soft_implausible_response(soft_implausible, correction_values, name, language),
                    "extracted_values": correction_values,
                    "action": Action.confirm_value.value,
                    "requires_photo": False,
                }

            return {
                "response_text": _confirm_value_response(correction_values, name, language),
                "extracted_values": correction_values,
                "action": Action.confirm_value.value,
                "requires_photo": False,
            }

        # Pure denial — clear pending, ask again
        session.pending_confirmation.clear()
        session.consecutive_failures += 1
        session.invalidate_prompt_cache()

        if session.consecutive_failures >= 2:
            return {
                "response_text": _fallback_text_response(name, language),
                "extracted_values": [],
                "action": Action.fallback_text.value,
                "requires_photo": False,
            }

        return {
            "response_text": _ask_repeat_response(name, language),
            "extracted_values": [],
            "action": Action.ask_repeat.value,
            "requires_photo": False,
        }

    else:
        # Patient may be correcting with a new value — try extraction
        extracted = _try_extract_values(session, text)
        if extracted:
            # Replace pending with new values
            session.pending_confirmation.clear()
            session.invalidate_prompt_cache()

            # Check plausibility — use hard/soft classification
            hard_implausible = [v for v in extracted if classify_plausibility(v["parameter"], v["value"]) == "hard"]
            if hard_implausible:
                return {
                    "response_text": _hard_implausible_response(hard_implausible, name, language),
                    "extracted_values": [],
                    "action": Action.implausible_value.value,
                    "requires_photo": False,
                }

            soft_implausible = [v for v in extracted if classify_plausibility(v["parameter"], v["value"]) == "soft"]
            if soft_implausible:
                return {
                    "response_text": _soft_implausible_response(soft_implausible, extracted, name, language),
                    "extracted_values": extracted,
                    "action": Action.confirm_value.value,
                    "requires_photo": False,
                }

            return {
                "response_text": _confirm_value_response(extracted, name, language),
                "extracted_values": extracted,
                "action": Action.confirm_value.value,
                "requires_photo": False,
            }

        # Unclear response — ask to repeat
        session.consecutive_failures += 1
        if session.consecutive_failures >= 2:
            return {
                "response_text": _fallback_text_response(name, language),
                "extracted_values": [],
                "action": Action.fallback_text.value,
                "requires_photo": False,
            }

        return {
            "response_text": _ask_repeat_response(name, language),
            "extracted_values": [],
            "action": Action.ask_repeat.value,
            "requires_photo": False,
        }


# ============================================================
# Response text generators (multi-language)
# ============================================================

def _emergency_response(name: str, language: str) -> str:
    responses = {
        "en": (
            f"{name}, this sounds serious. Please contact your caregiver or call "
            f"emergency services immediately. I am here if you need me, but please "
            f"get help right away."
        ),
        "hi": (
            f"{name} \u091c\u0940, \u092f\u0939 \u0917\u0902\u092d\u0940\u0930 "
            f"\u0932\u0917 \u0930\u0939\u093e \u0939\u0948\u0964 \u0915\u0943\u092a\u092f\u093e "
            f"\u0924\u0941\u0930\u0902\u0924 \u0905\u092a\u0928\u0947 "
            f"\u0926\u0947\u0916\u092d\u093e\u0932\u0915\u0930\u094d\u0924\u093e \u0938\u0947 "
            f"\u0938\u0902\u092a\u0930\u094d\u0915 \u0915\u0930\u0947\u0902 \u092f\u093e "
            f"\u0906\u092a\u093e\u0924\u0915\u093e\u0932\u0940\u0928 "
            f"\u0938\u0947\u0935\u093e\u0913\u0902 \u0915\u094b \u0915\u0949\u0932 "
            f"\u0915\u0930\u0947\u0902\u0964 \u0915\u0943\u092a\u092f\u093e \u0924\u0941\u0930\u0902\u0924 "
            f"\u092e\u0926\u0926 \u0932\u0947\u0902\u0964"
        ),
        "bn": (
            f"{name}, \u098f\u099f\u09be \u0997\u09c1\u09b0\u09c1\u09a4\u09b0 "
            f"\u09ae\u09a8\u09c7 \u09b9\u099a\u09cd\u099b\u09c7\u0964 "
            f"\u0985\u09a8\u09c1\u0997\u09cd\u09b0\u09b9 \u0995\u09b0\u09c7 "
            f"\u098f\u0996\u09a8\u0987 \u0986\u09aa\u09a8\u09be\u09b0 "
            f"\u09aa\u09b0\u09bf\u099a\u09b0\u09cd\u09af\u09be\u0995\u09be\u09b0\u09c0\u09b0 "
            f"\u09b8\u09be\u09a5\u09c7 \u09af\u09cb\u0997\u09be\u09af\u09cb\u0997 "
            f"\u0995\u09b0\u09c1\u09a8 \u09ac\u09be \u099c\u09b0\u09c1\u09b0\u09bf "
            f"\u09b8\u09c7\u09ac\u09be\u09df \u0995\u09b2 \u0995\u09b0\u09c1\u09a8\u0964"
        ),
    }
    return responses.get(language, responses["en"])


def _fallback_text_response(name: str, language: str) -> str:
    responses = {
        "en": f"{name}, I'm having trouble understanding. Could you please type your response instead?",
        "hi": f"{name} \u091c\u0940, \u092e\u0941\u091d\u0947 \u0938\u092e\u091d\u0928\u0947 \u092e\u0947\u0902 \u0915\u0920\u093f\u0928\u093e\u0908 \u0939\u094b \u0930\u0939\u0940 \u0939\u0948\u0964 \u0915\u094d\u092f\u093e \u0906\u092a \u0915\u0943\u092a\u092f\u093e \u0905\u092a\u0928\u093e \u091c\u0935\u093e\u092c \u091f\u093e\u0907\u092a \u0915\u0930 \u0938\u0915\u0924\u0947 \u0939\u0948\u0902?",
        "bn": f"{name}, \u0986\u09ae\u09bf \u09ac\u09c1\u099d\u09a4\u09c7 \u0985\u09b8\u09c1\u09ac\u09bf\u09a7\u09be \u09b9\u099a\u09cd\u099b\u09c7\u0964 \u0986\u09aa\u09a8\u09bf \u0995\u09bf \u0985\u09a8\u09c1\u0997\u09cd\u09b0\u09b9 \u0995\u09b0\u09c7 \u0986\u09aa\u09a8\u09be\u09b0 \u0989\u09a4\u09cd\u09a4\u09b0 \u099f\u09be\u0987\u09aa \u0995\u09b0\u09a4\u09c7 \u09aa\u09be\u09b0\u09ac\u09c7\u09a8?",
    }
    return responses.get(language, responses["en"])


def _ask_repeat_response(name: str, language: str) -> str:
    responses = {
        "en": f"{name}, I didn't quite catch that. Could you please repeat?",
        "hi": f"{name} \u091c\u0940, \u092e\u0948\u0902 \u0938\u092e\u091d \u0928\u0939\u0940\u0902 \u092a\u093e\u092f\u093e\u0964 \u0915\u094d\u092f\u093e \u0906\u092a \u0915\u0943\u092a\u092f\u093e \u0926\u094b\u0939\u0930\u093e \u0938\u0915\u0924\u0947 \u0939\u0948\u0902?",
        "bn": f"{name}, \u0986\u09ae\u09bf \u09a0\u09bf\u0995\u09ae\u09a4\u09cb \u09ac\u09c1\u099d\u09a4\u09c7 \u09aa\u09be\u09b0\u09b2\u09be\u09ae \u09a8\u09be\u0964 \u0986\u09aa\u09a8\u09bf \u0995\u09bf \u0986\u09ac\u09be\u09b0 \u09ac\u09b2\u09ac\u09c7\u09a8?",
    }
    return responses.get(language, responses["en"])


def _confused_patient_response(name: str, language: str) -> str:
    """Response when patient shows signs of confusion (P4 edge case)."""
    responses = {
        "en": (
            f"{name}, it seems like you might be having some difficulty. "
            f"Let me make this simpler. Would you like to stop for now? "
            f"We can try again later."
        ),
        "hi": (
            f"{name} \u091c\u0940, \u0932\u0917\u0924\u093e \u0939\u0948 \u0906\u092a\u0915\u094b "
            f"\u0915\u0941\u091b \u0915\u0920\u093f\u0928\u093e\u0908 \u0939\u094b \u0930\u0939\u0940 \u0939\u0948\u0964 "
            f"\u0915\u094d\u092f\u093e \u0906\u092a \u0905\u092d\u0940 \u0930\u0941\u0915\u0928\u093e \u091a\u093e\u0939\u0924\u0947 \u0939\u0948\u0902? "
            f"\u0939\u092e \u092c\u093e\u0926 \u092e\u0947\u0902 \u0915\u094b\u0936\u093f\u0936 \u0915\u0930 \u0938\u0915\u0924\u0947 \u0939\u0948\u0902\u0964"
        ),
        "bn": (
            f"{name}, \u09ae\u09a8\u09c7 \u09b9\u099a\u09cd\u099b\u09c7 \u0986\u09aa\u09a8\u09be\u09b0 "
            f"\u0995\u09bf\u099b\u09c1 \u0985\u09b8\u09c1\u09ac\u09bf\u09a7\u09be \u09b9\u099a\u09cd\u099b\u09c7\u0964 "
            f"\u0986\u09aa\u09a8\u09bf \u0995\u09bf \u098f\u0996\u09a8 \u09a5\u09be\u09ae\u09a4\u09c7 \u099a\u09be\u09a8? "
            f"\u0986\u09ae\u09b0\u09be \u09aa\u09b0\u09c7 \u0986\u09ac\u09be\u09b0 \u099a\u09c7\u09b7\u09cd\u099f\u09be \u0995\u09b0\u09a4\u09c7 \u09aa\u09be\u09b0\u09bf\u0964"
        ),
    }
    return responses.get(language, responses["en"])


def _ask_parameter_response(parameter: str, name: str, language: str) -> str:
    responses = {
        "en": f"{name}, could you tell me your {parameter} reading?",
        "hi": f"{name} \u091c\u0940, \u0915\u094d\u092f\u093e \u0906\u092a \u092e\u0941\u091d\u0947 \u0905\u092a\u0928\u093e {parameter} \u092c\u0924\u093e \u0938\u0915\u0924\u0947 \u0939\u0948\u0902?",
        "bn": f"{name}, \u0986\u09aa\u09a8\u09bf \u0995\u09bf \u0986\u09ae\u09be\u0995\u09c7 \u0986\u09aa\u09a8\u09be\u09b0 {parameter} \u09ac\u09b2\u09a4\u09c7 \u09aa\u09be\u09b0\u09ac\u09c7\u09a8?",
    }
    return responses.get(language, responses["en"])


def _ask_topic_response(topic: str, name: str, language: str) -> str:
    responses = {
        "en": f"{name}, let's talk about your {topic}. Can you share any updates?",
        "hi": f"{name} \u091c\u0940, \u091a\u0932\u093f\u090f \u0906\u092a\u0915\u0947 {topic} \u0915\u0947 \u092c\u093e\u0930\u0947 \u092e\u0947\u0902 \u092c\u093e\u0924 \u0915\u0930\u0924\u0947 \u0939\u0948\u0902\u0964 \u0915\u094b\u0908 \u0905\u092a\u0921\u0947\u091f \u0939\u0948?",
        "bn": f"{name}, \u0986\u09b8\u09c1\u09a8 \u0986\u09aa\u09a8\u09be\u09b0 {topic} \u09a8\u09bf\u09df\u09c7 \u0995\u09a5\u09be \u09ac\u09b2\u09bf\u0964 \u0995\u09cb\u09a8\u09cb \u0986\u09aa\u09a1\u09c7\u099f \u0986\u099b\u09c7?",
    }
    return responses.get(language, responses["en"])


def _confirm_value_response(values: list[dict[str, Any]], name: str, language: str) -> str:
    value_strs = [f"{v['parameter']}: {v['value']} {v['unit']}" for v in values]
    values_text = ", ".join(value_strs)
    responses = {
        "en": f"{name}, I heard {values_text}. Is that correct?",
        "hi": f"{name} \u091c\u0940, \u092e\u0948\u0902\u0928\u0947 \u0938\u0941\u0928\u093e {values_text}\u0964 \u0915\u094d\u092f\u093e \u092f\u0939 \u0938\u0939\u0940 \u0939\u0948?",
        "bn": f"{name}, \u0986\u09ae\u09bf \u09b6\u09c1\u09a8\u09c7\u099b\u09bf {values_text}\u0964 \u098f\u099f\u09be \u0995\u09bf \u09a0\u09bf\u0995?",
    }
    return responses.get(language, responses["en"])


def _hard_implausible_response(values: list[dict[str, Any]], name: str, language: str) -> str:
    """Response for hard-reject implausible values (outside physiological range)."""
    value_strs = [f"{v['parameter']}: {v['value']}" for v in values]
    values_text = ", ".join(value_strs)
    responses = {
        "en": (
            f"{name}, the reading {values_text} is outside the possible range. "
            f"Please re-check your device and try again."
        ),
        "hi": (
            f"{name} \u091c\u0940, {values_text} \u0915\u0940 \u0930\u0940\u0921\u093f\u0902\u0917 "
            f"\u0938\u0902\u092d\u0935 \u0938\u0940\u092e\u093e \u0938\u0947 \u092c\u093e\u0939\u0930 \u0939\u0948\u0964 "
            f"\u0915\u0943\u092a\u092f\u093e \u0921\u093f\u0935\u093e\u0907\u0938 \u091c\u093e\u0902\u091a\u0947\u0902 \u0914\u0930 \u0926\u094b\u092c\u093e\u0930\u093e \u092c\u0924\u093e\u090f\u0902\u0964"
        ),
        "bn": (
            f"{name}, {values_text} \u09b0\u09bf\u09a1\u09bf\u0982 \u09b8\u09ae\u09cd\u09ad\u09ac "
            f"\u09b8\u09c0\u09ae\u09be\u09b0 \u09ac\u09be\u0987\u09b0\u09c7\u0964 "
            f"\u0985\u09a8\u09c1\u0997\u09cd\u09b0\u09b9 \u0995\u09b0\u09c7 \u09a1\u09bf\u09ad\u09be\u0987\u09b8 \u099a\u09c7\u0995 \u0995\u09b0\u09c7 \u0986\u09ac\u09be\u09b0 \u09ac\u09b2\u09c1\u09a8\u0964"
        ),
    }
    return responses.get(language, responses["en"])


def _soft_implausible_response(
    warning_values: list[dict[str, Any]],
    all_values: list[dict[str, Any]],
    name: str,
    language: str,
) -> str:
    """Response for soft-warn implausible values (unusual but possible)."""
    warn_strs = [f"{v['parameter']}: {v['value']}" for v in warning_values]
    warn_text = ", ".join(warn_strs)
    all_strs = [f"{v['parameter']}: {v['value']} {v['unit']}" for v in all_values]
    all_text = ", ".join(all_strs)
    responses = {
        "en": (
            f"{name}, I heard {all_text}. I notice {warn_text} seems a bit unusual. "
            f"Is that correct?"
        ),
        "hi": (
            f"{name} \u091c\u0940, \u092e\u0948\u0902\u0928\u0947 \u0938\u0941\u0928\u093e {all_text}\u0964 "
            f"{warn_text} \u0925\u094b\u0921\u093c\u093e \u0905\u0938\u093e\u092e\u093e\u0928\u094d\u092f "
            f"\u0932\u0917 \u0930\u0939\u093e \u0939\u0948\u0964 \u0915\u094d\u092f\u093e \u092f\u0939 "
            f"\u0938\u0939\u0940 \u0939\u0948?"
        ),
        "bn": (
            f"{name}, \u0986\u09ae\u09bf \u09b6\u09c1\u09a8\u09c7\u099b\u09bf {all_text}\u0964 "
            f"{warn_text} \u098f\u0995\u099f\u09c1 \u0985\u09b8\u09cd\u09ac\u09be\u09ad\u09be\u09ac\u09bf\u0995 "
            f"\u09ae\u09a8\u09c7 \u09b9\u099a\u09cd\u099b\u09c7\u0964 \u098f\u099f\u09be \u0995\u09bf \u09a0\u09bf\u0995?"
        ),
    }
    return responses.get(language, responses["en"])


def _confirmed_and_ask_next(
    confirmed: list[ExtractedValue], next_param: str, name: str, language: str
) -> str:
    value_strs = [f"{v.parameter}: {v.value} {v.unit}" for v in confirmed]
    values_text = ", ".join(value_strs)
    responses = {
        "en": f"Great! I've saved {values_text}. Now, could you tell me your {next_param}?",
        "hi": f"\u092c\u0939\u0941\u0924 \u0905\u091a\u094d\u099b\u093e! {values_text} \u0938\u0947\u0935 \u0915\u0930 \u0932\u093f\u092f\u093e \u0939\u0948\u0964 \u0905\u092c, \u0915\u094d\u092f\u093e \u0906\u092a \u0905\u092a\u0928\u093e {next_param} \u092c\u0924\u093e \u0938\u0915\u0924\u0947 \u0939\u0948\u0902?",
        "bn": f"\u099a\u09ae\u09ce\u0995\u09be\u09b0! {values_text} \u09b8\u09c7\u09ad \u0995\u09b0\u09c7\u099b\u09bf\u0964 \u098f\u0996\u09a8, \u0986\u09aa\u09a8\u09be\u09b0 {next_param} \u09ac\u09b2\u09ac\u09c7\u09a8?",
    }
    return responses.get(language, responses["en"])


def _confirmed_and_ask_topic(
    confirmed: list[ExtractedValue], topic: str, name: str, language: str
) -> str:
    value_strs = [f"{v.parameter}: {v.value} {v.unit}" for v in confirmed]
    values_text = ", ".join(value_strs)
    responses = {
        "en": f"Great! I've saved {values_text}. All measurements are done. Let's talk about your {topic}.",
        "hi": f"\u092c\u0939\u0941\u0924 \u0905\u091a\u094d\u099b\u093e! {values_text} \u0938\u0947\u0935 \u0915\u0930 \u0932\u093f\u092f\u093e\u0964 \u0938\u092d\u0940 \u092e\u093e\u092a \u0939\u094b \u0917\u090f\u0964 \u091a\u0932\u093f\u090f {topic} \u0915\u0947 \u092c\u093e\u0930\u0947 \u092e\u0947\u0902 \u092c\u093e\u0924 \u0915\u0930\u0924\u0947 \u0939\u0948\u0902\u0964",
        "bn": f"\u099a\u09ae\u09ce\u0995\u09be\u09b0! {values_text} \u09b8\u09c7\u09ad \u0995\u09b0\u09c7\u099b\u09bf\u0964 \u09b8\u09ac \u09ae\u09be\u09aa \u09b9\u09df\u09c7 \u0997\u09c7\u099b\u09c7\u0964 \u0986\u09b8\u09c1\u09a8 {topic} \u09a8\u09bf\u09df\u09c7 \u0995\u09a5\u09be \u09ac\u09b2\u09bf\u0964",
    }
    return responses.get(language, responses["en"])


def _session_summary_response(session: SessionState, name: str, language: str) -> str:
    confirmed_strs = [
        f"{v.parameter}: {v.value} {v.unit}" for v in session.confirmed_values
    ]
    values_text = ", ".join(confirmed_strs) if confirmed_strs else "no values"
    responses = {
        "en": f"All done for today, {name}! Here's your summary: {values_text}. Take care and stay healthy!",
        "hi": f"\u0906\u091c \u0915\u0947 \u0932\u093f\u090f \u0939\u094b \u0917\u092f\u093e, {name} \u091c\u0940! \u0906\u092a\u0915\u093e \u0938\u093e\u0930\u093e\u0902\u0936: {values_text}\u0964 \u0905\u092a\u0928\u093e \u0916\u094d\u092f\u093e\u0932 \u0930\u0916\u0947\u0902!",
        "bn": f"\u0986\u099c\u0995\u09c7\u09b0 \u099c\u09a8\u09cd\u09af \u09b9\u09df\u09c7 \u0997\u09c7\u099b\u09c7, {name}! \u0986\u09aa\u09a8\u09be\u09b0 \u09b8\u09be\u09b0\u09b8\u0982\u0995\u09cd\u09b7\u09c7\u09aa: {values_text}\u0964 \u09ad\u09be\u09b2\u09cb \u09a5\u09be\u0995\u09c1\u09a8!",
    }
    return responses.get(language, responses["en"])


# ============================================================
# Main utterance processing (Epic 1.3.2) — with timing
# ============================================================

def _generate_greeting(session: SessionState) -> str:
    """Generate a greeting message for a new session."""
    name = session.config.patient_name or "Patient"
    greetings = {
        "en": f"Hello {name}! How are you feeling today?",
        "hi": f"\u0928\u092e\u0938\u094d\u0924\u0947 {name} \u091c\u0940! \u0906\u091c \u0906\u092a \u0915\u0948\u0938\u093e \u092e\u0939\u0938\u0942\u0938 \u0915\u0930 \u0930\u0939\u0947 \u0939\u0948\u0902?",
        "bn": f"\u09a8\u09ae\u09b8\u09cd\u0995\u09be\u09b0 {name}! \u0986\u099c \u0986\u09aa\u09a8\u09bf \u0995\u09c7\u09ae\u09a8 \u0985\u09a8\u09c1\u09ad\u09ac \u0995\u09b0\u099b\u09c7\u09a8?",
    }
    return greetings.get(session.language, greetings["en"])


def _process_utterance(session: SessionState, text: str) -> UtteranceResponse:
    """Process a patient utterance through the conversation engine.

    Implements the full state machine:
    1. Record patient turn
    2. Check confusion
    3. Check emergency
    4. Check consecutive failures (fallback)
    5. Handle pending confirmations
    6. Extract values
    7. Validate plausibility (soft/hard)
    8. Ask for next parameter / topic
    9. Session summary when all done

    Returns UtteranceResponse with inference_duration_ms.
    """
    t0 = time.monotonic()

    session.record_patient_text(text)
    session.add_turn("patient", text)

    # Run the LLM (or rule-based mock) to get the response
    result = _generate_llm_response(session, text)

    # Process extracted values — move to pending confirmation
    extracted_values: list[ExtractedValue] = []
    for raw_val in result.get("extracted_values", []):
        ev = ExtractedValue(
            parameter=raw_val["parameter"],
            loinc_code=raw_val["loinc_code"],
            value=raw_val["value"],
            unit=raw_val["unit"],
            status=ValueStatus.pending_confirmation,
        )
        session.pending_confirmation.append(ev)
        extracted_values.append(ev)

    response_text = result["response_text"]
    action_str = result["action"]
    requires_photo = result.get("requires_photo", False)

    # Map action string to enum
    try:
        action = Action(action_str)
    except ValueError:
        action = Action.ask_parameter

    # Reset consecutive failures on successful extraction or confirmation
    # Note: ask_parameter without extracted values means nothing was understood — don't reset
    if action in (Action.confirm_value, Action.session_summary, Action.ask_topic):
        session.consecutive_failures = 0
    elif action == Action.ask_parameter and extracted_values:
        session.consecutive_failures = 0

    # Record system response turn
    session.add_turn("system", response_text)

    inference_ms = round((time.monotonic() - t0) * 1000, 2)
    logger.info("Session %s utterance inference_duration_ms=%.2f", session.session_id, inference_ms)

    return UtteranceResponse(
        response_text=response_text,
        extracted_values=extracted_values,
        session_state=session.session_state_response(),
        action=action,
        requires_photo=requires_photo,
        inference_duration_ms=inference_ms,
    )


def _cleanup_session(session: SessionState) -> None:
    """Delete temp files and remove session from store."""
    try:
        if session.tmp_dir.exists():
            shutil.rmtree(session.tmp_dir)
    except Exception:
        logger.exception("Error cleaning up session tmp dir: %s", session.tmp_dir)
    _sessions.pop(session.session_id, None)


# ============================================================
# Background cleanup task (Epic 1.3.1)
# ============================================================
_cleanup_task: asyncio.Task | None = None


async def _session_cleanup_loop() -> None:
    """Periodically clean up expired and stale sessions.

    Runs every 30 seconds. Cleans up:
    - Paused sessions idle for > SESSION_TIMEOUT_SECONDS (5 min) -> auto-end with pause_timeout
    - Any session older than MAX_SESSION_AGE_SECONDS (30 min) regardless of state
    - Active sessions idle for > 2x timeout as safety net
    """
    while True:
        await asyncio.sleep(30)  # check every 30 seconds
        now = datetime.now(timezone.utc)
        expired_ids: list[str] = []
        for sid, session in _sessions.items():
            age_seconds = (now - session.created_at).total_seconds()
            idle_seconds = (now - session.last_activity).total_seconds()

            # Hard limit: any session older than 30 minutes
            if age_seconds > MAX_SESSION_AGE_SECONDS:
                expired_ids.append(sid)
            # Paused sessions: 5 minute timeout
            elif session.state == "paused" and idle_seconds > SESSION_TIMEOUT_SECONDS:
                expired_ids.append(sid)
            # Active sessions: safety net at 2x timeout
            elif session.state == "active" and idle_seconds > SESSION_TIMEOUT_SECONDS * 2:
                expired_ids.append(sid)

        for sid in expired_ids:
            session = _sessions.get(sid)
            if session:
                logger.info("Session %s timed out (state=%s, age=%ds) -- cleaning up",
                            sid, session.state,
                            (now - session.created_at).total_seconds())
                session.state = "ended"
                _cleanup_session(session)


# ============================================================
# Lifespan
# ============================================================
@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    global _cleanup_task
    _load_model()
    _cleanup_task = asyncio.create_task(_session_cleanup_loop())
    yield
    if _cleanup_task:
        _cleanup_task.cancel()
        try:
            await _cleanup_task
        except asyncio.CancelledError:
            pass
    # Clean up all remaining sessions
    for session in list(_sessions.values()):
        _cleanup_session(session)
    logger.info("LLM service stopped")


app = FastAPI(title="CareLog LLM Service", lifespan=lifespan)


# ============================================================
# Helpers
# ============================================================

def _get_session(session_id: str) -> SessionState:
    session = _sessions.get(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return session


# ============================================================
# Routes
# ============================================================

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


@app.post("/sessions", response_model=CreateSessionResponse, status_code=201)
async def create_session(request: CreateSessionRequest) -> JSONResponse:
    if not _model_ready():
        return JSONResponse({"error": "model_not_loaded"}, status_code=503)

    if request.language not in SUPPORTED_LANGUAGES:
        return JSONResponse(
            {"error": "unsupported_language", "message": f"Supported: {SUPPORTED_LANGUAGES}"},
            status_code=400,
        )

    session = SessionState(request)

    # Create temp directory for this session
    session.tmp_dir.mkdir(parents=True, exist_ok=True)

    greeting = _generate_greeting(session)
    session.add_turn("system", greeting)

    _sessions[session.session_id] = session

    resp = CreateSessionResponse(
        session_id=session.session_id,
        greeting_text=greeting,
        state="active",
    )
    return JSONResponse(content=resp.model_dump(), status_code=201)


@app.post("/sessions/{session_id}/utterance", response_model=UtteranceResponse)
async def send_utterance(session_id: str, request: UtteranceRequest) -> JSONResponse:
    if not _model_ready():
        return JSONResponse({"error": "model_not_loaded"}, status_code=503)

    session = _get_session(session_id)

    if session.state != "active":
        raise HTTPException(status_code=409, detail=f"Session is {session.state}, not active")

    result = _process_utterance(session, request.text)
    return JSONResponse(content=result.model_dump())


@app.post("/sessions/{session_id}/end", response_model=EndSessionResponse)
async def end_session(session_id: str, request: EndSessionRequest) -> JSONResponse:
    session = _get_session(session_id)
    session.state = "ended"

    # Build full transcript
    transcript = [
        TranscriptTurn(turn=i + 1, role=t.role, text=t.text)
        for i, t in enumerate(session.turns)
    ]

    # Determine status
    all_remaining = list(session.remaining_parameters)
    status = "complete" if not all_remaining else "incomplete"

    duration_ms = int((datetime.now(timezone.utc) - session.created_at).total_seconds() * 1000)

    summary = SessionSummary(
        confirmed_values=session.confirmed_values,
        missed_parameters=all_remaining,
        topics_addressed=session.topics_addressed,
        turn_count=session.turn_count,
        language=session.language,
        duration_ms=duration_ms,
        status=status,
    )

    resp = EndSessionResponse(
        session_id=session.session_id,
        summary=summary,
        full_transcript=transcript,
        state="ended",
    )

    # Cleanup after building the response
    _cleanup_session(session)

    return JSONResponse(content=resp.model_dump())


@app.post("/sessions/{session_id}/pause", response_model=PauseSessionResponse)
async def pause_session(session_id: str) -> JSONResponse:
    session = _get_session(session_id)

    if session.state != "active":
        raise HTTPException(status_code=409, detail=f"Session is {session.state}, cannot pause")

    session.state = "paused"
    session.paused_at = datetime.now(timezone.utc)
    session.touch()

    resp = PauseSessionResponse(
        session_id=session.session_id,
        state="paused",
        timeout_seconds=SESSION_TIMEOUT_SECONDS,
    )
    return JSONResponse(content=resp.model_dump())


@app.post("/sessions/{session_id}/resume", response_model=ResumeSessionResponse)
async def resume_session(session_id: str) -> JSONResponse:
    session = _get_session(session_id)

    if session.state == "ended":
        return JSONResponse(
            {"error": "session_expired", "message": "Session has timed out and been cleaned up"},
            status_code=410,
        )

    if session.state != "paused":
        raise HTTPException(status_code=409, detail=f"Session is {session.state}, not paused")

    # Check if timeout has expired
    if session.paused_at:
        elapsed = (datetime.now(timezone.utc) - session.paused_at).total_seconds()
        if elapsed > SESSION_TIMEOUT_SECONDS:
            session.state = "ended"
            _cleanup_session(session)
            return JSONResponse(
                {"error": "session_expired", "message": "Session has timed out and been cleaned up"},
                status_code=410,
            )

    session.state = "active"
    session.paused_at = None
    session.touch()

    # Generate a welcome-back message
    name = session.config.patient_name or "Patient"
    remaining = session.remaining_parameters
    if remaining:
        resume_text = f"Welcome back! Let's continue — have you checked your {remaining[0]}?"
    else:
        resume_text = "Welcome back! We were almost done."

    session.add_turn("system", resume_text)

    resp = ResumeSessionResponse(
        session_id=session.session_id,
        state="active",
        response_text=resume_text,
    )
    return JSONResponse(content=resp.model_dump())


# ============================================================
# Entrypoint
# ============================================================
if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    uvicorn.run(app, host="0.0.0.0", port=LLM_PORT)
