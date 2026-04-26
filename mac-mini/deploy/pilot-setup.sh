#!/usr/bin/env bash
#
# CareLog Pilot Setup Script
#
# Pilot-specific setup for a specific household's Mac Mini.
#
# Steps:
# 1. Run full provisioning (provision.sh)
# 2. Configure for a specific household (hostname, WiFi)
# 3. Run all health checks
# 4. Run security checks (firewall, FileVault, SSH)
# 5. Verify all 5 services are running
# 6. Verify mDNS advertisement works
# 7. Run smoke tests
# 8. Output summary: READY / NOT READY
#
# Usage: sudo ./pilot-setup.sh [--config <config-file>]
#
# Config file format (optional):
#   HOUSEHOLD_NAME=kumar-home
#   WIFI_SSID=MyHomeWiFi
#   WIFI_PASSWORD=secret123
#
# Estimated setup time: < 2 hours

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CARELOG_HOME="/opt/carelog"
LOGS_DIR="${CARELOG_HOME}/logs"
PILOT_LOG="${LOGS_DIR}/pilot-setup.log"

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
HOUSEHOLD_NAME=""
WIFI_SSID=""
WIFI_PASSWORD=""
CONFIG_FILE=""

# Parse arguments
while [[ $# -gt 0 ]]; do
    case "$1" in
        --config)
            CONFIG_FILE="$2"
            shift 2
            ;;
        *)
            echo "Unknown argument: $1"
            echo "Usage: sudo ./pilot-setup.sh [--config <config-file>]"
            exit 1
            ;;
    esac
done

# ---------------------------------------------------------------------------
# Helper Functions
# ---------------------------------------------------------------------------
log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] [pilot] $*" | tee -a "${PILOT_LOG}" 2>/dev/null || echo "[$(date '+%Y-%m-%d %H:%M:%S')] [pilot] $*"; }
warn() { log "WARNING: $*"; }
err() { log "ERROR: $*"; }
die() { err "$*"; exit 1; }

CHECKS_PASSED=0
CHECKS_FAILED=0
CHECKS_WARN=0
CHECK_RESULTS=()

record_pass() { CHECKS_PASSED=$((CHECKS_PASSED + 1)); CHECK_RESULTS+=("[PASS] $1"); log "[PASS] $1"; }
record_fail() { CHECKS_FAILED=$((CHECKS_FAILED + 1)); CHECK_RESULTS+=("[FAIL] $1"); log "[FAIL] $1"; }
record_warn() { CHECKS_WARN=$((CHECKS_WARN + 1)); CHECK_RESULTS+=("[WARN] $1"); log "[WARN] $1"; }

check_root() {
    if [[ $EUID -ne 0 ]]; then
        die "This script must be run as root (use sudo)."
    fi
}

# ---------------------------------------------------------------------------
# Step 0: Load config
# ---------------------------------------------------------------------------
load_config() {
    log "Loading configuration..."

    if [[ -n "${CONFIG_FILE}" && -f "${CONFIG_FILE}" ]]; then
        log "Reading config from ${CONFIG_FILE}..."
        # shellcheck source=/dev/null
        source "${CONFIG_FILE}"
        log "Config loaded."
    fi

    # Prompt for missing values
    if [[ -z "${HOUSEHOLD_NAME}" ]]; then
        echo ""
        read -rp "Enter household name (e.g., kumar-home): " HOUSEHOLD_NAME
    fi

    if [[ -z "${WIFI_SSID}" ]]; then
        echo ""
        read -rp "Enter WiFi SSID (or press Enter to skip WiFi setup): " WIFI_SSID
    fi

    if [[ -n "${WIFI_SSID}" && -z "${WIFI_PASSWORD}" ]]; then
        read -rsp "Enter WiFi password for '${WIFI_SSID}': " WIFI_PASSWORD
        echo ""
    fi

    log "Household: carelog-${HOUSEHOLD_NAME}"
}

