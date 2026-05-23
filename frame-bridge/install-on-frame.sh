#!/usr/bin/env bash
# install-on-frame.sh — installs the shell-only bridge directly on the
# Athan Frame and starts it. After this, no host machine is required.
#
# Usage:
#   ./install-on-frame.sh                  # auto-discover frame on LAN
#   FRAME_IP=192.168.1.42 ./install-on-frame.sh
#   ./install-on-frame.sh stop             # stop the bridge on the frame
#   ./install-on-frame.sh uninstall        # stop + remove all files
#
# Requirements on the host:
#   - adb (brew install --cask android-platform-tools)
#   - optional: nmap (for auto-discovery), qrencode (for QR code)

set -euo pipefail
cd "$(dirname "$0")"

BLUE="\033[1;34m"; GREEN="\033[1;32m"; YELLOW="\033[1;33m"; RED="\033[1;31m"; RESET="\033[0m"
say()  { printf "${BLUE}==>${RESET} %s\n" "$*"; }
ok()   { printf "${GREEN}✓${RESET}  %s\n" "$*"; }
warn() { printf "${YELLOW}!${RESET}  %s\n" "$*"; }
die()  { printf "${RED}✗${RESET}  %s\n" "$*" >&2; exit 1; }

command -v adb >/dev/null || die "adb not found. Install: brew install --cask android-platform-tools"

REMOTE_ROOT="/data/local/tmp/athan-bridge"
PORT="${PORT:-8080}"
MASJIDAL_PKG="com.masjidal.athanframe"
ACTION="${1:-install}"

# ---------- Find the frame ----------
find_frame() {
  if [ -n "${FRAME_IP:-}" ]; then
    echo "$FRAME_IP"
    return
  fi
  # Already-connected adb device wins
  local existing
  existing=$(adb devices 2>/dev/null | awk '/:5555\s+device$/ {print $1}' | head -1)
  if [ -n "$existing" ]; then
    echo "${existing%:*}"
    return
  fi
  # Scan
  if command -v nmap >/dev/null; then
    local subnet
    subnet=$(ipconfig getifaddr en0 2>/dev/null | awk -F. '{print $1"."$2"."$3".0/24"}')
    [ -z "$subnet" ] && subnet=$(ipconfig getifaddr en1 2>/dev/null | awk -F. '{print $1"."$2"."$3".0/24"}')
    [ -n "$subnet" ] && {
      for ip in $(nmap -p 5555 --open -T4 "$subnet" 2>/dev/null | awk '/Nmap scan report/{print $5}'); do
        if adb connect "$ip:5555" 2>&1 | grep -q "connected"; then
          sleep 0.3
          if adb -s "$ip:5555" shell "pm list packages $MASJIDAL_PKG" 2>/dev/null | grep -q "$MASJIDAL_PKG"; then
            echo "$ip"
            return
          fi
        fi
      done
    }
  fi
}

FRAME_IP=$(find_frame || true)
[ -z "$FRAME_IP" ] && die "Could not find the Athan Frame. Set FRAME_IP=<ip> and re-run."
adb connect "$FRAME_IP:5555" >/dev/null 2>&1
ok "Frame at $FRAME_IP"

ADB="adb -s $FRAME_IP:5555"

# Verify Masjidal is installed (sanity check)
$ADB shell "pm list packages $MASJIDAL_PKG" 2>/dev/null | grep -q "$MASJIDAL_PKG" || \
  die "Masjidal app not detected. Is this really an Athan Frame?"

stop_remote() {
  say "Stopping any running bridge..."
  # Try graceful: kill launcher by pidfile
  $ADB shell "if [ -f $REMOTE_ROOT/launcher.pid ]; then kill \$(cat $REMOTE_ROOT/launcher.pid) 2>/dev/null; rm -f $REMOTE_ROOT/launcher.pid; fi" 2>/dev/null || true
  # Best-effort: kill nc on the port
  $ADB shell "pkill -f 'nc -p $PORT' 2>/dev/null; pkill -f 'launcher.sh' 2>/dev/null" 2>/dev/null || true
  sleep 0.5
}

case "$ACTION" in
  stop)
    stop_remote
    ok "Stopped."
    exit 0
    ;;
  uninstall|remove)
    stop_remote
    say "Removing $REMOTE_ROOT..."
    $ADB shell "rm -rf $REMOTE_ROOT" 2>/dev/null
    ok "Uninstalled."
    exit 0
    ;;
  install|"") ;;
  *)
    die "Unknown action: $ACTION. Use: install | stop | uninstall"
    ;;
esac

# ---------- Push files ----------
say "Pushing files to $REMOTE_ROOT..."
$ADB shell "mkdir -p $REMOTE_ROOT $REMOTE_ROOT/webapp $REMOTE_ROOT/assets" >/dev/null
$ADB push athan-bridge.sh     "$REMOTE_ROOT/" >/dev/null
$ADB push launcher.sh         "$REMOTE_ROOT/" >/dev/null
$ADB push webapp/.            "$REMOTE_ROOT/webapp/" >/dev/null
$ADB push assets/.            "$REMOTE_ROOT/assets/" >/dev/null
$ADB shell "chmod +x $REMOTE_ROOT/athan-bridge.sh $REMOTE_ROOT/launcher.sh" >/dev/null
ok "Files in place"

# ---------- (Re)start ----------
stop_remote
say "Starting bridge..."
$ADB shell "nohup $REMOTE_ROOT/launcher.sh >/dev/null 2>&1 &" >/dev/null
sleep 1.5
PIDS=$($ADB shell "pgrep -f 'nc -p $PORT' 2>/dev/null" | tr -d '\r')
if [ -z "$PIDS" ]; then
  warn "Bridge process not detected. Check $REMOTE_ROOT/launcher.log on device."
else
  ok "Bridge running on port $PORT (pid: $PIDS)"
fi

# Quick sanity: hit /api/config
sleep 1
if curl -fsS -m 4 "http://$FRAME_IP:$PORT/api/config" >/dev/null 2>&1; then
  ok "HTTP responding at http://$FRAME_IP:$PORT/api/config"
else
  warn "HTTP not responding yet. Wait a few seconds and try: curl http://$FRAME_IP:$PORT/api/config"
fi

URL="http://$FRAME_IP:$PORT"
echo
echo "──────────────────────────────────────────────────────────"
echo "  Athan Frame bridge is now running ON the frame itself."
echo "──────────────────────────────────────────────────────────"
echo
echo "  Open this URL on a phone connected to the same Wi-Fi:"
echo
printf "    ${GREEN}%s${RESET}\n" "$URL"
if command -v qrencode >/dev/null; then
  echo
  qrencode -t ANSIUTF8 "$URL" 2>/dev/null || true
fi
echo
echo "  iPhone:  Safari → Share → Add to Home Screen"
echo "  Android: Chrome → ⋮ menu → Install app"
echo
echo "  No host machine is required after this point. The bridge"
echo "  runs as root on the frame and survives until the next reboot."
echo
echo "  After a frame reboot, re-run:    ./install-on-frame.sh"
echo "  To stop without uninstalling:    ./install-on-frame.sh stop"
echo "  To remove completely:            ./install-on-frame.sh uninstall"
echo "──────────────────────────────────────────────────────────"
