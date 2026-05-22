#!/usr/bin/env bash
# athanframe — one-command installer & launcher.
#
# What this does:
#   1. Installs OS dependencies (adb, python3, python3-venv) if missing
#   2. Creates a Python venv inside ./bridge/ and installs FastAPI / uvicorn / httpx
#   3. Starts the bridge on http://0.0.0.0:8080 in the foreground
#   4. The bridge auto-discovers the Athan Frame on your LAN at startup
#   5. Prints the LAN URL to open on your phone (and a QR code if `qrencode` is available)
#
# Re-run any time to start the bridge again. Safe to run repeatedly.
#
# Flags:
#   --install-only   Set up deps + venv, but do not run uvicorn at the end.
#                    Use this on a Raspberry Pi before running
#                    ./install-as-service.sh to register systemd.

set -euo pipefail

INSTALL_ONLY=0
for arg in "$@"; do
  case "$arg" in
    --install-only) INSTALL_ONLY=1 ;;
    -h|--help)
      sed -n '2,20p' "$0" | sed 's/^# //'
      exit 0 ;;
  esac
done

# Always operate from the repo root, regardless of caller's cwd.
cd "$(dirname "$0")"

BLUE="\033[1;34m"; GREEN="\033[1;32m"; YELLOW="\033[1;33m"; RED="\033[1;31m"; RESET="\033[0m"
say()  { printf "${BLUE}==>${RESET} %s\n" "$*"; }
ok()   { printf "${GREEN}✓${RESET}  %s\n" "$*"; }
warn() { printf "${YELLOW}!${RESET}  %s\n" "$*"; }
die()  { printf "${RED}✗${RESET}  %s\n" "$*" >&2; exit 1; }

# Run a privileged command — use sudo only when we're not already root.
maybe_sudo() {
  if [ "$(id -u)" -eq 0 ]; then "$@"; else sudo "$@"; fi
}

# ---------- Detect platform ----------
case "$(uname -s)" in
  Darwin) PLATFORM=mac ;;
  Linux)
    PLATFORM=linux
    if grep -qi 'raspbian\|raspberry' /etc/os-release 2>/dev/null; then
      PLATFORM=pi
    fi
    ;;
  *)      die "Unsupported OS: $(uname -s). This script supports macOS and Linux (Debian/Ubuntu/RPi OS)." ;;
esac
say "Platform: $PLATFORM"

# ---------- Homebrew check (macOS only) ----------
if [ "$PLATFORM" = "mac" ]; then
  if ! command -v brew >/dev/null 2>&1; then
    warn "Homebrew is not installed."
    echo "  Install it from https://brew.sh and re-run this script. Sample command:"
    echo '    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"'
    die "Aborting."
  fi
  ok "Homebrew detected"
fi

# ---------- adb ----------
if ! command -v adb >/dev/null 2>&1; then
  say "Installing ADB (Android Platform Tools)..."
  if [ "$PLATFORM" = "mac" ]; then
    brew install --cask android-platform-tools
  else
    # Debian/Ubuntu/RPi OS: 'adb' package, part of android-tools-adb on older releases.
    if ! maybe_sudo apt-get update; then warn "apt-get update failed; continuing"; fi
    maybe_sudo apt-get install -y adb || \
      maybe_sudo apt-get install -y android-tools-adb || \
      die "Could not install adb. Install it manually and re-run."
  fi
fi
ok "adb $(adb --version 2>&1 | head -1 | awk '{print $5}')"

# ---------- Python 3 + venv ----------
need_python=0
need_venv=0
command -v python3 >/dev/null 2>&1 || need_python=1
python3 -c 'import venv' 2>/dev/null || need_venv=1

if [ "$need_python" = "1" ] || [ "$need_venv" = "1" ]; then
  say "Installing Python 3 + venv..."
  if [ "$PLATFORM" = "mac" ]; then
    brew install python
  else
    maybe_sudo apt-get install -y python3 python3-venv python3-pip
  fi
fi
ok "python3 $(python3 --version | awk '{print $2}')"

# ---------- qrencode (nice-to-have, prints a scannable QR) ----------
if ! command -v qrencode >/dev/null 2>&1; then
  if [ "$PLATFORM" = "mac" ]; then
    brew list qrencode >/dev/null 2>&1 || say "Tip: brew install qrencode for a scannable QR code on the next run."
  else
    # Cheap install; skip silently if it fails.
    maybe_sudo apt-get install -y qrencode 2>/dev/null || true
  fi
fi

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
deactivate

# ---------- Discover LAN URL ----------
LAN_IP=$(
  ipconfig getifaddr en0 2>/dev/null \
  || ipconfig getifaddr en1 2>/dev/null \
  || hostname -I 2>/dev/null | awk '{print $1}' \
  || echo "127.0.0.1"
)
PORT="${PORT:-8080}"
URL="http://${LAN_IP}:${PORT}"

print_qr() {
  if command -v qrencode >/dev/null 2>&1; then
    echo
    qrencode -t ANSIUTF8 "$1" 2>/dev/null || true
  fi
}

# ---------- --install-only: stop here ----------
if [ "$INSTALL_ONLY" = "1" ]; then
  echo
  echo "──────────────────────────────────────────────────────────"
  echo "  Dependencies installed. Bridge NOT started (--install-only)."
  echo
  echo "  Next on a Raspberry Pi / Linux host:"
  echo "    sudo ./install-as-service.sh"
  echo
  echo "  This registers the bridge as a systemd service that runs"
  echo "  on boot and auto-restarts on crash."
  echo "──────────────────────────────────────────────────────────"
  exit 0
fi

# ---------- Run in foreground ----------
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
echo "  automatically on startup."
echo
if [ "$PLATFORM" = "pi" ] || [ "$PLATFORM" = "linux" ]; then
  echo "  Tip: to run as a background service on boot:"
  echo "    sudo ./install-as-service.sh"
  echo
fi
echo "  Press Ctrl+C to stop the bridge."
echo "──────────────────────────────────────────────────────────"
echo

exec .venv/bin/uvicorn server:app --host 0.0.0.0 --port "$PORT"
