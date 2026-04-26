#!/usr/bin/env bash
#
# CareLog SSH Hardening Script
#
# Hardens SSH configuration for Mac Mini maintenance access:
# - Disable password authentication (key-based only)
# - Limit SSH to LAN addresses
# - Set MaxAuthTries to 3
# - Disable root login
#
# Usage: sudo ./harden-ssh.sh
#
# This script is idempotent.

set -euo pipefail

SSHD_CONFIG="/etc/ssh/sshd_config"
SSHD_CONFIG_DIR="/etc/ssh/sshd_config.d"
CARELOG_SSH_CONF="${SSHD_CONFIG_DIR}/carelog-hardening.conf"

# ---------------------------------------------------------------------------
# Helper Functions
# ---------------------------------------------------------------------------
log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] [ssh-harden] $*"; }
warn() { log "WARNING: $*"; }
err() { log "ERROR: $*" >&2; }
die() { err "$*"; exit 1; }

check_root() {
    if [[ $EUID -ne 0 ]]; then
        die "This script must be run as root (use sudo)."
    fi
}

# ---------------------------------------------------------------------------
# Step 1: Backup existing SSH configuration
# ---------------------------------------------------------------------------
backup_ssh_config() {
    log "Backing up SSH configuration..."

    if [[ -f "${SSHD_CONFIG}" ]]; then
        local backup="${SSHD_CONFIG}.backup.$(date +%Y%m%d%H%M%S)"
        if [[ ! -f "${SSHD_CONFIG}.backup.original" ]]; then
            cp "${SSHD_CONFIG}" "${SSHD_CONFIG}.backup.original"
            log "Original backup saved to ${SSHD_CONFIG}.backup.original"
        fi
        cp "${SSHD_CONFIG}" "${backup}"
        log "Backup saved to ${backup}"
    fi
}

# ---------------------------------------------------------------------------
# Step 2: Create hardened SSH config
# ---------------------------------------------------------------------------
create_hardened_config() {
    log "Creating hardened SSH configuration..."

    mkdir -p "${SSHD_CONFIG_DIR}"

    cat > "${CARELOG_SSH_CONF}" <<'SSHCONF'
# CareLog SSH Hardening Configuration
# Applied by mac-mini/deploy/security/harden-ssh.sh
#
# This file is managed by the CareLog provisioning system.
# Manual edits will be overwritten on next provisioning run.

# Disable password authentication - key-based auth only
PasswordAuthentication no
ChallengeResponseAuthentication no
KbdInteractiveAuthentication no

# Disable root login
PermitRootLogin no

# Limit authentication attempts
MaxAuthTries 3
MaxSessions 3

# Key-based authentication settings
PubkeyAuthentication yes
AuthorizedKeysFile .ssh/authorized_keys

# Disable empty passwords
PermitEmptyPasswords no

# Disable X11 forwarding (not needed for headless Mac Mini)
X11Forwarding no

# Disable agent forwarding
AllowAgentForwarding no

# Disable TCP forwarding (enable only if needed for tunneling)
AllowTcpForwarding no

# Set idle timeout (disconnect after 10 minutes of inactivity)
ClientAliveInterval 300
ClientAliveCountMax 2

# Use only strong key exchange algorithms
KexAlgorithms curve25519-sha256,curve25519-sha256@libssh.org

# Use only strong ciphers
Ciphers chacha20-poly1305@openssh.com,aes256-gcm@openssh.com,aes128-gcm@openssh.com

# Use only strong MACs
MACs hmac-sha2-512-etm@openssh.com,hmac-sha2-256-etm@openssh.com

# Log level
LogLevel VERBOSE

# Restrict to LAN addresses only
# Private network ranges: 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16
# Update these if your LAN uses a specific subnet
ListenAddress 0.0.0.0
SSHCONF

    chmod 644 "${CARELOG_SSH_CONF}"
    log "Hardened SSH config written to ${CARELOG_SSH_CONF}"
}

