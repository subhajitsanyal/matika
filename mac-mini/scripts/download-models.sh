#!/usr/bin/env bash
#
# CareLog Mac Mini M4 — Model Download Script
#
# Downloads AI models from Hugging Face and sets up symlinks expected
# by the CareLog AI services.
#
# Usage:
#   ./download-models.sh                          # default: /opt/carelog/models
#   CARELOG_MODEL_BASE=~/models ./download-models.sh  # custom path (dev/testing)
#
# This script does NOT require sudo. For dev/testing, point CARELOG_MODEL_BASE
# to a user-writable directory. The production provision.sh handles ownership
# and permissions separately.
#
# Models downloaded (~15 GB total):
#   STT    — Systran/faster-whisper-large-v3   (model.bin, ~3 GB)
#   LLM    — Qwen2.5-7B-Instruct Q4_K_M GGUF  (~4.7 GB)
#   Vision — Qwen2-VL-7B-Instruct Q4_K_M GGUF (~4.7 GB)
#   TTS EN — Piper en_US-amy-medium            (~60 MB)
#   TTS HI — Piper hi_IN voice (see notes)     (~60 MB)
#   TTS BN — Bengali: not yet available in Piper (skipped)
#

set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
MODELS_DIR="${CARELOG_MODEL_BASE:-/opt/carelog/models}"

# Minimum free disk space required (in KB). ~15 GB = 15728640 KB.
# We add some headroom for temp files during download.
MIN_DISK_KB=16777216  # 16 GB

# Model URLs
declare -A MODEL_URLS=(
    [whisper-large-v3.bin]="https://huggingface.co/Systran/faster-whisper-large-v3/resolve/main/model.bin"
    [qwen-2.5-7b-q4.gguf]="https://huggingface.co/Qwen/Qwen2.5-7B-Instruct-GGUF/resolve/main/qwen2.5-7b-instruct-q4_k_m.gguf"
    [qwen-vl-7b-q4.gguf]="https://huggingface.co/Qwen/Qwen2-VL-7B-Instruct-GGUF/resolve/main/qwen2-vl-7b-instruct-q4_k_m.gguf"
    [piper-en.onnx]="https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/amy/medium/en_US-amy-medium.onnx"
    [piper-hi.onnx]="https://huggingface.co/rhasspy/piper-voices/resolve/main/hi/hi_IN/madhur/medium/hi_IN-madhur-medium.onnx"
)

# Human-readable names for logging
declare -A MODEL_NAMES=(
    [whisper-large-v3.bin]="STT — faster-whisper-large-v3 (Systran ct2 format)"
    [qwen-2.5-7b-q4.gguf]="LLM — Qwen2.5-7B-Instruct Q4_K_M"
    [qwen-vl-7b-q4.gguf]="Vision — Qwen2-VL-7B-Instruct Q4_K_M"
    [piper-en.onnx]="TTS English — Piper en_US-amy-medium"
    [piper-hi.onnx]="TTS Hindi — Piper hi_IN-madhur-medium"
)

