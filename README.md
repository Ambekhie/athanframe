# Athan Frame Remote

Tools for remotely controlling the **Masjidal Smart WiFi Digital Azan Clock & Islamic Prayer Frame** (sold as the *Athan Frame*) over your local network.

The device is an Android 11 tablet running Masjidal's custom kiosk app. It ships with ADB-over-WiFi enabled on port 5555, which we use to drive playback, change reciter and surah, adjust volume, and take screenshots — all without touching the frame.

## What's here

| Subproject | Status | Description |
|---|---|---|
| [`pwa-bridge/`](./pwa-bridge/) | ✅ working | Bash CLI + Python (FastAPI) HTTP bridge + Progressive Web App. Runs on any Mac/Linux machine on the same Wi-Fi as the frame. Auto-discovers the frame's IP on first run. Phone gets a polished installable web app. **Use this.** |
| [`android/`](./android/) | ❌ experimental, doesn't work | On-frame Android app. The HTTP server / PWA hosting works, but driving the Masjidal app from on-device is blocked by Android 11+ security on this kiosk device. See [`android/README.md`](./android/README.md) for the detailed walls hit. Kept as a learning artifact. |

Start with [`pwa-bridge/`](./pwa-bridge/) — it works today.

## Quick start

```bash
git clone https://github.com/<your-fork>/athanframe.git
cd athanframe/pwa-bridge
./install.sh
```

Then open the LAN URL it prints in Safari on your iPhone (same Wi-Fi), and **Share → Add to Home Screen**.

See [`pwa-bridge/README.md`](./pwa-bridge/README.md) for full details: how it works, the underlying broadcast we discovered, the HTTP API, troubleshooting.

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
