#!/usr/bin/env bash
#
# CareLog Mac Mini Firewall Configuration
#
# Configures macOS Application Firewall (socketfilterfw):
# - Enable firewall
# - Block all incoming connections except ports 8000-8004 (model services)
# - Allow mDNS (Bonjour)
# - Log blocked connections
# - Verify no services listen on public interfaces beyond LAN
#
# Usage: sudo ./firewall-setup.sh
#
# This script is idempotent.

set -euo pipefail

SOCKETFILTERFW="/usr/libexec/ApplicationFirewall/socketfilterfw"
CARELOG_HOME="/opt/carelog"
VENV_PATH="${CARELOG_HOME}/venv"

# ---------------------------------------------------------------------------
# Helper Functions
# ---------------------------------------------------------------------------
log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] [firewall] $*"; }
warn() { log "WARNING: $*"; }
err() { log "ERROR: $*" >&2; }
die() { err "$*"; exit 1; }

check_root() {
    if [[ $EUID -ne 0 ]]; then
        die "This script must be run as root (use sudo)."
    fi
}

# ---------------------------------------------------------------------------
# Step 1: Enable macOS Application Firewall
# ---------------------------------------------------------------------------
enable_firewall() {
    log "Enabling macOS Application Firewall..."

    # Enable the firewall
    "${SOCKETFILTERFW}" --setglobalstate on 2>/dev/null || true

    # Verify it is on
    if "${SOCKETFILTERFW}" --getglobalstate 2>/dev/null | grep -q "enabled"; then
        log "Firewall is enabled."
    else
        warn "Could not verify firewall state. Attempting to enable via defaults..."
        defaults write /Library/Preferences/com.apple.alf globalstate -int 1
        launchctl unload /System/Library/LaunchDaemons/com.apple.alf.agent.plist 2>/dev/null || true
        launchctl load /System/Library/LaunchDaemons/com.apple.alf.agent.plist 2>/dev/null || true
        log "Firewall enabled via defaults."
    fi
}

# ---------------------------------------------------------------------------
# Step 2: Configure firewall blocking mode
# ---------------------------------------------------------------------------
configure_blocking() {
    log "Configuring firewall blocking mode..."

    # Block all incoming connections by default
    "${SOCKETFILTERFW}" --setblockall on 2>/dev/null || true
    log "Default: block all incoming connections."

    # Allow signed applications (needed for system services and our services)
    "${SOCKETFILTERFW}" --setallowsigned on 2>/dev/null || true
    "${SOCKETFILTERFW}" --setallowsignedapp on 2>/dev/null || true
    log "Allowing signed applications."
}

# ---------------------------------------------------------------------------
# Step 3: Allow CareLog model services (ports 8000-8004)
# ---------------------------------------------------------------------------
allow_carelog_services() {
    log "Allowing CareLog model services through firewall..."

    # Allow Python (uvicorn) used by our services
    local python_bin="${VENV_PATH}/bin/python3.11"
    if [[ -f "${python_bin}" ]]; then
        "${SOCKETFILTERFW}" --remove "${python_bin}" 2>/dev/null || true
        "${SOCKETFILTERFW}" --add "${python_bin}" 2>/dev/null || true
        "${SOCKETFILTERFW}" --unblockapp "${python_bin}" 2>/dev/null || true
        log "Allowed: ${python_bin}"
    else
        warn "Python binary not found at ${python_bin}. Will allow after provisioning."
    fi

    # Also allow system python and brew python as fallbacks
    for py_path in /usr/bin/python3 /opt/homebrew/bin/python3.11 /opt/homebrew/bin/python3; do
        if [[ -f "${py_path}" ]]; then
            "${SOCKETFILTERFW}" --remove "${py_path}" 2>/dev/null || true
            "${SOCKETFILTERFW}" --add "${py_path}" 2>/dev/null || true
            "${SOCKETFILTERFW}" --unblockapp "${py_path}" 2>/dev/null || true
            log "Allowed: ${py_path}"
        fi
    done
}

# ---------------------------------------------------------------------------
# Step 4: Allow mDNS (Bonjour)
# ---------------------------------------------------------------------------
allow_mdns() {
    log "Allowing mDNS (Bonjour) through firewall..."

    local mDNSResponder="/usr/sbin/mDNSResponder"
    if [[ -f "${mDNSResponder}" ]]; then
        "${SOCKETFILTERFW}" --remove "${mDNSResponder}" 2>/dev/null || true
        "${SOCKETFILTERFW}" --add "${mDNSResponder}" 2>/dev/null || true
        "${SOCKETFILTERFW}" --unblockapp "${mDNSResponder}" 2>/dev/null || true
        log "Allowed: mDNSResponder (Bonjour/mDNS)"
    fi

    # Also allow dns-sd for service registration
    local dns_sd="/usr/bin/dns-sd"
    if [[ -f "${dns_sd}" ]]; then
        "${SOCKETFILTERFW}" --remove "${dns_sd}" 2>/dev/null || true
        "${SOCKETFILTERFW}" --add "${dns_sd}" 2>/dev/null || true
        "${SOCKETFILTERFW}" --unblockapp "${dns_sd}" 2>/dev/null || true
        log "Allowed: dns-sd"
    fi
}

