# frame-bridge — bridge runs on the Athan Frame itself

The simplest, lowest-footprint bridge possible. A 250-line shell script + `nc` + `am` + `input`, all using binaries that already ship with the Athan Frame's Android OS. **No Mac, no Pi, no APK required after install.** The friend's phone talks directly to the frame.

> One-time install requires any Mac/Linux machine with `adb` (just for the initial push). After that, the host machine is no longer needed.

## How it works

The Athan Frame's `adbd` runs as **root** (`ro.adb.secure=0`, `ro.debuggable=1`, `uid=0`). Any shell process started via `adb shell` inherits that uid — bypassing every Android sandbox restriction that defeated our previous attempts:

- `am broadcast` to non-exported receivers ✓
- `input tap` on other apps' windows ✓
- Full filesystem access ✓

We install a small shell-only HTTP server on the frame at `/data/local/tmp/athan-bridge/`, started via `adb shell nohup ./launcher.sh &`. The launcher keeps `nc -p 8080 -L athan-bridge.sh` running; `nc` accepts an HTTP connection, spawns the handler script with stdin/stdout wired to the socket, the handler parses the request and either serves a static file (PWA) or runs `am`/`input` directly.

```
┌─────────────┐  HTTP  ┌──────────────────────────────────┐
│  iPhone PWA │ ─────▶ │  Athan Frame                     │
│             │        │                                  │
└─────────────┘        │  /data/local/tmp/athan-bridge/   │
                       │  ├── launcher.sh   (loop)        │
                       │  ├── athan-bridge.sh  (handler)  │
                       │  ├── webapp/   (PWA assets)      │
                       │  └── assets/   (catalog JSON)    │
                       │                                  │
                       │  Spawned per request as ROOT:    │
                       │    am broadcast --user 0 -n ...  │
                       │    input tap X Y                 │
                       │             │                    │
                       │             ▼                    │
                       │  com.masjidal.athanframe         │
                       └──────────────────────────────────┘
```

## End-to-end flow

### Setup (one time)

```
┌──────────┐                     ┌─────────────┐
│   Mac    │ ── adb push ──────▶ │ Athan Frame │
│ (you)    │ ── nohup launcher │ │  (rooted    │
└──────────┘                     │   adbd)     │
                                 └─────────────┘
```

You run `./install-on-frame.sh` once. It:
1. Finds the frame on the LAN (auto-discovery, or set `FRAME_IP=...`)
2. `adb push`es 3 shell scripts + the PWA assets + catalog JSON to `/data/local/tmp/athan-bridge/`
3. `adb shell nohup launcher.sh &` — starts the listener as root, detaches
4. Mac walks away. Never needed again unless the frame reboots.

### Persistently running on the frame

```
launcher.sh  (PID alive forever, restarts nc if it dies)
   │
   └── nc -p 8080 -L athan-bridge.sh
                          │
                          └── (spawned per HTTP connection, runs as root)
```

`launcher.sh` keeps `nc` alive. `nc -L` is "listen for **many** connections, run COMMAND for each". When a request arrives, `nc` accepts the TCP socket and spawns a fresh `athan-bridge.sh` with the socket wired to stdin/stdout. That handler reads the request from stdin and writes the response to stdout.

### A single request, step by step

```
 iPhone PWA                  Athan Frame
 ──────────                  ───────────
    │
    │ POST /api/play
    │ {"reciter":"...","surah":"..."}
    │ ─────────────────────▶  nc accepts TCP on :8080
    │                              │
    │                              ▼
    │                          spawns athan-bridge.sh (uid=0, root)
    │                              │
    │                              ├─ read_request: parse method, path, body
    │                              ├─ route: case "/api/play" → action_play
    │                              ├─ json_get_str reciter / surah
    │                              ├─ am broadcast --user 0 \
    │                              │    -n com.masjidal.athanframe/...ScheduleReceiver \
    │                              │    --ei type 1 --es typeV "..." --es typeS "..."
    │                              │                  │
    │                              │                  ▼
    │                              │           Masjidal app receives broadcast,
    │                              │           opens player, fetches MP3 from S3,
    │                              │           starts playing on the frame's speaker.
    │                              │
    │                              ├─ respond_json "200 OK" '{"ok":true,...}'
    │ ◀───────────────────────  nc returns the bytes, closes socket
    │
    │ UI updates "Now Playing"
```

