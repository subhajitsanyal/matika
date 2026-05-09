#!/usr/bin/env bash
# Wrapper for running Maestro flows against a connected Android device.
#
# Verifies prerequisites, optionally reinstalls a fresh APK, and runs
# the requested flow (or all flows if no arg given).
#
# Usage:
#   scripts/maestro-run.sh                                    # all flows
#   scripts/maestro-run.sh caregiver_protocol_setup           # one flow
#   scripts/maestro-run.sh --no-install patient_logging_*     # skip install
#
# Pre-conditions:
#   ~/.matika-test-creds.env has MATIKA_CAREGIVER_EMAIL/_PASSWORD +
#   MATIKA_PATIENT_EMAIL/_PASSWORD. See .maestro/README.md.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APK="$ROOT/android/app/build/outputs/apk/debug/app-debug.apk"
FLOWS_DIR="$ROOT/.maestro/flows"
CREDS="${MATIKA_CREDS_FILE:-$HOME/.matika-test-creds.env}"

INSTALL=1
if [[ "${1:-}" == "--no-install" ]]; then
    INSTALL=0
    shift
fi

# ── Sanity checks ─────────────────────────────────────────
if ! command -v maestro >/dev/null 2>&1; then
    echo "ERROR: maestro not on PATH. Install via:" >&2
    echo "  curl -Ls 'https://get.maestro.mobile.dev' | bash" >&2
    exit 1
fi

if ! command -v adb >/dev/null 2>&1; then
    echo "ERROR: adb not on PATH. Install Android platform-tools." >&2
    exit 1
fi

if ! adb devices | grep -E '\bdevice$' >/dev/null; then
    echo "ERROR: no Android device connected. 'adb devices' output:" >&2
    adb devices >&2
    exit 1
fi

if [[ ! -f "$CREDS" ]]; then
    echo "ERROR: credentials file not found at $CREDS" >&2
    echo "See .maestro/README.md for the template." >&2
    exit 1
fi

# shellcheck disable=SC1090
source "$CREDS"

for var in MATIKA_CAREGIVER_EMAIL MATIKA_CAREGIVER_PASSWORD MATIKA_PATIENT_EMAIL MATIKA_PATIENT_PASSWORD; do
    if [[ -z "${!var:-}" ]]; then
        echo "ERROR: $var not set in $CREDS" >&2
        exit 1
    fi
done

# ── Optional install ──────────────────────────────────────
if [[ $INSTALL -eq 1 ]]; then
    if [[ ! -f "$APK" ]]; then
        echo "ERROR: debug APK not built at $APK" >&2
        echo "Run: (cd android && ./gradlew :app:assembleDebug)" >&2
        exit 1
    fi
    echo "▸ Installing $APK"
    adb install -r "$APK"
    adb shell am force-stop com.carelog
fi

# ── Run flow(s) ───────────────────────────────────────────
TARGET="${FLOWS_DIR}"
if [[ $# -gt 0 ]]; then
    TARGET="$FLOWS_DIR/${1%.yaml}.yaml"
    if [[ ! -f "$TARGET" ]]; then
        echo "ERROR: no flow named '${1%.yaml}'. Available:" >&2
        ls "$FLOWS_DIR"/*.yaml | xargs -n1 basename >&2
        exit 1
    fi
fi

echo "▸ Running maestro: $TARGET"
# Maestro does not auto-import shell env vars — `${VAR}` references in
# the YAML resolve to the literal "undefined" unless we pass them
# explicitly via --env. Forward the four creds we expect.
exec maestro test "$TARGET" \
    -e "MATIKA_CAREGIVER_EMAIL=$MATIKA_CAREGIVER_EMAIL" \
    -e "MATIKA_CAREGIVER_PASSWORD=$MATIKA_CAREGIVER_PASSWORD" \
    -e "MATIKA_PATIENT_EMAIL=$MATIKA_PATIENT_EMAIL" \
    -e "MATIKA_PATIENT_PASSWORD=$MATIKA_PATIENT_PASSWORD"
