"""
athanframe bridge — small FastAPI server that exposes the Athan Frame's
controls over HTTP so a phone (PWA) can drive it from the LAN.

Auto-discovers the frame on first run by scanning the local subnet for
ADB-over-WiFi (port 5555) devices and fingerprinting which one is the
Masjidal app. Caches the discovered IP for subsequent runs.

Endpoints:
    GET  /api/config        -> {frame, has_frame}
    POST /api/discover      -> kicks off a fresh scan; returns when done
    GET  /api/reciters      -> list of {name, slug}
    GET  /api/surahs        -> 114 surahs
    GET  /api/status        -> connection + foreground activity
    POST /api/play          -> {reciter, surah}
    POST /api/pause
    POST /api/stop
    POST /api/next
    POST /api/prev
    POST /api/volume        -> {direction, steps}
    POST /api/home
    GET  /api/screenshot
    GET  /                  -> serves the PWA
"""

from __future__ import annotations

import asyncio
import ipaddress
import json
import os
import re
import shlex
import socket
import time
from pathlib import Path
from typing import Optional

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

BASE_DIR    = Path(__file__).parent
CONFIG_FILE = BASE_DIR / "config.json"
CACHE_FILE  = BASE_DIR / "reciters_cache.json"
WEBAPP_DIR  = BASE_DIR / "webapp"

PKG = "com.masjidal.athanframe"
SCHEDULE_RECEIVER = f"{PKG}/{PKG}.schedular.ScheduleReceiver"
ALARM_TYPE_QURAN = 1
ADB_PORT = 5555

RECITERS_CATALOG_URL = (
    "https://masjidal.s3.us-east-2.amazonaws.com/audio/quran/data.json"
)
CACHE_TTL_SECONDS = 24 * 3600

# UI coordinates (1280x800). Must match the CLI script.
COORDS = {
    "plus":       (52, 705),
    "quran_tile": (640, 220),
    "close":      (1224, 33),
    "back":       (40, 33),
    "play_pause": (640, 584),
    "prev":       (456, 584),
    "next":       (824, 584),
    "vol_up":     (1205, 260),
    "vol_down":   (1205, 520),
}

# Canonical 114-surah list (from app's res/values/arrays.xml surah_name).
SURAHS = [
    "Al-Fatihah", "Al-Baqarah", "Al-Imran", "An-Nisa", "Al-Maidah",
    "Al-An\u2019am", "Al-A\u2019raf", "Al-Anfal", "At-Taubah", "Yunus",
    "Hud", "Yusuf", "Ar-Ra\u2019d", "Ibrahim", "Al-Hijr",
    "An-Nahl", "Al-Isra", "Al-Kahf", "Maryam", "Taha",
    "Al-Anbiya", "Al-Hajj", "Al-Mu\u2019minun", "An-Noor", "Al-Furqan",
    "Ash-Shuara", "An-Naml", "Al-Qasas", "Al-Ankabut", "Ar-Rum",
    "Luqman", "As-Sajdah", "Al-Ahzab", "Saba", "Fatir",
    "Ya-Sin", "As-Saaffat", "Sad", "Az-Zumar", "Ghafir",
    "Fussilat", "Ash-Shura", "Az-Zukhruf", "Ad-Dukhan", "Al-Jathiyah",
    "Al-Ahqaf", "Muhammad", "Al-Fath", "Al-Hujurat", "Qaf",
    "Adh-Dhariyat", "At-Tur", "An-Najm", "Al-Qamar", "Ar-Rahman",
    "Al-Waqi\u2019ah", "Al-Hadid", "Al-Mujadilah", "Al-Hashr", "Al-Mumtahanah",
    "As-Saff", "Al-Jumu\u2019ah", "Al-Munafiqun", "At-Taghabun", "At-Talaq",
    "At-Tahrim", "Al-Mulk", "Al-Qalam", "Al-Haaqqah", "Al-Ma\u2019arij",
    "Nuh", "Al-Jinn", "Al-Muzzammil", "Al-Muddaththir", "Al-Qiyamah",
    "Al-Insan", "Al-Mursalat", "An-Naba\u2019", "An-Nazi\u2019at", "Abasa",
    "At-Takwir", "Al-Infitar", "Al-Mutaffifin", "Al-Inshiqaq", "Al-Buruj",
    "At-Tariq", "Al-A\u2019la", "Al-Ghashiyah", "Al-Fajr", "Al-Balad",
    "Ash-Shams", "Al-Layl", "Ad-Dhuha", "As-Sharh", "At-Tin",
    "Al-\u2019Alaq", "Al-Qadr", "Al-Bayyinah", "Az-Zalzalah", "Al-\u2019Adiyat",
    "Al-Qari\u2019ah", "At-Takathur", "Al-Asr", "Al-Humazah", "Al-Fil",
    "Al-Quraish", "Al-Ma\u2019un", "Al-Kauther", "Al-Kafiroon", "An-Nasr",
    "Al-Masad", "Al-Ikhlas", "Al-Falaq", "An-Nas",
]
assert len(SURAHS) == 114