# ---------------------------------------------------------------------------
# Step 3: Ensure sshd_config includes the config directory
# ---------------------------------------------------------------------------
ensure_include_dir() {
    log "Ensuring sshd_config includes config directory..."

    if [[ -f "${SSHD_CONFIG}" ]]; then
        if ! grep -q "Include ${SSHD_CONFIG_DIR}" "${SSHD_CONFIG}" 2>/dev/null; then
            # Add Include directive at the top of sshd_config
            local tmp
            tmp="$(mktemp)"
            echo "Include ${SSHD_CONFIG_DIR}/*.conf" > "${tmp}"
            echo "" >> "${tmp}"
            cat "${SSHD_CONFIG}" >> "${tmp}"
            mv "${tmp}" "${SSHD_CONFIG}"
            log "Added Include directive to ${SSHD_CONFIG}"
        else
            log "Include directive already present."
        fi
    fi
}

# ---------------------------------------------------------------------------
# Step 4: Configure TCP Wrappers for LAN-only access
# ---------------------------------------------------------------------------
configure_tcp_wrappers() {
    log "Configuring TCP Wrappers for LAN-only SSH access..."

    local HOSTS_ALLOW="/etc/hosts.allow"
    local HOSTS_DENY="/etc/hosts.deny"

    # Allow SSH only from private networks
    if ! grep -q "carelog-ssh" "${HOSTS_ALLOW}" 2>/dev/null; then
        cat >> "${HOSTS_ALLOW}" <<'ALLOW'

# CareLog: Allow SSH from LAN only (carelog-ssh)
sshd: 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 127.0.0.1
ALLOW
        log "Added LAN allow rules to ${HOSTS_ALLOW}"
    else
        log "LAN allow rules already present in ${HOSTS_ALLOW}"
    fi

    # Deny SSH from all other sources
    if ! grep -q "carelog-ssh" "${HOSTS_DENY}" 2>/dev/null; then
        cat >> "${HOSTS_DENY}" <<'DENY'

# CareLog: Deny SSH from non-LAN sources (carelog-ssh)
sshd: ALL
DENY
        log "Added deny rules to ${HOSTS_DENY}"
    else
        log "Deny rules already present in ${HOSTS_DENY}"
    fi
}

# ---------------------------------------------------------------------------
# Step 5: Validate SSH configuration
# ---------------------------------------------------------------------------
validate_ssh_config() {
    log "Validating SSH configuration..."

    if sshd -t 2>/dev/null; then
        log "SSH configuration is valid."
    else
        err "SSH configuration validation failed!"
        err "Restoring backup..."
        if [[ -f "${SSHD_CONFIG}.backup.original" ]]; then
            cp "${SSHD_CONFIG}.backup.original" "${SSHD_CONFIG}"
            rm -f "${CARELOG_SSH_CONF}"
            err "Backup restored. Please check configuration manually."
        fi
        return 1
    fi
}

# ---------------------------------------------------------------------------
# Step 6: Reload SSH daemon (if running)
# ---------------------------------------------------------------------------
reload_ssh() {
    log "Reloading SSH daemon..."

    # Check if Remote Login (SSH) is enabled
    if systemsetup -getremotelogin 2>/dev/null | grep -qi "on"; then
        # Reload sshd to pick up new configuration
        launchctl unload /System/Library/LaunchDaemons/ssh.plist 2>/dev/null || true
        launchctl load /System/Library/LaunchDaemons/ssh.plist 2>/dev/null || true
        log "SSH daemon reloaded."
    else
        log "Remote Login (SSH) is currently disabled."
        log "SSH hardening config will take effect when SSH is enabled."
        log "To enable SSH: sudo systemsetup -setremotelogin on"
    fi
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
main() {
    log "============================================="
    log "CareLog SSH Hardening"
    log "============================================="

    check_root

    backup_ssh_config
    create_hardened_config
    ensure_include_dir
    configure_tcp_wrappers
    validate_ssh_config
    reload_ssh

    log ""
    log "SSH hardening complete."
    log "  - Password authentication: DISABLED"
    log "  - Root login: DISABLED"
    log "  - Max auth tries: 3"
    log "  - Key-based auth: ENABLED"
    log "  - LAN-only access: CONFIGURED (TCP Wrappers)"
    log "  - Strong ciphers/KEX: ENFORCED"
    log ""
    log "IMPORTANT: Ensure you have placed an authorized SSH public key in"
    log "  ~/.ssh/authorized_keys for the maintenance user BEFORE enabling SSH."
    log "  Otherwise you will be locked out."
}

main "$@"
