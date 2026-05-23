# Athan Frame Remote

Tools for remotely controlling the **Masjidal Smart WiFi Digital Azan Clock & Islamic Prayer Frame** (sold as the *Athan Frame*) over your local network.

The device is an Android 11 tablet running Masjidal's custom kiosk app. It ships with ADB-over-WiFi enabled on port 5555, which we use to drive playback, change reciter and surah, adjust volume, and take screenshots — all without touching the frame.

## What's here

| Subproject | Status | Description |
|---|---|---|
| [`frame-bridge/`](./frame-bridge/) | ✅ working | **Recommended.** A shell-only HTTP server that runs directly on the Athan Frame as root, via the frame's own `adbd`. One-time install with ADB from any Mac; after that, no host machine needed. Phone talks directly to `http://<frame-ip>:8080`. ~250 lines of shell + the same PWA. |
| [`pwa-bridge/`](./pwa-bridge/) | ✅ working | Python (FastAPI) bridge + Progressive Web App. Runs on a Mac, Raspberry Pi, or any Linux host on the same Wi-Fi. Use this if you don't want any code running on the frame itself. |
| [`android/`](./android/) | ❌ experimental, doesn't work | Earlier attempt at an on-frame Android APK. Blocked by Android's app-sandbox model. Kept as a learning artifact. See [`android/README.md`](./android/README.md). |

Start with [`pwa-bridge/`](./pwa-bridge/) — it works today.

## Quick start

```bash
git clone https://github.com/<your-fork>/athanframe.git
cd athanframe/frame-bridge
./install-on-frame.sh
```

Then open the printed URL in Safari on your iPhone (same Wi-Fi), and **Share → Add to Home Screen**. Done — no host machine to keep running.

See [`frame-bridge/README.md`](./frame-bridge/README.md) for details, or [`pwa-bridge/README.md`](./pwa-bridge/README.md) if you'd rather run the bridge on a Mac/Pi.

## How this came to exist

There's no official API or companion app for the Athan Frame. The hard work was figuring out that:

1. The frame is a Rockchip RK3566 Android 11 tablet running `com.masjidal.athanframe`
2. ADB-over-WiFi is shipped open on port 5555
3. Quran playback can be triggered with a single broadcast intent:
   ```
   am broadcast -n com.masjidal.athanframe/com.masjidal.athanframe.schedular.ScheduleReceiver \
     --ei type 1 --es typeV "<reciter>" --es typeS "<surah>"
   ```
4. All 36 reciters' audio is on a public S3 bucket (`masjidal.s3.us-east-2.amazonaws.com/audio/quran/...`)

Full write-up of the journey is in [`pwa-bridge/README.md`](./pwa-bridge/README.md).

## License

MIT — see [`LICENSE`](./LICENSE). Not affiliated with Masjidal.

Third-party assets bundled with attribution: see `pwa-bridge/bridge/webapp/vendor/`.
