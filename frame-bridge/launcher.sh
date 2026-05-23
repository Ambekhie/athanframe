#!/system/bin/sh
# athan-bridge launcher — keeps `nc -L` running on port 8080, respawning
# if it crashes. Each incoming connection invokes athan-bridge.sh once.

BRIDGE_ROOT="${BRIDGE_ROOT:-/data/local/tmp/athan-bridge}"
HANDLER="$BRIDGE_ROOT/athan-bridge.sh"
PORT="${PORT:-8080}"
PID_FILE="$BRIDGE_ROOT/launcher.pid"
LOG="$BRIDGE_ROOT/launcher.log"

# Make sure we're the only launcher running.
if [ -f "$PID_FILE" ]; then
  OLD=$(cat "$PID_FILE" 2>/dev/null)
  if [ -n "$OLD" ] && kill -0 "$OLD" 2>/dev/null; then
    echo "launcher already running pid=$OLD" >&2
    exit 0
  fi
fi
echo $$ > "$PID_FILE"

cleanup() {
  rm -f "$PID_FILE"
  pkill -f "nc -p $PORT" 2>/dev/null
}
trap cleanup EXIT INT TERM

# Loop forever: nc -L exits on its own when the connection list is exhausted;
# we just restart it. In practice toybox nc -L stays alive across many
# connections, so this loop is mostly defensive.
while true; do
  echo "$(date '+%H:%M:%S') starting nc on $PORT" >> "$LOG" 2>/dev/null
  nc -p "$PORT" -L "$HANDLER"
  echo "$(date '+%H:%M:%S') nc exited; restarting in 1s" >> "$LOG" 2>/dev/null
  sleep 1
done
