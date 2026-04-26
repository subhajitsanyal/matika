#!/usr/bin/env bash
#
# CareLog Health/Resource Monitoring Cron Script
#
# Logs memory usage (vm_stat) and disk usage (df) for the Mac Mini.
# Intended to run every 5 minutes via cron.
#
# Output goes to /opt/carelog/logs/monitoring.log (via cron redirection).

set -euo pipefail

TIMESTAMP="$(date '+%Y-%m-%d %H:%M:%S')"
CARELOG_HOME="/opt/carelog"

echo "=== Health Check: ${TIMESTAMP} ==="

# ---------------------------------------------------------------------------
# Memory Usage (vm_stat)
# ---------------------------------------------------------------------------
echo ""
echo "--- Memory Usage ---"

# Parse vm_stat output into human-readable format
VM_STAT="$(vm_stat)"
PAGE_SIZE="$(echo "${VM_STAT}" | head -1 | grep -oE '[0-9]+')"

# Extract page counts
pages_free="$(echo "${VM_STAT}" | awk '/Pages free/ {print $NF}' | tr -d '.')"
pages_active="$(echo "${VM_STAT}" | awk '/Pages active/ {print $NF}' | tr -d '.')"
pages_inactive="$(echo "${VM_STAT}" | awk '/Pages inactive/ {print $NF}' | tr -d '.')"
pages_wired="$(echo "${VM_STAT}" | awk '/Pages wired/ {print $NF}' | tr -d '.')"
pages_compressed="$(echo "${VM_STAT}" | awk '/Pages occupied by compressor/ {print $NF}' | tr -d '.')"

# Convert to MB
free_mb=$(( (pages_free * PAGE_SIZE) / 1048576 ))
active_mb=$(( (pages_active * PAGE_SIZE) / 1048576 ))
inactive_mb=$(( (pages_inactive * PAGE_SIZE) / 1048576 ))
wired_mb=$(( (pages_wired * PAGE_SIZE) / 1048576 ))
compressed_mb=$(( (pages_compressed * PAGE_SIZE) / 1048576 ))
used_mb=$(( active_mb + wired_mb + compressed_mb ))

echo "  Free:       ${free_mb} MB"
echo "  Active:     ${active_mb} MB"
echo "  Inactive:   ${inactive_mb} MB"
echo "  Wired:      ${wired_mb} MB"
echo "  Compressed: ${compressed_mb} MB"
echo "  Used Total: ${used_mb} MB"

# ---------------------------------------------------------------------------
# Disk Usage
# ---------------------------------------------------------------------------
echo ""
echo "--- Disk Usage ---"
df -h / "${CARELOG_HOME}" 2>/dev/null | awk 'NR==1 || /\/$/ || /carelog/'
echo ""

# Specific /opt/carelog usage
echo "  /opt/carelog breakdown:"
if [[ -d "${CARELOG_HOME}/models" ]]; then
    models_size="$(du -sh "${CARELOG_HOME}/models" 2>/dev/null | cut -f1)"
    echo "    models:   ${models_size}"
fi
if [[ -d "${CARELOG_HOME}/logs" ]]; then
    logs_size="$(du -sh "${CARELOG_HOME}/logs" 2>/dev/null | cut -f1)"
    echo "    logs:     ${logs_size}"
fi
if [[ -d "${CARELOG_HOME}/tmp" ]]; then
    tmp_size="$(du -sh "${CARELOG_HOME}/tmp" 2>/dev/null | cut -f1)"
    echo "    tmp:      ${tmp_size}"
fi

# ---------------------------------------------------------------------------
# Service Health Checks
# ---------------------------------------------------------------------------
echo ""
echo "--- Service Status ---"

declare -A SERVICE_PORTS=(
    [health]=8000
    [stt]=8001
    [llm]=8002
    [tts]=8003
    [vision]=8004
)

