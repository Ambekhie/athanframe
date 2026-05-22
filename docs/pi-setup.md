# Running the bridge on a Raspberry Pi

This guide walks through setting up the `pwa-bridge` on a Raspberry Pi so it runs 24/7 with no Mac/PC required. Total time: ~30 minutes, mostly waiting.

> If you already have a Mac that's always on, you don't need a Pi — just run `./pwa-bridge/install.sh` on the Mac. The Pi is the right answer when your only computer is a laptop that sleeps.

## Hardware you'll need

| Item | Spec | ~Cost |
|---|---|---|
| Raspberry Pi | **Pi Zero 2 W (recommended, cheapest viable)** — or any Pi 3 / 4 / 5 you already have | $15–60 |
| microSD card | 8 GB minimum, Class 10 or A1 | $5 |
| Power supply | micro-USB (Zero 2 W / Pi 3) or USB-C (Pi 4/5) | $8 |
| Case | optional | $5 |

**Total for a new Pi Zero 2 W setup: ~$28.** A Pi Zero 2 W has a 1 GHz quad-core ARM CPU, 512 MB RAM, and built-in Wi-Fi — plenty for a small FastAPI server and an `adb` connection. Idle draw is around 0.5 W.

**Do not use the original Pi Zero W** (single-core armv6) — it's only $5 cheaper and Python wheel availability is much worse on armv6. Stick with the **Zero 2 W** or newer.

If you already have any old Pi (3, 3 A+, 4, 400, even a Pi 2) gathering dust, use that — they all work.

## Step 1 — Flash Raspberry Pi OS Lite to the microSD

1. Download **Raspberry Pi Imager** from https://www.raspberrypi.com/software/
2. Open it, click **Choose Device** → your Pi model
3. **Choose OS** → **Raspberry Pi OS (other)** → **Raspberry Pi OS Lite (64-bit)** (no desktop needed)
4. **Choose Storage** → your microSD card
5. Before clicking Write, click the **gear icon** (or "Edit Settings") to pre-configure:
   - Hostname: `athanpi` (so it'll be reachable as `athanpi.local`)
   - Enable SSH → with password authentication
   - Username + password: pick anything (e.g. `pi` / your-strong-password)
   - Configure Wi-Fi: SSID and password of your home network
   - Locale settings: your timezone
6. Click **Save**, then **Write**. Takes about 5 minutes.

## Step 2 — Boot the Pi

Insert the microSD, plug in power. The Pi boots and connects to your Wi-Fi automatically. First boot takes ~2 minutes.

## Step 3 — SSH in from your Mac

```bash
ssh pi@athanpi.local
```

(Substitute your username/hostname. If `.local` doesn't resolve, find the Pi's IP in your router's admin page and use that.)

First connection asks you to trust the host fingerprint — say yes.

## Step 4 — Clone and install

```bash
sudo apt-get update
sudo apt-get install -y git
git clone https://github.com/Ambekhie/athanframe.git
cd athanframe/pwa-bridge
./install.sh --install-only
```

The `--install-only` flag stops after installing dependencies — we don't want the bridge running in the foreground because we're about to register it as a systemd service.

This installs:
- `adb` (Android platform tools)
- `python3` + `python3-venv` (if missing)
- `qrencode` (for the QR code in the install banner)
- Python deps into `./bridge/.venv/`

Takes ~3–5 minutes on a Pi Zero 2 W.

## Step 5 — Register the bridge as a systemd service

```bash
sudo ./install-as-service.sh
```

This writes `/etc/systemd/system/athanframe.service`, enables it for boot, and starts it. You'll see the LAN URL printed at the end.

## Step 6 — Install the PWA on your phone

On your iPhone (same Wi-Fi), open Safari and go to the LAN URL the script printed (something like `http://192.168.1.42:8080`). Tap **Share → Add to Home Screen**.

On Android, use Chrome → ⋮ menu → **Install app**.

## You're done

The Pi will:
- Boot the bridge automatically on power-on
- Auto-discover your Athan Frame on the LAN at startup
- Restart the bridge if it crashes
- Survive your router reassigning the frame's DHCP IP

You can unplug the Pi, put it behind your TV or in a cabinet, and never touch it again.

## Useful commands (run on the Pi via SSH)

```bash
# Is it running?
systemctl status athanframe

# Live logs
journalctl -u athanframe -f

# Restart
sudo systemctl restart athanframe

# Stop / start
sudo systemctl stop athanframe
sudo systemctl start athanframe

# Update the bridge (pull latest code + restart)
cd ~/athanframe && git pull && sudo systemctl restart athanframe

# Uninstall the service (deps stay)
cd ~/athanframe/pwa-bridge && sudo ./install-as-service.sh remove
```

## Pinning the frame's IP (optional)

If your frame's DHCP lease keeps changing and you want to skip the auto-discovery delay on every boot, edit the service file:

```bash
sudo systemctl edit athanframe
```

Add:
```
[Service]
Environment=FRAME_IP=192.168.1.42
```

Save, then `sudo systemctl restart athanframe`. The bridge will use that IP directly instead of scanning.

Better still: configure a DHCP reservation in your router so the frame always gets the same IP.

## Troubleshooting

**`ssh pi@athanpi.local` fails:** mDNS not working on your network. Find the Pi's IP in your router's "Connected Devices" page and SSH to that.

**`./install.sh` apt-get errors:** `sudo apt-get update` first, then re-run.

**`systemctl status athanframe` shows "failed":** check `journalctl -u athanframe -n 50` for the exact error. Most common: venv missing (re-run `./install.sh --install-only`) or port 8080 already taken (`sudo lsof -i :8080`).

**Bridge can see itself but can't find the frame:** the Pi and the frame must be on the same Wi-Fi subnet. If your router has guest network isolation enabled, disable it for the frame and the Pi (or put both on the main network).

**Phone PWA shows "bridge offline":** check `journalctl -u athanframe -f` while you tap a button on the PWA. If you see no requests, your phone is on a different subnet than the Pi.

**Want to expose this beyond your LAN?** Don't port-forward 8080 — there's no auth. Use Tailscale instead: install on the Pi, install the Tailscale iOS/Android app, then access via the Pi's Tailscale IP from anywhere. See https://tailscale.com for details.
