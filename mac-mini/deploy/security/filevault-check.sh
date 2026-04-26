#!/usr/bin/env bash
#
# CareLog FileVault Disk Encryption Check
#
# Checks if FileVault disk encryption is enabled on the Mac Mini.
# If not enabled, provides instructions to enable it.
#
# Usage: sudo ./filevault-check.sh
#
# This script is idempotent and non-destructive.

set -euo pipefail

# ---------------------------------------------------------------------------
# Helper Functions
# ---------------------------------------------------------------------------
log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] [filevault] $*"; }
warn() { log "WARNING: $*"; }
err() { log "ERROR: $*" >&2; }

check_root() {
    if [[ $EUID -ne 0 ]]; then
        err "This script must be run as root (use sudo)."
        exit 1
    fi
}

# ---------------------------------------------------------------------------
# Check FileVault Status
# ---------------------------------------------------------------------------
check_filevault() {
    log "Checking FileVault disk encryption status..."

    local fv_status
    fv_status="$(fdesetup status 2>/dev/null || echo "Unknown")"

    echo ""
    echo "  FileVault Status: ${fv_status}"
    echo ""

    if echo "${fv_status}" | grep -qi "On"; then
        log "FileVault is ENABLED."

        # Check encryption progress
        if echo "${fv_status}" | grep -qi "Encryption in progress"; then
            local progress
            progress="$(fdesetup status 2>/dev/null | grep -oE '[0-9]+%' || echo "unknown")"
            log "Encryption is in progress: ${progress}"
            warn "Do not power off the Mac Mini until encryption is complete."
        else
            log "Disk is fully encrypted."
        fi

        # Verify encryption type
        local disk_info
        disk_info="$(diskutil apfs list 2>/dev/null || true)"
        if echo "${disk_info}" | grep -qi "FileVault"; then
            log "APFS FileVault encryption confirmed."
        fi

        return 0

    elif echo "${fv_status}" | grep -qi "Off"; then
        warn "FileVault is DISABLED."
        warn ""
        warn "For DPDP Act compliance and patient data protection,"
        warn "FileVault disk encryption MUST be enabled."
        warn ""
        warn "To enable FileVault:"
        warn "  1. Open System Settings > Privacy & Security > FileVault"
        warn "  2. Click 'Turn On FileVault'"
        warn "  3. Choose recovery key option (recommended: institutional recovery key)"
        warn ""
        warn "Or enable via command line:"
        warn "  sudo fdesetup enable"
        warn ""
        warn "IMPORTANT:"
        warn "  - Encryption will take several hours on first enable"
        warn "  - Do not power off during encryption"
        warn "  - Store the recovery key securely (NOT on the Mac Mini)"
        warn "  - The Mac Mini must be logged in with a user account for FileVault to work"
        warn ""
        return 1

    else
        err "Could not determine FileVault status."
        err "Raw output: ${fv_status}"
        return 2
    fi
}

# ---------------------------------------------------------------------------
# Check Secure Boot status (T2/Apple Silicon)
# ---------------------------------------------------------------------------
check_secure_boot() {
    log "Checking Secure Boot status..."

    # On Apple Silicon Macs, check security policy
    if [[ "$(uname -m)" == "arm64" ]]; then
        log "Apple Silicon detected (M4)."
        log "Full Security mode is the default and recommended setting."
        log "To verify: Restart into Recovery > Utilities > Startup Security Utility"
    fi
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
main() {
    log "============================================="
    log "CareLog FileVault Encryption Check"
    log "============================================="

    check_root

    local exit_code=0
    check_filevault || exit_code=$?
    check_secure_boot

    echo ""
    if [[ ${exit_code} -eq 0 ]]; then
        log "RESULT: PASS - FileVault encryption is enabled."
    elif [[ ${exit_code} -eq 1 ]]; then
        log "RESULT: FAIL - FileVault encryption is NOT enabled."
        log "Action required: Enable FileVault before pilot deployment."
    else
        log "RESULT: UNKNOWN - Could not verify FileVault status."
    fi

    return ${exit_code}
}

main "$@"