### What gets served

The same handler serves both the PWA *and* the control API:

| Request | Handler does |
|---|---|
| `GET /` | `cat webapp/index.html` |
| `GET /static/app.js`, `style.css` | `cat webapp/<file>` |
| `GET /icon-*.png`, `/manifest.json` | `cat webapp/<file>` |
| `GET /api/reciters` | `cat assets/reciters.json` (36 reciters, baked at build) |
| `GET /api/surahs` | `cat assets/surahs.json` (114 canonical names) |
| `POST /api/play` | `am broadcast` to ScheduleReceiver; persists `state.json` |
| `POST /api/pause` | `input tap` on play/pause button (toggles current state) |
| `POST /api/next`, `/prev` | Read `state.json`, look up neighbor in `assets/surahs.json` (with wrap-around), re-broadcast play intent. No UI taps. |
| `POST /api/stop` | `input tap` play/pause (to pause), then `input tap` close X |
| `POST /api/volume` `{direction, steps}` | `input keyevent KEYCODE_VOLUME_UP`/`DOWN` × steps (system media stream) |
| `POST /api/home` | `input tap` the close button |
| `GET /api/status` | `dumpsys window \| grep mCurrentFocus` |

### Why next/prev and volume don't use UI taps

The Masjidal player has **no visible next/prev buttons** — only play/pause and close. So `/api/next` and `/api/prev` work by:

1. Reading the persisted `state.json` (last `{reciter, surah}` from `/api/play`)
2. Looking up that surah's index in the bundled `assets/surahs.json`
3. Computing the neighbour (wraps: An-Nas → Al-Fatihah, Al-Fatihah → An-Nas)
4. Re-broadcasting the play intent with the new surah name

This is more robust than UI automation would be anyway — no race with animations, no idle-state requirement, no coordinate drift if the player UI changes in a future Masjidal update.

Volume similarly avoids the in-app volume slider (it's decorative — single taps on `+`/`−` don't visibly move the thumb). Instead `/api/volume` issues `KEYCODE_VOLUME_UP`/`DOWN` events to the OS, which control the `STREAM_MUSIC` volume that the player is playing on. Verified to work cleanly with `dumpsys audio | grep streamVolume`.

### What the user does on their phone

1. Connect to the same Wi-Fi as the frame
2. Safari → `http://<frame-ip>:8080`
3. Share → Add to Home Screen → tap the new icon
4. Tap reciter → tap surah → tap play

That's it. The PWA is static; all behavior lives on the frame; there's no Mac/Pi/cloud in the request path.

### Where everything lives

```
On your Mac (just the source):
  ~/repos/athanframe/frame-bridge/

On the frame after install:
  /data/local/tmp/athan-bridge/
  ├── launcher.sh           # outer loop, keeps nc alive
  ├── athan-bridge.sh       # per-request handler (parses HTTP, dispatches)
  ├── launcher.pid          # PID of the launcher loop
  ├── state.json            # last {reciter, surah} — used by next/prev
  ├── bridge.log            # request log
  ├── launcher.log          # nc start/restart log
  ├── webapp/               # PWA assets (index.html, app.js, style.css, icons)
  └── assets/               # reciter + surah catalogs (JSON)

In RAM on the frame:
  - 1 launcher.sh process (the outer while loop)
  - 1 nc process (listening on :8080)
  - briefly: 1 athan-bridge.sh per active request
```

## Why this works where the Android-app approach didn't

We previously tried building a Kotlin Android app to do the same thing. It hit hard security walls because Android sandboxes apps from each other — an app cannot send broadcasts to another app's non-exported receivers, nor inject input events into another app's windows. Those are signature-level permissions.

But the **shell** uid on a rooted `userdebug` build has those permissions natively. By piggybacking on the existing `adbd` and writing a shell script (not an APK), we avoid the sandbox entirely.

## Install

```bash
cd frame-bridge
./install-on-frame.sh
```

The script:
1. Finds the frame on your LAN (auto-discovers via nmap, or set `FRAME_IP=…`)
2. Pushes the shell scripts and PWA assets to `/data/local/tmp/athan-bridge/` on the frame
3. Starts the launcher with `nohup`
4. Prints the LAN URL to open on your phone

