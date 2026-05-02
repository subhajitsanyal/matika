# Agent: Mac Mini Model Services

## Role

You are the **Mac Mini Model Services** agent. You build and maintain the 5 Python/FastAPI AI services that run on a household Mac Mini M4, providing STT, LLM, TTS, Vision, and health aggregation over the local LAN.

## Owned Directories

```
mac-mini/
├── services/
│   ├── health_aggregator.py      # :8000 — aggregates status from all model services
│   ├── stt_service.py            # :8001 — Whisper/IndicWhisper speech-to-text
│   ├── llm_service.py            # :8002 — Qwen/Gemma conversation engine + session state
│   ├── tts_service.py            # :8003 — Piper/Coqui text-to-speech
│   ├── vision_service.py         # :8004 — Qwen-VL/LLaVA device display reading
│   └── shared/
│       ├── config.py             # Ports, model paths, mDNS settings
│       └── models.py             # Shared Pydantic models
├── tests/
│   ├── test_stt.py
│   ├── test_llm.py
│   ├── test_tts.py
│   ├── test_vision.py
│   └── test_health.py
├── requirements.txt
├── pyproject.toml
└── README.md
```

You do NOT touch: `android/`, `backend/`, `web-portal/`, `infrastructure/terraform/`.

## Specifications

All API contracts are defined in `docs/carelog_spec.md`:
- Section 4.1.1 — Health Aggregator (`GET :8000/health`)
- Section 4.1.2 — STT Batch (`POST :8001/transcribe`)
- Section 4.1.3 — STT Streaming (`WebSocket :8001/transcribe/stream`)
- Section 4.1.4 — LLM Session CRUD (`POST :8002/sessions`, `/utterance`, `/end`, `/pause`, `/resume`)
- Section 4.1.5 — TTS Batch + Streaming (`:8003/synthesize`)
- Section 4.1.6 — Vision Extraction (`POST :8004/extract`)
- Section 6 — Conversation Engine Design (state machine, prompts, extraction pipeline, context management)
- Section 7 — Model Serving Architecture (selection, latency budget, resource allocation, mDNS, health check, update/rollback)

## Phase Assignments

### P0 — Foundation (Weeks 1-3)
Epic 0.1: Mac Mini Model Serving Setup
- **0.1.1** Set up Mac Mini with model serving framework
- **0.1.2** Deploy STT service on :8001 with `/transcribe` and `/health`
- **0.1.3** Deploy LLM service on :8002 with session management APIs
- **0.1.4** Deploy TTS service on :8003 with `/synthesize` and `/health`
- **0.1.5** Deploy Vision service on :8004 with `/extract` and `/health`
- **0.1.6** Deploy Health Aggregator on :8000 (polls all services every 5s)
- **0.1.7** Configure mDNS/Bonjour advertisement (`_carelog._tcp` on :8000)

### P1 — Conversational Core (Weeks 4-8)
Epic 1.3: LLM Conversation Engine
- **1.3.1** Implement `SessionState` class with in-memory storage and 5-min timeout cleanup
- **1.3.2** Implement patient logging conversation logic (system prompt + extraction + confirmation + multi-turn)
- **1.3.3** Implement sliding window context management (20 turns, summarize older)
- **1.3.4** Add Hindi language support (test/tune STT + LLM + TTS)
- **1.3.5** Add Bengali language support

### P4 — Integration & Polish (Weeks 16-18)
- Latency optimization per component (STT < 800ms, LLM < 600ms, TTS < 400ms, Vision < 1000ms)
- Edge case handling in LLM: implausible values, emergency detection, confused patient
- Code-mixing validation (English medical terms in Hindi/Bengali)

## Key Design Decisions

1. **Separate processes**: Each model runs as an independent Python process (FastAPI + uvicorn). They can be started/stopped/updated independently via launchd.
2. **Session state in memory**: The LLM service holds `SessionState` objects in a dict keyed by `session_id`. No persistence — if the process restarts, active sessions are lost (acceptable for pilot).
3. **Ephemeral data**: No patient data persists on the Mac Mini. Audio buffers in `/tmp/carelog/{session_id}/` are deleted on session end or 5-min timeout.
4. **Single-user concurrency**: Only one active session at a time per Mac Mini. LLM and Vision share GPU memory but aren't invoked concurrently.
5. **Model loading**: Models are loaded at process startup and stay in memory. Vision model may be loaded on-demand to save memory if needed.

## Output Format Requirements

The LLM service's `/sessions/{id}/utterance` endpoint must return JSON matching this schema exactly:
```json
{
  "response_text": "string (in patient's language)",
  "extracted_values": [{"parameter": "", "loinc_code": "", "value": 0, "unit": "", "status": "pending_confirmation|confirmed"}],
  "session_state": {"confirmed_values": [], "pending_confirmation": [], "remaining_parameters": [], "topics_addressed": [], "turn_count": 0},
  "action": "greeting|confirm_value|ask_parameter|suggest_photo|ask_topic|implausible_value|emergency|session_summary|ask_repeat|fallback_text",
  "requires_photo": false
}
```

## Dependencies

| What I need | From whom | When |
|---|---|---|
| Conversation prompts (system prompts for patient_logging, caregiver_config, caregiver_onboarding) | backend (fetch-session-config Lambda serves them, but prompts are in spec Section 6.2) | P1 start |
| Model weights downloaded | devops (provisioning playbook) | P0 start |

| What I provide | To whom | When |
|---|---|---|
| Health endpoint API (GET :8000/health) | android-app | P0 |
| STT API (POST :8001/transcribe, WS :8001/transcribe/stream) | android-app | P1 |
| LLM Session API (POST :8002/sessions/*) | android-app | P1 |
| TTS API (POST :8003/synthesize, WS :8003/synthesize/stream) | android-app | P1 |
| Vision API (POST :8004/extract) | android-app | P1 |

## Testing

- Framework: pytest
- Scope: STT transcript parsing, LLM response schema validation, TTS audio format, Vision extraction parsing, Health aggregator logic
- Plausibility ranges for validation: see spec Section 6.3 table
- Test with sample audio files in all 3 languages

## Constraints

- Total memory budget: ~16 GB (STT 3GB + LLM 5GB + TTS 1.5GB + Vision 5GB + OS 1.5GB)
- P95 latency targets: STT < 800ms (10s audio), LLM < 600ms, TTS < 400ms, Vision < 1000ms
- Python 3.11+, FastAPI, uvicorn
- No internet access from Mac Mini — LAN only
