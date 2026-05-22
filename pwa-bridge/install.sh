#!/usr/bin/env bash
# athanframe — one-command installer & launcher.
#
# What this does:
#   1. Verifies Homebrew, installs adb (android-platform-tools) and Python 3 if missing
#   2. Creates a Python venv inside ./bridge/ and installs FastAPI / uvicorn / httpx
#   3. Starts the bridge on http://0.0.0.0:8080
#   4. The bridge auto-discovers the Athan Frame on your LAN at startup
#   5. Prints the LAN URL to open on your phone (and a QR code if `qrencode` is available)
#
# Re-run any time to start the bridge again. Safe to run repeatedly.

set -euo pipefail

# Always operate from the repo root, regardless of caller's cwd.
cd "$(dirname "$0")"
HERE="$PWD"

BLUE="\033[1;34m"; GREEN="\033[1;32m"; YELLOW="\033[1;33m"; RED="\033[1;31m"; RESET="\033[0m"
say()  { printf "${BLUE}==>${RESET} %s\n" "$*"; }
ok()   { printf "${GREEN}✓${RESET}  %s\n" "$*"; }
warn() { printf "${YELLOW}!${RESET}  %s\n" "$*"; }
die()  { printf "${RED}✗${RESET}  %s\n" "$*" >&2; exit 1; }

# ---------- Prereq: macOS or Linux ----------
case "$(uname -s)" in
  Darwin) PLATFORM=mac ;;
  Linux)  PLATFORM=linux ;;
  *)      die "Unsupported OS: $(uname -s). This script supports macOS and Linux." ;;
esac
say "Platform: $PLATFORM"

# ---------- Prereq: Homebrew (macOS) ----------
if [ "$PLATFORM" = "mac" ]; then
  if ! command -v brew >/dev/null 2>&1; then
    warn "Homebrew is not installed."
    echo "  Install it from https://brew.sh and re-run this script. Sample command:"
    echo '    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"'
    die "Aborting."
  fi
  ok "Homebrew detected"
fi

# ---------- Prereq: adb ----------
if ! command -v adb >/dev/null 2>&1; then
  say "Installing ADB (Android Platform Tools)..."
  if [ "$PLATFORM" = "mac" ]; then
    brew install --cask android-platform-tools
  else
    sudo apt-get update && sudo apt-get install -y adb || die "Install adb manually."
  fi
fi
ok "adb $(adb --version 2>&1 | head -1 | awk '{print $5}')"

# ---------- Prereq: Python 3 ----------
if ! command -v python3 >/dev/null 2>&1; then
  say "Installing Python 3..."
  if [ "$PLATFORM" = "mac" ]; then
    brew install python
  else
    sudo apt-get install -y python3 python3-venv python3-pip
  fi
fi
ok "python3 $(python3 --version | awk '{print $2}')"

# ---------- venv + Python deps ----------
cd bridge
if [ ! -d .venv ]; then
  say "Creating Python virtualenv..."
  python3 -m venv .venv
fi

# shellcheck disable=SC1091
source .venv/bin/activate
say "Installing Python deps (fastapi, uvicorn, httpx)..."
pip install --quiet --upgrade pip
pip install --quiet -r requirements.txt
ok "Dependencies ready"

# ---------- Discover LAN URL ----------
LAN_IP=$(
  ipconfig getifaddr en0 2>/dev/null \
  || ipconfig getifaddr en1 2>/dev/null \
  || hostname -I 2>/dev/null | awk '{print $1}' \
  || echo "127.0.0.1"
)
PORT="${PORT:-8080}"
URL="http://${LAN_IP}:${PORT}"

# ---------- QR code (optional, if qrencode is installed) ----------
print_qr() {
  if command -v qrencode >/dev/null 2>&1; then
    echo
    qrencode -t ANSIUTF8 "$1" 2>/dev/null || true
  fi
}

echo
echo "──────────────────────────────────────────────────────────"
echo "  athanframe bridge is starting"
echo "──────────────────────────────────────────────────────────"
echo
echo "  Open this URL on a phone connected to the same Wi-Fi:"
echo
printf "    ${GREEN}%s${RESET}\n" "$URL"
print_qr "$URL"
echo
echo "  On iPhone: Safari → Share → Add to Home Screen"
echo "  On Android: Chrome → ⋮ menu → Install app"
echo
echo "  The bridge will scan your network for the Athan Frame"
echo "  automatically. The PWA will guide your friend through"
echo "  setup if it isn't found right away."
echo
echo "  Press Ctrl+C to stop the bridge."
echo "──────────────────────────────────────────────────────────"
echo

exec uvicorn server:app --host 0.0.0.0 --port "$PORT"