# ---------------------------------------------------------------------------
# Config (persistent: stores discovered frame IP)
# ---------------------------------------------------------------------------

def load_config() -> dict:
    if CONFIG_FILE.exists():
        try:
            return json.loads(CONFIG_FILE.read_text())
        except Exception:
            pass
    return {}

def save_config(cfg: dict) -> None:
    CONFIG_FILE.write_text(json.dumps(cfg, indent=2))

# Boot-time config: env var > saved config > nothing (triggers discovery)
_cfg = load_config()
FRAME_IP: Optional[str] = os.environ.get("FRAME_IP") or _cfg.get("frame_ip")

def frame_addr() -> Optional[str]:
    return f"{FRAME_IP}:{ADB_PORT}" if FRAME_IP else None

# Coordination lock so we never run two discoveries in parallel
_discovery_lock = asyncio.Lock()
_discovery_status = {"running": False, "last_scanned": 0, "last_found": None}

# ---------------------------------------------------------------------------
# Subprocess helpers
# ---------------------------------------------------------------------------

async def _run(cmd: list[str], timeout: float = 10.0) -> tuple[int, str, str]:
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        out, err = await asyncio.wait_for(proc.communicate(), timeout=timeout)
    except asyncio.TimeoutError:
        proc.kill()
        return 124, "", "timeout"
    return proc.returncode or 0, out.decode(errors="replace"), err.decode(errors="replace")


# ---------------------------------------------------------------------------
# Discovery
# ---------------------------------------------------------------------------

def _local_subnets() -> list[str]:
    """Return /24 networks for all non-loopback IPv4 interfaces on this host.
    Returns CIDR strings like '192.168.1.0/24'. Most home users only have one."""
    nets: list[str] = []
    try:
        # macOS / Linux: parse `ifconfig` to find inet addresses + netmasks
        rc, out, _ = (0, "", "")
        proc = os.popen("ifconfig 2>/dev/null || ip -4 -o addr")
        out = proc.read()
        proc.close()
        # Match either macOS style `inet 192.168.1.5 netmask 0xffffff00` or
        # Linux style `inet 192.168.1.5/24`
        for line in out.splitlines():
            m = re.search(r"inet\s+(\d+\.\d+\.\d+\.\d+)\s+netmask\s+0x([0-9a-fA-F]+)", line)
            if m:
                ip = m.group(1)
                if ip.startswith("127."): continue
                mask_hex = m.group(2)
                # convert mask hex to dotted to CIDR
                mask_int = int(mask_hex, 16)
                bits = bin(mask_int).count("1")
                net = ipaddress.ip_network(f"{ip}/{bits}", strict=False)
                if net.num_addresses <= 4096:  # safety
                    nets.append(str(net))
                continue
            m = re.search(r"inet\s+(\d+\.\d+\.\d+\.\d+)/(\d+)", line)
            if m:
                ip = m.group(1)
                if ip.startswith("127."): continue
                bits = int(m.group(2))
                net = ipaddress.ip_network(f"{ip}/{bits}", strict=False)
                if net.num_addresses <= 4096:
                    nets.append(str(net))
    except Exception:
        pass
    # De-duplicate, keep order
    seen = set()
    out_nets = []
    for n in nets:
        if n not in seen:
            seen.add(n)
            out_nets.append(n)
    return out_nets or ["192.168.1.0/24"]