# Symlink mappings: symlink_name -> target_file
declare -A SYMLINKS=(
    [current-stt]="whisper-large-v3.bin"
    [current-llm]="qwen-2.5-7b-q4.gguf"
    [current-vision]="qwen-vl-7b-q4.gguf"
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
log()  { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }
warn() { log "WARNING: $*"; }
err()  { log "ERROR: $*" >&2; }
die()  { err "$*"; exit 1; }

# ---------------------------------------------------------------------------
# Preflight checks
# ---------------------------------------------------------------------------
preflight() {
    # Check curl is available
    if ! command -v curl &>/dev/null; then
        die "curl is required but not found. Install it first."
    fi

    # Create models directory if it doesn't exist
    if [[ ! -d "${MODELS_DIR}" ]]; then
        log "Creating models directory: ${MODELS_DIR}"
        mkdir -p "${MODELS_DIR}" || die "Cannot create ${MODELS_DIR}. Check permissions or set CARELOG_MODEL_BASE."
    fi

    # Check we can write to it
    if [[ ! -w "${MODELS_DIR}" ]]; then
        die "Cannot write to ${MODELS_DIR}. Run with appropriate permissions or set CARELOG_MODEL_BASE to a writable path."
    fi

    # Check available disk space
    local available_kb
    available_kb=$(df -k "${MODELS_DIR}" | tail -1 | awk '{print $4}')
    if [[ "${available_kb}" -lt "${MIN_DISK_KB}" ]]; then
        local available_gb=$(( available_kb / 1048576 ))
        local required_gb=$(( MIN_DISK_KB / 1048576 ))
        die "Insufficient disk space. Available: ~${available_gb} GB, Required: ~${required_gb} GB."
    fi

    local available_gb=$(( available_kb / 1048576 ))
    log "Disk space check passed (~${available_gb} GB available)."
}

# ---------------------------------------------------------------------------
# Download a single model
# ---------------------------------------------------------------------------
download_model() {
    local filename="$1"
    local url="${MODEL_URLS[$filename]}"
    local name="${MODEL_NAMES[$filename]}"
    local dest="${MODELS_DIR}/${filename}"

    if [[ -f "${dest}" ]]; then
        log "  [SKIP] ${name} — already exists at ${dest}"
        return 0
    fi

    log "  [DOWNLOAD] ${name}"
    log "    URL:  ${url}"
    log "    Dest: ${dest}"

    # Download with:
    #   -L  follow redirects (Hugging Face uses them)
    #   -C - resume interrupted downloads
    #   -#  progress bar
    #   -o  output file (use .tmp suffix, rename on success)
    if curl -L -C - -# -o "${dest}.tmp" "${url}"; then
        mv "${dest}.tmp" "${dest}"
        log "  [OK] ${name} downloaded successfully."
    else
        local exit_code=$?
        # curl exit 33 = range error (server doesn't support resume). Retry without -C.
        if [[ ${exit_code} -eq 33 ]]; then
            warn "  Server does not support resume. Restarting download..."
            rm -f "${dest}.tmp"
            curl -L -# -o "${dest}.tmp" "${url}" || die "Failed to download ${name}."
            mv "${dest}.tmp" "${dest}"
            log "  [OK] ${name} downloaded successfully."
        else
            rm -f "${dest}.tmp"
            die "Failed to download ${name} (curl exit code ${exit_code})."
        fi
    fi

    # SHA256 checksum note: Hugging Face does not provide standalone checksum
    # files for individual model blobs. The integrity is verified via HTTPS
    # transport security. If you need offline verification, compute and record
    # checksums after the first successful download:
    #   shasum -a 256 "${dest}" >> "${MODELS_DIR}/checksums.sha256"
    # Then verify on subsequent runs:
    #   shasum -a 256 -c "${MODELS_DIR}/checksums.sha256"
}

# ---------------------------------------------------------------------------
# Verify checksums (if a checksums file exists)
# ---------------------------------------------------------------------------
verify_checksums() {
    local checksum_file="${MODELS_DIR}/checksums.sha256"
    if [[ -f "${checksum_file}" ]]; then
        log "Verifying checksums from ${checksum_file}..."
        if shasum -a 256 -c "${checksum_file}" 2>/dev/null; then
            log "  All checksums verified."
        else
            warn "  Checksum verification failed for one or more models."
            warn "  You may want to re-download affected models (delete them and re-run)."
        fi
    else
        log "No checksums.sha256 file found — skipping verification."
        log "To enable verification, run after first download:"
        log "  cd ${MODELS_DIR} && shasum -a 256 *.bin *.gguf *.onnx > checksums.sha256"
    fi
}

# ---------------------------------------------------------------------------
# Create symlinks
# ---------------------------------------------------------------------------
create_symlinks() {
    log "Creating model symlinks..."

    for link_name in "${!SYMLINKS[@]}"; do
        local target="${SYMLINKS[$link_name]}"
        local link_path="${MODELS_DIR}/${link_name}"

        if [[ ! -f "${MODELS_DIR}/${target}" ]]; then
            warn "  Skipping ${link_name} — target '${target}' not found."
            continue
        fi

        if [[ -L "${link_path}" ]] && [[ "$(readlink "${link_path}")" == "${target}" ]]; then
            log "  ${link_name} -> ${target} (already set)"
        else
            ln -sfn "${target}" "${link_path}"
            log "  ${link_name} -> ${target}"
        fi
    done

    # TTS models don't need symlinks — services reference them directly
    # as piper-en.onnx, piper-hi.onnx at the models directory root.
}

# ---------------------------------------------------------------------------
# Bengali TTS note
# ---------------------------------------------------------------------------
print_bengali_note() {
    log ""
    log "NOTE: Bengali (BN) TTS voice"
    log "  Piper does not currently have a Bengali voice model."
    log "  The piper-bn.onnx file is NOT downloaded."
    log "  The TTS service will return 503 for Bengali requests until"
    log "  a model becomes available. Options:"
    log "    1. Train a custom Piper voice for Bengali"
    log "    2. Use a different TTS engine for Bengali"
    log "    3. Wait for community contributions to Piper"
    log "  When available, place the ONNX file at: ${MODELS_DIR}/piper-bn.onnx"
}

# ---------------------------------------------------------------------------
# Hindi TTS note
# ---------------------------------------------------------------------------
print_hindi_note() {
    log ""
    log "NOTE: Hindi (HI) TTS voice"
    log "  The URL points to rhasspy/piper-voices hi_IN-madhur-medium."
    log "  If this model is not available on Hugging Face (404), the download"
    log "  will fail gracefully. Check https://github.com/rhasspy/piper for"
    log "  the latest available Hindi voices and update the URL accordingly."
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
main() {
    log "============================================="
    log "CareLog Model Download"
    log "============================================="
    log "Target directory: ${MODELS_DIR}"
    log "Architecture:     $(uname -m)"
    log ""

    preflight

    log ""
    log "--- Downloading models ---"

    # Download order: largest first so failures happen early
    download_model "qwen-2.5-7b-q4.gguf"
    download_model "qwen-vl-7b-q4.gguf"
    download_model "whisper-large-v3.bin"
    download_model "piper-en.onnx"
    download_model "piper-hi.onnx"

    log ""
    log "--- Verifying checksums ---"
    verify_checksums

    log ""
    log "--- Creating symlinks ---"
    create_symlinks

    print_bengali_note
    print_hindi_note

    log ""
    log "============================================="
    log "Model download complete!"
    log "============================================="
    log ""
    log "Models directory contents:"
    ls -lh "${MODELS_DIR}/" 2>/dev/null || true
    log ""
    log "To generate checksums for future verification:"
    log "  cd ${MODELS_DIR} && shasum -a 256 *.bin *.gguf *.onnx > checksums.sha256"
}

main "$@"
