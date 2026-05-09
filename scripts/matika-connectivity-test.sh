#!/usr/bin/env bash
#
# PT-V2-13 orchestrator — toggles wifi via adb between Maestro flow
# invocations to exercise the connectivity-loss + recovery path.
#
# Maestro's runScript can't shell out, so the wifi toggle has to live
# outside the flow. Three flows share an app instance; the only one
# that uses clearState is part 1.
#
# Pre-conditions:
#   - APK installed
#   - Single device on adb
#   - $MATIKA_PATIENT_EMAIL / $MATIKA_PATIENT_PASSWORD exported
#     (source ~/.matika-test-creds.env first)
#
# Exit codes:
#   0 — all three parts passed; wifi restored to ENABLED
#   1 — any part failed; wifi WAS restored to ENABLED before exit

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FLOWS_DIR="${REPO_ROOT}/.maestro/flows"

# Always re-enable wifi on any exit path so we don't leave the device
# offline for the next test.
trap 'adb shell svc wifi enable >/dev/null 2>&1; sleep 2' EXIT INT TERM

if ! command -v maestro >/dev/null 2>&1; then
  if [[ -x "${HOME}/.maestro/bin/maestro" ]]; then
    export PATH="${HOME}/.maestro/bin:${PATH}"
  else
    echo "ERROR: maestro not on PATH." >&2
    exit 1
  fi
fi

if ! command -v adb >/dev/null 2>&1; then
  echo "ERROR: adb not on PATH." >&2
  exit 1
fi

run_part() {
  local part_label="$1" flow_path="$2"
  echo
  echo "==> ${part_label}"
  # Maestro doesn't auto-import shell env vars; the four cred env vars
  # have to be passed explicitly via -e. Same convention as
  # scripts/maestro-run.sh.
  if ! maestro test "${flow_path}" \
      -e "MATIKA_CAREGIVER_EMAIL=${MATIKA_CAREGIVER_EMAIL:-}" \
      -e "MATIKA_CAREGIVER_PASSWORD=${MATIKA_CAREGIVER_PASSWORD:-}" \
      -e "MATIKA_PATIENT_EMAIL=${MATIKA_PATIENT_EMAIL:-}" \
      -e "MATIKA_PATIENT_PASSWORD=${MATIKA_PATIENT_PASSWORD:-}"; then
    echo "FAIL: ${part_label}"
    return 1
  fi
}

# Make sure wifi is on before we begin.
adb shell svc wifi enable >/dev/null
# Give Android a moment to actually associate.
sleep 4

# Part 1 — log in, reach the conversation screen.
run_part "Part 1: setup (wifi=ON)" \
  "${FLOWS_DIR}/patient_connectivity_loss_part1_setup.yaml" || exit 1

# Disable wifi. Wait long enough that the next /conversation/turn POST
# actually fails the connection rather than being held in the OS buffer.
echo "==> Disabling wifi"
adb shell svc wifi disable >/dev/null
sleep 6

# Part 2 — submit a turn while offline; assert the snackbar error.
run_part "Part 2: offline turn (wifi=OFF)" \
  "${FLOWS_DIR}/patient_connectivity_loss_part2_offline.yaml" || exit 1

# Re-enable wifi and let the OS reassociate before retry.
echo "==> Re-enabling wifi"
adb shell svc wifi enable >/dev/null
sleep 8

# Part 3 — retry the turn; assert the response card.
run_part "Part 3: recovery turn (wifi=ON)" \
  "${FLOWS_DIR}/patient_connectivity_loss_part3_recover.yaml" || exit 1

echo
echo "==> All three parts PASSED"
