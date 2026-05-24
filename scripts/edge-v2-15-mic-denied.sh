#!/usr/bin/env bash
# edge-v2-15-mic-denied.sh — EDGE-V2-15 (microphone permission denied)
# wrapper.
#
# Maestro can't shell out to adb mid-flow (maestro_lessons #4), so the
# `pm revoke RECORD_AUDIO` pre-step + `pm grant` post-step are wrapped
# here around the Maestro flow.
#
# Critical post-step: ALWAYS re-grant RECORD_AUDIO at the end, even on
# flow failure. Subsequent voice journeys (PT-V2-03/04/05/06,
# CG-V2-03/04/13) depend on it. We trap EXIT so a Maestro failure or
# manual abort doesn't leave the device with mic permanently denied.
#
# Run:
#   source ~/.matika-test-creds.env
#   scripts/edge-v2-15-mic-denied.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FLOW="$ROOT/.maestro/flows/edge_v2_15_mic_permission_denied.yaml"
PKG="com.carelog"
PERM="android.permission.RECORD_AUDIO"

# ── Pre-flight ────────────────────────────────────────────
for cmd in adb maestro; do
    command -v "$cmd" >/dev/null 2>&1 || { echo "ERROR: $cmd not on PATH" >&2; exit 1; }
done
adb devices | grep -E '\bdevice$' >/dev/null || {
    echo "ERROR: no Android device connected" >&2; adb devices; exit 1; }

# Source creds if not already in the env (mirrors maestro-run.sh:21).
CREDS="${MATIKA_CREDS_FILE:-$HOME/.matika-test-creds.env}"
[[ -f "$CREDS" ]] && source "$CREDS"
for var in MATIKA_PATIENT_EMAIL MATIKA_PATIENT_PASSWORD; do
    [[ -n "${!var:-}" ]] || { echo "ERROR: $var not set (sourced from $CREDS?)" >&2; exit 1; }
done

# ── Always re-grant on exit ───────────────────────────────
cleanup() {
    local rc=$?
    echo "▸ Restoring $PERM grant (rc=$rc)" >&2
    adb shell pm grant "$PKG" "$PERM" 2>&1 | sed 's/^/  /' >&2 || true
    local state
    state="$(adb shell dumpsys package "$PKG" | grep -E "$PERM: granted=" | head -1 | xargs)"
    echo "  → $state" >&2
    exit "$rc"
}
trap cleanup EXIT INT TERM

# ── Pre-step: revoke ──────────────────────────────────────
echo "▸ Revoking $PERM for $PKG"
adb shell pm revoke "$PKG" "$PERM"
state="$(adb shell dumpsys package "$PKG" | grep -E "$PERM: granted=" | head -1 | xargs)"
echo "  → $state"

# Force-stop so the next launch picks up the revoked perm cleanly
# (running activity processes cache the granted state in memory).
adb shell am force-stop "$PKG"

# ── Run flow ──────────────────────────────────────────────
# Explicit -e env passing per voice_harness_lessons #5 — Maestro does
# NOT inherit the wrapper's env vars; each ${VAR} substitution in YAML
# must be -e-bridged.
echo "▸ Running Maestro: $(basename "$FLOW")"
maestro test "$FLOW" \
    -e "MATIKA_PATIENT_EMAIL=$MATIKA_PATIENT_EMAIL" \
    -e "MATIKA_PATIENT_PASSWORD=$MATIKA_PATIENT_PASSWORD"
