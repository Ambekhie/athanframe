#!/system/bin/sh
# athan-bridge — shell-only HTTP server that drives the Masjidal Athan Frame
# from on-device. Designed to be spawned per-request by `nc -L`.
#
# Privileges: runs as root because adbd on the frame is rooted and the parent
# `nc` inherits that uid. This grants us INJECT_EVENTS, broadcast-to-non-
# exported-receivers, and full filesystem access — everything the Android
# app sandbox denies a regular third-party app.
#
# Endpoints (HTTP/1.1):
#   GET  /                 -> webapp/index.html
#   GET  /static/<file>    -> webapp/<file>
#   GET  /icon-<N>.png     -> webapp/icon-<N>.png
#   GET  /manifest.json    -> webapp/manifest.json
#   GET  /api/config       -> {frame_ip, has_frame, on_device:true}
#   POST /api/discover     -> no-op (we ARE the device)
#   GET  /api/reciters     -> assets/reciters.json
#   GET  /api/surahs       -> assets/surahs.json
#   GET  /api/status       -> {connected, focus}
#   POST /api/play         -> {reciter, surah}
#   POST /api/pause        -> tap play/pause
#   POST /api/next, /prev  -> tap
#   POST /api/stop         -> pause + close
#   POST /api/volume       -> {direction, steps}
#   POST /api/home         -> tap close

BRIDGE_ROOT="${BRIDGE_ROOT:-/data/local/tmp/athan-bridge}"
WEBAPP="$BRIDGE_ROOT/webapp"
ASSETS="$BRIDGE_ROOT/assets"
LOG="$BRIDGE_ROOT/bridge.log"

MASJIDAL_PKG="com.masjidal.athanframe"
RECEIVER="$MASJIDAL_PKG/$MASJIDAL_PKG.schedular.ScheduleReceiver"
ALARM_TYPE_QURAN=1

# UI coordinates (1280x800). Matches pwa-bridge/server.py.
COORD_PLAY_PAUSE="640 584"
COORD_PREV="456 584"
COORD_NEXT="824 584"
COORD_CLOSE="1224 33"
COORD_VOL_UP="1205 260"
COORD_VOL_DOWN="1205 520"

log() {
  # Best-effort log to disk; ignore errors so we never break the response.
  echo "$(date '+%H:%M:%S') $*" >> "$LOG" 2>/dev/null
}

# -----------------------------------------------------------------------------
# Read the HTTP request from stdin. Sets:
#   METHOD, PATH_, BODY
# -----------------------------------------------------------------------------
read_request() {
  local line content_length=0

  # Request line: METHOD PATH HTTP/1.1
  read -r line
  line="${line%$'\r'}"
  METHOD="${line%% *}"
  PATH_="${line#"$METHOD "}"
  PATH_="${PATH_%% *}"

  # Headers
  while read -r line; do
    line="${line%$'\r'}"
    [ -z "$line" ] && break
    case "$line" in
      [Cc]ontent-[Ll]ength:*)
        content_length="${line#*:}"
        content_length="${content_length# }"
        ;;
    esac
  done

  # Body (if any). Use dd for exact-byte read.
  BODY=""
  if [ "$content_length" -gt 0 ] 2>/dev/null; then
    BODY=$(dd bs=1 count="$content_length" 2>/dev/null)
  fi
}

# -----------------------------------------------------------------------------
# HTTP response helpers
# -----------------------------------------------------------------------------
respond_headers() {
  # $1 = status line e.g. "200 OK"
  # $2 = content type
  # $3 = content length (or '-' for chunked omitted)
  printf 'HTTP/1.1 %s\r\n' "$1"
  printf 'Content-Type: %s\r\n' "$2"
  if [ "$3" != "-" ]; then
    printf 'Content-Length: %s\r\n' "$3"
  fi
  printf 'Access-Control-Allow-Origin: *\r\n'
  printf 'Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n'
  printf 'Access-Control-Allow-Headers: Content-Type\r\n'
  printf 'Connection: close\r\n'
  printf 'Cache-Control: no-store\r\n'
  printf '\r\n'
}

