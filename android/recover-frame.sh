#!/usr/bin/env bash
# recover-frame.sh — clean up the system-app install if it left the frame
# in a bad state. Run this once the frame is reachable on the LAN again.
#
# What it does:
#   1. Scans the LAN for any ADB device (port 5555)
#   2. For each, checks if it's an Athan Frame
#   3. Removes /system/priv-app/AthanFrameBridge (the system install)
#   4. Removes any user-space install of com.athanframe.bridge too
#   5. Reboots the frame back to clean state
#
# After recovery the frame is back to the same state as before any of the
# Android-app work — the Masjidal app is untouched throughout.

set -euo pipefail

BLUE="\033[1;34m"; GREEN="\033[1;32m"; YELLOW="\033[1;33m"; RED="\033[1;31m"; RESET="\033[0m"
say()  { printf "${BLUE}==>${RESET} %s\n" "$*"; }
ok()   { printf "${GREEN}✓${RESET}  %s\n" "$*"; }
warn() { printf "${YELLOW}!${RESET}  %s\n" "$*"; }
die()  { printf "${RED}✗${RESET}  %s\n" "$*" >&2; exit 1; }

command -v adb >/dev/null || die "adb not found"
command -v nmap >/dev/null || die "nmap not found (brew install nmap)"

# ---- Find the frame ----
SUBNET=$(ipconfig getifaddr en0 2>/dev/null | awk -F. '{print $1"."$2"."$3".0/24"}')
[ -z "$SUBNET" ] && SUBNET=$(ipconfig getifaddr en1 2>/dev/null | awk -F. '{print $1"."$2"."$3".0/24"}')
[ -z "$SUBNET" ] && die "could not determine local subnet"

say "Scanning $SUBNET for ADB devices..."
FRAME=""
for ip in $(nmap -p 5555 --open -T4 "$SUBNET" 2>/dev/null | awk '/Nmap scan report/{print $5}'); do
  if adb connect "$ip:5555" 2>&1 | grep -q "connected"; then
    sleep 0.3
    if adb -s "$ip:5555" shell "pm list packages com.masjidal.athanframe" 2>/dev/null | grep -q masjidal; then
      FRAME="$ip"
      break
    fi
  fi
done
[ -z "$FRAME" ] && die "no Athan Frame found on $SUBNET. Wait longer (slow first boot) or check the device physically."
ok "Frame at $FRAME"

# ---- Get root + remount /system ----
say "Enabling root + remounting /system writable..."
adb -s "$FRAME:5555" root >/dev/null 2>&1 || true
sleep 1
adb connect "$FRAME:5555" >/dev/null 2>&1
adb -s "$FRAME:5555" remount >/dev/null 2>&1 || warn "remount may have failed; continuing"
ok "Root + remount done"

# ---- Remove the system APK ----
say "Removing /system/priv-app/AthanFrameBridge..."
adb -s "$FRAME:5555" shell "rm -rf /system/priv-app/AthanFrameBridge" 2>&1
ok "System APK removed"

# ---- Remove any user install too ----
say "Removing user install of com.athanframe.bridge (if any)..."
adb -s "$FRAME:5555" uninstall com.athanframe.bridge 2>&1 || true

# ---- Reboot ----
say "Rebooting the frame to apply cleanup..."
adb -s "$FRAME:5555" reboot
echo
echo "──────────────────────────────────────────────────────────"
echo "  Recovery in progress. The frame will reboot now."
echo "  Wait ~2 minutes, then verify the Masjidal UI is back."
echo "──────────────────────────────────────────────────────────"
