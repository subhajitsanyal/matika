#!/usr/bin/env bash
#
# CareLog Cron Job Setup Script
#
# Installs all monitoring cron jobs:
# - health-cron.sh every 5 minutes
# - cleanup-tmp.sh every 15 minutes
# - service-watchdog.sh every 1 minute
# - Log rotation daily
#
# Usage: sudo ./setup-cron.sh
#
# This script is idempotent — removes existing CareLog cron entries before adding.

set -euo pipefail

CARELOG_HOME="/opt/carelog"
LOGS_DIR="${CARELOG_HOME}/logs"
MONITORING_DIR="${CARELOG_HOME}/monitoring"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ---------------------------------------------------------------------------
# Helper Functions
# ---------------------------------------------------------------------------
log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] [setup-cron] $*"; }
warn() { log "WARNING: $*"; }
die() { echo "ERROR: $*" >&2; exit 1; }

check_root() {
    if [[ $EUID -ne 0 ]]; then
        die "This script must be run as root (use sudo)."
    fi
}

# ---------------------------------------------------------------------------
# Install monitoring scripts to /opt/carelog/monitoring/
# ---------------------------------------------------------------------------
install_scripts() {
    log "Installing monitoring scripts to ${MONITORING_DIR}..."

    mkdir -p "${MONITORING_DIR}"
    mkdir -p "${LOGS_DIR}"

    local scripts=(health-cron.sh cleanup-tmp.sh service-watchdog.sh)
    for script in "${scripts[@]}"; do
        if [[ -f "${SCRIPT_DIR}/${script}" ]]; then
            cp "${SCRIPT_DIR}/${script}" "${MONITORING_DIR}/${script}"
            chmod +x "${MONITORING_DIR}/${script}"
            log "  Installed: ${script}"
        else
            warn "  Script not found: ${SCRIPT_DIR}/${script}"
        fi
    done

    chown -R carelog:staff "${MONITORING_DIR}" 2>/dev/null || true
}

# ---------------------------------------------------------------------------
# Install cron jobs
# ---------------------------------------------------------------------------
install_cron_jobs() {
    log "Installing cron jobs..."

    local CRON_TMP
    CRON_TMP="$(mktemp)"

    # Preserve existing non-CareLog cron entries
    crontab -l 2>/dev/null | grep -v "carelog" > "${CRON_TMP}" || true

    cat >> "${CRON_TMP}" <<CRON
# ---- CareLog Monitoring Cron Jobs ----
# Health/resource logging every 5 minutes (carelog)
*/5 * * * * ${MONITORING_DIR}/health-cron.sh >> ${LOGS_DIR}/monitoring.log 2>&1
# Tmp directory cleanup every 15 minutes (carelog)
*/15 * * * * ${MONITORING_DIR}/cleanup-tmp.sh >> ${LOGS_DIR}/monitoring.log 2>&1
# Service watchdog every 1 minute (carelog)
* * * * * ${MONITORING_DIR}/service-watchdog.sh >> ${LOGS_DIR}/watchdog.log 2>&1
# Log rotation daily at 2 AM (carelog)
0 2 * * * /usr/local/bin/logrotate /usr/local/etc/logrotate.d/carelog --state ${CARELOG_HOME}/logrotate.state >> ${LOGS_DIR}/logrotate.log 2>&1
# ---- End CareLog Cron Jobs ----
CRON

    crontab "${CRON_TMP}"
    rm -f "${CRON_TMP}"

    log "Cron jobs installed successfully."
}

# ---------------------------------------------------------------------------
# Install logrotate configuration
# ---------------------------------------------------------------------------
install_logrotate() {
    log "Installing logrotate configuration..."

    local LOGROTATE_DIR="/usr/local/etc/logrotate.d"
    mkdir -p "${LOGROTATE_DIR}"

    cat > "${LOGROTATE_DIR}/carelog" <<LOGROTATE
${LOGS_DIR}/*.log {
    daily
    rotate 30
    compress
    delaycompress
    missingok
    notifempty
    create 644 carelog staff
    dateext
    dateformat -%Y%m%d
}

${LOGS_DIR}/watchdog.log {
    daily
    rotate 14
    compress
    delaycompress
    missingok
    notifempty
    create 644 carelog staff
    dateext
    dateformat -%Y%m%d
}
LOGROTATE

    log "Logrotate config installed to ${LOGROTATE_DIR}/carelog."
}

# ---------------------------------------------------------------------------
# Verify installation
# ---------------------------------------------------------------------------
verify() {
    log "Verifying cron installation..."

    echo ""
    echo "  Installed cron jobs:"
    echo "  --------------------"
    crontab -l 2>/dev/null | grep "carelog" | while IFS= read -r line; do
        echo "  ${line}"
    done

    echo ""
    echo "  Monitoring scripts:"
    echo "  -------------------"
    for script in health-cron.sh cleanup-tmp.sh service-watchdog.sh; do
        if [[ -x "${MONITORING_DIR}/${script}" ]]; then
            echo "  [OK] ${MONITORING_DIR}/${script}"
        else
            echo "  [MISSING] ${MONITORING_DIR}/${script}"
        fi
    done
    echo ""
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
main() {
    log "============================================="
    log "CareLog Cron Job Setup"
    log "============================================="

    check_root

    install_scripts
    install_logrotate
    install_cron_jobs
    verify

    log "Cron setup complete."
    log ""
    log "Schedule:"
    log "  - health-cron.sh:       every 5 minutes"
    log "  - cleanup-tmp.sh:       every 15 minutes"
    log "  - service-watchdog.sh:  every 1 minute"
    log "  - log rotation:         daily at 2:00 AM"
}

main "$@"