respond_json() {
  # $1 = status (e.g. "200 OK"), $2 = JSON string
  local body="$2"
  local len
  len=$(printf '%s' "$body" | wc -c)
  respond_headers "$1" "application/json" "$len"
  printf '%s' "$body"
}

respond_file() {
  # $1 = path to file, $2 = mime type
  if [ ! -f "$1" ]; then
    respond_json "404 Not Found" '{"error":"asset not found"}'
    return
  fi
  local len
  len=$(stat -c '%s' "$1" 2>/dev/null || wc -c < "$1")
  respond_headers "200 OK" "$2" "$len"
  cat "$1"
}

respond_405() {
  respond_json "405 Method Not Allowed" '{"error":"method not allowed"}'
}

respond_400() {
  respond_json "400 Bad Request" "{\"error\":\"$1\"}"
}

respond_500() {
  respond_json "500 Internal Server Error" "{\"error\":\"$1\"}"
}

# -----------------------------------------------------------------------------
# JSON-ish extraction. Pulls a single string-valued key from BODY without a
# real JSON parser. Good enough for our flat single-level payloads.
#   key value -> json_get "reciter"
# -----------------------------------------------------------------------------
json_get_str() {
  printf '%s' "$BODY" | sed -n 's/.*"'"$1"'"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1
}

json_get_num() {
  printf '%s' "$BODY" | sed -n 's/.*"'"$1"'"[[:space:]]*:[[:space:]]*\([0-9]\+\).*/\1/p' | head -1
}

# Shell-escape a value for safe inclusion in single quotes within `am ... 'X'`.
shellesc() {
  # Replace ' with '\''
  printf '%s' "$1" | sed "s/'/'\\\\''/g"
}

# Tiny URL decoder (handles %xx). Used if we ever take query params.
urldecode() {
  printf '%b' "$(printf '%s' "$1" | sed 's/+/ /g;s/%/\\x/g')"
}

# -----------------------------------------------------------------------------
# Actions
# -----------------------------------------------------------------------------
get_ip() {
  ip addr show wlan0 2>/dev/null | awk '/inet /{split($2,a,"/"); print a[1]; exit}' \
    || ip route get 1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="src"){print $(i+1); exit}}' \
    || hostname -I 2>/dev/null | awk '{print $1}' \
    || echo "127.0.0.1"
}

has_masjidal() {
  pm list packages "$MASJIDAL_PKG" 2>/dev/null | grep -q "$MASJIDAL_PKG" && echo 1 || echo 0
}

action_play() {
  local reciter surah
  reciter=$(json_get_str reciter)
  surah=$(json_get_str surah)
  if [ -z "$reciter" ] || [ -z "$surah" ]; then
    respond_400 "reciter and surah required"
    return
  fi
  local er es
  er=$(shellesc "$reciter")
  es=$(shellesc "$surah")
  log "play: '$reciter' / '$surah'"
  am broadcast --user 0 -n "$RECEIVER" \
    --ei type "$ALARM_TYPE_QURAN" \
    --es typeV "$reciter" \
    --es typeS "$surah" >/dev/null 2>&1
  respond_json "200 OK" "{\"ok\":true,\"playing\":{\"reciter\":\"$er\",\"surah\":\"$es\"}}"
}

action_tap() {
  # $1 = "X Y"
  input tap $1 >/dev/null 2>&1
  respond_json "200 OK" '{"ok":true}'
}

action_volume() {
  local dir steps coord
  dir=$(json_get_str direction)
  steps=$(json_get_num steps)
  [ -z "$steps" ] && steps=3
  case "$dir" in
    up)   coord="$COORD_VOL_UP" ;;
    down) coord="$COORD_VOL_DOWN" ;;
    *)    respond_400 "direction must be up or down"; return ;;
  esac
  # Clamp 1..20
  [ "$steps" -lt 1 ]  2>/dev/null && steps=1
  [ "$steps" -gt 20 ] 2>/dev/null && steps=20
  i=0
  while [ $i -lt "$steps" ]; do
    input tap $coord >/dev/null 2>&1
    sleep 0.12
    i=$((i+1))
  done
  respond_json "200 OK" "{\"ok\":true,\"direction\":\"$dir\",\"steps\":$steps}"
}

