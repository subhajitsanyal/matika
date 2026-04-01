#!/usr/bin/env bash
# logcat-capture.sh — Backend call monitoring via logcat
# Source this file: source test-automation/scripts/logcat-capture.sh

set -euo pipefail

export ANDROID_HOME="${ANDROID_HOME:-/opt/homebrew/share/android-commandlinetools}"
export ADB="$ANDROID_HOME/platform-tools/adb"
export RESULTS_DIR="${RESULTS_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/results}"

LOGCAT_PID=""

# Start capturing logcat filtered to HTTP and app tags
start_logcat() {
    local journey_id="${1:-unknown}"
    local logfile="$RESULTS_DIR/logcat/${journey_id}_$(date +%s).log"

    # Clear logcat buffer
    $ADB logcat -c 2>/dev/null || true

    # Start filtered capture in background
    $ADB logcat -v time \
        "OkHttp:D" \
        "Amplify:D" \
        "CareLog:D" \
        "AuthRepository:D" \
        "SyncManager:D" \
        "*:S" \
        > "$logfile" 2>/dev/null &
    LOGCAT_PID=$!

    echo "$logfile"
}

# Stop logcat capture
stop_logcat() {
    if [ -n "$LOGCAT_PID" ]; then
        kill "$LOGCAT_PID" 2>/dev/null || true
        wait "$LOGCAT_PID" 2>/dev/null || true
        LOGCAT_PID=""
    fi
    echo "Logcat capture stopped"
}

# Parse logcat for HTTP requests/responses
parse_http_calls() {
    local logfile="$1"
    python3 -c "
import re, sys, json

calls = []
current_call = {}

with open('$logfile') as f:
    for line in f:
        # OkHttp request line: --> POST https://...
        m = re.search(r'--> (GET|POST|PUT|DELETE|PATCH) (https?://\S+)', line)
        if m:
            if current_call:
                calls.append(current_call)
            current_call = {'method': m.group(1), 'url': m.group(2), 'status': None, 'body_snippet': ''}

        # OkHttp response line: <-- 200 https://...
        m = re.search(r'<-- (\d+) (https?://\S+)', line)
        if m and current_call:
            current_call['status'] = int(m.group(1))

        # Capture relevant body content
        if current_call and ('observationType' in line or 'patientId' in line or 'loincCode' in line):
            current_call['body_snippet'] += line.strip()[-200:] + '\n'

if current_call:
    calls.append(current_call)

for c in calls:
    status_str = str(c.get('status', '?'))
    print(f\"{c['method']} {c['url']} -> {status_str}\")
    if c.get('body_snippet'):
        print(f\"  body: {c['body_snippet'][:300]}\")

print(f'\nTotal API calls: {len(calls)}')
json.dump(calls, open('$logfile.json', 'w'), indent=2)
print(f'JSON saved to: $logfile.json')
"
}

# Quick check: was a specific endpoint called?
check_endpoint() {
    local logfile="$1"
    local method="$2"
    local path_pattern="$3"

    if grep -q "$method.*$path_pattern" "$logfile" 2>/dev/null; then
        local status
        status=$(grep -A5 "$method.*$path_pattern" "$logfile" | grep -o '<-- [0-9]*' | head -1 | grep -o '[0-9]*')
        echo "FOUND: $method $path_pattern -> HTTP $status"
        return 0
    else
        echo "MISSING: $method $path_pattern not found in logs"
        return 1
    fi
}

echo "logcat-capture.sh loaded."
