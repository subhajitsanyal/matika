#!/usr/bin/env bash
# Voice journey runner with logcat-trigger orchestration.
#
# Replaces the fixed-sleep pattern that masked PT-V2-03 in sweep
# 20260508_215314 (mic activated at T+45s, orchestration spoke at T+25s,
# STT got 0 hypotheses). Fix from docs/testing_todos_v2.md F7.
#
# Usage:
#   scripts/matika-voice-run.sh <flow_name> \
#       [--no-install] \
#       --turn "en|175|My blood pressure is one thirty over eighty five.|600" \
#       --turn "en|175|Yes, that's correct.|400"
#
# Turn spec format:
#   lang|rate|utterance[|predelay-ms]
#   - lang:       en | hi | bn   (matika-say.sh maps to Rishi/Lekha/$MATIKA_BN_AUDIO)
#   - rate:       say -r value (e.g. 175 for English, 165 for Hindi)
#   - utterance:  the spoken text (cannot contain '|')
#   - predelay:   ms before say (default 600). Compensates for mic-tap →
#                 SpeechRecognizer.startListening latency.
#
# How it works:
#   1. Background scripts/maestro-run.sh against the flow.
#   2. For each --turn: block on `adb logcat -e "<trigger>" -m 1` —
#      this exits the moment a single matching line appears.
#      Trigger pattern: SodaSpeechRecognizer.*Offline recognizer - start listening
#      That fires when MatikaConversationViewModel calls
#      SpeechRecognizer.startListening(), which is exactly the moment
#      we want to speak.
#   3. matika-say.sh speaks the utterance. Its own --predelay defaults
#      to 600ms — enough margin for SpeechRecognizer init.
#   4. adb logcat -c clears the buffer so the next turn's wait doesn't
#      match this turn's trigger line.
#   5. wait $MAESTRO_PID; exit with maestro's rc.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# `adb logcat -e PATTERN` filters on the MESSAGE field only, not on the
# tag or the full line. The trigger fires inside SttManager's
# RecognitionListener.onReadyForSpeech() — emitted on every device the
# moment the SpeechRecognizer hands the mic to the user, regardless of
# OEM. Earlier we relied on Google Soda's "Offline recognizer - start
# listening" system log; that line only appears on Pixel/Google ROMs
# and was silent on Samsung One UI, breaking the harness during the
# 2026-05-09 voice sweep.
TRIGGER='RecognitionListener.onReadyForSpeech'
TURN_TIMEOUT_S="${MATIKA_TURN_TIMEOUT_S:-90}"

INSTALL_FLAGS=()
TURNS=()
FLOW=""

# Parse args order-independently (also fixes F5 for this script).
while (( $# )); do
    case "$1" in
        --no-install)
            INSTALL_FLAGS+=("--no-install")
            ;;
        --turn)
            shift
            if [[ $# -eq 0 ]]; then
                echo "ERROR: --turn needs a value" >&2; exit 2
            fi
            TURNS+=("$1")
            ;;
        --help|-h)
            sed -n '2,/^$/p' "$0"
            exit 0
            ;;
        --*)
            echo "ERROR: unknown flag '$1'" >&2; exit 2
            ;;
        *)
            if [[ -z "$FLOW" ]]; then
                FLOW="$1"
            else
                echo "ERROR: multiple flow names provided ('$FLOW', '$1')" >&2; exit 2
            fi
            ;;
    esac
    shift
done

if [[ -z "$FLOW" ]]; then
    echo "ERROR: provide a flow name (e.g. patient_voice_bp_en)" >&2
    exit 2
fi
if [[ ${#TURNS[@]} -eq 0 ]]; then
    echo "ERROR: provide at least one --turn 'lang|rate|utterance[|predelay]'" >&2
    exit 2
fi
if ! command -v adb >/dev/null 2>&1; then
    echo "ERROR: adb not on PATH" >&2; exit 1
fi
if [[ ! -x "$ROOT/scripts/maestro-run.sh" ]]; then
    echo "ERROR: scripts/maestro-run.sh missing or not executable" >&2; exit 1
fi
if [[ ! -x "$ROOT/scripts/matika-say.sh" ]]; then
    echo "ERROR: scripts/matika-say.sh missing or not executable" >&2; exit 1
fi

# Clean logcat once before launching anything so the very first turn's
# wait can't match a stale event.
adb logcat -c

echo "▸ launching maestro flow: $FLOW (${#TURNS[@]} turn(s) queued)"
# Important: don't quote-expand an empty INSTALL_FLAGS array as
# "${INSTALL_FLAGS[@]:-}" — that yields a single literal "" arg which
# poisons maestro-run.sh's positional flow-name lookup ("no flow named
# ''"). Expand without the default and let the array vanish when empty.
if [[ ${#INSTALL_FLAGS[@]} -gt 0 ]]; then
    "$ROOT/scripts/maestro-run.sh" "${INSTALL_FLAGS[@]}" "$FLOW" &
else
    "$ROOT/scripts/maestro-run.sh" "$FLOW" &
fi
MAESTRO_PID=$!

cleanup() {
    if kill -0 "$MAESTRO_PID" 2>/dev/null; then
        echo "▸ cleanup: terminating maestro pid $MAESTRO_PID"
        kill "$MAESTRO_PID" 2>/dev/null || true
    fi
}
trap cleanup EXIT

turn_n=0
for spec in "${TURNS[@]}"; do
    turn_n=$((turn_n + 1))
    IFS='|' read -r lang rate utter predelay <<< "$spec"
    predelay="${predelay:-600}"

    if [[ -z "${lang:-}" || -z "${rate:-}" || -z "${utter:-}" ]]; then
        echo "ERROR: turn $turn_n malformed: '$spec' (need lang|rate|utterance[|predelay])" >&2
        exit 2
    fi

    echo "▸ turn $turn_n — waiting for mic-active trigger (timeout ${TURN_TIMEOUT_S}s)"
    ( adb logcat -e "$TRIGGER" -m 1 >/dev/null 2>&1 ) &
    GREP_PID=$!

    elapsed=0
    while kill -0 "$GREP_PID" 2>/dev/null; do
        if ! kill -0 "$MAESTRO_PID" 2>/dev/null; then
            kill "$GREP_PID" 2>/dev/null || true
            echo "ERROR: maestro exited before turn $turn_n mic-active trigger" >&2
            wait "$MAESTRO_PID" 2>/dev/null || true
            exit 1
        fi
        if (( elapsed >= TURN_TIMEOUT_S )); then
            kill "$GREP_PID" 2>/dev/null || true
            echo "ERROR: turn $turn_n mic-active trigger did not fire in ${TURN_TIMEOUT_S}s" >&2
            exit 1
        fi
        sleep 1
        elapsed=$((elapsed + 1))
    done
    wait "$GREP_PID" 2>/dev/null || true

    echo "▸ turn $turn_n — mic active after ${elapsed}s; speaking ($lang @ $rate r/m): $utter"
    "$ROOT/scripts/matika-say.sh" "$lang" "$rate" "$utter" "$predelay"

    # Clear so the next --turn's wait doesn't see this turn's trigger.
    adb logcat -c
done

# All speaks done; wait for Maestro to finish its assertions.
wait "$MAESTRO_PID"
RC=$?
trap - EXIT
echo "▸ maestro exit=$RC"
exit "$RC"
