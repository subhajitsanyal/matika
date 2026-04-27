#!/usr/bin/env bash
#
# CareLog Mac Mini M4 Provisioning Script
# Unboxing -> Fully serving AI model endpoints
#
# Usage: sudo ./provision.sh
#
# This script is idempotent — safe to run multiple times.
# It will skip steps that have already been completed.

set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
CARELOG_USER="carelog"
CARELOG_HOME="/opt/carelog"
PYTHON_VERSION="python@3.11"
VENV_PATH="${CARELOG_HOME}/venv"
SERVICES_DIR="${CARELOG_HOME}/services"
MODELS_DIR="${CARELOG_HOME}/models"
LOGS_DIR="${CARELOG_HOME}/logs"
TMP_DIR="${CARELOG_HOME}/tmp"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LAUNCHD_DIR="${SCRIPT_DIR}/launchd"

# Model download URLs (Hugging Face)
# Override via environment variables if hosting models elsewhere.
MODEL_STT_URL="${MODEL_STT_URL:-https://huggingface.co/Systran/faster-whisper-large-v3/resolve/main/model.bin}"
MODEL_LLM_URL="${MODEL_LLM_URL:-https://huggingface.co/Qwen/Qwen2.5-7B-Instruct-GGUF/resolve/main/qwen2.5-7b-instruct-q4_k_m.gguf}"
MODEL_VISION_URL="${MODEL_VISION_URL:-https://huggingface.co/Qwen/Qwen2-VL-7B-Instruct-GGUF/resolve/main/qwen2-vl-7b-instruct-q4_k_m.gguf}"
MODEL_TTS_EN_URL="${MODEL_TTS_EN_URL:-https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/amy/medium/en_US-amy-medium.onnx}"
MODEL_TTS_HI_URL="${MODEL_TTS_HI_URL:-https://huggingface.co/rhasspy/piper-voices/resolve/main/hi/hi_IN/madhur/medium/hi_IN-madhur-medium.onnx}"
# NOTE: Piper does not have a Bengali voice yet. This URL will 404.
# When a Bengali voice becomes available, update this URL.
MODEL_TTS_BN_URL="${MODEL_TTS_BN_URL:-https://huggingface.co/rhasspy/piper-voices/resolve/main/bn/bn_BD/placeholder/medium/bn_BD-placeholder-medium.onnx}"

# Service ports for health checks
SERVICE_PORT_health=8000
SERVICE_PORT_stt=8001
SERVICE_PORT_llm=8002
SERVICE_PORT_tts=8003
SERVICE_PORT_vision=8004
SERVICE_NAMES="health stt llm tts vision"

# ---------------------------------------------------------------------------
# Helper Functions
# ---------------------------------------------------------------------------
log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }
warn() { log "WARNING: $*"; }
err() { log "ERROR: $*" >&2; }
die() { err "$*"; exit 1; }

check_root() {
    if [[ $EUID -ne 0 ]]; then
        die "This script must be run as root (use sudo)."
    fi
}

# ---------------------------------------------------------------------------
# Step 1: macOS Software Update & Xcode CLI Tools
# ---------------------------------------------------------------------------
install_xcode_cli() {
    log "Checking Xcode Command Line Tools..."
    if xcode-select -p &>/dev/null; then
        log "Xcode CLI tools already installed."
    else
        log "Installing Xcode Command Line Tools..."
        xcode-select --install 2>/dev/null || true
        # Wait for installation to complete
        until xcode-select -p &>/dev/null; do
            log "Waiting for Xcode CLI tools installation..."
            sleep 10
        done
        log "Xcode CLI tools installed."
    fi
}

run_macos_updates() {
    log "Checking for macOS software updates..."
    softwareupdate --list 2>&1 | grep -q "No new software available" && {
        log "macOS is up to date."
        return 0
    }
    log "Installing recommended macOS updates (this may take a while)..."
    softwareupdate --install --recommended --agree-to-license 2>/dev/null || {
        warn "Some updates may require a restart. Continue provisioning."
    }
}