async def _tcp_open(ip: str, port: int, timeout: float = 0.4) -> bool:
    """Async TCP connect probe (non-blocking)."""
    try:
        fut = asyncio.open_connection(ip, port)
        reader, writer = await asyncio.wait_for(fut, timeout=timeout)
        writer.close()
        try:
            await writer.wait_closed()
        except Exception:
            pass
        return True
    except Exception:
        return False


async def _is_athan_frame(ip: str) -> bool:
    """Connect via ADB and verify the Masjidal package is installed."""
    addr = f"{ip}:{ADB_PORT}"
    rc, _, _ = await _run(["adb", "connect", addr], timeout=4.0)
    if rc != 0:
        return False
    # Wait briefly for the device to appear
    await asyncio.sleep(0.3)
    rc, out, _ = await _run(["adb", "-s", addr, "shell", f"pm list packages {PKG}"], timeout=4.0)
    found = (PKG in (out or ""))
    if not found:
        # Disconnect so we don't keep a useless adb connection around
        await _run(["adb", "disconnect", addr], timeout=2.0)
    return found


async def discover_frame(verbose_log: list[str] | None = None) -> Optional[str]:
    """Scan local subnets for an Athan Frame. Returns the IP if found.
    Updates the in-memory + persisted config on success."""
    global FRAME_IP

    if _discovery_status["running"]:
        # Wait for the existing run to finish, then return its result.
        for _ in range(50):
            if not _discovery_status["running"]:
                break
            await asyncio.sleep(0.2)
        return _discovery_status.get("last_found")

    async with _discovery_lock:
        _discovery_status["running"] = True
        _discovery_status["last_scanned"] = int(time.time())
        try:
            subnets = _local_subnets()
            if verbose_log is not None:
                verbose_log.append(f"scanning subnets: {subnets}")
            candidates: list[str] = []
            # Phase 1: parallel TCP probes on 5555 across each subnet
            for cidr in subnets:
                net = ipaddress.ip_network(cidr, strict=False)
                ips = [str(h) for h in net.hosts()]
                # Bound parallelism so we don't open thousands of sockets
                sem = asyncio.Semaphore(64)
                async def probe(ip):
                    async with sem:
                        if await _tcp_open(ip, ADB_PORT):
                            candidates.append(ip)
                await asyncio.gather(*(probe(ip) for ip in ips))
            if verbose_log is not None:
                verbose_log.append(f"candidates with port {ADB_PORT}: {candidates}")
            # Phase 2: serially fingerprint each candidate (adb can only handle
            # one connect/shell at a time reliably).
            for ip in candidates:
                if await _is_athan_frame(ip):
                    if verbose_log is not None:
                        verbose_log.append(f"confirmed athan frame: {ip}")
                    FRAME_IP = ip
                    _cfg["frame_ip"] = ip
                    save_config(_cfg)
                    _discovery_status["last_found"] = ip
                    return ip
            _discovery_status["last_found"] = None
            return None
        finally:
            _discovery_status["running"] = False


# ---------------------------------------------------------------------------
# ADB helpers (target the current FRAME_IP)
# ---------------------------------------------------------------------------

async def adb_devices_has_frame() -> bool:
    if not FRAME_IP:
        return False
    rc, out, _ = await _run(["adb", "devices"])
    if rc != 0:
        return False
    target = frame_addr()
    return any(line.startswith(target) and line.endswith("device") for line in out.splitlines())


async def ensure_connected(auto_discover: bool = True) -> None:
    global FRAME_IP
    if not FRAME_IP and auto_discover:
        await discover_frame()
    if not FRAME_IP:
        raise HTTPException(status_code=503, detail="frame not configured; run discovery first")
    if await adb_devices_has_frame():
        return
    await _run(["adb", "connect", frame_addr()])
    await asyncio.sleep(0.4)
    if not await adb_devices_has_frame():
        # Cached IP may be stale (router reassigned DHCP). Try a re-scan once.
        if auto_discover:
            old = FRAME_IP
            FRAME_IP = None
            new_ip = await discover_frame()
            if new_ip:
                if await adb_devices_has_frame():
                    return
            # Restore old if discovery failed
            if not FRAME_IP:
                FRAME_IP = old
        raise HTTPException(status_code=503, detail=f"cannot connect to frame at {frame_addr()}")


