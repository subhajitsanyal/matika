#!/usr/bin/env bash
#
# CareLog Model Update/Rollback Script
#
# Downloads a new model version, swaps it in with zero-downtime symlink swap,
# and rolls back automatically if the health check fails.
#
# Usage: ./update-model.sh <service> <model_url>
#   service:   stt | llm | vision | tts
#   model_url: HTTPS URL to the new model file
#
# Example:
#   ./update-model.sh stt https://models.example.com/whisper-large-v3-2.bin

set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
CARELOG_HOME="/opt/carelog"
MODELS_DIR="${CARELOG_HOME}/models"
PREVIOUS_DIR="${MODELS_DIR}/previous"
STAGING_DIR="${CARELOG_HOME}/tmp/model-staging"
LOGS_DIR="${CARELOG_HOME}/logs"

HEALTH_CHECK_RETRIES=6
HEALTH_CHECK_INTERVAL=5

# Service -> symlink name mapping
declare -A SYMLINK_MAP=(
    [stt]="current-stt"
    [llm]="current-llm"
    [vision]="current-vision"
    [tts]="current-tts"
)

# Service -> launchd label mapping
declare -A LAUNCHD_MAP=(
    [stt]="com.carelog.stt"
    [llm]="com.carelog.llm"
    [vision]="com.carelog.vision"
    [tts]="com.carelog.tts"
    [health]="com.carelog.health"
)

# Service -> port mapping
declare -A PORT_MAP=(
    [stt]=8001
    [llm]=8002
    [vision]=8004
    [tts]=8003
    [health]=8000
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] [update-model] $*"; }
err() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] [update-model] ERROR: $*" >&2; }
die() { err "$*"; exit 1; }

usage() {
    echo "Usage: $0 <service> <model_url>"
    echo "  service:   stt | llm | vision | tts"
    echo "  model_url: HTTPS URL to the new model file"
    exit 1
}

health_check() {
    local service="$1"
    local port="${PORT_MAP[$service]}"
    local url="http://127.0.0.1:${port}/health"

    log "Running health check on ${service} (port ${port})..."
    for i in $(seq 1 ${HEALTH_CHECK_RETRIES}); do
        if curl -sf --max-time 5 "${url}" &>/dev/null; then
            log "Health check passed (attempt ${i}/${HEALTH_CHECK_RETRIES})."
            return 0
        fi
        log "Health check attempt ${i}/${HEALTH_CHECK_RETRIES} failed. Retrying in ${HEALTH_CHECK_INTERVAL}s..."
        sleep "${HEALTH_CHECK_INTERVAL}"
    done

    err "Health check failed after ${HEALTH_CHECK_RETRIES} attempts."
    return 1
}

stop_service() {
    local service="$1"
    local label="${LAUNCHD_MAP[$service]}"
    local plist="/Library/LaunchDaemons/${label}.plist"

    log "Stopping ${service} (${label})..."
    if [[ -f "${plist}" ]]; then
        launchctl unload "${plist}" 2>/dev/null || true
    fi
    sleep 2
    log "Service ${service} stopped."
}

start_service() {
    local service="$1"
    local label="${LAUNCHD_MAP[$service]}"
    local plist="/Library/LaunchDaemons/${label}.plist"

    log "Starting ${service} (${label})..."
    if [[ -f "${plist}" ]]; then
        launchctl load "${plist}"
    else
        die "Plist not found: ${plist}"
    fi
    log "Service ${service} started."
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
main() {
    # Validate arguments
    if [[ $# -ne 2 ]]; then
        usage
    fi

    local service="$1"
    local model_url="$2"

    if [[ -z "${SYMLINK_MAP[$service]+_}" ]]; then
        die "Unknown service: ${service}. Must be one of: stt, llm, vision, tts."
    fi

    local symlink_name="${SYMLINK_MAP[$service]}"
    local symlink_path="${MODELS_DIR}/${symlink_name}"

    # Determine the filename from URL
    local new_model_filename
    new_model_filename="$(basename "${model_url}")"
    local new_model_path="${MODELS_DIR}/${new_model_filename}"
    local staging_path="${STAGING_DIR}/${new_model_filename}"

    log "============================================="
    log "Model Update: ${service}"
    log "  URL:      ${model_url}"
    log "  Filename: ${new_model_filename}"
    log "  Symlink:  ${symlink_name}"
    log "============================================="

    # Record current model for rollback
    local current_model=""
    if [[ -L "${symlink_path}" ]]; then
        current_model="$(readlink "${symlink_path}")"
        log "Current model: ${current_model}"
    else
        log "No existing symlink found at ${symlink_path}."
    fi

    # Step 1: Download to staging
    log ""
    log "--- Step 1: Download to staging ---"
    mkdir -p "${STAGING_DIR}"
    log "Downloading ${model_url}..."
    if ! wget --progress=bar:force -O "${staging_path}" "${model_url}"; then
        rm -f "${staging_path}"
        die "Download failed."
    fi
    log "Download complete: ${staging_path}"

    # Verify file is not empty
    if [[ ! -s "${staging_path}" ]]; then
        rm -f "${staging_path}"
        die "Downloaded file is empty."
    fi

    # Step 2: Move to models directory
    log ""
    log "--- Step 2: Move model to ${MODELS_DIR} ---"
    mv "${staging_path}" "${new_model_path}"
    log "Model placed at ${new_model_path}."

    # Step 3: Backup current model
    if [[ -n "${current_model}" && -f "${MODELS_DIR}/${current_model}" ]]; then
        log ""
        log "--- Step 3: Backup current model ---"
        mkdir -p "${PREVIOUS_DIR}"
        cp "${MODELS_DIR}/${current_model}" "${PREVIOUS_DIR}/${current_model}"
        log "Backed up ${current_model} to ${PREVIOUS_DIR}/."
    fi

    # Step 4: Stop service, swap symlink, start service
    log ""
    log "--- Step 4: Swap model ---"
    stop_service "${service}"
    ln -sfn "${new_model_filename}" "${symlink_path}"
    log "Symlink updated: ${symlink_name} -> ${new_model_filename}"
    start_service "${service}"

    # Step 5: Health check
    log ""
    log "--- Step 5: Health check ---"
    if health_check "${service}"; then
        log ""
        log "Model update successful!"
        log "  Service: ${service}"
        log "  Model:   ${new_model_filename}"

        # Clean up staging directory
        rm -rf "${STAGING_DIR}"
        log "Staging directory cleaned up."
    else
        # Rollback
        log ""
        log "--- ROLLBACK ---"
        err "Health check failed. Rolling back to previous model."

        stop_service "${service}"

        if [[ -n "${current_model}" ]]; then
            ln -sfn "${current_model}" "${symlink_path}"
            log "Symlink reverted: ${symlink_name} -> ${current_model}"
        else
            rm -f "${symlink_path}"
            log "Symlink removed (no previous model to revert to)."
        fi

        start_service "${service}"

        # Verify rollback
        if health_check "${service}"; then
            log "Rollback successful. Service is healthy with previous model."
        else
            err "CRITICAL: Rollback health check also failed!"
            err "Manual intervention required. Check logs at ${LOGS_DIR}/."
        fi

        # Remove the failed model
        rm -f "${new_model_path}"
        rm -rf "${STAGING_DIR}"

        die "Model update failed and was rolled back."
    fi
}

main "$@"
