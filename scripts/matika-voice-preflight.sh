#!/usr/bin/env bash
# Voice-bench preflight: hard-block the run before it wastes a Maestro
# launch if the harness is in a known-bad state.
#
# Checks in order:
#   1. Core Audio responsive (afplay Pop.aiff with a 3s timeout) —
#      catches the F41 wedge regression. Exit 2 if -66681 or if the
#      command hangs.
#   2. Orphan `say` processes from prior runs killed — F21 mitigation.
#   3. adb device reachable (any device; specific device check is the
#      orchestrator's responsibility).
#   4. Echo the currently-selected output device + recommended
#      MATIKA_OUTPUT_DEVICE state so logs capture the rig.
#
# Usage:
#   scripts/matika-voice-preflight.sh
#     → exit 0 = ready to run
#     → exit 1 = adb/say cleanup failure (recoverable, but surface)
#     → exit 2 = Core Audio wedged (F41 active — REBOOT REQUIRED)
#
# Called automatically at the top of scripts/matika-voice-run.sh.
# Operators driving voice manually (without the runner) should call
# this themselves before the first utterance of a session.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SOUND_FILE="/System/Library/Sounds/Pop.aiff"
PREFLIGHT_RC=0

echo "▸ voice preflight starting at $(date -u +%Y-%m-%dT%H:%M:%SZ)"

# 1. Core Audio responsive? Run afplay in the background so we can
# timeout it — afplay on a wedged HAL hangs indefinitely past `kill`,
# and `kill -9` doesn't always reap the audio-IO sleep.
if [[ ! -f "$SOUND_FILE" ]]; then
    echo "WARN: $SOUND_FILE missing on this macOS — skipping Core Audio sanity." >&2
else
    AFPLAY_LOG="$(mktemp -t matika-afplay-XXXXXX)"
    afplay "$SOUND_FILE" >"$AFPLAY_LOG" 2>&1 &
    AFPLAY_PID=$!
    AFPLAY_ELAPSED=0
    while kill -0 "$AFPLAY_PID" 2>/dev/null; do
        if (( AFPLAY_ELAPSED >= 3 )); then
            kill "$AFPLAY_PID" 2>/dev/null || true
            kill -9 "$AFPLAY_PID" 2>/dev/null || true
            wait "$AFPLAY_PID" 2>/dev/null || true
            echo "ERROR: afplay hung >3s on $SOUND_FILE — Core Audio wedged (F41)." >&2
            echo "       Reboot the Mac mini before retrying. See voice_harness_lessons.md lesson 6 + testing_todos_v2.md F41." >&2
            rm -f "$AFPLAY_LOG"
            exit 2
        fi
        sleep 1
        AFPLAY_ELAPSED=$((AFPLAY_ELAPSED + 1))
    done
    if ! wait "$AFPLAY_PID"; then
        if grep -q "AudioQueueStart failed" "$AFPLAY_LOG"; then
            echo "ERROR: afplay returned AudioQueueStart failure — Core Audio wedged (F41)." >&2
            echo "       $(grep AudioQueueStart "$AFPLAY_LOG" | head -1)" >&2
            echo "       Reboot the Mac mini before retrying." >&2
            rm -f "$AFPLAY_LOG"
            exit 2
        fi
        echo "WARN: afplay non-zero exit (not the F41 signature). Output:" >&2
        cat "$AFPLAY_LOG" >&2
        # Don't hard-fail — could be a missing audio device with no
        # actual wedge. Surface and continue.
    fi
    rm -f "$AFPLAY_LOG"
    echo "  ✓ Core Audio responsive (afplay Pop.aiff completed in ${AFPLAY_ELAPSED}s)"
fi

# 2. Reap orphan `say` processes (F21 — wedged say queue between
# sweeps). pkill returns 1 when nothing matched; that's the
# happy-path, not an error.
if pkill -x say 2>/dev/null; then
    echo "  ✓ killed orphan say process(es)"
else
    echo "  ✓ no orphan say processes"
fi

# 3. adb reachable + at least one device attached.
if ! command -v adb >/dev/null 2>&1; then
    echo "ERROR: adb not on PATH" >&2
    exit 1
fi
DEVICE_COUNT=$(adb devices 2>/dev/null | awk 'NR>1 && /device$/ {n++} END{print n+0}')
if [[ "$DEVICE_COUNT" -eq 0 ]]; then
    echo "ERROR: no adb device attached. Plug the phone in / authorize USB debugging." >&2
    PREFLIGHT_RC=1
else
    DEVICE_LIST=$(adb devices 2>/dev/null | awk 'NR>1 && /device$/ {print $1}' | paste -sd, -)
    echo "  ✓ adb device(s) attached: $DEVICE_LIST"
fi

# 4. Echo current audio output + the env var state so the run log
# captures the rig. Not a check — informational.
if command -v SwitchAudioSource >/dev/null 2>&1; then
    CURRENT_OUTPUT="$(SwitchAudioSource -c 2>/dev/null || echo '<unknown>')"
    echo "  ◦ current output device: $CURRENT_OUTPUT"
    echo "  ◦ MATIKA_OUTPUT_DEVICE env: '${MATIKA_OUTPUT_DEVICE:-<unset>}'"
    if [[ -n "${MATIKA_OUTPUT_DEVICE:-}" && "$CURRENT_OUTPUT" != "${MATIKA_OUTPUT_DEVICE}" ]]; then
        echo "  ◦ matika-say.sh will switch to '${MATIKA_OUTPUT_DEVICE}' on the first utterance, then leave it alone."
    fi
else
    echo "WARN: SwitchAudioSource not on PATH (brew install switchaudio-osx). matika-say.sh will fail." >&2
    PREFLIGHT_RC=1
fi

echo "▸ voice preflight done (rc=$PREFLIGHT_RC)"
exit $PREFLIGHT_RC
