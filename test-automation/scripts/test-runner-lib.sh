#!/usr/bin/env bash
# test-runner-lib.sh — Shared library for all test runner agents
# Source this: source test-automation/scripts/test-runner-lib.sh
set -euo pipefail

export ANDROID_HOME="${ANDROID_HOME:-/opt/homebrew/share/android-commandlinetools}"
export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home}"
export ADB="$ANDROID_HOME/platform-tools/adb"
export PROJECT_ROOT="${PROJECT_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
export TEST_ROOT="$PROJECT_ROOT/test-automation"
export RESULTS_DIR="$TEST_ROOT/results"
export CREDS_FILE="$TEST_ROOT/test-data/credentials.json"

# ─── UI Interaction ────────────────────────────────────────────────

# Dump UI and return path
ui_dump() {
    local out="${1:-/tmp/ui_dump_$(date +%s).xml}"
    $ADB shell uiautomator dump /sdcard/ui.xml 2>/dev/null
    $ADB pull /sdcard/ui.xml "$out" 2>/dev/null
    echo "$out"
}

# Find element center by text content; prints "x y" or returns 1
find_by_text() {
    local search_text="$1"
    local xml="${2:-/tmp/ui_current.xml}"
    ui_dump "$xml" >/dev/null 2>&1
    python3 -c "
import xml.etree.ElementTree as ET, sys
tree = ET.parse('$xml')
for node in tree.iter('node'):
    if node.get('text','') == '''$search_text''':
        b = node.get('bounds','')
        # Check if parent is clickable — use parent bounds for better tap target
        parts = b.replace('][',',').replace('[','').replace(']','').split(',')
        if len(parts)==4:
            x1,y1,x2,y2 = int(parts[0]),int(parts[1]),int(parts[2]),int(parts[3])
            print(f'{(x1+x2)//2} {(y1+y2)//2}')
            sys.exit(0)
sys.exit(1)
" 2>/dev/null
}

# Find EditText by its child label text; prints center of the EditText parent
find_field_by_label() {
    local label="$1"
    local xml="${2:-/tmp/ui_current.xml}"
    ui_dump "$xml" >/dev/null 2>&1
    python3 -c "
import xml.etree.ElementTree as ET, sys
tree = ET.parse('$xml')
for node in tree.iter('node'):
    if 'EditText' in node.get('class',''):
        for child in node.iter():
            if child.get('text','') == '''$label''' or '''$label''' in child.get('text',''):
                b = node.get('bounds','')
                parts = b.replace('][',',').replace('[','').replace(']','').split(',')
                if len(parts)==4:
                    x1,y1,x2,y2 = int(parts[0]),int(parts[1]),int(parts[2]),int(parts[3])
                    print(f'{(x1+x2)//2} {(y1+y2)//2}')
                    sys.exit(0)
sys.exit(1)
" 2>/dev/null
}

# Find clickable parent of a text element
find_button_by_text() {
    local search_text="$1"
    local xml="${2:-/tmp/ui_current.xml}"
    ui_dump "$xml" >/dev/null 2>&1
    python3 -c "
import xml.etree.ElementTree as ET, sys
tree = ET.parse('$xml')
# Build parent map
parent_map = {c: p for p in tree.iter() for c in p}
for node in tree.iter('node'):
    if node.get('text','') == '''$search_text''':
        # Walk up to find clickable parent
        current = node
        while current is not None:
            if current.get('clickable','') == 'true':
                b = current.get('bounds','')
                parts = b.replace('][',',').replace('[','').replace(']','').split(',')
                if len(parts)==4:
                    x1,y1,x2,y2 = int(parts[0]),int(parts[1]),int(parts[2]),int(parts[3])
                    print(f'{(x1+x2)//2} {(y1+y2)//2}')
                    sys.exit(0)
            current = parent_map.get(current)
        # Fallback to text position itself
        b = node.get('bounds','')
        parts = b.replace('][',',').replace('[','').replace(']','').split(',')
        if len(parts)==4:
            x1,y1,x2,y2 = int(parts[0]),int(parts[1]),int(parts[2]),int(parts[3])
            print(f'{(x1+x2)//2} {(y1+y2)//2}')
            sys.exit(0)
sys.exit(1)
" 2>/dev/null
}

# Find checkbox
find_checkbox() {
    local xml="${1:-/tmp/ui_current.xml}"
    ui_dump "$xml" >/dev/null 2>&1
    python3 -c "
import xml.etree.ElementTree as ET, sys
tree = ET.parse('$xml')
for node in tree.iter('node'):
    if node.get('checkable','') == 'true' and node.get('checked','') == 'false':
        b = node.get('bounds','')
        parts = b.replace('][',',').replace('[','').replace(']','').split(',')
        if len(parts)==4:
            x1,y1,x2,y2 = int(parts[0]),int(parts[1]),int(parts[2]),int(parts[3])
            print(f'{(x1+x2)//2} {(y1+y2)//2}')
            sys.exit(0)
sys.exit(1)
" 2>/dev/null
}

# Tap at coordinates
tap() {
    $ADB shell input tap "$1" "$2"
}

