#!/usr/bin/env bash
# Speaks an utterance through the Mac's External Headphones output so
# the Android phone (placed near the speaker) picks it up via mic.
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
# Example:
#   scripts/matika-say.sh en 175 "My blood pressure is one thirty over eighty five." 600

set -euo pipefail

LANG_CODE="${1:?lang (en|hi|bn) required}"
RATE="${2:?rate (e.g. 175) required}"
UTTER="${3:?utterance required}"
PREDELAY_MS="${4:-0}"

if ! command -v SwitchAudioSource >/dev/null 2>&1; then
    echo "ERROR: SwitchAudioSource not on PATH. brew install switchaudio-osx" >&2
    exit 1
fi

# matika-say.sh always re-asserts the output device before speaking.
# The user may switch outputs between turns (Bluetooth, AirPods,
# screen-sharing) and we want every utterance to land on the phone.
SwitchAudioSource -t output -s "External Headphones" >/dev/null

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