async def adb_shell(command: str) -> str:
    await ensure_connected()
    rc, out, err = await _run(["adb", "-s", frame_addr(), "shell", command])
    if rc != 0:
        raise HTTPException(status_code=500, detail=f"adb shell failed: {err.strip()}")
    return out


async def tap(x: int, y: int, settle: float = 0.3) -> None:
    await adb_shell(f"input tap {x} {y}")
    await asyncio.sleep(settle)


async def bring_app_foreground() -> None:
    await adb_shell(f"monkey -p {PKG} -c android.intent.category.LAUNCHER 1")
    await asyncio.sleep(0.4)


async def broadcast_quran(reciter: str, surah: str) -> None:
    await bring_app_foreground()
    cmd = (
        f"am broadcast -n {SCHEDULE_RECEIVER} "
        f"--ei type {ALARM_TYPE_QURAN} "
        f"--es typeV {shlex.quote(reciter)} "
        f"--es typeS {shlex.quote(surah)}"
    )
    await adb_shell(cmd)


# ---------------------------------------------------------------------------
# Reciter catalog (cached on disk for 24h)
# ---------------------------------------------------------------------------

def _name_to_slug(name: str) -> str:
    out = []
    for ch in name.lower():
        if ch.isalnum():
            out.append(ch)
        elif ch in (" ", "-", "_"):
            out.append("-")
    s = "".join(out)
    while "--" in s:
        s = s.replace("--", "-")
    return s.strip("-")


async def fetch_reciters() -> list[dict]:
    if CACHE_FILE.exists():
        age = time.time() - CACHE_FILE.stat().st_mtime
        if age < CACHE_TTL_SECONDS:
            try:
                return json.loads(CACHE_FILE.read_text())
            except Exception:
                pass
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.get(RECITERS_CATALOG_URL)
            r.raise_for_status()
            raw = r.json()
        reciters = [
            {"name": entry["name"], "slug": _name_to_slug(entry["name"])}
            for entry in raw["data"]["reciter"]
        ]
        CACHE_FILE.write_text(json.dumps(reciters, indent=2, ensure_ascii=False))
        return reciters
    except Exception:
        if CACHE_FILE.exists():
            return json.loads(CACHE_FILE.read_text())
        raise HTTPException(status_code=502, detail="cannot fetch reciter catalog")


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------