for service in health stt llm tts vision; do
    port="${SERVICE_PORTS[$service]}"
    if curl -sf --max-time 3 "http://127.0.0.1:${port}/health" &>/dev/null; then
        echo "  ${service} (port ${port}): UP"
    else
        echo "  ${service} (port ${port}): DOWN"
    fi
done

# ---------------------------------------------------------------------------
# GPU / Metal Performance (Apple Silicon M4)
# ---------------------------------------------------------------------------
echo ""
echo "--- GPU / Metal Info ---"
# Apple Silicon uses unified memory — GPU memory is part of system memory
# Check for Metal GPU activity via IOKit
ioreg -l -w0 | grep -i "PerformanceStatistics" | head -3 2>/dev/null || echo "  GPU stats not available"

# ---------------------------------------------------------------------------
# Process-Level Memory for CareLog Services
# ---------------------------------------------------------------------------
echo ""
echo "--- CareLog Process Memory ---"
for service in health stt llm tts vision; do
    port="${SERVICE_PORTS[$service]}"
    # Find process by port
    pid="$(lsof -iTCP:${port} -sTCP:LISTEN -t 2>/dev/null | head -1 || true)"
    if [[ -n "${pid}" ]]; then
        rss="$(ps -o rss= -p "${pid}" 2>/dev/null | tr -d ' ' || echo "0")"
        rss_mb=$((rss / 1024))
        echo "  ${service} (PID ${pid}): ${rss_mb} MB RSS"
    else
        echo "  ${service}: no process found"
    fi
done

# ---------------------------------------------------------------------------
# Network Interface Status (LAN Connectivity)
# ---------------------------------------------------------------------------
echo ""
echo "--- Network Status ---"
# Check default gateway reachability
gateway="$(route -n get default 2>/dev/null | awk '/gateway/ {print $2}' || true)"
if [[ -n "${gateway}" ]]; then
    if ping -c 1 -W 2 "${gateway}" &>/dev/null; then
        echo "  Default gateway (${gateway}): REACHABLE"
    else
        echo "  Default gateway (${gateway}): UNREACHABLE"
    fi
else
    echo "  Default gateway: NOT CONFIGURED"
fi

# Active network interface
active_if="$(route -n get default 2>/dev/null | awk '/interface/ {print $2}' || true)"
if [[ -n "${active_if}" ]]; then
    ip_addr="$(ifconfig "${active_if}" 2>/dev/null | awk '/inet / {print $2}' || true)"
    echo "  Active interface: ${active_if} (${ip_addr:-no IP})"
fi

# ---------------------------------------------------------------------------
# Disk I/O Stats
# ---------------------------------------------------------------------------
echo ""
echo "--- Disk I/O Stats ---"
iostat -d -c 1 2>/dev/null | tail -2 || echo "  iostat not available"

# ---------------------------------------------------------------------------
# Alert Thresholds
# ---------------------------------------------------------------------------
echo ""
echo "--- Threshold Alerts ---"

# Memory alert: warn if used > 80% of total
total_mem_pages=$((pages_free + pages_active + pages_inactive + pages_wired + pages_compressed))
if [[ ${total_mem_pages} -gt 0 ]]; then
    used_pages=$((pages_active + pages_wired + pages_compressed))
    mem_pct=$(( (used_pages * 100) / total_mem_pages ))
    if [[ ${mem_pct} -gt 80 ]]; then
        echo "  WARNING: Memory usage at ${mem_pct}% (threshold: 80%)"
    else
        echo "  Memory: ${mem_pct}% used (OK, threshold: 80%)"
    fi
fi

# Disk alert: warn if usage > 90%
root_usage="$(df / 2>/dev/null | awk 'NR==2 {gsub(/%/,"",$5); print $5}')"
if [[ -n "${root_usage}" && ${root_usage} -gt 90 ]]; then
    echo "  WARNING: Disk usage at ${root_usage}% (threshold: 90%)"
else
    echo "  Disk: ${root_usage:-unknown}% used (OK, threshold: 90%)"
fi

echo ""
echo "=== End Health Check ==="