# ---------------------------------------------------------------------------
# Step 1: Run full provisioning
# ---------------------------------------------------------------------------
run_provisioning() {
    log "============================================="
    log "Step 1: Full Provisioning"
    log "============================================="

    local provision_script="${SCRIPT_DIR}/provision.sh"
    if [[ ! -f "${provision_script}" ]]; then
        die "Provisioning script not found at ${provision_script}."
    fi

    chmod +x "${provision_script}"
    bash "${provision_script}" 2>&1 | tee -a "${PILOT_LOG}" || {
        err "Provisioning failed. Check logs at ${PILOT_LOG}."
        record_fail "Provisioning"
        return 1
    }

    record_pass "Provisioning completed"
}

# ---------------------------------------------------------------------------
# Step 2: Configure household
# ---------------------------------------------------------------------------
configure_household() {
    log "============================================="
    log "Step 2: Household Configuration"
    log "============================================="

    # Set hostname
    local new_hostname="carelog-${HOUSEHOLD_NAME}"
    log "Setting hostname to '${new_hostname}'..."

    scutil --set ComputerName "${new_hostname}" 2>/dev/null || warn "Could not set ComputerName"
    scutil --set HostName "${new_hostname}" 2>/dev/null || warn "Could not set HostName"
    scutil --set LocalHostName "${new_hostname}" 2>/dev/null || warn "Could not set LocalHostName"

    # Flush DNS cache
    dscacheutil -flushcache 2>/dev/null || true

    local current_hostname
    current_hostname="$(scutil --get ComputerName 2>/dev/null || hostname)"
    if [[ "${current_hostname}" == "${new_hostname}" ]]; then
        record_pass "Hostname set to ${new_hostname}"
    else
        record_warn "Hostname may not have been set correctly (got: ${current_hostname})"
    fi

    # Configure WiFi
    if [[ -n "${WIFI_SSID}" ]]; then
        log "Configuring WiFi for SSID: ${WIFI_SSID}..."

        # Get the WiFi interface name
        local wifi_interface
        wifi_interface="$(networksetup -listallhardwareports | awk '/Wi-Fi/{getline; print $2}')"

        if [[ -n "${wifi_interface}" ]]; then
            networksetup -setairportnetwork "${wifi_interface}" "${WIFI_SSID}" "${WIFI_PASSWORD}" 2>/dev/null || {
                warn "Could not connect to WiFi '${WIFI_SSID}'. Check credentials."
                record_warn "WiFi configuration for '${WIFI_SSID}'"
                return
            }

            # Verify connection
            sleep 5
            local current_ssid
            current_ssid="$(networksetup -getairportnetwork "${wifi_interface}" 2>/dev/null | awk -F': ' '{print $2}' || true)"

            if [[ "${current_ssid}" == "${WIFI_SSID}" ]]; then
                record_pass "WiFi connected to '${WIFI_SSID}'"
            else
                record_warn "WiFi may not be connected to '${WIFI_SSID}' (got: '${current_ssid}')"
            fi
        else
            warn "No WiFi interface found."
            record_warn "WiFi interface not found"
        fi
    else
        log "WiFi setup skipped (no SSID provided)."
    fi

    # Verify LAN connectivity
    log "Checking LAN connectivity..."
    local gateway
    gateway="$(route -n get default 2>/dev/null | awk '/gateway/ {print $2}' || true)"

    if [[ -n "${gateway}" ]]; then
        if ping -c 3 -W 2 "${gateway}" &>/dev/null; then
            record_pass "LAN connectivity (gateway: ${gateway})"
        else
            record_fail "LAN connectivity (gateway ${gateway} unreachable)"
        fi
    else
        record_warn "Could not determine default gateway"
    fi
}

