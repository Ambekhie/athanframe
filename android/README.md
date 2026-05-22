# Athan Frame — on-device bridge (Android)

This is the **on-frame** version of the bridge. Once installed, the Athan Frame hosts the HTTP server and PWA itself. No host machine (Mac, PC, Pi) is required for daily use.

## How it differs from `pwa-bridge/`

| | pwa-bridge | android (this) |
|---|---|---|
| Where bridge runs | A Mac/Linux machine on the LAN | The Athan Frame itself |
| Daily host required | yes | **no** |
| One-time setup | run `install.sh` on your host | run `install-on-frame.sh` once on any Mac to flash the APK |
| Updates after install | run new bridge code on host | install new APK on the frame |
| Survives frame reboot | host stays up | yes, auto-restarts via `BOOT_COMPLETED` |

## Architecture

```
┌─────────────┐    HTTP    ┌──────────────────────────────────┐
│ iPhone PWA  │ ─────────▶ │ Athan Frame (Android 11)         │
└─────────────┘            │                                  │
                           │  com.athanframe.bridge (this app)│
                           │   ├─ BridgeService (foreground)  │
                           │   ├─ HttpServer (NanoHTTPD)      │
                           │   ├─ Bundled PWA assets          │
                           │   └─ IntentDispatcher            │
                           │           │                      │
                           │           │ sendBroadcast        │
                           │           ▼                      │
                           │  com.masjidal.athanframe         │
                           │   └─ ScheduleReceiver            │
                           └──────────────────────────────────┘
```

## Build

Requires:
- JDK 17 (`brew install openjdk@17`)
- Android SDK (cmdline-tools at minimum, with platform 34 + build-tools 34.0.0)
- Gradle (either install with `brew install gradle` or generate `gradlew` via `gradle wrapper`)
- `adb` (`brew install --cask android-platform-tools`)

```bash
cd android
./install-on-frame.sh
```

The script:
1. Finds the frame on your LAN (or use `FRAME_IP_OVERRIDE=<ip>`)
2. Builds `app-debug.apk`
3. `adb install -r -t` onto the frame
4. Starts `MainActivity` (which auto-starts `BridgeService`)
5. Prints the URL your friend should open on their phone

## After install

- The bridge listens on `http://<frame-ip>:8080`
- A persistent notification on the frame's status bar shows the URL
- The on-frame app's main activity displays the URL plus a QR code
- The PWA at `/` is the same one shipped in `pwa-bridge/` — guided 3-step flow (Reciter → Surah → Player)
- Survives reboots via `BootReceiver`
- Auto-restarts if killed (`START_STICKY`)

## Endpoints (mirrors pwa-bridge)

| Method | Path | Notes |
|---|---|---|
| `GET`  | `/`, `/manifest.json`, `/static/*`, `/icon-*.png` | PWA assets bundled inside the APK |
| `GET`  | `/api/config` | Returns `{frame_ip, has_frame, on_device:true}` |
| `POST` | `/api/discover` | No-op on-device; returns our IP |
| `GET`  | `/api/reciters` | Returns the 36-reciter catalog baked into the APK |
| `GET`  | `/api/surahs` | 114 surahs |
| `GET`  | `/api/status` | Reports whether the Masjidal package is installed |
| `POST` | `/api/play` | `{reciter, surah}` → broadcast to Masjidal |
| `POST` | `/api/pause`, `/api/next`, `/api/prev`, `/api/stop`, `/api/volume`, `/api/home` | Tap-based |

## Known limitations

- **Tap controls** (`pause`/`next`/`prev`/`stop`/`volume`) use `Runtime.exec("input tap X Y")`. This works on the frame because it's a `userdebug` Android 11 build where the app's process has shell-level input access. On a hardened production Android device this would require an `AccessibilityService` — not implemented yet.
- **No mDNS / `.local` discovery** in v1. The URL is `http://<frame-ip>:8080`. mDNS advertisement is planned (`MdnsAdvertiser.kt` stub).
- **OTA risk**: if Masjidal pushes a firmware update, our app might be uninstalled along with userland. Re-run `install-on-frame.sh` to recover.
- **Frame reboot**: the service auto-starts via `BOOT_COMPLETED`, but the frame needs to be online (connected to Wi-Fi with a valid DHCP lease) before the service can be reached.

## Project layout

```
android/
├── settings.gradle.kts        # Gradle project settings
├── build.gradle.kts           # Top-level Gradle config
├── gradle.properties          # JVM / Android flags
├── install-on-frame.sh        # One-command build + install
├── app/
│   ├── build.gradle.kts       # App module config (dependencies, SDK levels)
│   ├── proguard-rules.pro
│   └── src/main/
│       ├── AndroidManifest.xml
│       ├── kotlin/com/athanframe/bridge/
│       │   ├── BridgeApplication.kt   # Singleton holder
│       │   ├── BridgeService.kt       # Foreground service + lifecycle
│       │   ├── HttpServer.kt          # NanoHTTPD routes
│       │   ├── IntentDispatcher.kt    # sendBroadcast + input tap
│       │   ├── SurahData.kt           # 114 surah names
│       │   ├── NetUtils.kt            # LAN IP discovery
│       │   ├── BootReceiver.kt        # Restart on boot
│       │   └── MainActivity.kt        # On-device status UI + QR
│       ├── assets/
│       │   ├── index.html, app.js, style.css   # PWA (copied from pwa-bridge)
│       │   ├── manifest.json
│       │   ├── icon-{180,192,512}.png
│       │   └── reciters.json          # Baked from Masjidal S3 at build time
│       └── res/
│           ├── layout/activity_main.xml
│           ├── values/{strings,colors,themes}.xml
│           └── xml/data_extraction_rules.xml
└── README.md (this file)
```
