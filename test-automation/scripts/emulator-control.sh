#!/usr/bin/env bash
# emulator-control.sh — Emulator lifecycle management
# Source this file: source test-automation/scripts/emulator-control.sh

set -euo pipefail

export ANDROID_HOME="${ANDROID_HOME:-/opt/homebrew/share/android-commandlinetools}"
export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home}"
export ADB="$ANDROID_HOME/platform-tools/adb"
export EMULATOR="$ANDROID_HOME/emulator/emulator"
export AVD_NAME="${AVD_NAME:-CareLog_Test}"
export APP_PACKAGE="com.carelog"
export MAIN_ACTIVITY="$APP_PACKAGE/.ui.MainActivity"

# Kill running emulator
kill_emulator() {
    $ADB emu kill 2>/dev/null || true
    sleep 3
    # Force kill any remaining emulator processes
    pkill -f "qemu-system" 2>/dev/null || true
    sleep 2
    echo "Emulator killed"
}

# Cold-boot emulator (no snapshot)
start_emulator() {
    echo "Starting emulator (cold boot)..."
    kill_emulator 2>/dev/null || true
    nohup "$EMULATOR" -avd "$AVD_NAME" -no-snapshot-load -gpu auto -no-audio > /tmp/emulator.log 2>&1 &
    echo "Waiting for boot..."
    $ADB wait-for-device
    while [ "$($ADB shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" != "1" ]; do
        sleep 3
    done
    # Extra settle time for system UI
    sleep 5
    echo "Emulator booted: $($ADB devices | grep emulator)"
}

# Clear app data (reset to fresh install state)
reset_app() {
    $ADB shell pm clear "$APP_PACKAGE" 2>/dev/null || true
    echo "App data cleared"
}

# Force stop the app
kill_app() {
    $ADB shell am force-stop "$APP_PACKAGE"
    echo "App stopped"
}

# Launch the app
launch_app() {
    $ADB shell am start -n "$MAIN_ACTIVITY" 2>/dev/null
    sleep 3
    echo "App launched"
}

# Full reset: clear data + relaunch
fresh_start() {
    reset_app
    sleep 1
    launch_app
}

# Toggle airplane mode
airplane_on() {
    $ADB shell cmd connectivity airplane-mode enable
    echo "Airplane mode ON"
}

airplane_off() {
    $ADB shell cmd connectivity airplane-mode disable
    echo "Airplane mode OFF"
}

# Install APK
install_apk() {
    local apk="${1:-$(find "$(cd "$(dirname "${BASH_SOURCE[0]}")/../../android/app/build/outputs/apk/debug" && pwd)" -name '*.apk' | head -1)}"
    echo "Installing: $apk"
    $ADB install -r "$apk"
    echo "APK installed"
}

# Build + install
build_and_install() {
    local project_root
    project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
    echo "Building debug APK..."
    (cd "$project_root/android" && ./gradlew assembleDebug)
    install_apk
}

echo "emulator-control.sh loaded. AVD=$AVD_NAME"
