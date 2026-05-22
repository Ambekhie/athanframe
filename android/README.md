# Athan Frame — on-device bridge (Android) — EXPERIMENTAL

> ⚠️ **This subproject does not work as intended on the production Masjidal Athan Frame.** It is kept in the repo as a learning artifact documenting why an unsigned third-party app cannot self-host the bridge on a locked-down kiosk device. **Use [`pwa-bridge/`](../pwa-bridge/) instead** — it works, is stable, and gives you 100% of the functionality.

## Goal of this experiment

Move the HTTP bridge **onto the Athan Frame itself** so users don't need a host machine (Mac, PC, Pi) at home. Friend installs once via ADB, then their phone talks directly to `http://<frame-ip>:8080` forever after.

## What was built

A Kotlin Android app (`com.athanframe.bridge`) with:

- Foreground service hosting an embedded NanoHTTPD server on port 8080
- All API endpoints mirroring the Python bridge (`/api/play`, `/api/pause`, etc.)
- The PWA bundled inside the APK (`assets/index.html`, `app.js`, `style.css`, icons)
- Reciter catalog baked at build time from Masjidal's S3
- `MainActivity` showing the LAN URL + QR code on the frame's screen
- `BootReceiver` for restart-on-boot
- `install-on-frame.sh` for one-command install via ADB

The HTTP server, PWA serving, reciter catalog, and `MainActivity` all work correctly. The build is clean (`./gradlew :app:assembleDebug` succeeds, APK is ~4 MB). What doesn't work is the part that actually drives the Masjidal app.

## Why it doesn't work

The Masjidal Athan Frame is a **locked-down kiosk device**. Masjidal's app is the Device Admin and runs in Android's Lock Task Mode — a feature designed precisely to prevent third-party software from doing what this experiment tried to do. We hit every wall the Android security model erects:

| Approach we tried | Why it failed |
|---|---|
| `Context.sendBroadcast()` to ScheduleReceiver | Masjidal's receiver is `exported=false`. Android 11+ blocks cross-package broadcasts to non-exported receivers. |
| `Runtime.exec("am broadcast")` | The `am` command inherits our app's uid, hits the same export check. |
| `pm grant INTERACT_ACROSS_USERS` then retry | Cross-user permission doesn't bypass the receiver-export check. |
| Install as system app (`/system/priv-app/`) | A debug-signed APK in `/system/priv-app/` mismatches the platform signature, which can prevent `system_server` from starting cleanly. Risky for the device. |
| `Runtime.exec("input tap")` for UI automation | `INJECT_EVENTS` is signature-only; one app cannot inject input into another app's window. `adb shell` can; we cannot. |
| AccessibilityService (Android's official answer) | Enabling it requires opening Settings → Accessibility → Enable. **Lock Task Mode blocks Settings from opening.** |
| UIAutomator screen-content read | Masjidal UI's constant animations prevent UIAutomator from ever reaching "idle state". |

The kiosk security model isn't a bug — it's the intended behavior. The only ways past it are:

1. Sign our APK with Masjidal's platform signing key (not available)
2. Modify the device firmware to disable Lock Task Mode (real device modification, voids warranty)
3. Drive ADB from an **external** machine that has shell privileges (which is exactly what `pwa-bridge/` does)

## What worked anyway (parts you can reuse)

- The Gradle/Kotlin scaffolding for an Android service hosting NanoHTTPD
- The endpoint shapes for the HTTP API
- The PWA-asset-bundling-into-an-APK pattern
- The QR-code-on-device launch UX
- The Masjidal-package detection logic

If Masjidal ever releases an unlocked SKU, or you have a different (non-kiosk) Android device you want to control, this code is a working starting point.

## How to verify the verdict yourself

```bash
cd android
./install-on-frame.sh
```

The script builds the APK, installs it via ADB, and starts the service. The HTTP server comes up, the PWA loads, all read endpoints work. Then call:

```bash
curl -X POST http://<frame-ip>:8080/api/play \
  -H 'Content-Type: application/json' \
  -d '{"reciter":"Abdur Rahman As-Sudais","surah":"Al-Fatihah"}'
```

The endpoint returns `{"ok": true}` but playback does **not** start. Check logcat:

```bash
adb -s <frame-ip>:5555 logcat | grep IntentDispatcher
# You'll see:
#   Permission denied: injecting event ... requires INJECT_EVENTS permission
```

That's the wall.

## Recovery if you ran the broken `install-on-frame.sh` and it pushed to /system

An earlier revision of the install script pushed the APK to `/system/priv-app/` which can leave the frame in a degraded boot state. If you ran that and the frame is misbehaving, use the recovery script:

```bash
./recover-frame.sh
```

It scans the LAN for the frame, gets root, remounts `/system` writable, removes the bad system APK, and reboots. The current version of `install-on-frame.sh` does **not** push to `/system/`; it uses regular `adb install`.

## Code layout

```
android/
├── README.md                                — this file
├── recover-frame.sh                         — recovery if you ran the old broken installer
├── install-on-frame.sh                      — builds + adb installs (regular user-space install)
├── settings.gradle.kts, build.gradle.kts, gradle.properties, gradlew, gradle/
├── local.properties                         — gitignored
└── app/
    ├── build.gradle.kts
    ├── proguard-rules.pro
    └── src/main/
        ├── AndroidManifest.xml              — foreground service + boot receiver
        ├── kotlin/com/athanframe/bridge/
        │   ├── BridgeApplication.kt
        │   ├── BridgeService.kt             — works: foreground service + notification
        │   ├── HttpServer.kt                — works: all API routes
        │   ├── IntentDispatcher.kt          — does NOT work: tap injection denied
        │   ├── SurahData.kt
        │   ├── NetUtils.kt
        │   ├── BootReceiver.kt
        │   └── MainActivity.kt              — works (when not blocked by Lock Task)
        ├── assets/                          — bundled PWA + reciter catalog + layout map
        └── res/                             — icons, theme, strings
```