app = FastAPI(title="athanframe bridge", version="1.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class PlayBody(BaseModel):
    reciter: str
    surah: str


class VolumeBody(BaseModel):
    direction: str
    steps: int = 3


class ConfigBody(BaseModel):
    frame_ip: str


@app.on_event("startup")
async def startup_discover():
    """If we don't have a saved IP, run discovery in the background so the
    PWA shows a 'looking…' state when it loads. Don't block startup.
    Set SKIP_AUTO_DISCOVER=1 to disable (useful for testing the setup overlay)."""
    if not FRAME_IP and not os.environ.get("SKIP_AUTO_DISCOVER"):
        asyncio.create_task(discover_frame())


@app.get("/api/config")
async def get_config():
    return {
        "frame_ip": FRAME_IP,
        "frame": frame_addr(),
        "has_frame": bool(FRAME_IP),
        "discovery_running": _discovery_status["running"],
        "last_scanned": _discovery_status["last_scanned"],
    }


@app.post("/api/config")
async def set_config(body: ConfigBody):
    """Manually set the frame IP. Verifies the device is reachable and is
    actually the Masjidal app before persisting."""
    global FRAME_IP
    ip = body.frame_ip.strip()
    if not re.match(r"^\d+\.\d+\.\d+\.\d+$", ip):
        raise HTTPException(status_code=400, detail="invalid IPv4 address")
    if not await _is_athan_frame(ip):
        raise HTTPException(
            status_code=400,
            detail=f"no Athan Frame reachable at {ip} (ADB on port {ADB_PORT} either closed or not the Masjidal app)",
        )
    FRAME_IP = ip
    _cfg["frame_ip"] = ip
    save_config(_cfg)
    return {"ok": True, "frame_ip": ip}


@app.post("/api/discover")
async def post_discover():
    log: list[str] = []
    ip = await discover_frame(verbose_log=log)
    return {
        "ok": ip is not None,
        "frame_ip": ip,
        "log": log,
    }


@app.get("/api/reciters")
async def get_reciters():
    return {"reciters": await fetch_reciters()}


@app.get("/api/surahs")
async def get_surahs():
    return {"surahs": [{"index": i + 1, "name": name} for i, name in enumerate(SURAHS)]}


@app.get("/api/status")
async def get_status():
    if not FRAME_IP:
        return JSONResponse(
            status_code=200,
            content={"connected": False, "frame": None, "error": "frame not configured"},
        )
    try:
        await ensure_connected()
        focus = await adb_shell("dumpsys window | grep mCurrentFocus")
        return {"connected": True, "frame": frame_addr(), "focus": focus.strip()}
    except HTTPException as e:
        return JSONResponse(
            status_code=200,
            content={"connected": False, "frame": frame_addr(), "error": e.detail},
        )


@app.post("/api/play")
async def post_play(body: PlayBody):
    if not body.reciter or not body.surah:
        raise HTTPException(status_code=400, detail="reciter and surah required")
    if body.surah not in SURAHS:
        raise HTTPException(status_code=400, detail=f"unknown surah: {body.surah}")
    await broadcast_quran(body.reciter, body.surah)
    return {"ok": True, "playing": {"reciter": body.reciter, "surah": body.surah}}


@app.post("/api/pause")
async def post_pause():
    await tap(*COORDS["play_pause"])
    return {"ok": True}


@app.post("/api/next")
async def post_next():
    await tap(*COORDS["next"])
    return {"ok": True}


@app.post("/api/prev")
async def post_prev():
    await tap(*COORDS["prev"])
    return {"ok": True}


@app.post("/api/stop")
async def post_stop():
    await tap(*COORDS["play_pause"])
    await asyncio.sleep(0.3)
    await tap(*COORDS["close"], settle=0.4)
    return {"ok": True}


@app.post("/api/volume")
async def post_volume(body: VolumeBody):
    if body.direction not in ("up", "down"):
        raise HTTPException(status_code=400, detail="direction must be 'up' or 'down'")
    coord = COORDS["vol_up"] if body.direction == "up" else COORDS["vol_down"]
    steps = max(1, min(20, body.steps))
    for _ in range(steps):
        await tap(*coord, settle=0.12)
    return {"ok": True, "direction": body.direction, "steps": steps}


@app.post("/api/home")
async def post_home():
    await tap(*COORDS["close"], settle=0.4)
    return {"ok": True}


@app.get("/api/screenshot")
async def get_screenshot():
    await ensure_connected()
    proc = await asyncio.create_subprocess_exec(
        "adb", "-s", frame_addr(), "exec-out", "screencap", "-p",
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    out, err = await proc.communicate()
    if proc.returncode != 0 or not out:
        raise HTTPException(status_code=500, detail=err.decode(errors="replace"))
    return Response(content=out, media_type="image/png")


# ---------------------------------------------------------------------------
# Static / PWA
# ---------------------------------------------------------------------------

if WEBAPP_DIR.exists():
    app.mount("/static", StaticFiles(directory=WEBAPP_DIR), name="static")


@app.get("/")
async def serve_index():
    index = WEBAPP_DIR / "index.html"
    if not index.exists():
        return JSONResponse({"error": "webapp not built"}, status_code=404)
    return FileResponse(index)


@app.get("/manifest.json")
async def serve_manifest():
    f = WEBAPP_DIR / "manifest.json"
    if not f.exists():
        raise HTTPException(status_code=404)
    return FileResponse(f, media_type="application/manifest+json")


@app.get("/icon-{size}.png")
async def serve_icon(size: str):
    f = WEBAPP_DIR / f"icon-{size}.png"
    if not f.exists():
        raise HTTPException(status_code=404)
    return FileResponse(f, media_type="image/png")