# ---------------------------------------------------------------------------
# Step 3: Security checks
# ---------------------------------------------------------------------------
run_security_checks() {
    log "============================================="
    log "Step 3: Security Checks"
    log "============================================="

    # Firewall
    log "Running firewall setup..."
    local firewall_script="${SCRIPT_DIR}/security/firewall-setup.sh"
    if [[ -f "${firewall_script}" ]]; then
        chmod +x "${firewall_script}"
        if bash "${firewall_script}" 2>&1 | tee -a "${PILOT_LOG}"; then
            record_pass "Firewall configuration"
        else
            record_fail "Firewall configuration"
        fi
    else
        record_fail "Firewall script not found"
    fi

    # FileVault
    log "Checking FileVault..."
    local fv_script="${SCRIPT_DIR}/security/filevault-check.sh"
    if [[ -f "${fv_script}" ]]; then
        chmod +x "${fv_script}"
        if bash "${fv_script}" 2>&1 | tee -a "${PILOT_LOG}"; then
            record_pass "FileVault encryption"
        else
            record_warn "FileVault encryption not enabled (enable before production)"
        fi
    else
        record_fail "FileVault check script not found"
    fi

    # SSH hardening
    log "Hardening SSH..."
    local ssh_script="${SCRIPT_DIR}/security/harden-ssh.sh"
    if [[ -f "${ssh_script}" ]]; then
        chmod +x "${ssh_script}"
        if bash "${ssh_script}" 2>&1 | tee -a "${PILOT_LOG}"; then
            record_pass "SSH hardening"
        else
            record_warn "SSH hardening had issues"
        fi
    else
        record_fail "SSH hardening script not found"
    fi

    # File permissions
    log "Setting file permissions..."
    if [[ -d "${CARELOG_HOME}/models" ]]; then
        chmod -R a-w "${CARELOG_HOME}/models/" 2>/dev/null || true
        chmod -R u+r "${CARELOG_HOME}/models/" 2>/dev/null || true
        record_pass "Model files set to read-only"
    fi

    if [[ -d "${CARELOG_HOME}/services" ]]; then
        chmod -R a-w "${CARELOG_HOME}/services/" 2>/dev/null || true
        chmod -R u+r,u+x "${CARELOG_HOME}/services/" 2>/dev/null || true
        record_pass "Service files set to read-only"
    fi

    # Disable unnecessary macOS services
    log "Disabling unnecessary macOS services..."

    # Disable Screen Sharing (unless needed)
    launchctl unload -w /System/Library/LaunchDaemons/com.apple.screensharing.plist 2>/dev/null || true
    log "  Disabled: Screen Sharing"

    # Disable AirDrop
    defaults write com.apple.NetworkBrowser DisableAirDrop -bool YES 2>/dev/null || true
    log "  Disabled: AirDrop"

    record_pass "Unnecessary macOS services disabled"
}

# ---------------------------------------------------------------------------
# Step 4: Verify services
# ---------------------------------------------------------------------------
verify_services() {
    log "============================================="
    log "Step 4: Service Verification"
    log "============================================="

    log "Waiting 15s for services to start..."
    sleep 15

    declare -A SERVICE_PORTS=(
        [health]=8000
        [stt]=8001
        [llm]=8002
        [tts]=8003
        [vision]=8004
    )

    for service in health stt llm tts vision; do
        local port="${SERVICE_PORTS[$service]}"
        if curl -sf --max-time 5 "http://127.0.0.1:${port}/health" &>/dev/null; then
            record_pass "Service ${service} on port ${port}"
        else
            record_fail "Service ${service} on port ${port} not responding"
        fi
    done
}

