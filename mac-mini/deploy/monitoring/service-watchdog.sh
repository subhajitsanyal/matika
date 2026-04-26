#!/usr/bin/env bash
#
# CareLog Service Watchdog
#
# Enhanced watchdog that monitors all CareLog services (ports 8000-8004)
# and force-restarts them if launchd hasn't recovered them within 60s.
#
# Features:
# - Checks each service health endpoint
# - Force restarts services that are down for > 60s
# - Logs all restarts with timestamps
# - Tracks repeated failures (3+ restarts in 10 min triggers alert)
# - Maintains uptime statistics
#
# Intended to run every 1 minute via cron.
#
# Output goes to /opt/carelog/logs/watchdog.log (via cron redirection).

set -euo pipefail

CARELOG_HOME="/opt/carelog"
LOGS_DIR="${CARELOG_HOME}/logs"
WATCHDOG_STATE_DIR="${CARELOG_HOME}/monitoring/watchdog-state"
TIMESTAMP="$(date '+%Y-%m-%d %H:%M:%S')"
EPOCH="$(date '+%s')"
HEALTH_TIMEOUT=5
RESTART_GRACE_PERIOD=60  # seconds to wait before force restart
FAILURE_WINDOW=600       # 10 minutes in seconds
MAX_RESTARTS_IN_WINDOW=3

# Service definitions
declare -A SERVICE_PORTS=(
    [health]=8000
    [stt]=8001
    [llm]=8002
    [tts]=8003
    [vision]=8004
)

declare -A SERVICE_PLISTS=(
    [health]="com.carelog.health"
    [stt]="com.carelog.stt"
    [llm]="com.carelog.llm"
    [tts]="com.carelog.tts"
    [vision]="com.carelog.vision"
)

# Optional webhook URL for failure notifications
WEBHOOK_URL="${CARELOG_WATCHDOG_WEBHOOK:-}"

# ---------------------------------------------------------------------------
# Helper Functions
# ---------------------------------------------------------------------------
log() { echo "[${TIMESTAMP}] [watchdog] $*"; }
warn() { log "WARNING: $*"; }
err() { log "ERROR: $*"; }

# ---------------------------------------------------------------------------
# Initialize state directory
# ---------------------------------------------------------------------------
init_state() {
    mkdir -p "${WATCHDOG_STATE_DIR}"
    for service in "${!SERVICE_PORTS[@]}"; do
        local state_file="${WATCHDOG_STATE_DIR}/${service}"
        if [[ ! -f "${state_file}" ]]; then
            echo "up:${EPOCH}:0" > "${state_file}"
        fi
    done
}

# ---------------------------------------------------------------------------
# Check service health
# ---------------------------------------------------------------------------
check_service() {
    local service="$1"
    local port="${SERVICE_PORTS[$service]}"
    local url="http://127.0.0.1:${port}/health"

    if curl -sf --max-time "${HEALTH_TIMEOUT}" "${url}" &>/dev/null; then
        return 0
    else
        return 1
    fi
}

# ---------------------------------------------------------------------------
# Read service state: status:last_change_epoch:restart_count
# ---------------------------------------------------------------------------
read_state() {
    local service="$1"
    local state_file="${WATCHDOG_STATE_DIR}/${service}"
    if [[ -f "${state_file}" ]]; then
        cat "${state_file}"
    else
        echo "unknown:${EPOCH}:0"
    fi
}

write_state() {
    local service="$1" status="$2" last_change="$3" restart_count="$4"
    echo "${status}:${last_change}:${restart_count}" > "${WATCHDOG_STATE_DIR}/${service}"
}

# ---------------------------------------------------------------------------
# Read restart history (timestamps of recent restarts)
# ---------------------------------------------------------------------------
read_restart_history() {
    local service="$1"
    local history_file="${WATCHDOG_STATE_DIR}/${service}.restarts"
    if [[ -f "${history_file}" ]]; then
        cat "${history_file}"
    fi
}

add_restart_event() {
    local service="$1"
    local history_file="${WATCHDOG_STATE_DIR}/${service}.restarts"

    # Append current timestamp
    echo "${EPOCH}" >> "${history_file}"

    # Prune entries older than the failure window
    local cutoff=$((EPOCH - FAILURE_WINDOW))
    if [[ -f "${history_file}" ]]; then
        local tmp
        tmp="$(mktemp)"
        awk -v cutoff="${cutoff}" '$1 >= cutoff' "${history_file}" > "${tmp}"
        mv "${tmp}" "${history_file}"
    fi
}

count_recent_restarts() {
    local service="$1"
    local history_file="${WATCHDOG_STATE_DIR}/${service}.restarts"
    local cutoff=$((EPOCH - FAILURE_WINDOW))

    if [[ -f "${history_file}" ]]; then
        awk -v cutoff="${cutoff}" '$1 >= cutoff' "${history_file}" | wc -l | tr -d ' '
    else
        echo "0"
    fi
}

