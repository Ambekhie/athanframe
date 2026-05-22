#!/usr/bin/env bash
# install-as-service.sh — register the bridge as a systemd service so it
# runs on boot and auto-restarts on crash. Intended for Linux hosts
# (Raspberry Pi, Debian, Ubuntu, etc.).
#
# Run AFTER ./install.sh has succeeded (the venv must exist).
#
# Usage:
#   sudo ./install-as-service.sh           # installs + enables + starts
#   sudo ./install-as-service.sh remove    # removes the service
#
# After install:
#   systemctl status athanframe
#   journalctl -u athanframe -f
#   sudo systemctl restart athanframe

set -euo pipefail

BLUE="\033[1;34m"; GREEN="\033[1;32m"; YELLOW="\033[1;33m"; RED="\033[1;31m"; RESET="\033[0m"
say()  { printf "${BLUE}==>${RESET} %s\n" "$*"; }
ok()   { printf "${GREEN}✓${RESET}  %s\n" "$*"; }
warn() { printf "${YELLOW}!${RESET}  %s\n" "$*"; }
die()  { printf "${RED}✗${RESET}  %s\n" "$*" >&2; exit 1; }

# Resolve absolute install dir (the pwa-bridge folder containing this script).
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
INSTALL_DIR="$SCRIPT_DIR"

UNIT_NAME="athanframe.service"
UNIT_SRC="$INSTALL_DIR/bridge/systemd/athanframe.service"
UNIT_DST="/etc/systemd/system/$UNIT_NAME"

# ---- Sanity checks ----------------------------------------------------------

if [ "$(uname -s)" != "Linux" ]; then
  die "systemd installer is for Linux only. On macOS, run ./install.sh in a tmux session or use launchd manually."
fi

if [ "$(id -u)" -ne 0 ]; then
  die "must be run as root (use: sudo $0)"
fi

if ! command -v systemctl >/dev/null 2>&1; then
  die "systemctl not found — not a systemd system?"
fi

[ -f "$UNIT_SRC" ] || die "service template not found at $UNIT_SRC"

# ---- Remove path ------------------------------------------------------------

if [ "${1:-}" = "remove" ] || [ "${1:-}" = "uninstall" ]; then
  say "Stopping and removing $UNIT_NAME..."
  systemctl stop "$UNIT_NAME" 2>/dev/null || true
  systemctl disable "$UNIT_NAME" 2>/dev/null || true
  rm -f "$UNIT_DST"
  systemctl daemon-reload
  ok "Removed."
  exit 0
fi

# ---- Install path -----------------------------------------------------------

# Resolve the user the service should run as. Prefer the invoking user (when
# called via sudo) so the venv they created is what we exec.
TARGET_USER="${SUDO_USER:-$USER}"
if [ "$TARGET_USER" = "root" ]; then
  warn "running as real root (no SUDO_USER). Service will run as root."
  warn "If you intended to run the bridge as a normal user, re-run as: sudo ./install-as-service.sh"
fi

# Verify the venv exists where we expect it.
VENV_PY="$INSTALL_DIR/bridge/.venv/bin/uvicorn"
if [ ! -x "$VENV_PY" ]; then
  die "venv not ready at $VENV_PY — run ./install.sh first to create it"
fi

# Verify the venv is owned by TARGET_USER (or systemd User= can't read it).
VENV_OWNER=$(stat -c '%U' "$INSTALL_DIR/bridge/.venv" 2>/dev/null || stat -f '%Su' "$INSTALL_DIR/bridge/.venv")
if [ "$VENV_OWNER" != "$TARGET_USER" ] && [ "$TARGET_USER" != "root" ]; then
  warn "venv is owned by $VENV_OWNER but service will run as $TARGET_USER"
  warn "consider: sudo chown -R $TARGET_USER:$TARGET_USER $INSTALL_DIR/bridge/.venv"
fi

say "Installing $UNIT_NAME for user '$TARGET_USER'"
say "  Install dir: $INSTALL_DIR"
say "  Unit path:   $UNIT_DST"

# Substitute placeholders in the template
sed -e "s|{{INSTALL_DIR}}|$INSTALL_DIR|g" \
    -e "s|{{USER}}|$TARGET_USER|g" \
    "$UNIT_SRC" > "$UNIT_DST"
chmod 644 "$UNIT_DST"
ok "Wrote $UNIT_DST"

systemctl daemon-reload
ok "systemctl daemon reloaded"

systemctl enable "$UNIT_NAME" >/dev/null
ok "Enabled (will start on boot)"

systemctl restart "$UNIT_NAME"
sleep 1.5

if systemctl is-active --quiet "$UNIT_NAME"; then
  ok "Started"
else
  warn "Service failed to start. Recent log:"
  journalctl -u "$UNIT_NAME" -n 20 --no-pager
  exit 1
fi

# Print LAN URL for convenience
LAN_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
[ -z "$LAN_IP" ] && LAN_IP="<this-host>"

echo
echo "──────────────────────────────────────────────────────────"
echo "  Athan Frame bridge is running as a systemd service."
echo "──────────────────────────────────────────────────────────"
echo
printf "    LAN URL: ${GREEN}http://%s:8080${RESET}\n" "$LAN_IP"
echo
echo "  Useful commands:"
echo "    systemctl status athanframe"
echo "    journalctl -u athanframe -f"
echo "    sudo systemctl restart athanframe"
echo "    sudo ./install-as-service.sh remove"
echo
echo "  On your phone (same Wi-Fi):"
echo "    Open the LAN URL in Safari → Share → Add to Home Screen"
echo "──────────────────────────────────────────────────────────"
