# athanframe

Remote control for the **Masjidal Smart WiFi Digital Azan Clock & Islamic Prayer Frame** (also marketed as the *Athan Frame*) from your Mac terminal, over your local network, via ADB.

Trigger Quran recitation, pause/resume, change surah, adjust volume, and take screenshots — all without touching the device. Drive it from a CLI on your Mac, or from your phone via the bundled PWA (`./bridge/`).

```
./athanframe play                              # Sudais reciting Al-Fatihah
./athanframe play SHATIRI KAHF                 # Al-Shatiri reciting Al-Kahf
./athanframe play "Mishari Rashid Al-Afasy" "Ar-Rahman"
./athanframe pause
./athanframe vol_up 5
./athanframe stop
./athanframe screenshot ~/Desktop/frame.png
```

---

## Contents

- [How it works](#how-it-works)
- [Device fingerprint](#device-fingerprint)
- [Prerequisites](#prerequisites)
- [Setup](#setup)
- [Usage](#usage)
- [How playback is triggered (the broadcast)](#how-playback-is-triggered-the-broadcast)
- [UI coordinate map (for the tap-based controls)](#ui-coordinate-map-for-the-tap-based-controls)
- [Reciter & surah names](#reciter--surah-names)
- [Reconnaissance findings](#reconnaissance-findings)
- [Limitations](#limitations)
- [Troubleshooting](#troubleshooting)
- [Roadmap](#roadmap)
- [Security note](#security-note)
- [Phone control (PWA bridge)](#phone-control-pwa-bridge)
- [The journey (how we built this)](#the-journey-how-we-built-this)
- [Disclaimer](#disclaimer)

---

## How it works

The Athan Frame is an **Android 11 tablet** (Rockchip RK3566 SoC) running Masjidal's custom kiosk app `com.masjidal.athanframe`. The shipped firmware leaves **ADB-over-WiFi enabled on port 5555** with no authentication. This script connects over the LAN and drives the device two ways:

1. **`play`** sends an Android broadcast intent directly to the app's `ScheduleReceiver`, which the app itself uses internally to schedule prayer-time Quran recitations. One command, one round-trip, immediate playback. Robust against UI layout changes — the broadcast is part of the app's internal API.

2. **`pause` / `next` / `prev` / `vol_up` / `vol_down` / `stop`** are simulated screen taps via `adb shell input tap`. These controls are method calls on a live in-memory `QuranPlayer` view object inside the app and have no broadcast surface, so we drive them through the UI. Coordinates are calibrated for the 1280×800 display and may need re-mapping if Masjidal updates the app.

---

## Device fingerprint

For future model compatibility / debugging:

| Property | Value |
|---|---|
| Manufacturer / Brand | rockchip |
| Model | RK3566 |
| Build display ID | `XB-RK3566X12-Masjida-…-EDITION11-YYYYMMDD` (redacted) |
| Android version | 11 (API 30) |
| Build type | `userdebug` (ADB auto-authorizes) |
| Display | 1280 × 800 |
| Package | `com.masjidal.athanframe` |
| ADB port | 5555 (TCP-over-WiFi) |

The device also has `com.youngfeel.yfclock2` (a generic Chinese white-label clock app — likely the original platform Masjidal customized) and `TeamViewer QuickSupport` pre-installed.

---

## Prerequisites

- macOS (script is bash; trivially portable to Linux)
- [Homebrew](https://brew.sh)
- `adb` from `android-platform-tools`
- Frame powered on and connected to the same WiFi as your computer
- Frame's local IP address

Optional, for re-doing the reverse engineering yourself:
- `nmap` — network scanning
- `apktool` — APK resource decoding
- `jadx` — APK Java decompilation

---

## Setup

### 1. Install ADB

```bash
brew install --cask android-platform-tools
adb --version   # confirm
```

### 2. Find your frame's IP

The frame's IP is whatever DHCP gave it. Three ways to discover:

- **From the frame's settings screen** — swipe down from top middle → WiFi / About / Network.
- **From your router's DHCP table** — look for an unfamiliar Android device.
- **By scanning your subnet for ADB port 5555**:
  ```bash
  nmap -p 5555 --open -T4 192.168.1.0/24    # adjust subnet to match yours
  ```

### 3. Connect

```bash
adb connect <FRAME_IP>:5555
adb devices                                 # should list <FRAME_IP>:5555 as "device"
```

If `adb devices` shows `unauthorized`, walk over to the frame and approve the debugging prompt. (On this build the prompt usually never appears because it's a `userdebug` build.)

### 4. Configure the script

Edit the default `FRAME_IP` near the top of `./athanframe`, or override per-invocation:

```bash
FRAME_IP=192.168.1.50 ./athanframe status
```

### 5. (Optional) Put it on your PATH

```bash
ln -s "$PWD/athanframe" /usr/local/bin/athanframe
# or add this directory to PATH in your ~/.zshrc
```

---

## Usage

```
athanframe <command> [args]

Playback (broadcast-driven, robust):
  play [RECITER] [SURAH]     Start Quran playback in one shot.
                             Defaults: SUDAIS FATIHAH.

Playback controls (UI taps):
  pause                      Toggle play / pause
  next                       Next surah
  prev                       Previous surah
  vol_up   [steps]           Volume up (default 3 steps)
  vol_down [steps]           Volume down (default 3 steps)
  stop                       Pause and close the player

Utility:
  status                     Show connection + foreground activity
  screenshot [path]          Save a PNG (default /tmp/athanframe_screen.png)
  home                       Close any open overlay, return to prayer-times view
```

---

## How playback is triggered (the broadcast)

`play` runs:

```bash
adb -s <FRAME>:5555 shell "am broadcast \
  -n com.masjidal.athanframe/com.masjidal.athanframe.schedular.ScheduleReceiver \
  --ei type 1 \
  --es typeV '<reciter name>' \
  --es typeS '<surah name>'"
```

**Extras:**

| Extra | Type | Meaning | Value used |
|---|---|---|---|
| `type` | int | Alarm type enum from `Utills.Constants.ALARM_TYPE` | `1` = QURAN (2 = ADHKAR, 3 = RADIO, 4 = OTHER) |
| `typeV` | string | Reciter display name | e.g. `"Abdur Rahman As-Sudais"` |
| `typeS` | string | Surah display name | e.g. `"Al-Fatihah"` |

**Control flow inside the app:**

1. `ScheduleReceiver.onReceive` (manifest-registered, reachable from ADB) repackages the extras and dispatches `Intent("com.masjidal.alarm.schedule.player")` over `LocalBroadcastManager`.
2. The currently-foreground activity (`MasjidDetailView` or `CalculatedDetailView`) has an in-process listener on that local action.
3. The listener calls `showQuranPlayerScreen(true, reciter, surah)`.
4. `showQuranPlayerScreen` instantiates `new QuranPlayer(...)` bound to the `R.id.quran_player` view and starts MediaPlayer against the S3 audio URL.

**The audio CDN URL pattern** (discovered via logcat during testing):

```
https://masjidal.s3.us-east-2.amazonaws.com/audio/quran/<reciter-slug>/<NNN>.mp3
```

The reciter slug is the lowercased display name with hyphens (`Abdur Rahman As-Sudais` → `abdur-rahman-as-sudais`); `<NNN>` is the zero-padded surah number (`001` … `114`). These URLs are publicly downloadable — you can stream them on any device, no frame required.

---

## UI coordinate map (for the tap-based controls)

All coordinates are for the 1280×800 display in the default theme. If Masjidal updates the layout, re-measure with `./athanframe screenshot` and a pixel ruler.

| Element | x, y |
|---|---|
| Plus / Features button (main screen, bottom-left) | 52, 705 |
| Qur'an Player tile (Features menu) | 640, 220 |
| Close (X, top-right of overlays) | 1224, 33 |
| Back (top-left of sub-screens) | 40, 33 |
| Play / Pause toggle (player screen) | 640, 584 |
| Previous surah | 456, 584 |
| Next surah | 824, 584 |
| Volume + | 1205, 260 |
| Volume − | 1205, 520 |

---

## Reciter & surah names

The broadcast accepts whatever exact display name the app already knows. The script defines a few friendly shortcuts (all case-insensitive); anything else is passed through unchanged.

**Reciter shortcuts:**

| Token | Resolves to |
|---|---|
| `SUDAIS` | Abdur Rahman As-Sudais |
| `SHATIRI` | Abu Bakr Al-Shatiri |
| `BASFAR` | Abdullah Basfar |
| `ABDULBASET` | AbdulBaset AbdulSamad |
| `AFASY`, `MISHARI` | Mishari Rashid Al-Afasy |

**Surah shortcuts:**

| Token | Resolves to |
|---|---|
| `FATIHAH`, `FATIHA`, `1` | Al-Fatihah |
| `BAQARAH`, `2` | Al-Baqarah |
| `KAHF`, `18` | Al-Kahf |
| `YASEEN`, `YASIN`, `36` | Yaseen |
| `RAHMAN`, `55` | Ar-Rahman |
| `WAQIAH`, `56` | Al-Waqi'ah |
| `MULK`, `67` | Al-Mulk |

For anything else, pass the exact name in quotes:

```bash
./athanframe play "Mishari Rashid Al-Afasy" "An-Nas"
```

---

## Notes on the app

The script's `play` command works by sending a single Android broadcast intent
to a receiver that the Masjidal app registers in its manifest. The action and
extras are documented earlier in this README only because they are required to
use the script. No backend credentials, server keys, device tokens, internal
endpoints, or other client-side secrets discovered while building this are
reproduced in this repository. If you are interested in interoperability work
of your own, decompile the APK locally and read its sources directly.

---

## Limitations

- **LAN only.** This script needs to be able to reach the frame's IP. For control from outside your home, you need a VPN (Tailscale, WireGuard) or a relay running on an always-on machine at home.
- **`MasjidDetailView` or `CalculatedDetailView` must be the foreground activity** for `play` to work. The script defensively brings the app forward before broadcasting. If the frame is asleep or showing a fullscreen reminder, results vary.
- **Volume / pause / next / prev / stop are tap-based** and will break if Masjidal materially changes the UI layout. Re-map coordinates via `./athanframe screenshot`.
- **Reciter list scrolling not implemented.** All reciters work via the broadcast `play`, but selecting one via UI taps (legacy) would need scroll support. Not currently needed.
- **Surah list scrolling not implemented** (same reason).
- Requires ADB-over-network to remain enabled by the vendor in future firmware updates. If they ever disable it, ADB-over-USB still works.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `adb: device offline` | `adb disconnect <FRAME>:5555 && adb connect <FRAME>:5555` |
| Broadcast says `Broadcast completed: result=0` but nothing plays | Make sure `MasjidDetailView` / `CalculatedDetailView` is foreground. Run `./athanframe home` first, then `./athanframe play`. |
| Tap hits wrong UI element | Take a screenshot (`./athanframe screenshot`), open it, measure the actual element coordinates, update the constants near the top of the script. |
| Frame restarted / IP changed | Re-scan with `nmap -p 5555 --open -T4 <your-subnet>/24`. |
| ADB port 5555 closed after a firmware update | Power-cycle. If still closed, factory reset is heavy-handed but works. Worst case, the trick is dead and you'd need to find another way in (USB ADB, custom recovery). |
| `bad substitution` or `${1^^}` errors | You're on the system bash (3.x). The script already uses portable `tr` for upper-casing — if you see this, it means the script wasn't saved properly. |

---

## Roadmap

- Add a sleep-aware `play` that wakes the screen and brings the activity forward more reliably (currently uses `monkey -p ... LAUNCHER 1` which is good enough but could be more graceful).
- Map play/pause/next/prev to direct method calls if a future reverse-engineering pass finds an internal entry point (uiautomator dump → exact view IDs would also work, more robust than fixed coordinates).
- Try `type 2` (ADHKAR), `type 3` (RADIO), `type 4` (OTHER) variants of the broadcast — same code path, untested.
- Optional: Home Assistant / HomeKit shim so playback can be triggered via voice / automation.
- Optional: Stand up a small auth-gated HTTP wrapper on an always-on home machine + Cloudflare Tunnel / Tailscale for true off-LAN control. (See [Security note](#security-note).)

---

## Phone control (PWA bridge)

A small FastAPI bridge in `./bridge/` exposes the script's functionality as HTTP endpoints and serves a Progressive Web App you can install on your phone's home screen. **LAN-only** — your phone must be on the same WiFi as the Mac running the bridge.

### One-command install (recommended)

For a fresh machine, the simplest path is:

```bash
git clone <this repo url>
cd athanframe
./install.sh
```

`install.sh` will:
- Verify Homebrew, then install `adb` and Python 3 if missing
- Create a venv inside `bridge/` and install Python dependencies
- Start the bridge on port 8080
- **Auto-discover your Athan Frame on the LAN** at startup (no IP needed)
- Print the LAN URL — open it in Safari on your iPhone (same Wi-Fi) → Share → Add to Home Screen

If `qrencode` is installed (`brew install qrencode`), it'll also print a QR code you can scan from your phone.

### Sharing with a friend who has the same device

Send them the repo. On their Mac:

```bash
git clone <this repo url>
cd athanframe
./install.sh
```

That's it. The bridge will scan their LAN at startup and figure out their frame's IP automatically. If discovery fails (e.g., the frame is on a different VLAN or sleeping), the PWA shows a friendly setup screen with:

- A **"Scan my network"** button to retry discovery
- A **manual IP entry** option as a fallback

The discovered IP is cached to `bridge/config.json` so subsequent starts are instant. If the router reassigns the frame's IP later, the bridge auto-re-scans on the next failed connection.

### Start the bridge manually

If you've already installed once and just want to start:

```bash
cd bridge
./run.sh
```

Override the auto-discovered IP if you need to:
```bash
FRAME_IP=192.168.1.50 ./run.sh
```

### Install the PWA on iPhone

1. On the Mac, make sure the bridge is running.
2. On your iPhone (same Wi-Fi), open Safari and go to the LAN URL printed by `install.sh`.
3. Tap **Share** → **Add to Home Screen** → **Add**.
4. The app icon appears on your home screen and launches fullscreen.

Same flow on Android (Chrome → menu → Install app).

### What the PWA does

- **First-run setup overlay** — if no frame is configured yet, shows a "Find your Athan Frame" screen with a Scan button and a manual IP fallback
- **Guided 3-step flow** — Reciter → Surah → Player with back navigation
- **Full 36-reciter catalog** fetched live from Masjidal's S3, alphabetized with letter section markers
- **All 114 surahs** with Arabic name + English name + number
- **One-shot play** via the bridge's `am broadcast` to the frame's ScheduleReceiver
- **Pause/resume/next/prev/stop/volume** via tap automation
- **Now-playing bar** stays visible across all steps

### HTTP API

| Method | Path | Body | Description |
|---|---|---|---|
| `GET` | `/api/config` | – | `{frame_ip, has_frame, discovery_running, last_scanned}` |
| `POST` | `/api/config` | `{frame_ip}` | Manually set the frame IP; verifies it's a real Athan Frame |
| `POST` | `/api/discover` | – | Force a fresh subnet scan; returns when complete |
| `GET` | `/api/reciters` | – | `{reciters: [{name, slug}, ...]}` |
| `GET` | `/api/surahs` | – | `{surahs: [{index, name}, ...]}` |
| `GET` | `/api/status` | – | `{connected, frame, focus}` |
| `POST` | `/api/play` | `{reciter, surah}` | Trigger playback via broadcast |
| `POST` | `/api/pause` | – | Toggle play/pause (tap) |
| `POST` | `/api/next` | – | Next surah (tap) |
| `POST` | `/api/prev` | – | Previous surah (tap) |
| `POST` | `/api/stop` | – | Pause + close player (tap) |
| `POST` | `/api/volume` | `{direction, steps}` | direction = `up` or `down` |
| `POST` | `/api/home` | – | Close any overlay (tap) |
| `GET` | `/api/screenshot` | – | Returns PNG of frame display |

Example:
```bash
curl -X POST http://192.168.1.42:8080/api/play \
  -H 'Content-Type: application/json' \
  -d '{"reciter":"Abdur Rahman As-Sudais","surah":"Al-Fatihah"}'
```

### Keeping the bridge running

`install.sh` and `run.sh` both run in the foreground — close the terminal and the bridge stops. Two simple ways to keep it up:

- **tmux / screen** — `tmux new -d -s athan './install.sh'`, reattach with `tmux a -t athan`.
- **launchd** (proper way on macOS) — create `~/Library/LaunchAgents/com.athanframe.bridge.plist` and `launchctl load` it.

### Security

The bridge has **no authentication**. Anyone on your LAN can reach it and trigger playback. That's acceptable for a home network you control; do not expose port 8080 to the internet or run this on a guest network.

---

## Security note

The frame ships with **ADB over WiFi exposed on port 5555 with zero authentication.** Anyone on your LAN can take it over completely (install apps, exfiltrate data, brick it, or pivot deeper). Treat the frame like any other unauthenticated IoT device:

- Keep it on your trusted home network only. **Never put it on a guest or public network.**
- Consider isolating it on an IoT VLAN if your router supports it.
- **Do not port-forward 5555 to the public internet** under any circumstances. ADB has no auth and the device is one `adb install` away from being a permanent member of someone's botnet.

For remote (outside-home) control, the safe approaches are:
- **Tailscale** on an always-on home machine acting as a subnet router (recommended for personal use).
- **WireGuard** server on your router.
- A small auth-protected HTTP shim on an always-on home machine, exposed via Cloudflare Tunnel.

---

## The journey (how we built this)

For curious readers, the rough sequence that led here:

1. **No public API exists** for the Masjidal Athan Frame. Their support docs only cover the on-device touchscreen UI. Email to `support@masjidal.com` would have been the polite first step.
2. **Network reconnaissance** identified the frame on the LAN as an "Unknown" MAC with TCP port `5555` open — the classic signature of a vendor Android device with ADB-over-WiFi left enabled.
3. **`adb connect` succeeded immediately**, no authorization prompt — confirming the `userdebug` build.
4. **`getprop`** revealed the device is a Rockchip RK3566 Android 11 tablet running a `com.masjidal.athanframe` launcher.
5. **First-pass UI automation** via `input tap` proved viable — we drove the frame through Features → Qur'an Player → Reciter → Surah and got recitation playing.
6. **APK pull + apktool/jadx decompilation** of `com.masjidal.athanframe` revealed:
   - The Quran player is a UI controller (`quran/QuranPlayer.java`), not a service or activity, so it has no direct external launch point.
   - But `schedular/ScheduleReceiver` is a manifest-registered receiver that re-emits a `LocalBroadcastManager` event the player listens for.
   - The action constant is `com.masjidal.alarm.schedule.player`; extras are `type` (int enum), `typeV` (reciter string), `typeS` (surah string).
7. **Firing the broadcast from ADB** triggered playback immediately, and **logcat** confirmed the full chain and revealed the audio CDN URL pattern.

The script's `play` now uses the broadcast; everything else still uses taps because those controls are method calls on the live player object with no broadcast surface.

---

## Disclaimer

Not affiliated with, endorsed by, or supported by Masjidal. This is personal interoperability work on a device the script's author legally owns. Decompilation for interoperability is permitted under DMCA §1201 and equivalent provisions in most jurisdictions, but YMMV — consult a lawyer if you're doing this commercially.

The script reads the device's state and sends standard Android commands to it via ADB. It does not contact Masjidal's servers, exfiltrate data, or modify the app. No warranty; use at your own risk.

## Credits

- PWA app icon glyph: **Google Material Symbols** `mosque` — Apache License 2.0.
  Source: https://github.com/google/material-design-icons
  Local copy + license: `bridge/webapp/vendor/`