# ---------------------------------------------------------------------------
# Force restart a service via launchd
# ---------------------------------------------------------------------------
force_restart() {
    local service="$1"
    local plist="${SERVICE_PLISTS[$service]}"
    local plist_path="/Library/LaunchDaemons/${plist}.plist"

    if [[ ! -f "${plist_path}" ]]; then
        err "Plist not found: ${plist_path}. Cannot restart ${service}."
        return 1
    fi

    log "Force restarting ${service} (${plist})..."

    # Unload and reload
    launchctl unload "${plist_path}" 2>/dev/null || true
    sleep 2
    launchctl load "${plist_path}" 2>/dev/null || {
        err "Failed to reload ${plist}."
        return 1
    }

    log "Service ${service} restarted via launchd."
    add_restart_event "${service}"
}

# ---------------------------------------------------------------------------
# Send webhook notification on repeated failures
# ---------------------------------------------------------------------------
send_alert() {
    local service="$1"
    local restart_count="$2"

    if [[ -z "${WEBHOOK_URL}" ]]; then
        return 0
    fi

    local hostname
    hostname="$(hostname)"
    local payload
    payload="{\"text\":\"[CareLog Watchdog] ALERT: Service '${service}' on ${hostname} has been restarted ${restart_count} times in the last 10 minutes. Manual intervention may be required.\"}"

    curl -sf --max-time 10 \
        -H "Content-Type: application/json" \
        -d "${payload}" \
        "${WEBHOOK_URL}" &>/dev/null || warn "Failed to send webhook alert."
}

# ---------------------------------------------------------------------------
# Update uptime statistics
# ---------------------------------------------------------------------------
update_uptime_stats() {
    local service="$1" is_up="$2"
    local stats_file="${WATCHDOG_STATE_DIR}/${service}.uptime"

    if [[ ! -f "${stats_file}" ]]; then
        echo "checks:0 up:0 down:0" > "${stats_file}"
    fi

    local checks up down
    read -r checks up down < <(awk -F'[ :]' '{print $2, $4, $6}' "${stats_file}" 2>/dev/null || echo "0 0 0")
    checks=$((checks + 1))
    if [[ "${is_up}" == "true" ]]; then
        up=$((up + 1))
    else
        down=$((down + 1))
    fi
    echo "checks:${checks} up:${up} down:${down}" > "${stats_file}"
}

# ---------------------------------------------------------------------------
# Main watchdog loop (single pass)
# ---------------------------------------------------------------------------
main() {
    init_state

    local all_ok=true

    for service in health stt llm tts vision; do
        local port="${SERVICE_PORTS[$service]}"
        local state
        state="$(read_state "${service}")"
        local prev_status prev_change prev_restarts
        IFS=':' read -r prev_status prev_change prev_restarts <<< "${state}"

        if check_service "${service}"; then
            # Service is UP
            update_uptime_stats "${service}" "true"

            if [[ "${prev_status}" != "up" ]]; then
                log "${service} (port ${port}): RECOVERED (was down since $(date -r "${prev_change}" '+%H:%M:%S' 2>/dev/null || echo 'unknown'))"
                write_state "${service}" "up" "${EPOCH}" "0"
            fi
        else
            # Service is DOWN
            update_uptime_stats "${service}" "false"
            all_ok=false

            local down_duration=$((EPOCH - prev_change))

            if [[ "${prev_status}" == "up" ]]; then
                # Just went down — record the time
                warn "${service} (port ${port}): DOWN (just detected)"
                write_state "${service}" "down" "${EPOCH}" "0"
            elif [[ ${down_duration} -ge ${RESTART_GRACE_PERIOD} ]]; then
                # Been down longer than grace period — force restart
                warn "${service} (port ${port}): DOWN for ${down_duration}s — force restarting"
                force_restart "${service}" || true

                local recent_restarts
                recent_restarts="$(count_recent_restarts "${service}")"

                if [[ ${recent_restarts} -ge ${MAX_RESTARTS_IN_WINDOW} ]]; then
                    err "${service}: ${recent_restarts} restarts in last 10 minutes! Possible crash loop."
                    send_alert "${service}" "${recent_restarts}"
                fi

                write_state "${service}" "restarting" "${EPOCH}" "${recent_restarts}"
            else
                # Still within grace period — launchd may recover it
                log "${service} (port ${port}): DOWN for ${down_duration}s (grace period: ${RESTART_GRACE_PERIOD}s)"
            fi
        fi
    done

    if [[ "${all_ok}" == "true" ]]; then
        log "All services healthy."
    fi
}

main "$@"