# ---------------------------------------------------------------------------
# Step 2: Homebrew
# ---------------------------------------------------------------------------
install_homebrew() {
    log "Checking Homebrew..."
    if command -v brew &>/dev/null; then
        log "Homebrew already installed. Updating..."
        sudo -u "${CARELOG_USER}" brew update || sudo -u "$(logname)" brew update || true
    else
        log "Installing Homebrew..."
        # Install as the logged-in user, not root
        INSTALL_USER="$(logname 2>/dev/null || echo "${SUDO_USER:-admin}")"
        sudo -u "${INSTALL_USER}" /bin/bash -c \
            "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
        # Ensure brew is on PATH for Apple Silicon
        if [[ -f /opt/homebrew/bin/brew ]]; then
            eval "$(/opt/homebrew/bin/brew shellenv)"
        fi
    fi
}

install_brew_packages() {
    log "Installing Homebrew packages..."
    local BREW_USER
    BREW_USER="$(logname 2>/dev/null || echo "${SUDO_USER:-admin}")"

    local packages=("${PYTHON_VERSION}" "git" "wget" "logrotate")
    for pkg in "${packages[@]}"; do
        if sudo -u "${BREW_USER}" brew list "${pkg}" &>/dev/null; then
            log "  ${pkg} already installed."
        else
            log "  Installing ${pkg}..."
            sudo -u "${BREW_USER}" brew install "${pkg}"
        fi
    done
}

# ---------------------------------------------------------------------------
# Step 3: Create carelog user and directory structure
# ---------------------------------------------------------------------------
create_carelog_user() {
    log "Checking carelog user..."
    if id "${CARELOG_USER}" &>/dev/null; then
        log "User '${CARELOG_USER}' already exists."
    else
        log "Creating user '${CARELOG_USER}'..."
        # Find the next available UID above 500
        local NEXT_UID
        NEXT_UID=$(dscl . -list /Users UniqueID | awk '{print $2}' | sort -n | tail -1)
        NEXT_UID=$((NEXT_UID + 1))

        dscl . -create "/Users/${CARELOG_USER}"
        dscl . -create "/Users/${CARELOG_USER}" UserShell /usr/bin/false
        dscl . -create "/Users/${CARELOG_USER}" RealName "CareLog Service Account"
        dscl . -create "/Users/${CARELOG_USER}" UniqueID "${NEXT_UID}"
        dscl . -create "/Users/${CARELOG_USER}" PrimaryGroupID 20
        dscl . -create "/Users/${CARELOG_USER}" NFSHomeDirectory "${CARELOG_HOME}"
        # Hide the user from the login window
        dscl . -create "/Users/${CARELOG_USER}" IsHidden 1
        log "User '${CARELOG_USER}' created (UID=${NEXT_UID})."
    fi
}

create_directory_structure() {
    log "Creating directory structure at ${CARELOG_HOME}..."
    local dirs=(
        "${CARELOG_HOME}"
        "${MODELS_DIR}"
        "${MODELS_DIR}/previous"
        "${SERVICES_DIR}"
        "${LOGS_DIR}"
        "${TMP_DIR}"
    )

    for dir in "${dirs[@]}"; do
        if [[ -d "${dir}" ]]; then
            log "  ${dir} exists."
        else
            mkdir -p "${dir}"
            log "  Created ${dir}."
        fi
    done

    chown -R "${CARELOG_USER}:staff" "${CARELOG_HOME}"
    chmod -R 755 "${CARELOG_HOME}"
    log "Directory structure ready."
}