action_stop() {
  input tap $COORD_PLAY_PAUSE >/dev/null 2>&1
  sleep 0.3
  input tap $COORD_CLOSE >/dev/null 2>&1
  respond_json "200 OK" '{"ok":true}'
}

action_config() {
  local ip masj
  ip=$(get_ip)
  masj=$(has_masjidal)
  if [ "$masj" = "1" ]; then masj=true; else masj=false; fi
  respond_json "200 OK" "{\"frame_ip\":\"$ip\",\"frame\":\"$ip:on-device\",\"has_frame\":$masj,\"on_device\":true,\"discovery_running\":false,\"last_scanned\":0}"
}

action_discover() {
  local ip
  ip=$(get_ip)
  respond_json "200 OK" "{\"ok\":true,\"frame_ip\":\"$ip\",\"log\":[\"running on-device; no scan needed\"]}"
}

action_status() {
  local masj focus
  masj=$(has_masjidal)
  if [ "$masj" = "1" ]; then masj=true; else masj=false; fi
  focus=$(dumpsys window 2>/dev/null | grep mCurrentFocus | head -1 | sed 's/"/\\"/g' | tr -d '\r\n')
  respond_json "200 OK" "{\"connected\":$masj,\"frame\":\"on-device\",\"focus\":\"$focus\",\"on_device\":true}"
}

# -----------------------------------------------------------------------------
# Routing
# -----------------------------------------------------------------------------
mime_for() {
  case "$1" in
    *.html) echo "text/html" ;;
    *.css)  echo "text/css" ;;
    *.js)   echo "application/javascript" ;;
    *.json) echo "application/json" ;;
    *.png)  echo "image/png" ;;
    *.svg)  echo "image/svg+xml" ;;
    *.ico)  echo "image/x-icon" ;;
    *)      echo "application/octet-stream" ;;
  esac
}

route() {
  # Strip query string from PATH_ for static lookups
  local clean="${PATH_%%\?*}"
  log "$METHOD $clean"

  if [ "$METHOD" = "OPTIONS" ]; then
    respond_headers "200 OK" "text/plain" "0"
    return
  fi

  # --- Static + PWA ---
  case "$clean" in
    "/" | "")
      respond_file "$WEBAPP/index.html" "text/html"; return ;;
    "/manifest.json")
      respond_file "$WEBAPP/manifest.json" "application/manifest+json"; return ;;
    /icon-*.png)
      respond_file "$WEBAPP${clean}" "image/png"; return ;;
    /static/*)
      local f="${clean#/static/}"
      respond_file "$WEBAPP/$f" "$(mime_for "$f")"; return ;;
  esac

  # --- API ---
  case "$clean" in
    "/api/config")
      [ "$METHOD" = "GET" ]  && action_config   || respond_405; return ;;
    "/api/discover")
      [ "$METHOD" = "POST" ] && action_discover || respond_405; return ;;
    "/api/reciters")
      respond_file "$ASSETS/reciters.json" "application/json"; return ;;
    "/api/surahs")
      respond_file "$ASSETS/surahs.json" "application/json"; return ;;
    "/api/status")
      action_status; return ;;
    "/api/play")
      [ "$METHOD" = "POST" ] && action_play     || respond_405; return ;;
    "/api/pause")
      [ "$METHOD" = "POST" ] && action_tap "$COORD_PLAY_PAUSE" || respond_405; return ;;
    "/api/next")
      [ "$METHOD" = "POST" ] && action_tap "$COORD_NEXT"       || respond_405; return ;;
    "/api/prev")
      [ "$METHOD" = "POST" ] && action_tap "$COORD_PREV"       || respond_405; return ;;
    "/api/stop")
      [ "$METHOD" = "POST" ] && action_stop                    || respond_405; return ;;
    "/api/volume")
      [ "$METHOD" = "POST" ] && action_volume                  || respond_405; return ;;
    "/api/home")
      [ "$METHOD" = "POST" ] && action_tap "$COORD_CLOSE"      || respond_405; return ;;
  esac

  respond_json "404 Not Found" "{\"error\":\"no route for $clean\"}"
}

# -----------------------------------------------------------------------------
# Entrypoint
# -----------------------------------------------------------------------------
mkdir -p "$BRIDGE_ROOT" 2>/dev/null
read_request
route
