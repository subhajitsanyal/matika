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
# Example (loud-bench, External Headphones device, switch-once):
#   export MATIKA_OUTPUT_DEVICE="External Headphones"
#   scripts/matika-say.sh en 175 "My BP is one thirty over eighty five." 600

set -euo pipefail

LANG_CODE="${1:?lang (en|hi|bn) required}"
RATE="${2:?rate (e.g. 175) required}"
UTTER="${3:?utterance required}"
PREDELAY_MS="${4:-0}"

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
