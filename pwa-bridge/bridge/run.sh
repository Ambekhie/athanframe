#!/usr/bin/env bash
# Convenience launcher for the athanframe bridge.
# Creates/uses a local venv, installs deps, runs uvicorn on 0.0.0.0:8080.

set -euo pipefail
cd "$(dirname "$0")"

PORT="${PORT:-8080}"
VENV="${VENV:-.venv}"

if [ ! -d "$VENV" ]; then
  echo "Creating venv at $VENV..."
  python3 -m venv "$VENV"
fi

# shellcheck disable=SC1091
source "$VENV/bin/activate"
pip install --quiet --upgrade pip
pip install --quiet -r requirements.txt

# Show LAN URL for convenience
IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "127.0.0.1")
echo ""
echo "==============================================="
echo "  athanframe bridge"
echo "  LAN URL: http://${IP}:${PORT}"
echo "  Frame:   ${FRAME_IP:-auto-discover}:5555"
echo "==============================================="
echo ""

exec uvicorn server:app --host 0.0.0.0 --port "$PORT"