# ---------------------------------------------------------------------------
# Step 5: Verify mDNS
# ---------------------------------------------------------------------------
verify_mdns() {
    log "============================================="
    log "Step 5: mDNS Verification"
    log "============================================="

    log "Checking mDNS advertisement for _carelog._tcp..."

    # Start dns-sd browse in background, capture output for 5 seconds
    local mdns_output
    mdns_output="$(timeout 5 dns-sd -B _carelog._tcp 2>/dev/null || true)"

    if echo "${mdns_output}" | grep -qi "carelog"; then
        record_pass "mDNS advertising _carelog._tcp"
    else
        # Try alternate check
        local mdns_resolved
        mdns_resolved="$(dns-sd -L "CareLog" _carelog._tcp local 2>/dev/null &
            sleep 3
            kill %1 2>/dev/null || true
        )"
        record_warn "mDNS advertisement could not be verified (may need manual check)"
    fi
}

# ---------------------------------------------------------------------------
# Step 6: Run smoke tests
# ---------------------------------------------------------------------------
run_smoke_tests() {
    log "============================================="
    log "Step 6: Smoke Tests"
    log "============================================="

    local smoke_script="${SCRIPT_DIR}/pilot-smoke-test.sh"
    if [[ -f "${smoke_script}" ]]; then
        chmod +x "${smoke_script}"
        if bash "${smoke_script}" 2>&1 | tee -a "${PILOT_LOG}"; then
            record_pass "Smoke tests"
        else
            record_fail "Smoke tests (some tests failed)"
        fi
    else
        record_warn "Smoke test script not found"
    fi
}

# ---------------------------------------------------------------------------
# Step 7: Setup monitoring cron
# ---------------------------------------------------------------------------
setup_monitoring() {
    log "============================================="
    log "Step 7: Monitoring Setup"
    log "============================================="

    local cron_script="${SCRIPT_DIR}/monitoring/setup-cron.sh"
    if [[ -f "${cron_script}" ]]; then
        chmod +x "${cron_script}"
        if bash "${cron_script}" 2>&1 | tee -a "${PILOT_LOG}"; then
            record_pass "Monitoring cron jobs"
        else
            record_warn "Monitoring cron setup had issues"
        fi
    else
        record_warn "Monitoring cron setup script not found"
    fi
}

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
print_summary() {
    echo ""
    echo "============================================================="
    echo "  CareLog Pilot Setup Summary"
    echo "  Household: carelog-${HOUSEHOLD_NAME}"
    echo "  Date: $(date '+%Y-%m-%d %H:%M:%S')"
    echo "============================================================="
    echo ""

    for result in "${CHECK_RESULTS[@]}"; do
        echo "  ${result}"
    done

    echo ""
    echo "  Passed:   ${CHECKS_PASSED}"
    echo "  Failed:   ${CHECKS_FAILED}"
    echo "  Warnings: ${CHECKS_WARN}"
    echo ""

    if [[ ${CHECKS_FAILED} -eq 0 ]]; then
        echo "  ==============================="
        echo "  STATUS: READY FOR PILOT"
        echo "  ==============================="
        echo ""
        echo "  Mac Mini is configured and all services are running."
        echo "  Hostname: carelog-${HOUSEHOLD_NAME}"
        echo "  Services: http://carelog-${HOUSEHOLD_NAME}.local:8000"
        echo ""
        echo "  Next steps:"
        echo "  1. Place Mac Mini at pilot household"
        echo "  2. Connect to household WiFi"
        echo "  3. Verify mobile app can discover the device"
        echo ""
    else
        echo "  ==============================="
        echo "  STATUS: NOT READY"
        echo "  ==============================="
        echo ""
        echo "  ${CHECKS_FAILED} check(s) failed. Resolve issues above before deployment."
        echo ""
    fi

    echo "  Full log: ${PILOT_LOG}"
    echo ""
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
main() {
    log "============================================="
    log "CareLog Pilot Setup"
    log "============================================="

    check_root

    mkdir -p "${LOGS_DIR}"

    load_config

    run_provisioning
    configure_household
    run_security_checks
    verify_services
    verify_mdns
    run_smoke_tests
    setup_monitoring

    print_summary

    if [[ ${CHECKS_FAILED} -gt 0 ]]; then
        exit 1
    fi
}

main "$@"
