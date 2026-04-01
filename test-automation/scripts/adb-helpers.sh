#!/usr/bin/env bash
# adb-helpers.sh — UI interaction primitives for agent-based testing
# Source this file: source test-automation/scripts/adb-helpers.sh

set -euo pipefail

export ANDROID_HOME="${ANDROID_HOME:-/opt/homebrew/share/android-commandlinetools}"
export ADB="$ANDROID_HOME/platform-tools/adb"
export RESULTS_DIR="${RESULTS_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/results}"

# ─── UI Hierarchy ──────────────────────────────────────────────────

# Dump UI hierarchy XML to local file and echo the path
dump_ui() {
    local out="${1:-$RESULTS_DIR/ui-dumps/ui_$(date +%s).xml}"
    $ADB shell uiautomator dump /sdcard/window_dump.xml 2>/dev/null
    $ADB pull /sdcard/window_dump.xml "$out" 2>/dev/null
    echo "$out"
}

# Get bounds "[x1,y1][x2,y2]" for element matching text or resource-id
# Usage: get_bounds "text" "Sign In"  OR  get_bounds "resource-id" "com.carelog:id/btn"
get_bounds() {
    local attr="$1"
    local value="$2"
    local xml
    xml=$(dump_ui "/tmp/ui_bounds.xml")
    python3 -c "
import xml.etree.ElementTree as ET, sys
tree = ET.parse('$xml')
for node in tree.iter('node'):
    if node.get('$attr', '') == '$value' or '$value' in node.get('$attr', ''):
        b = node.get('bounds', '')
        if b:
            # Parse [x1,y1][x2,y2] -> center x,y
            parts = b.replace('][', ',').replace('[', '').replace(']', '').split(',')
            x1,y1,x2,y2 = int(parts[0]),int(parts[1]),int(parts[2]),int(parts[3])
            print(f'{(x1+x2)//2} {(y1+y2)//2}')
            sys.exit(0)
print('NOT_FOUND', file=sys.stderr)
sys.exit(1)
" 2>/dev/null
}

# Get center coordinates for element with matching text
get_center_by_text() {
    get_bounds "text" "$1"
}

# Get center for element with matching resource-id (testTag shows as resource-id in uiautomator)
get_center_by_tag() {
    # Compose testTags appear as resource-id in uiautomator dump
    local tag="$1"
    local xml
    xml=$(dump_ui "/tmp/ui_tag.xml")
    python3 -c "
import xml.etree.ElementTree as ET, sys
tree = ET.parse('$xml')
for node in tree.iter('node'):
    rid = node.get('resource-id', '')
    # Compose testTags may appear as 'com.carelog:id/tag' or just 'tag' in content-desc
    cd = node.get('content-desc', '')
    text = node.get('text', '')
    if '$tag' in rid or '$tag' == cd:
        b = node.get('bounds', '')
        if b:
            parts = b.replace('][', ',').replace('[', '').replace(']', '').split(',')
            x1,y1,x2,y2 = int(parts[0]),int(parts[1]),int(parts[2]),int(parts[3])
            print(f'{(x1+x2)//2} {(y1+y2)//2}')
            sys.exit(0)
print('NOT_FOUND', file=sys.stderr)
sys.exit(1)
" 2>/dev/null
}

# ─── UI Interaction ────────────────────────────────────────────────

# Tap at coordinates
tap_xy() {
    $ADB shell input tap "$1" "$2"
}

# Tap element by visible text
tap_text() {
    local coords
    coords=$(get_center_by_text "$1") || { echo "ERROR: text '$1' not found" >&2; return 1; }
    local x y
    read -r x y <<< "$coords"
    $ADB shell input tap "$x" "$y"
}

# Tap element by testTag
tap_tag() {
    local coords
    coords=$(get_center_by_tag "$1") || { echo "ERROR: tag '$1' not found" >&2; return 1; }
    local x y
    read -r x y <<< "$coords"
    $ADB shell input tap "$x" "$y"
}

# Type text (clears field first by selecting all + delete, then types)
type_text() {
    # Escape special chars for adb shell input
    local text="$1"
    # Replace spaces with %s for adb
    text="${text// /%s}"
    $ADB shell input text "$text"
}

# Clear a text field (select all + delete)
clear_field() {
    $ADB shell input keyevent KEYCODE_MOVE_HOME
    $ADB shell input keyevent --longpress KEYCODE_SHIFT_LEFT KEYCODE_MOVE_END
    $ADB shell input keyevent KEYCODE_DEL
}

# Press back button
press_back() {
    $ADB shell input keyevent KEYCODE_BACK
}

# Press enter
press_enter() {
    $ADB shell input keyevent KEYCODE_ENTER
}

# Swipe/scroll down
scroll_down() {
    $ADB shell input swipe 540 1500 540 500 500
}

# Swipe/scroll up
scroll_up() {
    $ADB shell input swipe 540 500 540 1500 500
}

# ─── Screenshot & Verification ─────────────────────────────────────

# Take screenshot and save to file
screenshot() {
    local name="${1:-screenshot_$(date +%s)}"
    local path="$RESULTS_DIR/screenshots/${name}.png"
    $ADB exec-out screencap -p > "$path"
    echo "$path"
}

# Wait for text to appear on screen (polls every 1s, up to timeout)
wait_for_text() {
    local text="$1"
    local timeout="${2:-10}"
    local elapsed=0
    while [ $elapsed -lt "$timeout" ]; do
        local xml
        xml=$(dump_ui "/tmp/ui_wait.xml" 2>/dev/null)
        if grep -q "$text" "$xml" 2>/dev/null; then
            return 0
        fi
        sleep 1
        elapsed=$((elapsed + 1))
    done
    echo "TIMEOUT waiting for text: $text" >&2
    return 1
}

# Wait for a testTag to appear
wait_for_tag() {
    local tag="$1"
    local timeout="${2:-10}"
    local elapsed=0
    while [ $elapsed -lt "$timeout" ]; do
        if get_center_by_tag "$tag" >/dev/null 2>&1; then
            return 0
        fi
        sleep 1
        elapsed=$((elapsed + 1))
    done
    echo "TIMEOUT waiting for tag: $tag" >&2
    return 1
}

# Check if text is visible on screen
text_visible() {
    local xml
    xml=$(dump_ui "/tmp/ui_check.xml" 2>/dev/null)
    grep -q "$1" "$xml" 2>/dev/null
}

# ─── Utility ───────────────────────────────────────────────────────

# Wait for UI to settle
settle() {
    sleep "${1:-2}"
}

# Print all visible text on screen (for debugging)
dump_all_text() {
    local xml
    xml=$(dump_ui "/tmp/ui_debug.xml")
    python3 -c "
import xml.etree.ElementTree as ET
tree = ET.parse('$xml')
for node in tree.iter('node'):
    text = node.get('text', '')
    rid = node.get('resource-id', '')
    cd = node.get('content-desc', '')
    if text or rid or cd:
        bounds = node.get('bounds', '')
        print(f'text=\"{text}\" id=\"{rid}\" desc=\"{cd}\" bounds={bounds}')
"
}

echo "adb-helpers.sh loaded. ADB=$ADB RESULTS_DIR=$RESULTS_DIR"
