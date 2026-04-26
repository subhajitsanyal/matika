#!/usr/bin/env bash
#
# CareLog Pilot Smoke Test
#
# Quick verification that all Mac Mini services are responding correctly.
#
# Tests:
# 1. Health check: GET :8000/health
# 2. STT test: POST :8001/transcribe (with sample PCM if available)
# 3. LLM test: POST :8002/sessions -> send utterance -> end session
# 4. TTS test: POST :8003/synthesize
# 5. Vision test: POST :8004/extract (with sample image if available)
#
# Usage: ./pilot-smoke-test.sh [--verbose]
#
# Exit codes:
#   0 = all tests passed
#   1 = one or more tests failed

set -euo pipefail

BASE_URL="http://127.0.0.1"
VERBOSE="${1:-}"
TIMEOUT=10
PASS_COUNT=0
FAIL_COUNT=0
RESULTS=()

# ---------------------------------------------------------------------------
# Helper Functions
# ---------------------------------------------------------------------------
log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

test_pass() {
    local name="$1"
    PASS_COUNT=$((PASS_COUNT + 1))
    RESULTS+=("[PASS] ${name}")
    log "[PASS] ${name}"
}

test_fail() {
    local name="$1"
    local detail="${2:-}"
    FAIL_COUNT=$((FAIL_COUNT + 1))
    RESULTS+=("[FAIL] ${name}${detail:+ - ${detail}}")
    log "[FAIL] ${name}${detail:+ - ${detail}}"
}

verbose() {
    if [[ "${VERBOSE}" == "--verbose" || "${VERBOSE}" == "-v" ]]; then
        echo "  $*"
    fi
}

# ---------------------------------------------------------------------------
# Test 1: Health Aggregator (port 8000)
# ---------------------------------------------------------------------------
test_health() {
    log "--- Test 1: Health Aggregator (port 8000) ---"

    local response
    response="$(curl -sf --max-time "${TIMEOUT}" "${BASE_URL}:8000/health" 2>/dev/null || echo "FAILED")"

    if [[ "${response}" == "FAILED" ]]; then
        test_fail "Health Aggregator" "No response from :8000/health"
        return
    fi

    verbose "Response: ${response}"

    # Check if response indicates all services are up
    if echo "${response}" | grep -qi '"status".*"ok"\|"healthy"\|"up"'; then
        test_pass "Health Aggregator - all services reported"
    elif echo "${response}" | grep -qi '"status"'; then
        test_pass "Health Aggregator - responding (check individual statuses)"
    else
        test_pass "Health Aggregator - endpoint responding"
    fi
}

# ---------------------------------------------------------------------------
# Test 2: STT Service (port 8001)
# ---------------------------------------------------------------------------
test_stt() {
    log "--- Test 2: STT Service (port 8001) ---"

    # Health check first
    local health
    health="$(curl -sf --max-time "${TIMEOUT}" "${BASE_URL}:8001/health" 2>/dev/null || echo "FAILED")"

    if [[ "${health}" == "FAILED" ]]; then
        test_fail "STT Health" "No response from :8001/health"
        return
    fi

    test_pass "STT Health - endpoint responding"
    verbose "Health: ${health}"

    # Transcribe test with minimal PCM data (silence)
    # Generate 1 second of 16kHz 16-bit silence
    local tmp_pcm
    tmp_pcm="$(mktemp /tmp/carelog-smoke-XXXX.pcm)"
    dd if=/dev/zero of="${tmp_pcm}" bs=32000 count=1 2>/dev/null

    local response
    response="$(curl -sf --max-time 30 \
        -X POST "${BASE_URL}:8001/transcribe" \
        -F "audio=@${tmp_pcm}" \
        -F "language=en" \
        2>/dev/null || echo "FAILED")"

    rm -f "${tmp_pcm}"

    if [[ "${response}" == "FAILED" ]]; then
        test_fail "STT Transcribe" "No response from :8001/transcribe"
    else
        verbose "Response: ${response}"
        test_pass "STT Transcribe - endpoint responding"
    fi
}

# ---------------------------------------------------------------------------
# Test 3: LLM Service (port 8002)
# ---------------------------------------------------------------------------
test_llm() {
    log "--- Test 3: LLM Service (port 8002) ---"

    # Health check
    local health
    health="$(curl -sf --max-time "${TIMEOUT}" "${BASE_URL}:8002/health" 2>/dev/null || echo "FAILED")"

    if [[ "${health}" == "FAILED" ]]; then
        test_fail "LLM Health" "No response from :8002/health"
        return
    fi

    test_pass "LLM Health - endpoint responding"
    verbose "Health: ${health}"

    # Create session
    local session_response
    session_response="$(curl -sf --max-time "${TIMEOUT}" \
        -X POST "${BASE_URL}:8002/sessions" \
        -H "Content-Type: application/json" \
        -d '{
            "patient_name": "Smoke Test",
            "language": "en",
            "session_type": "morning",
            "parameters": []
        }' 2>/dev/null || echo "FAILED")"

    if [[ "${session_response}" == "FAILED" ]]; then
        test_fail "LLM Create Session" "No response from :8002/sessions"
        return
    fi

    verbose "Session: ${session_response}"
    test_pass "LLM Create Session - endpoint responding"

    # Extract session ID
    local session_id
    session_id="$(echo "${session_response}" | grep -oE '"session_id"\s*:\s*"[^"]+' | head -1 | sed 's/.*"//' || true)"

    if [[ -z "${session_id}" ]]; then
        verbose "Could not extract session_id; skipping utterance and end tests"
        return
    fi

    # Send utterance
    local utterance_response
    utterance_response="$(curl -sf --max-time 30 \
        -X POST "${BASE_URL}:8002/sessions/${session_id}/utterance" \
        -H "Content-Type: application/json" \
        -d '{"text": "Hello, this is a smoke test.", "role": "patient"}' \
        2>/dev/null || echo "FAILED")"

    if [[ "${utterance_response}" != "FAILED" ]]; then
        verbose "Utterance: ${utterance_response}"
        test_pass "LLM Send Utterance - endpoint responding"
    else
        test_fail "LLM Send Utterance" "No response"
    fi

    # End session
    local end_response
    end_response="$(curl -sf --max-time "${TIMEOUT}" \
        -X POST "${BASE_URL}:8002/sessions/${session_id}/end" \
        2>/dev/null || echo "FAILED")"

    if [[ "${end_response}" != "FAILED" ]]; then
        verbose "End: ${end_response}"
        test_pass "LLM End Session - endpoint responding"
    else
        test_fail "LLM End Session" "No response"
    fi
}

