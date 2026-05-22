#!/usr/bin/env bash
# install-on-frame.sh — build the Athan Frame on-device bridge APK,
# push it to the frame, and start the bridge service.
#
# One-time use: after this runs successfully, the frame hosts the bridge
# itself and no host machine is needed for daily use.

set -euo pipefail
cd "$(dirname "$0")"

BLUE="\033[1;34m"; GREEN="\033[1;32m"; YELLOW="\033[1;33m"; RED="\033[1;31m"; RESET="\033[0m"
say()  { printf "${BLUE}==>${RESET} %s\n" "$*"; }
ok()   { printf "${GREEN}✓${RESET}  %s\n" "$*"; }
warn() { printf "${YELLOW}!${RESET}  %s\n" "$*"; }
die()  { printf "${RED}✗${RESET}  %s\n" "$*" >&2; exit 1; }

PKG="com.athanframe.bridge"
ADB_PORT=5555
MASJIDAL_PKG="com.masjidal.athanframe"

# ---------- Prereqs ----------
command -v adb >/dev/null   || die "adb not found. Install Android platform-tools: brew install --cask android-platform-tools"
[ -x "./gradlew" ] || [ -f "./gradlew" ] || warn "gradlew wrapper not present; first build will download Gradle."

# ---------- Find the frame ----------
say "Looking for the Athan Frame on your network..."
FRAME_IP=""
if [ -n "${FRAME_IP_OVERRIDE:-}" ]; then
  FRAME_IP="$FRAME_IP_OVERRIDE"
  say "Using FRAME_IP_OVERRIDE=$FRAME_IP"
else
  # Look at currently-connected adb devices first
  EXISTING=$(adb devices | awk '/:5555\s+device$/ {print $1}' | head -1)
  if [ -n "$EXISTING" ]; then
    FRAME_IP="${EXISTING%:*}"
    say "Found already-connected device: $FRAME_IP"
  else
    # Scan local subnet via nmap if available
    if command -v nmap >/dev/null; then
      SUBNET=$(ipconfig getifaddr en0 2>/dev/null | awk -F. '{print $1"."$2"."$3".0/24"}')
      [ -z "$SUBNET" ] && SUBNET=$(ipconfig getifaddr en1 2>/dev/null | awk -F. '{print $1"."$2"."$3".0/24"}')
      [ -n "$SUBNET" ] && {
        say "Scanning $SUBNET for ADB-enabled devices..."
        for ip in $(nmap -p 5555 --open -T4 "$SUBNET" 2>/dev/null | awk '/Nmap scan report/{print $5}'); do
          if adb connect "$ip:$ADB_PORT" 2>&1 | grep -q "connected"; then
            sleep 0.3
            if adb -s "$ip:$ADB_PORT" shell "pm list packages $MASJIDAL_PKG" 2>/dev/null | grep -q "$MASJIDAL_PKG"; then
              FRAME_IP="$ip"
              break
            fi
          fi
        done
      }
    else
      warn "nmap not installed (brew install nmap). Skipping automatic scan."
    fi
  fi
fi

[ -z "$FRAME_IP" ] && die "Could not find the Athan Frame on your network. Set FRAME_IP_OVERRIDE=<ip> and re-run."
ok "Frame at $FRAME_IP"

# Make sure adb is connected
adb connect "$FRAME_IP:$ADB_PORT" >/dev/null
sleep 0.4
adb -s "$FRAME_IP:$ADB_PORT" shell "pm list packages $MASJIDAL_PKG" | grep -q "$MASJIDAL_PKG" || \
  die "Masjidal app not found on $FRAME_IP. Are you sure this is an Athan Frame?"
ok "Masjidal app detected on the frame"

# ---------- Build the APK ----------
APK="app/build/outputs/apk/debug/app-debug.apk"
if [ -f "$APK" ] && [ -z "${REBUILD:-}" ]; then
  say "Reusing existing build at $APK (set REBUILD=1 to force a rebuild)"
else
  command -v java >/dev/null || die "Java not found. Install: brew install openjdk@17"
  say "Building debug APK (first build downloads Gradle and Android dependencies; can take a few minutes)..."
  if [ -x "./gradlew" ]; then
    ./gradlew :app:assembleDebug
  elif command -v gradle >/dev/null; then
    gradle :app:assembleDebug
  else
    die "Neither ./gradlew nor system gradle is available. Run \`gradle wrapper\` once, or install gradle: brew install gradle"
  fi
fi
[ -f "$APK" ] || die "Build finished but APK not found at $APK"
ok "APK ready: $APK ($(du -h "$APK" | awk '{print $1}'))"

# ---------- Install + start ----------
say "Installing on the frame..."
adb -s "$FRAME_IP:$ADB_PORT" install -r -t "$APK"
ok "Installed"

say "Starting the bridge service..."
adb -s "$FRAME_IP:$ADB_PORT" shell am start -n "$PKG/.MainActivity" >/dev/null
sleep 1
adb -s "$FRAME_IP:$ADB_PORT" shell am start-foreground-service -n "$PKG/.BridgeService" >/dev/null || \
  adb -s "$FRAME_IP:$ADB_PORT" shell am startservice -n "$PKG/.BridgeService" >/dev/null
ok "Bridge service started"

URL="http://$FRAME_IP:8080"
echo
echo "──────────────────────────────────────────────────────────"
echo "  Athan Frame bridge is now running ON the frame itself."
echo "──────────────────────────────────────────────────────────"
echo
echo "  Open this URL on a phone connected to the same Wi-Fi:"
echo
printf "    ${GREEN}%s${RESET}\n" "$URL"
echo
echo "  iPhone:  Safari → Share → Add to Home Screen"
echo "  Android: Chrome → ⋮ menu → Install app"
echo
echo "  The frame will restart the bridge automatically on reboot."
echo "  This host machine is no longer required for daily use."
echo "──────────────────────────────────────────────────────────"
echo
