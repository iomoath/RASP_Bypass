#!/usr/bin/env bash
# run.sh — Launch RASP Bypass Toolkit with all modules via Frida -l flags
# RASP Bypass Toolkit — https://github.com/iomoath/RASP_Bypass
#
# Usage:
#   bash run.sh <package>                        # spawn mode
#   bash run.sh <package> attach                 # attach mode
#   bash run.sh <package> spawn <profile>        # spawn with profile (banking|meta|flutter)
#
# Examples:
#   bash run.sh com.target.app
#   bash run.sh com.bank.app spawn banking
#   bash run.sh com.instagram.android spawn meta
#   bash run.sh com.flutter.app spawn flutter

set -euo pipefail

PACKAGE="${1:-}"
MODE="${2:-spawn}"
PROFILE="${3:-}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ -z "$PACKAGE" ]; then
    echo "Usage: bash run.sh <package> [spawn|attach] [banking|meta|flutter]"
    echo ""
    echo "Examples:"
    echo "  bash run.sh com.target.app"
    echo "  bash run.sh com.bank.app spawn banking"
    echo "  bash run.sh com.instagram.android spawn meta"
    echo "  bash run.sh com.flutter.app spawn flutter"
    exit 1
fi

# Build the list of -l flags
L_FLAGS=(
    -l "$SCRIPT_DIR/config.js"
    -l "$SCRIPT_DIR/lib/utils.js"
    -l "$SCRIPT_DIR/lib/stealth-frida-hiding.js"
    -l "$SCRIPT_DIR/lib/stealth-hook-detection.js"
    -l "$SCRIPT_DIR/lib/root-detection-bypass.js"
    -l "$SCRIPT_DIR/lib/frida-detection-bypass.js"
    -l "$SCRIPT_DIR/lib/debugger-detection-bypass.js"
    -l "$SCRIPT_DIR/lib/emulator-detection-bypass.js"
    -l "$SCRIPT_DIR/lib/vpn-detection-bypass.js"
    -l "$SCRIPT_DIR/lib/developer-mode-bypass.js"
    -l "$SCRIPT_DIR/lib/accessibility-bypass.js"
    -l "$SCRIPT_DIR/lib/screen-capture-bypass.js"
    -l "$SCRIPT_DIR/lib/app-cloning-bypass.js"
    -l "$SCRIPT_DIR/lib/android-ssl-pinning-bypass.js"
    -l "$SCRIPT_DIR/lib/android-ssl-pinning-bypass-fallback.js"
    -l "$SCRIPT_DIR/lib/android-system-certificate-injection.js"
    -l "$SCRIPT_DIR/lib/native-tls-hook.js"
    -l "$SCRIPT_DIR/lib/disable-flutter-tls.js"
    -l "$SCRIPT_DIR/lib/meta-ssl-pinning-bypass.js"
    -l "$SCRIPT_DIR/lib/android-proxy-override.js"
    -l "$SCRIPT_DIR/lib/native-connect-hook.js"
    -l "$SCRIPT_DIR/lib/integrity-bypass.js"
    -l "$SCRIPT_DIR/lib/attestation-bypass.js"
    -l "$SCRIPT_DIR/lib/http3-disable.js"
    -l "$SCRIPT_DIR/lib/syscall-bypass.js"
    -l "$SCRIPT_DIR/lib/anti-frida-bypass.js"
)

# Optionally append profile
if [ -n "$PROFILE" ]; then
    PROFILE_FILE="$SCRIPT_DIR/profiles/${PROFILE}.js"
    if [ ! -f "$PROFILE_FILE" ]; then
        echo "Error: profile '$PROFILE' not found at $PROFILE_FILE"
        exit 1
    fi
    L_FLAGS+=(-l "$PROFILE_FILE")
fi

if [ "$MODE" = "attach" ]; then
    CMD=(frida -U -n "$PACKAGE" "${L_FLAGS[@]}")
else
    CMD=(frida -U -f "$PACKAGE" "${L_FLAGS[@]}")
fi

echo "[*] Running: ${CMD[*]}"
exec "${CMD[@]}"