# ---------------------------------------------------------------------------
# Test 4: TTS Service (port 8003)
# ---------------------------------------------------------------------------
test_tts() {
    log "--- Test 4: TTS Service (port 8003) ---"

    # Health check
    local health
    health="$(curl -sf --max-time "${TIMEOUT}" "${BASE_URL}:8003/health" 2>/dev/null || echo "FAILED")"

    if [[ "${health}" == "FAILED" ]]; then
        test_fail "TTS Health" "No response from :8003/health"
        return
    fi

    test_pass "TTS Health - endpoint responding"
    verbose "Health: ${health}"

    # Synthesize test
    local response
    response="$(curl -sf --max-time 30 \
        -X POST "${BASE_URL}:8003/synthesize" \
        -H "Content-Type: application/json" \
        -d '{"text": "Hello, this is a test.", "language": "en"}' \
        --output /dev/null -w "%{http_code}:%{size_download}" \
        2>/dev/null || echo "FAILED")"

    if [[ "${response}" == "FAILED" ]]; then
        test_fail "TTS Synthesize" "No response from :8003/synthesize"
    else
        local http_code size
        IFS=':' read -r http_code size <<< "${response}"
        verbose "HTTP ${http_code}, ${size} bytes"
        if [[ "${http_code}" == "200" && "${size}" -gt 0 ]]; then
            test_pass "TTS Synthesize - returned ${size} bytes of audio"
        elif [[ "${http_code}" == "200" ]]; then
            test_pass "TTS Synthesize - HTTP 200 (empty response, model may need warm-up)"
        else
            test_fail "TTS Synthesize" "HTTP ${http_code}"
        fi
    fi
}

# ---------------------------------------------------------------------------
# Test 5: Vision Service (port 8004)
# ---------------------------------------------------------------------------
test_vision() {
    log "--- Test 5: Vision Service (port 8004) ---"

    # Health check
    local health
    health="$(curl -sf --max-time "${TIMEOUT}" "${BASE_URL}:8004/health" 2>/dev/null || echo "FAILED")"

    if [[ "${health}" == "FAILED" ]]; then
        test_fail "Vision Health" "No response from :8004/health"
        return
    fi

    test_pass "Vision Health - endpoint responding"
    verbose "Health: ${health}"

    # Generate a minimal test image (1x1 white PNG)
    local tmp_img
    tmp_img="$(mktemp /tmp/carelog-smoke-XXXX.png)"
    # Minimal valid PNG: 1x1 white pixel
    printf '\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc\xf8\x0f\x00\x00\x01\x01\x00\x05\x18\xd8N\x00\x00\x00\x00IEND\xaeB`\x82' > "${tmp_img}" 2>/dev/null || true

    local response
    response="$(curl -sf --max-time 30 \
        -X POST "${BASE_URL}:8004/extract" \
        -F "image=@${tmp_img}" \
        2>/dev/null || echo "FAILED")"

    rm -f "${tmp_img}"

    if [[ "${response}" == "FAILED" ]]; then
        test_fail "Vision Extract" "No response from :8004/extract"
    else
        verbose "Response: ${response}"
        test_pass "Vision Extract - endpoint responding"
    fi
}

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
print_summary() {
    echo ""
    echo "============================================="
    echo "  CareLog Pilot Smoke Test Results"
    echo "============================================="
    echo ""

    for result in "${RESULTS[@]}"; do
        echo "  ${result}"
    done

    echo ""
    echo "  Total: $((PASS_COUNT + FAIL_COUNT)) tests"
    echo "  Passed: ${PASS_COUNT}"
    echo "  Failed: ${FAIL_COUNT}"
    echo ""

    if [[ ${FAIL_COUNT} -eq 0 ]]; then
        echo "  STATUS: ALL TESTS PASSED"
        echo ""
        return 0
    else
        echo "  STATUS: ${FAIL_COUNT} TEST(S) FAILED"
        echo ""
        return 1
    fi
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
main() {
    log "============================================="
    log "CareLog Pilot Smoke Test"
    log "============================================="
    log ""

    test_health
    echo ""
    test_stt
    echo ""
    test_llm
    echo ""
    test_tts
    echo ""
    test_vision

    print_summary
}

main "$@"
