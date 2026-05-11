#!/usr/bin/env bash
#
# EDGE-V2-14 orchestrator — drops wifi between part 1 (navigate to
# BP screen) and part 2 (offline save), then re-enables wifi and
# polls CloudWatch for the sync-observation lambda's "Stored
# observation" log line. Proves the manual-log path survives a
# network drop without data loss.
#
# Unblocked 2026-05-11: AuthRepository now has a BuildConfig.DEBUG-
# gated offline bypass — if Amplify's local token cache says the
# user is signed in but the remote attribute fetch fails AND the
# device is offline, the splash trusts a cached user blob and
# routes to the persona's home instead of falling back to login.
# That keeps Maestro on BloodPressureScreen across the wifi=OFF
# launchApp boundary in part 2.
#
# Pre-conditions:
#   - APK installed
#   - Single device on adb
#   - $MATIKA_PATIENT_EMAIL / $MATIKA_PATIENT_PASSWORD exported
#     (source ~/.matika-test-creds.env first)
#   - AWS credentials with logs:FilterLogEvents on the
#     /aws/lambda/carelog-dev-sync-observation log group
#
# Exit codes:
#   0 — both parts passed + CloudWatch confirmed the post-recovery
#       sync; wifi restored to ENABLED
#   1 — any part failed; wifi WAS restored to ENABLED before exit

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FLOWS_DIR="${REPO_ROOT}/.maestro/flows"

trap 'adb shell svc wifi enable >/dev/null 2>&1; sleep 2' EXIT INT TERM

if ! command -v maestro >/dev/null 2>&1; then
  if [[ -x "${HOME}/.maestro/bin/maestro" ]]; then
    export PATH="${HOME}/.maestro/bin:${PATH}"
  else
    echo "ERROR: maestro not on PATH." >&2
    exit 1
  fi
fi

run_part() {
  local part_label="$1" flow_path="$2"
  echo
  echo "==> ${part_label}"
  if ! maestro test "${flow_path}" \
      -e "MATIKA_CAREGIVER_EMAIL=${MATIKA_CAREGIVER_EMAIL:-}" \
      -e "MATIKA_CAREGIVER_PASSWORD=${MATIKA_CAREGIVER_PASSWORD:-}" \
      -e "MATIKA_PATIENT_EMAIL=${MATIKA_PATIENT_EMAIL:-}" \
      -e "MATIKA_PATIENT_PASSWORD=${MATIKA_PATIENT_PASSWORD:-}"; then
    echo "FAIL: ${part_label}"
    return 1
  fi
}

# Remember the wall-clock cutoff for the CloudWatch filter so we
# only match new "Stored observation" lines from THIS run.
START_EPOCH_MS=$(python3 -c 'import time; print(int(time.time()*1000))')

adb shell svc wifi enable >/dev/null
sleep 4

run_part "Part 1: navigate to BP (wifi=ON)" \
  "${FLOWS_DIR}/edge_v2_14_part1_navigate.yaml" || exit 1

echo "==> Disabling wifi"
adb shell svc wifi disable >/dev/null
sleep 6

run_part "Part 2: offline BP save (wifi=OFF)" \
  "${FLOWS_DIR}/edge_v2_14_part2_save_offline.yaml" || exit 1

echo "==> Re-enabling wifi"
adb shell svc wifi enable >/dev/null
# WorkManager retries via exponential backoff. The first retry after
# a failure can take up to 30s with default constraints; give a
# generous window.
sleep 35

echo "==> Polling CloudWatch for post-recovery sync"
# Filter the sync-observation log group for any "Stored observation"
# line newer than this run's start cutoff. Allow up to 4 retries
# spaced 10s apart — the lambda log can lag the actual write by a
# few seconds.
for i in 1 2 3 4; do
  HIT=$(aws logs filter-log-events \
        --log-group-name /aws/lambda/carelog-dev-sync-observation \
        --start-time "${START_EPOCH_MS}" \
        --filter-pattern '"Stored observation"' \
        --region ap-south-1 --max-items 5 2>/dev/null \
        | python3 -c 'import json,sys; d=json.load(sys.stdin); print(len(d.get("events",[])))')
  if [[ "${HIT:-0}" -ge 1 ]]; then
    echo "==> CloudWatch confirms ${HIT} post-recovery sync(s)"
    echo
    echo "==> EDGE-V2-14 PASS"
    exit 0
  fi
  echo "    (no sync yet — sleep 10)"
  sleep 10
done

echo "FAIL: no sync-observation log line observed after wifi recovery" >&2
exit 1