# ---------------------------------------------------------------------------
# Step 4: Python virtual environment and dependencies
# ---------------------------------------------------------------------------
setup_python_venv() {
    log "Setting up Python virtual environment..."

    # Determine python3.11 path (Homebrew on Apple Silicon)
    local PYTHON_BIN
    PYTHON_BIN="$(brew --prefix "${PYTHON_VERSION}")/bin/python3.11"
    if [[ ! -x "${PYTHON_BIN}" ]]; then
        PYTHON_BIN="$(which python3.11 2>/dev/null || true)"
    fi
    if [[ -z "${PYTHON_BIN}" || ! -x "${PYTHON_BIN}" ]]; then
        die "python3.11 not found. Ensure ${PYTHON_VERSION} is installed via Homebrew."
    fi

    if [[ -f "${VENV_PATH}/bin/activate" ]]; then
        log "Virtual environment already exists at ${VENV_PATH}."
    else
        log "Creating virtual environment..."
        "${PYTHON_BIN}" -m venv "${VENV_PATH}"
        log "Virtual environment created."
    fi

    log "Installing Python dependencies..."
    "${VENV_PATH}/bin/pip" install --upgrade pip

    # Install from requirements.txt if available, otherwise install core deps
    local REQUIREMENTS="${SCRIPT_DIR}/../requirements.txt"
    if [[ -f "${REQUIREMENTS}" ]]; then
        "${VENV_PATH}/bin/pip" install -r "${REQUIREMENTS}"
        log "Installed dependencies from requirements.txt."
    else
        log "No requirements.txt found, installing core dependencies..."
        "${VENV_PATH}/bin/pip" install \
            fastapi \
            uvicorn[standard] \
            numpy \
            pydantic \
            httpx \
            python-multipart
        log "Core dependencies installed."
    fi

    chown -R "${CARELOG_USER}:staff" "${VENV_PATH}"
}

# ---------------------------------------------------------------------------
# Step 5: Download models
# ---------------------------------------------------------------------------
download_model() {
    local name="$1" url="$2" dest="$3"

    if [[ -f "${dest}" ]]; then
        log "  Model '${name}' already downloaded at ${dest}."
        return 0
    fi

    if [[ "${url}" == *"example.com"* ]]; then
        warn "  Skipping '${name}' download — placeholder URL detected."
        warn "  Set the correct URL and re-run, or manually place the model at: ${dest}"
        return 0
    fi

    log "  Downloading '${name}' from ${url}..."
    curl -L -C - -# -o "${dest}.tmp" "${url}"
    mv "${dest}.tmp" "${dest}"
    log "  Model '${name}' downloaded."
}

download_models() {
    log "Downloading AI models..."

    download_model "whisper-large-v3 (STT)" \
        "${MODEL_STT_URL}" "${MODELS_DIR}/whisper-large-v3.bin"

    download_model "qwen-2.5-7b (LLM)" \
        "${MODEL_LLM_URL}" "${MODELS_DIR}/qwen-2.5-7b-q4.gguf"

    download_model "qwen-vl-7b (Vision)" \
        "${MODEL_VISION_URL}" "${MODELS_DIR}/qwen-vl-7b-q4.gguf"

    download_model "piper-en (TTS English)" \
        "${MODEL_TTS_EN_URL}" "${MODELS_DIR}/piper-en.onnx"

    download_model "piper-hi (TTS Hindi)" \
        "${MODEL_TTS_HI_URL}" "${MODELS_DIR}/piper-hi.onnx"

    download_model "piper-bn (TTS Bengali)" \
        "${MODEL_TTS_BN_URL}" "${MODELS_DIR}/piper-bn.onnx"

    chown -R "${CARELOG_USER}:staff" "${MODELS_DIR}"
}

# ---------------------------------------------------------------------------
# Step 6: Create model version symlinks
# ---------------------------------------------------------------------------
create_model_symlinks() {
    log "Creating model version symlinks..."

    local link_names="current-stt current-llm current-vision"
    local link_targets="whisper-large-v3.bin qwen-2.5-7b-q4.gguf qwen-vl-7b-q4.gguf"

    local i=0
    for link_name in ${link_names}; do
        local target
        target="$(echo "${link_targets}" | cut -d' ' -f$((i+1)))"
        i=$((i+1))
        local link_path="${MODELS_DIR}/${link_name}"

        if [[ -L "${link_path}" ]]; then
            local current_target
            current_target="$(readlink "${link_path}")"
            if [[ "${current_target}" == "${target}" ]]; then
                log "  ${link_name} -> ${target} (already set)."
                continue
            fi
        fi

        # Only create symlink if target model file exists
        if [[ -f "${MODELS_DIR}/${target}" ]]; then
            ln -sfn "${target}" "${link_path}"
            log "  ${link_name} -> ${target}"
        else
            warn "  Skipping ${link_name} — target model '${target}' not yet downloaded."
        fi
    done
}

