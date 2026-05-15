#!/usr/bin/env bash
# cognito-harness-maestro.sh — Stream C orchestrator.
#
# Drives the multi-phase Maestro flows that need an admin-API user
# confirmation (or admin-API user creation) in the middle. Maestro's
# runScript JS sandbox cannot shell out (per maestro_lessons.md #4), so
# the orchestration lives here as a wrapper bash script.
#
# Usage:
#   scripts/cognito-harness-maestro.sh cg-v2-01
#       Self-registration → admin-confirm → login + consent + dashboard.
#       Asserts disclosure substring on the consent screen (also
#       satisfies PT-V2-23 — caregiver and patient see identical text).
#
#   scripts/cognito-harness-maestro.sh cg-v2-01 --keep-user
#       Same, but skip the cleanup so dev RDS rows survive for inspection.
#
# Cleans up the test user (admin-delete-user) at the end unless
# --keep-user is passed.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APK="$ROOT/android/app/build/outputs/apk/debug/app-debug.apk"
FLOWS_DIR="$ROOT/.maestro/flows"

# shellcheck source=../test-automation/scripts/cognito-test-harness.sh
source "$ROOT/test-automation/scripts/cognito-test-harness.sh"

KEEP_USER=0
INSTALL=1
JOURNEY=""
for a in "$@"; do
    case "$a" in
        --keep-user) KEEP_USER=1 ;;
        --no-install) INSTALL=0 ;;
        *) JOURNEY="$a" ;;
    esac
done

if [[ -z "$JOURNEY" ]]; then
    echo "usage: $0 <journey> [--keep-user] [--no-install]" >&2
    echo "  journeys: cg-v2-01" >&2
    exit 1
fi

# ── Sanity checks (mirror maestro-run.sh) ─────────────────
for cmd in maestro adb aws; do
    command -v "$cmd" >/dev/null 2>&1 || { echo "ERROR: $cmd not on PATH"; exit 1; }
done
adb devices | grep -E '\bdevice$' >/dev/null || {
    echo "ERROR: no Android device connected"; adb devices; exit 1; }

# ── Optional install ──────────────────────────────────────
if [[ $INSTALL -eq 1 ]]; then
    [[ -f "$APK" ]] || { echo "ERROR: APK not built at $APK; run ./gradlew :app:assembleDebug"; exit 1; }
    echo "▸ Installing $APK"
    adb install -r "$APK"
    adb shell am force-stop com.carelog
fi

# ── Resolve dev pool/client ───────────────────────────────
harness_init

# ── Per-journey orchestration ─────────────────────────────
case "$JOURNEY" in
    cg-v2-01)
        EMAIL="$(harness_generate_test_email cg)"
        PASSWORD="${MATIKA_REGISTER_PASSWORD:-Carelog2026@x}"
        NAME="Stream C Test ${EMAIL##*+}"
        echo "▸ Test caregiver email: $EMAIL"

        echo "▸ Phase 1 — register form fill"
        maestro test "$FLOWS_DIR/cg_v2_01_self_register_part1.yaml" \
            -e "MATIKA_REGISTER_EMAIL=$EMAIL" \
            -e "MATIKA_REGISTER_PASSWORD=$PASSWORD" \
            -e "MATIKA_REGISTER_NAME=$NAME"

        echo "▸ Harness — admin-confirm-sign-up (skips real OTP email)"
        harness_admin_confirm_signup "$EMAIL"

        # post-confirmation Lambda runs async-ish on Cognito's side;
        # give it a moment to write the users row before login triggers
        # GET /consent (which resolves cognito_sub → users.id).
        sleep 3

        echo "▸ Phase 2 — login + consent + dashboard"
        maestro test "$FLOWS_DIR/cg_v2_01_self_register_part2.yaml" \
            -e "MATIKA_REGISTER_EMAIL=$EMAIL" \
            -e "MATIKA_REGISTER_PASSWORD=$PASSWORD"

        echo "▸ Cognito state after run:"
        harness_admin_get_user "$EMAIL" \
            --query '{Status: UserStatus, Sub: Attributes[?Name==`sub`].Value | [0], EmailVerified: Attributes[?Name==`email_verified`].Value | [0]}'

        if [[ $KEEP_USER -eq 0 ]]; then
            echo "▸ Cleanup — admin-delete-user $EMAIL"
            harness_admin_delete_user "$EMAIL"
        else
            echo "▸ --keep-user set; leaving $EMAIL in Cognito for inspection"
        fi
        ;;
    *)
        echo "Unknown journey: $JOURNEY" >&2
        exit 1
        ;;
esac

echo "▸ Done."