# Tap element found by text
tap_text() {
    local coords
    coords=$(find_by_text "$1") || { echo "FAIL: text '$1' not found" >&2; return 1; }
    tap $coords
}

# Tap button found by text
tap_button() {
    local coords
    coords=$(find_button_by_text "$1") || { echo "FAIL: button '$1' not found" >&2; return 1; }
    tap $coords
}

# Tap input field found by label, then type text
fill_field() {
    local label="$1"
    local value="$2"
    local coords
    coords=$(find_field_by_label "$label") || { echo "FAIL: field '$label' not found" >&2; return 1; }
    tap $coords
    sleep 0.3
    # Encode spaces for adb
    local encoded="${value// /%s}"
    $ADB shell input text "$encoded"
    sleep 0.3
}

# Type into currently focused field
type_text() {
    local encoded="${1// /%s}"
    $ADB shell input text "$encoded"
}

# Keyboard management
dismiss_keyboard() { $ADB shell input keyevent 4; sleep 0.5; }
press_back() { $ADB shell input keyevent 4; sleep 1; }
press_enter() { $ADB shell input keyevent 66; sleep 0.5; }

# Scrolling
scroll_down() { $ADB shell input swipe 540 1800 540 600 500; sleep 0.8; }
scroll_up() { $ADB shell input swipe 540 600 540 1800 500; sleep 0.8; }

# Wait
settle() { sleep "${1:-2}"; }

# ─── Screenshots & Verification ───────────────────────────────────

screenshot() {
    local name="$1"
    local path="$RESULTS_DIR/screenshots/${name}.png"
    $ADB exec-out screencap -p > "$path"
    echo "$path"
}

# Check if text is on screen
text_on_screen() {
    local xml="/tmp/ui_check_$(date +%s).xml"
    ui_dump "$xml" >/dev/null 2>&1
    grep -q "$1" "$xml" 2>/dev/null
}

# Wait for text to appear (up to N seconds)
wait_for_text() {
    local text="$1"
    local timeout="${2:-15}"
    local i=0
    while [ $i -lt "$timeout" ]; do
        if text_on_screen "$text"; then return 0; fi
        sleep 1
        i=$((i+1))
    done
    return 1
}

# ─── App Control ───────────────────────────────────────────────────

APP_PKG="com.carelog"
MAIN_ACT="$APP_PKG/.ui.MainActivity"

reset_app() { $ADB shell pm clear "$APP_PKG" 2>/dev/null; sleep 1; echo "App reset"; }
kill_app() { $ADB shell am force-stop "$APP_PKG"; sleep 0.5; }
launch_app() { $ADB shell am start -n "$MAIN_ACT" 2>/dev/null; sleep 4; echo "App launched"; }
fresh_start() { reset_app; launch_app; }

airplane_on() { $ADB shell cmd connectivity airplane-mode enable; sleep 2; echo "Airplane ON"; }
airplane_off() { $ADB shell cmd connectivity airplane-mode disable; sleep 5; echo "Airplane OFF"; }

# ─── Logcat ────────────────────────────────────────────────────────

LOGCAT_PID=""

start_logcat() {
    local group="$1"
    local logfile="$RESULTS_DIR/logcat/${group}.log"
    $ADB logcat -c 2>/dev/null || true
    $ADB logcat -v time "okhttp.OkHttpClient:D" "CareLog:D" "*:S" > "$logfile" 2>/dev/null &
    LOGCAT_PID=$!
    echo "$logfile"
}

stop_logcat() {
    [ -n "${LOGCAT_PID:-}" ] && kill "$LOGCAT_PID" 2>/dev/null || true
    LOGCAT_PID=""
}

# ─── Result Logging ───────────────────────────────────────────────

log_result() {
    local journey="$1" step="$2" action="$3" expected="$4" actual="$5" status="$6" screenshot_name="${7:-}"
    local file="$RESULTS_DIR/journey-results/${journey}.jsonl"
    printf '{"journey":"%s","step":%s,"action":"%s","expected":"%s","actual":"%s","status":"%s","screenshot":"%s","timestamp":"%s"}\n' \
        "$journey" "$step" "$action" "$expected" "$actual" "$status" "$screenshot_name" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$file"
}

# Read credentials from file
get_cred() {
    local key="$1"  # e.g., "relative.email" or "password"
    python3 -c "
import json
d = json.load(open('$CREDS_FILE'))
keys = '$key'.split('.')
v = d
for k in keys:
    v = v[k]
print(v)
"
}

# ─── Emulator Cold Boot ───────────────────────────────────────────

cold_boot_emulator() {
    echo "=== Cold-booting emulator ==="
    $ADB emu kill 2>/dev/null || true
    sleep 3
    pkill -f "qemu-system" 2>/dev/null || true
    sleep 2
    nohup "$ANDROID_HOME/emulator/emulator" -avd CareLog_Test -no-snapshot-load -gpu auto -no-audio > /tmp/emulator.log 2>&1 &
    $ADB wait-for-device
    while [ "$($ADB shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" != "1" ]; do sleep 3; done
    sleep 5
    echo "=== Emulator booted ==="
}

echo "test-runner-lib.sh loaded. PROJECT_ROOT=$PROJECT_ROOT"