# ---------------------------------------------------------------------------
# Step 7: Copy service files and install launchd plists
# ---------------------------------------------------------------------------
install_services() {
    log "Copying service files..."

    # Copy Python service files from source tree if they exist
    local SRC_SERVICES="${SCRIPT_DIR}/../services"
    if [[ -d "${SRC_SERVICES}" ]]; then
        cp -R "${SRC_SERVICES}/"* "${SERVICES_DIR}/" 2>/dev/null || true
        chown -R "${CARELOG_USER}:staff" "${SERVICES_DIR}"
        log "Service files copied to ${SERVICES_DIR}."
    else
        warn "No service source directory found at ${SRC_SERVICES}."
        warn "Service Python files must be placed in ${SERVICES_DIR} before starting."
    fi
}

install_launchd_plists() {
    log "Installing launchd plist files..."

    if [[ ! -d "${LAUNCHD_DIR}" ]]; then
        die "Launchd plist directory not found at ${LAUNCHD_DIR}."
    fi

    local plist_files=(
        "com.carelog.health.plist"
        "com.carelog.stt.plist"
        "com.carelog.llm.plist"
        "com.carelog.tts.plist"
        "com.carelog.vision.plist"
    )

    for plist in "${plist_files[@]}"; do
        local src="${LAUNCHD_DIR}/${plist}"
        local dest="/Library/LaunchDaemons/${plist}"

        if [[ ! -f "${src}" ]]; then
            warn "  Plist not found: ${src}. Skipping."
            continue
        fi

        cp "${src}" "${dest}"
        chown root:wheel "${dest}"
        chmod 644 "${dest}"
        log "  Installed ${plist}."
    done
}

load_launchd_services() {
    log "Loading launchd services..."

    local plist_files=(
        "com.carelog.health.plist"
        "com.carelog.stt.plist"
        "com.carelog.llm.plist"
        "com.carelog.tts.plist"
        "com.carelog.vision.plist"
    )

    for plist in "${plist_files[@]}"; do
        local plist_path="/Library/LaunchDaemons/${plist}"

        if [[ ! -f "${plist_path}" ]]; then
            warn "  ${plist} not installed. Skipping load."
            continue
        fi

        # Unload first if already loaded (idempotent)
        launchctl unload "${plist_path}" 2>/dev/null || true
        launchctl load "${plist_path}"
        log "  Loaded ${plist}."
    done
}

# ---------------------------------------------------------------------------
# Step 8: Install monitoring cron jobs
# ---------------------------------------------------------------------------
install_monitoring() {
    log "Installing monitoring scripts and cron jobs..."

    local MONITORING_DIR="${SCRIPT_DIR}/monitoring"

    # Install logrotate config
    if [[ -f "${MONITORING_DIR}/log-rotate.conf" ]]; then
        local LOGROTATE_DIR="/usr/local/etc/logrotate.d"
        mkdir -p "${LOGROTATE_DIR}"
        cp "${MONITORING_DIR}/log-rotate.conf" "${LOGROTATE_DIR}/carelog"
        log "  Logrotate config installed."
    fi

    # Copy monitoring scripts
    local INSTALLED_MONITORING="${CARELOG_HOME}/monitoring"
    mkdir -p "${INSTALLED_MONITORING}"
    for script in health-cron.sh cleanup-tmp.sh; do
        if [[ -f "${MONITORING_DIR}/${script}" ]]; then
            cp "${MONITORING_DIR}/${script}" "${INSTALLED_MONITORING}/${script}"
            chmod +x "${INSTALLED_MONITORING}/${script}"
        fi
    done
    chown -R "${CARELOG_USER}:staff" "${INSTALLED_MONITORING}"

    # Install cron jobs for root
    local CRON_TMP
    CRON_TMP="$(mktemp)"
    crontab -l 2>/dev/null | grep -v "carelog" > "${CRON_TMP}" || true

    cat >> "${CRON_TMP}" <<CRON
# CareLog monitoring - health/resource logging every 5 minutes
*/5 * * * * ${INSTALLED_MONITORING}/health-cron.sh >> ${LOGS_DIR}/monitoring.log 2>&1
# CareLog monitoring - tmp cleanup every 15 minutes
*/15 * * * * ${INSTALLED_MONITORING}/cleanup-tmp.sh >> ${LOGS_DIR}/monitoring.log 2>&1
# CareLog monitoring - logrotate hourly
0 * * * * /usr/local/bin/logrotate /usr/local/etc/logrotate.d/carelog --state ${CARELOG_HOME}/logrotate.state
CRON

    crontab "${CRON_TMP}"
    rm -f "${CRON_TMP}"
    log "  Cron jobs installed."
}

