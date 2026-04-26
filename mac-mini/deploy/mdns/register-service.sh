#!/usr/bin/env bash
#
# CareLog mDNS/Bonjour Service Registration
#
# Registers the CareLog health aggregator endpoint as a discoverable
# service on the local network via dns-sd (Bonjour).
#
# Usage: ./register-service.sh [--background]
#
# Clients on the LAN can discover this service by browsing for _carelog._tcp.

set -euo pipefail

SERVICE_TYPE="_carelog._tcp"
SERVICE_NAME="CareLog Mac Mini"
SERVICE_PORT=8000
SERVICE_DOMAIN="local"

# TXT record key-value pairs
TXT_VERSION="version=1.0"
TXT_DEVICE="device=macmini-m4"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] [mdns] $*"; }

# Kill any existing registration for this service
cleanup_existing() {
    local existing_pids
    existing_pids="$(pgrep -f "dns-sd.*${SERVICE_TYPE}" 2>/dev/null || true)"
    if [[ -n "${existing_pids}" ]]; then
        log "Stopping existing mDNS registration (PIDs: ${existing_pids})..."
        echo "${existing_pids}" | xargs kill 2>/dev/null || true
        sleep 1
    fi
}

register() {
    log "Registering mDNS service:"
    log "  Name:   ${SERVICE_NAME}"
    log "  Type:   ${SERVICE_TYPE}"
    log "  Port:   ${SERVICE_PORT}"
    log "  Domain: ${SERVICE_DOMAIN}"
    log "  TXT:    ${TXT_VERSION} ${TXT_DEVICE}"

    # dns-sd -R registers a service in Bonjour.
    # This process must stay running for the registration to remain active.
    exec dns-sd -R "${SERVICE_NAME}" "${SERVICE_TYPE}" "${SERVICE_DOMAIN}" \
        "${SERVICE_PORT}" "${TXT_VERSION}" "${TXT_DEVICE}"
}

main() {
    cleanup_existing
    register
}

main "$@"
