#!/usr/bin/env bash
#
# CareLog Temporary Directory Cleanup Script
#
# Removes stale directories and files from /tmp/carelog/ and /opt/carelog/tmp/
# that are older than 30 minutes.
#
# Intended to run every 15 minutes via cron.

set -euo pipefail

TIMESTAMP="$(date '+%Y-%m-%d %H:%M:%S')"
CARELOG_TMP="/opt/carelog/tmp"
SYSTEM_TMP="/tmp/carelog"
STALE_MINUTES=30

log() { echo "[${TIMESTAMP}] [cleanup-tmp] $*"; }

cleaned=0

# ---------------------------------------------------------------------------
# Clean /opt/carelog/tmp/ (session data, staging files)
# ---------------------------------------------------------------------------
if [[ -d "${CARELOG_TMP}" ]]; then
    while IFS= read -r -d '' item; do
        log "Removing stale item: ${item}"
        rm -rf "${item}"
        cleaned=$((cleaned + 1))
    done < <(find "${CARELOG_TMP}" -mindepth 1 -maxdepth 1 -mmin "+${STALE_MINUTES}" -print0 2>/dev/null)
fi

# ---------------------------------------------------------------------------
# Clean /tmp/carelog/ (ephemeral session directories)
# ---------------------------------------------------------------------------
if [[ -d "${SYSTEM_TMP}" ]]; then
    while IFS= read -r -d '' item; do
        log "Removing stale item: ${item}"
        rm -rf "${item}"
        cleaned=$((cleaned + 1))
    done < <(find "${SYSTEM_TMP}" -mindepth 1 -maxdepth 1 -mmin "+${STALE_MINUTES}" -print0 2>/dev/null)
fi

if [[ ${cleaned} -gt 0 ]]; then
    log "Cleaned ${cleaned} stale item(s)."
else
    log "No stale items found."
fi