# ---------------------------------------------------------------------------
# Step 9: Register mDNS service
# ---------------------------------------------------------------------------
register_mdns() {
    log "Registering mDNS service..."
    local MDNS_SCRIPT="${SCRIPT_DIR}/mdns/register-service.sh"

    if [[ -x "${MDNS_SCRIPT}" ]]; then
        bash "${MDNS_SCRIPT}" &
        log "  mDNS registration started in background."
    else
        warn "mDNS registration script not found or not executable."
    fi
}

# ---------------------------------------------------------------------------
# Step 10: Health check verification
# ---------------------------------------------------------------------------
verify_services() {
    log "Verifying services (waiting 10s for startup)..."
    sleep 10

    local all_healthy=true
    for service in ${SERVICE_NAMES}; do
        local port_var="SERVICE_PORT_${service}"
        local port="${!port_var}"
        local url="http://127.0.0.1:${port}/health"

        if curl -sf --max-time 5 "${url}" &>/dev/null; then
            log "  [OK] ${service} service on port ${port} is healthy."
        else
            warn "  [FAIL] ${service} service on port ${port} is not responding."
            all_healthy=false
        fi
    done

    if [[ "${all_healthy}" == "true" ]]; then
        log "All services are healthy!"
    else
        warn "Some services are not healthy. Check logs at ${LOGS_DIR}/."
        warn "Services may still be starting up — retry verification after a minute."
    fi
}

# ---------------------------------------------------------------------------
# Step 11: Security Hardening
# ---------------------------------------------------------------------------
run_security_hardening() {
    log "Running security hardening scripts..."

    local SECURITY_DIR="${SCRIPT_DIR}/security"

    # Firewall setup
    if [[ -f "${SECURITY_DIR}/firewall-setup.sh" ]]; then
        log "  Running firewall setup..."
        chmod +x "${SECURITY_DIR}/firewall-setup.sh"
        bash "${SECURITY_DIR}/firewall-setup.sh" || warn "Firewall setup had issues."
    else
        warn "  Firewall setup script not found at ${SECURITY_DIR}/firewall-setup.sh"
    fi

    # FileVault check
    if [[ -f "${SECURITY_DIR}/filevault-check.sh" ]]; then
        log "  Running FileVault check..."
        chmod +x "${SECURITY_DIR}/filevault-check.sh"
        bash "${SECURITY_DIR}/filevault-check.sh" || warn "FileVault is not enabled. Enable it before pilot deployment."
    else
        warn "  FileVault check script not found at ${SECURITY_DIR}/filevault-check.sh"
    fi

    # SSH hardening
    if [[ -f "${SECURITY_DIR}/harden-ssh.sh" ]]; then
        log "  Running SSH hardening..."
        chmod +x "${SECURITY_DIR}/harden-ssh.sh"
        bash "${SECURITY_DIR}/harden-ssh.sh" || warn "SSH hardening had issues."
    else
        warn "  SSH hardening script not found at ${SECURITY_DIR}/harden-ssh.sh"
    fi
}