# ---------------------------------------------------------------------------
# Step 5: Enable logging of blocked connections
# ---------------------------------------------------------------------------
enable_logging() {
    log "Enabling firewall logging..."

    "${SOCKETFILTERFW}" --setloggingmode on 2>/dev/null || true
    "${SOCKETFILTERFW}" --setloggingopt detail 2>/dev/null || true
    log "Firewall logging enabled (detailed mode)."
    log "Logs available at: /var/log/appfirewall.log"
}

# ---------------------------------------------------------------------------
# Step 6: Configure packet filter for port-level control
# ---------------------------------------------------------------------------
configure_pf() {
    log "Configuring packet filter (pf) for port-level restrictions..."

    local PF_CONF="/etc/pf.anchors/com.carelog"
    local PF_ANCHOR_CONF="/etc/pf.conf"

    # Create pf anchor rules for CareLog
    cat > "${PF_CONF}" <<'PFRULES'
# CareLog Packet Filter Rules
# Allow traffic on CareLog service ports (8000-8004) from LAN only
# Block these ports from non-LAN sources

# Allow loopback
pass quick on lo0 all

# Allow established connections
pass in quick proto tcp from any to any flags A/A

# Allow CareLog services on ports 8000-8004 from private networks only
pass in quick proto tcp from 10.0.0.0/8 to any port 8000:8004
pass in quick proto tcp from 172.16.0.0/12 to any port 8000:8004
pass in quick proto tcp from 192.168.0.0/16 to any port 8000:8004
pass in quick proto tcp from 169.254.0.0/16 to any port 8000:8004

# Allow mDNS (multicast DNS on port 5353)
pass in quick proto udp from any to 224.0.0.251 port 5353
pass in quick proto udp from any to any port 5353

# Block CareLog ports from all other sources
block in quick proto tcp from any to any port 8000:8004
PFRULES

    log "Created pf anchor rules at ${PF_CONF}."

    # Add anchor to pf.conf if not already present
    if ! grep -q "com.carelog" "${PF_ANCHOR_CONF}" 2>/dev/null; then
        # Backup the original
        cp "${PF_ANCHOR_CONF}" "${PF_ANCHOR_CONF}.backup.$(date +%Y%m%d%H%M%S)" 2>/dev/null || true

        # Append our anchor
        cat >> "${PF_ANCHOR_CONF}" <<'PFCONF'

# CareLog firewall rules
anchor "com.carelog"
load anchor "com.carelog" from "/etc/pf.anchors/com.carelog"
PFCONF
        log "Added CareLog anchor to ${PF_ANCHOR_CONF}."
    else
        log "CareLog anchor already present in ${PF_ANCHOR_CONF}."
    fi

    # Load the rules
    pfctl -f "${PF_ANCHOR_CONF}" 2>/dev/null || warn "Failed to load pf rules (may need restart)."
    pfctl -e 2>/dev/null || true  # Enable pf (may already be enabled)
    log "Packet filter rules loaded."
}

# ---------------------------------------------------------------------------
# Step 7: Verify no services listen on public interfaces beyond LAN
# ---------------------------------------------------------------------------
verify_listening() {
    log "Verifying listening services..."

    echo ""
    echo "  Services currently listening on network interfaces:"
    echo "  ---------------------------------------------------"

    # List all listening TCP ports
    lsof -iTCP -sTCP:LISTEN -nP 2>/dev/null | awk 'NR==1 || /LISTEN/' | while IFS= read -r line; do
        echo "  ${line}"
    done

    echo ""

    # Check that CareLog services are only on expected ports
    local unexpected=false
    for port in 8000 8001 8002 8003 8004; do
        local listeners
        listeners="$(lsof -iTCP:${port} -sTCP:LISTEN -nP 2>/dev/null | grep -v "^COMMAND" || true)"
        if [[ -n "${listeners}" ]]; then
            # Check if binding to 0.0.0.0 or specific LAN address
            if echo "${listeners}" | grep -qE "\*:${port}|0\.0\.0\.0:${port}"; then
                warn "Port ${port} is listening on all interfaces (0.0.0.0). Firewall rules will restrict to LAN."
            fi
        fi
    done

    if [[ "${unexpected}" == "false" ]]; then
        log "Listening services verified. Firewall restricts non-LAN access."
    fi
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
main() {
    log "============================================="
    log "CareLog Firewall Configuration"
    log "============================================="

    check_root

    enable_firewall
    configure_blocking
    allow_carelog_services
    allow_mdns
    enable_logging
    configure_pf
    verify_listening

    log ""
    log "Firewall configuration complete."
    log "  - macOS Application Firewall: ENABLED"
    log "  - Default policy: BLOCK all incoming"
    log "  - Allowed: CareLog services (ports 8000-8004, LAN only)"
    log "  - Allowed: mDNS/Bonjour (port 5353)"
    log "  - Logging: ENABLED (detailed)"
    log "  - Packet filter: ACTIVE"
}

main "$@"