Then on the phone (same Wi-Fi): open `http://<frame-ip>:8080` → Safari Share → Add to Home Screen.

## After a frame reboot

The launcher dies when the frame reboots (it lives in RAM as a process, the scripts persist in `/data/local/tmp/` across reboots). To restart, just re-run:

```bash
./install-on-frame.sh
```

This is idempotent — it stops any existing launcher, re-pushes any changed files, and starts a fresh launcher. ~5 seconds.

For a fully hands-off auto-start on boot, a small extra step would be needed (e.g., dropping an `init.rc` extension, or installing a tiny boot-receiver APK). Not implemented yet — manual restart after the occasional reboot is the v1 trade-off.

## Endpoints

Same shape as the Python `pwa-bridge`:

| Method | Path | Notes |
|---|---|---|
| `GET`  | `/`, `/manifest.json`, `/static/*`, `/icon-*.png` | Bundled PWA assets |
| `GET`  | `/api/config` | `{frame_ip, has_frame, on_device:true}` |
| `POST` | `/api/discover` | No-op on-device; returns our IP |
| `GET`  | `/api/reciters` | 36-reciter catalog (baked at build time) |
| `GET`  | `/api/surahs` | 114 surahs |
| `GET`  | `/api/status` | Whether Masjidal is installed; current focused window |
| `POST` | `/api/play` | `{reciter, surah}` → `am broadcast` to ScheduleReceiver |
| `POST` | `/api/pause`, `/next`, `/prev`, `/home` | `input tap` |
| `POST` | `/api/stop` | tap play/pause + tap close |
| `POST` | `/api/volume` | `{direction: up|down, steps: int}` |

Example:
```bash
curl -X POST http://192.168.x.y:8080/api/play \
  -H 'Content-Type: application/json' \
  -d '{"reciter":"Abdur Rahman As-Sudais","surah":"Al-Fatihah"}'
```

## Files

```
frame-bridge/
├── README.md (this file)
├── install-on-frame.sh         — host-side: pushes + starts; also stop/uninstall
├── athan-bridge.sh             — frame-side: per-connection HTTP handler (250 lines)
├── launcher.sh                 — frame-side: keeps `nc -L` alive
├── webapp/                     — bundled PWA (copied from pwa-bridge at build time)
│   ├── index.html, style.css, app.js
│   ├── manifest.json
│   └── icon-{180,192,512}.png
└── assets/
    ├── reciters.json           — 36 reciters from Masjidal's S3 catalog
    └── surahs.json             — canonical 114-surah list
```

## Uninstall

```bash
./install-on-frame.sh uninstall
```

Stops the launcher and removes `/data/local/tmp/athan-bridge/` entirely.

## Limitations

- **Does not survive frame reboot** without re-running `install-on-frame.sh`. The scripts persist; only the running `nc` process dies on reboot.
- **No auth.** Anyone on the LAN can reach the bridge and play Quran on the frame. Acceptable for a home network you control; do not expose port 8080 to the internet.
- **`/data/local/tmp/` is preserved across reboots and OTAs**, but the frame's vendor (Masjidal) could in principle wipe it via a future firmware update. Reinstall is one command.
- **Performance:** each HTTP request spawns a fresh `sh` process via `nc -L`. Comfortably handles dozens of requests per second; fine for an interactive phone client.
- **No HTTPS.** LAN-only; HTTP is the standard for local IoT control.

## Compared to `pwa-bridge` and `android/`

| | pwa-bridge | android (experimental) | **frame-bridge** |
|---|---|---|---|
| Where the bridge runs | a host machine | the frame (failed) | **the frame** |
| Host machine required | yes (always-on) | one-time for install | one-time for install |
| Install footprint | Python venv on a Mac/Pi | ~4 MB APK | ~250 KB of shell + JSON + PWA |
| Privileges to drive Masjidal | external ADB | none (blocked) | root via adbd |
| Reboot persistence | host stays up | scripted via boot-receiver | manual restart |
| Status | ✅ rock-solid | ❌ blocked by Android sandbox | ✅ working |

For day-to-day use without an always-on host machine, this is the right answer.