# ---------------------------------------------------------------------------
# Step 12: Set File Permissions
# ---------------------------------------------------------------------------
set_file_permissions() {
    log "Setting restrictive file permissions..."

    # Model files: read-only
    if [[ -d "${MODELS_DIR}" ]]; then
        chmod -R a-w "${MODELS_DIR}/" 2>/dev/null || true
        chmod -R u+r "${MODELS_DIR}/" 2>/dev/null || true
        chown -R "${CARELOG_USER}:staff" "${MODELS_DIR}"
        log "  Model files set to read-only for ${CARELOG_USER}."
    fi

    # Service files: read-only + execute for carelog user
    if [[ -d "${SERVICES_DIR}" ]]; then
        chmod -R a-w "${SERVICES_DIR}/" 2>/dev/null || true
        chmod -R u+r,u+x "${SERVICES_DIR}/" 2>/dev/null || true
        chown -R "${CARELOG_USER}:staff" "${SERVICES_DIR}"
        log "  Service files set to read-only for ${CARELOG_USER}."
    fi

    # Logs directory: writable by carelog user only
    chmod 755 "${LOGS_DIR}"
    chown -R "${CARELOG_USER}:staff" "${LOGS_DIR}"
    log "  Log directory permissions set."

    # Tmp directory: writable by carelog user only
    chmod 755 "${TMP_DIR}"
    chown -R "${CARELOG_USER}:staff" "${TMP_DIR}"
    log "  Tmp directory permissions set."
}

# ---------------------------------------------------------------------------
# Step 13: Disable Unnecessary macOS Services
# ---------------------------------------------------------------------------
disable_unnecessary_services() {
    log "Disabling unnecessary macOS services..."

    # Disable Screen Sharing
    launchctl unload -w /System/Library/LaunchDaemons/com.apple.screensharing.plist 2>/dev/null || true
    log "  Disabled: Screen Sharing"

    # Disable AirDrop
    defaults write com.apple.NetworkBrowser DisableAirDrop -bool YES 2>/dev/null || true
    log "  Disabled: AirDrop"

    # Disable Bluetooth Sharing
    defaults -currentHost write com.apple.Bluetooth PrefKeyServicesEnabled -bool false 2>/dev/null || true
    log "  Disabled: Bluetooth Sharing"

    # Disable File Sharing (AFP/SMB) if not needed
    launchctl unload -w /System/Library/LaunchDaemons/com.apple.smbd.plist 2>/dev/null || true
    log "  Disabled: File Sharing (SMB)"

    # Note: Remote Login (SSH) is left as configured by harden-ssh.sh
    log "  Note: SSH left as configured by security hardening."
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
main() {
    log "============================================="
    log "CareLog Mac Mini M4 Provisioning"
    log "============================================="

    check_root

    log ""
    log "--- Step 1: macOS Updates & Xcode CLI Tools ---"
    install_xcode_cli
    run_macos_updates

    log ""
    log "--- Step 2: Homebrew & Packages ---"
    install_homebrew
    install_brew_packages

    log ""
    log "--- Step 3: User & Directory Structure ---"
    create_carelog_user
    create_directory_structure

    log ""
    log "--- Step 4: Python Virtual Environment ---"
    setup_python_venv

    log ""
    log "--- Step 5: Download AI Models ---"
    download_models

    log ""
    log "--- Step 6: Model Version Symlinks ---"
    create_model_symlinks

    log ""
    log "--- Step 7: Install Services & Launchd ---"
    install_services
    install_launchd_plists
    load_launchd_services

    log ""
    log "--- Step 8: Monitoring & Cron Jobs ---"
    install_monitoring

    log ""
    log "--- Step 9: mDNS Registration ---"
    register_mdns

    log ""
    log "--- Step 10: Health Check Verification ---"
    verify_services

    log ""
    log "--- Step 11: Security Hardening ---"
    run_security_hardening

    log ""
    log "--- Step 12: File Permissions ---"
    set_file_permissions

    log ""
    log "--- Step 13: Disable Unnecessary Services ---"
    disable_unnecessary_services

    log ""
    log "============================================="
    log "Provisioning complete!"
    log "============================================="
    log ""
    log "Service endpoints:"
    for service in ${SERVICE_NAMES}; do
        local port_var="SERVICE_PORT_${service}"
        log "  ${service}: http://127.0.0.1:${!port_var}"
    done
    log ""
    log "Logs:   ${LOGS_DIR}/"
    log "Models: ${MODELS_DIR}/"
    log "Tmp:    ${TMP_DIR}/"
}

main "$@"
