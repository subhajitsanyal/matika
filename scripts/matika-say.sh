#!/usr/bin/env bash
# Speaks an utterance through whichever Mac audio output the operator
# has pre-selected so the Android phone (placed near the speaker, or
# with an earbud taped to its mic) picks it up via mic.
#
# Synthetic audio cannot be injected into Android's SpeechRecognizer
# over ADB, so the agentic voice harness goes acoustic: Mac speaks,
# phone listens. See docs/journeys.md §3.2.
#
# Usage:
#   scripts/matika-say.sh <lang> <rate> "<utterance>" [predelay-ms]
#
# Languages:
#   en   Rishi (en_IN)
#   hi   Lekha (hi_IN)
#   bn   no native macOS voice; set MATIKA_BN_AUDIO=<path> to play a
#        pre-recorded .aiff/.wav via afplay instead.
#
# Output-device behavior (F41 mitigation, 2026-05-17):
#   This script used to call `SwitchAudioSource -t output -s
#   "External Headphones"` UNCONDITIONALLY on every utterance. Over a
#   multi-turn bench (~25 min, ~30 utterances) the cumulative
#   device-switch events are the leading hypothesis for the Core Audio
#   wedge documented as F41 in docs/testing_todos_v2.md. New behavior:
#     - If MATIKA_OUTPUT_DEVICE env is set, switch ONLY when the
#       currently-selected output device doesn't already match. So
#       turn 1 may switch; turns 2..N are no-ops as long as nothing
#       outside the script changed the device.
#     - If MATIKA_OUTPUT_DEVICE is unset, leave whatever the operator
#       pre-selected (via Sound prefs or `SwitchAudioSource -s`) alone.
#   To restore the old always-re-assert behavior, set
#   MATIKA_OUTPUT_DEVICE="External Headphones" and additionally
#   export MATIKA_FORCE_OUTPUT_REASSERT=1.
#
# Remote-TTS mode (F41 bypass, 2026-05-17):
#   If MATIKA_SAY_REMOTE_URL is set, POST the utterance to that URL
#   instead of invoking the local `say` binary. The remote service
#   (scripts/matika-tts-server.py running on a second Mac near the
#   phone) speaks through its own audio chain, completely sidestepping
#   the primary mac's wedged Core Audio. SwitchAudioSource is skipped
#   entirely in this mode — output device is the remote mac's concern.
#
# Example (loud-bench, External Headphones device, switch-once):
#   export MATIKA_OUTPUT_DEVICE="External Headphones"
#   scripts/matika-say.sh en 175 "My BP is one thirty over eighty five." 600
#
# Example (remote-tts, F41-bypass):
#   export MATIKA_SAY_REMOTE_URL="http://10.0.0.171:8765"
#   scripts/matika-say.sh en 165 "Geeta Iyer" 600

set -euo pipefail

LANG_CODE="${1:?lang (en|hi|bn) required}"
RATE="${2:?rate (e.g. 175) required}"
UTTER="${3:?utterance required}"
PREDELAY_MS="${4:-0}"

# --- Remote-TTS branch ------------------------------------------------
if [[ -n "${MATIKA_SAY_REMOTE_URL:-}" ]]; then
    if ! command -v curl >/dev/null 2>&1; then
        echo "ERROR: curl required for MATIKA_SAY_REMOTE_URL mode" >&2
        exit 1
    fi
    # bn is supported via the remote server's gTTS path (matika-tts-server.py
    # downloads MP3 from translate_tts and afplays it). No Mac mini fallback
    # needed any more.
    if [[ "$PREDELAY_MS" -gt 0 ]]; then
        sleep "$(awk "BEGIN{ print $PREDELAY_MS / 1000 }")"
    fi
    # Build JSON body — prefer jq for proper string escaping; fall back
    # to a python one-liner (always present on macOS) if jq is missing.
    if command -v jq >/dev/null 2>&1; then
        BODY=$(jq -nc --arg lang "$LANG_CODE" --argjson rate "$RATE" --arg text "$UTTER" \
            '{lang:$lang, rate:$rate, text:$text}')
    else
        BODY=$(python3 -c 'import json,sys; print(json.dumps({"lang":sys.argv[1],"rate":int(sys.argv[2]),"text":sys.argv[3]}))' \
            "$LANG_CODE" "$RATE" "$UTTER")
    fi
    RESP=$(curl -sS --fail-with-body --max-time 35 -X POST "${MATIKA_SAY_REMOTE_URL%/}/say" \
        -H 'Content-Type: application/json' --data "$BODY") || {
        rc=$?
        echo "ERROR: remote say failed (curl rc=$rc): $RESP" >&2
        exit "$rc"
    }
    # Echo duration to stderr so the harness log captures TTS latency.
    echo "[remote-say] $RESP" >&2
    exit 0
fi

# --- Local-say branch (original behavior) -----------------------------
if ! command -v SwitchAudioSource >/dev/null 2>&1; then
    echo "ERROR: SwitchAudioSource not on PATH. brew install switchaudio-osx" >&2
    exit 1
fi

TARGET_OUTPUT="${MATIKA_OUTPUT_DEVICE:-}"
if [[ -n "$TARGET_OUTPUT" ]]; then
    CURRENT_OUTPUT="$(SwitchAudioSource -c 2>/dev/null || true)"
    if [[ "${MATIKA_FORCE_OUTPUT_REASSERT:-0}" == "1" || "$CURRENT_OUTPUT" != "$TARGET_OUTPUT" ]]; then
        SwitchAudioSource -t output -s "$TARGET_OUTPUT" >/dev/null
    fi
fi

# Floating-point sleep — bc isn't always present on a fresh macOS;
# awk is. Skip the sleep entirely if zero.
if [[ "$PREDELAY_MS" -gt 0 ]]; then
    sleep "$(awk "BEGIN{ print $PREDELAY_MS / 1000 }")"
fi

case "$LANG_CODE" in
    en)
        exec say -v Rishi -r "$RATE" "$UTTER"
        ;;
    hi)
        exec say -v Lekha -r "$RATE" "$UTTER"
        ;;
    bn)
        if [[ -n "${MATIKA_BN_AUDIO:-}" && -f "$MATIKA_BN_AUDIO" ]]; then
            exec afplay "$MATIKA_BN_AUDIO"
        fi
        echo "ERROR: macOS has no native Bengali say voice." >&2
        echo "Stage a recording and set MATIKA_BN_AUDIO=<path-to-aiff>." >&2
        exit 2
        ;;
    *)
        echo "ERROR: unsupported lang '$LANG_CODE' (use en|hi|bn)" >&2
        exit 2
        ;;
esac
