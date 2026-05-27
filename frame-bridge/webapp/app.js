// athanframe PWA — guided 3-step flow: Reciter → Surah → Player.
// Talks to the on-frame shell bridge at the same origin by default, with
// LAN rediscovery to survive frame IP changes (DHCP).

// `apiBase` is the absolute origin we send /api requests to. It's mutable
// because the frame's DHCP lease can shift across reboots; if our current
// base goes silent, discoverBridge() rescans the /24 and rewrites this.
// Default: relative (same origin as the page). Once we discover a working
// absolute origin, we switch to it (so an installed PWA that was opened
// from a stale cached origin can keep functioning).
let apiBase = "";  // empty string = use relative `/api` (same-origin)

function apiUrl(path) {
  return `${apiBase}/api${path}`;
}

// Try to remember the last working bridge across PWA reloads. We store the
// full origin (scheme://host:port) so we can drive fetches at it even if
// the PWA was opened from a dead origin.
const LS_KEY_BRIDGE = "athanframe.bridgeOrigin";
function rememberBridge(origin) {
  try { localStorage.setItem(LS_KEY_BRIDGE, origin); } catch {}
}
function recallBridge() {
  try { return localStorage.getItem(LS_KEY_BRIDGE) || ""; } catch { return ""; }
}

// Probe one candidate origin for a working bridge. Resolves to the origin
// on success, null on failure. 700ms timeout so a full /24 scan finishes
// in a few seconds even when most IPs are silent.
async function probeOrigin(origin, timeoutMs = 700) {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    const r = await fetch(`${origin}/api/config`, {
      signal: ctl.signal,
      cache: "no-store",
    });
    clearTimeout(t);
    if (!r.ok) return null;
    const cfg = await r.json().catch(() => null);
    // Only accept bridges that look like our on-frame variant.
    if (cfg && (cfg.on_device === true || cfg.has_frame === true)) return origin;
    return null;
  } catch {
    return null;
  }
}

// Last-resort LAN scan. Walks the /24 of the page's current host (or a
// reasonable fallback) and returns the first responsive bridge origin.
// Highly parallel to keep the worst case under ~2s on a typical /24.
async function discoverBridge() {
  // 1. Try last-known origin first — usually a one-RTT win after IP shift.
  const remembered = recallBridge();
  if (remembered) {
    const hit = await probeOrigin(remembered, 800);
    if (hit) return hit;
  }
  // 2. Try current page origin (works on every "first install" path where
  //    the user typed http://<ip>:8080).
  if (location.origin && location.origin !== "null") {
    const hit = await probeOrigin(location.origin, 800);
    if (hit) return hit;
  }
  // 3. Derive a scan subnet. Prefer the host of remembered/current origin;
  //    if that's an IP, scan its /24. If host is a name (.local etc.), we
  //    can't scan a subnet from a name, so skip.
  const hostsToScanFrom = [
    remembered && new URL(remembered).hostname,
    location.hostname,
  ].filter(Boolean);
  for (const h of hostsToScanFrom) {
    const m = /^(\d+\.\d+\.\d+)\.\d+$/.exec(h);
    if (!m) continue;
    const prefix = m[1];
    // Parallel-probe the whole /24. AbortController fires per-request.
    const candidates = [];
    for (let i = 1; i <= 254; i++) candidates.push(`http://${prefix}.${i}:8080`);
    // Race: first responder wins, others get garbage-collected by their
    // own timeouts. We still await all to find ANY responder in case
    // none of them race to first quickly.
    const results = await Promise.all(candidates.map(o => probeOrigin(o, 700)));
    const hit = results.find(Boolean);
    if (hit) return hit;
  }
  return null;
}

// Switch the active bridge origin to the discovered one and persist it.
function adoptBridge(origin) {
  apiBase = origin;
  rememberBridge(origin);
  console.info("athanframe: bridge adopted at", origin);
}

// Tracks an in-flight rediscovery so concurrent failing fetches share one.
let discoveryInFlight = null;
async function rediscoverOnce() {
  if (!discoveryInFlight) {
    discoveryInFlight = (async () => {
      try {
        const found = await discoverBridge();
        if (found) {
          if (found !== apiBase) {
            adoptBridge(found);
            toast("Frame found at " + new URL(found).host);
          }
          return found;
        }
        return null;
      } finally {
        // Allow another attempt after this one settles, so a later IP
        // change doesn't get blocked by the cached promise.
        setTimeout(() => { discoveryInFlight = null; }, 1000);
      }
    })();
  }
  return discoveryInFlight;
}

// Steps in the main flow (about is overlay, not in flow).
const STEPS = ["reciter", "surah", "player"];

// ---------------------------------------------------------------------------
// Canonical Arabic surah names (114), order = English surah_name array.
// ---------------------------------------------------------------------------
const SURAH_AR = [
  "الفاتحة","البقرة","آل عمران","النساء","المائدة","الأنعام","الأعراف","الأنفال",
  "التوبة","يونس","هود","يوسف","الرعد","إبراهيم","الحجر","النحل","الإسراء",
  "الكهف","مريم","طه","الأنبياء","الحج","المؤمنون","النور","الفرقان","الشعراء",
  "النمل","القصص","العنكبوت","الروم","لقمان","السجدة","الأحزاب","سبأ","فاطر",
  "يس","الصافات","ص","الزمر","غافر","فصلت","الشورى","الزخرف","الدخان",
  "الجاثية","الأحقاف","محمد","الفتح","الحجرات","ق","الذاريات","الطور","النجم",
  "القمر","الرحمن","الواقعة","الحديد","المجادلة","الحشر","الممتحنة","الصف",
  "الجمعة","المنافقون","التغابن","الطلاق","التحريم","الملك","القلم","الحاقة",
  "المعارج","نوح","الجن","المزمل","المدثر","القيامة","الإنسان","المرسلات",
  "النبأ","النازعات","عبس","التكوير","الانفطار","المطففين","الانشقاق","البروج",
  "الطارق","الأعلى","الغاشية","الفجر","البلد","الشمس","الليل","الضحى","الشرح",
  "التين","العلق","القدر","البينة","الزلزلة","العاديات","القارعة","التكاثر",
  "العصر","الهمزة","الفيل","قريش","الماعون","الكوثر","الكافرون","النصر","المسد",
  "الإخلاص","الفلق","الناس"
];

const state = {
  reciters: [],
  surahs: [],
  selectedReciter: null,
  selectedSurah: null,
  nowPlaying: null,
  isPlaying: false,    // tracks the merged play/pause button state
  volumePct: 60,
  step: "reciter",
};

// Reciter name to pre-select on first load. Matches the catalog's display name.
const DEFAULT_RECITER_NAME = "AbdulBaset AbdulSamad";

// ---------- DOM helpers ----------
const $  = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

function toast(msg, isError = false, ms = 2200) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.toggle("error", isError);
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.hidden = true; }, ms);
}

async function api(path, opts = {}) {
  const init = {
    method: opts.method || "GET",
    headers: { "Content-Type": "application/json" },
  };
  if (opts.body) init.body = JSON.stringify(opts.body);
  if (!opts.silent) setDot("busy");
  // One-shot retry: if the current base goes silent (typical after a DHCP
  // shift while the PWA was idle), kick off rediscovery and retry once.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch(apiUrl(path), init);
      if (!r.ok) {
        const text = await r.text().catch(() => "");
        throw new Error(`HTTP ${r.status} ${text || r.statusText}`);
      }
      if (!opts.silent) setDot("connected");
      return await r.json();
    } catch (e) {
      // Only attempt rediscovery on the first failure, and only for
      // network-level errors (TypeError from fetch). HTTP errors mean
      // the bridge is reachable but unhappy — no point rescanning.
      const isNetworkErr = (e && e.name === "TypeError");
      if (attempt === 0 && isNetworkErr && opts.rediscover !== false) {
        const found = await rediscoverOnce();
        if (found) continue;  // retry against new base
      }
      setDot("error");
      throw e;
    }
  }
}

// Fire-and-forget control call. No spinner thrash, no awaiting; we already
// updated the UI optimistically, the network is just confirmation.
function apiFire(path, body) {
  const init = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    keepalive: true,
  };
  if (body) init.body = JSON.stringify(body);
  return fetch(apiUrl(path), init).catch(e => {
    // Surface only network/server errors, not the optimistic action itself.
    console.warn("control call failed:", path, e);
    toast("Frame didn't respond", true, 1500);
    setDot("error");
    // Background rediscovery so the NEXT tap lands on the new IP without
    // the user noticing. We don't await — the current call is lost, but
    // the user will tap again momentarily.
    if (e && e.name === "TypeError") rediscoverOnce();
  });
}

// Bind a handler to fire on the earliest possible touch/pointer event, so
// the UI feels instant. Adds a `.pressed` flash and a light haptic on
// devices that support it. Falls back to `click` for non-pointer browsers.
function bindFastTap(el, handler) {
  if (!el) return;
  let fired = false;
  const trigger = (e) => {
    if (fired) return;
    fired = true;
    // Reset shortly so subsequent taps still fire; the boolean only guards
    // against the click that follows the same pointerdown.
    setTimeout(() => { fired = false; }, 300);
    el.classList.add("pressed");
    setTimeout(() => el.classList.remove("pressed"), 140);
    if (navigator.vibrate) { try { navigator.vibrate(8); } catch {} }
    e.preventDefault();
    handler(e);
  };
  el.addEventListener("pointerdown", trigger, { passive: false });
  // Click fallback for browsers without PointerEvent.
  el.addEventListener("click", trigger);
}

function setDot(s)        { const el = $("#dot"); if (el) el.dataset.state = s; }
function setStatusText(t) { const el = $("#status-text"); if (el) el.textContent = t; }

// ---------- Step machine ----------
function go(step) {
  state.step = step;
  renderStep();
}

function goBack() {
  const i = STEPS.indexOf(state.step);
  if (i > 0) {
    state.step = STEPS[i - 1];
    renderStep();
  }
}

function renderStep() {
  const target = state.step;
  $$(".panel").forEach(p => p.classList.toggle("active", p.id === `panel-${target}`));

  $("#steps").hidden = false;

  // Back button visible if there's somewhere to go back to
  $("#btn-back").hidden = STEPS.indexOf(state.step) === 0;

  // Mark step circles
  $$(".step").forEach(el => {
    const s = el.dataset.step;
    el.classList.remove("active", "done");
    const i = STEPS.indexOf(s);
    const cur = STEPS.indexOf(state.step);
    if (i < cur) el.classList.add("done");
    else if (i === cur) el.classList.add("active");
  });
  // Step lines
  $$(".step-line").forEach((ln, idx) => {
    const cur = STEPS.indexOf(state.step);
    ln.classList.toggle("done", idx < cur);
  });

  // Titles
  if (state.step === "reciter") {
    $("#step-title").textContent = "Choose a Reciter";
    $("#step-subtitle").textContent = "Step 1 of 3";
  } else if (state.step === "surah") {
    $("#step-title").textContent = "Choose a Surah";
    $("#step-subtitle").textContent = "Step 2 of 3";
  } else {
    $("#step-title").textContent = "Player";
    $("#step-subtitle").textContent = "Step 3 of 3";
  }

  renderNowBar();
}

// ---------- Now-bar: shows context + the next-step CTA ----------
function renderNowBar() {
  const title = $("#now-title");
  const sub   = $("#now-reciter");
  const acts  = $("#now-actions");
  acts.innerHTML = "";

  if (state.step === "reciter") {
    if (state.selectedReciter) {
      title.textContent = state.selectedReciter.name;
      sub.textContent = "Selected — next: surah";
      acts.appendChild(makeCTA("Next", () => go("surah")));
    } else {
      title.textContent = "Pick a reciter";
      sub.textContent = "Step 1 of 3";
      const btn = makeCTA("Next", null);
      btn.disabled = true;
      acts.appendChild(btn);
    }
    return;
  }

  if (state.step === "surah") {
    if (state.selectedSurah) {
      title.textContent = `${state.selectedSurah.index}. ${state.selectedSurah.name}`;
      sub.textContent = state.selectedReciter ? state.selectedReciter.name : "Pick a reciter";
      acts.appendChild(makeCTA("Next", () => go("player")));
    } else {
      title.textContent = "Pick a surah";
      sub.textContent = state.selectedReciter ? state.selectedReciter.name : "Step 2 of 3";
      const btn = makeCTA("Next", null);
      btn.disabled = true;
      acts.appendChild(btn);
    }
    return;
  }

  // Player step
  if (state.nowPlaying) {
    title.textContent = state.nowPlaying.surah;
    sub.textContent = state.nowPlaying.reciter;
  } else if (state.selectedReciter && state.selectedSurah) {
    title.textContent = `${state.selectedSurah.index}. ${state.selectedSurah.name}`;
    sub.textContent = state.selectedReciter.name;
  } else {
    title.textContent = "Ready";
    sub.textContent = "—";
  }
  // Player-step CTA: quick play if not already playing, otherwise pause/stop
  if (state.nowPlaying) {
    // Icon shows the NEXT ACTION a tap will perform (matches the main button).
    const nextIcon = state.isPlaying ? "pause" : "play";
    acts.appendChild(makeIconBtn(nextIcon, togglePlayPause, true));
    acts.appendChild(makeIconBtn("stop",  stop));
  } else {
    const playBtn = makeCTA("Play", play);
    playBtn.disabled = !(state.selectedReciter && state.selectedSurah);
    acts.appendChild(playBtn);
  }
}

function makeCTA(label, onClick) {
  const b = document.createElement("button");
  b.className = "cta";
  b.innerHTML = `${label} <span class="arrow">→</span>`;
  if (onClick) b.addEventListener("click", onClick);
  return b;
}

function makeIconBtn(kind, onClick, primary = false) {
  const b = document.createElement("button");
  b.className = "now-btn" + (primary ? " primary" : "");
  const svgs = {
    play:  '<svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>',
    pause: '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M6 5h4v14H6zm8 0h4v14h-4z"/></svg>',
    stop:  '<svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M6 6h12v12H6z"/></svg>',
  };
  b.innerHTML = svgs[kind] || "";
  if (onClick) bindFastTap(b, onClick);
  return b;
}

// ---------- Data load ----------
async function loadCatalog() {
  setStatusText("loading");
  try {
    const [r, s] = await Promise.all([api("/reciters"), api("/surahs")]);
    state.reciters = r.reciters;
    state.surahs   = s.surahs.map(it => ({ ...it, ar: SURAH_AR[it.index - 1] || "" }));

    // Pre-select default reciter (exact match, else case-insensitive fallback).
    if (!state.selectedReciter) {
      const exact = state.reciters.find(x => x.name === DEFAULT_RECITER_NAME);
      const loose = exact || state.reciters.find(
        x => x.name.toLowerCase() === DEFAULT_RECITER_NAME.toLowerCase()
      );
      if (loose) state.selectedReciter = loose;
    }

    renderReciters("");
    renderSurahs("");
    updatePlayer();
    renderNowBar();
    setStatusText("ready");
  } catch (e) {
    setStatusText("offline");
    toast("Cannot reach bridge: " + e.message, true, 4000);
  }
}

async function refreshStatus() {
  try {
    const s = await api("/status");
    if (s.connected) {
      setDot("connected");
      setStatusText("connected");
    } else {
      setDot("error");
      setStatusText("frame offline");
    }
    // Reconcile playing state from the frame so the UI shows what's
    // actually loaded — even on a fresh PWA load, or after next/prev
    // when our optimistic update was skipped (e.g. unknown surah name).
    // Server returns playing:null after /api/stop or before any play.
    if (s.playing && s.playing.reciter && s.playing.surah) {
      state.nowPlaying = { reciter: s.playing.reciter, surah: s.playing.surah };
    } else {
      // Don't override an in-flight optimistic update (just after the
      // user tapped play and we set isPlaying=true). Only clear when
      // we believe nothing is playing anyway.
      if (!state.isPlaying) state.nowPlaying = null;
    }
    renderNowBar();
    renderPlayPauseButton();
  } catch {
    setDot("error");
    setStatusText("bridge offline");
  }
}

// ---------- Rendering: reciters with alphabetical section markers ----------
function renderReciters(filter) {
  const root = $("#reciter-list");
  root.innerHTML = "";
  const f = filter.toLowerCase().trim();
  const items = state.reciters.filter(r => !f || r.name.toLowerCase().includes(f));
  if (items.length === 0) {
    root.innerHTML = '<div class="empty">No matches</div>';
    return;
  }
  let currentLetter = "";
  for (const r of items) {
    const letter = (r.name[0] || "").toUpperCase();
    if (letter !== currentLetter) {
      currentLetter = letter;
      const hdr = document.createElement("div");
      hdr.className = "section-letter";
      hdr.textContent = letter;
      root.appendChild(hdr);
    }
    const el = document.createElement("div");
    el.className = "reciter-item";
    if (state.selectedReciter && state.selectedReciter.name === r.name) {
      el.classList.add("selected");
    }
    el.innerHTML = `<span class="name">${escapeHtml(r.name)}</span><span class="check"></span>`;
    el.addEventListener("click", () => selectReciter(r));
    root.appendChild(el);
  }
}

// ---------- Rendering: surahs ----------
function renderSurahs(filter) {
  const root = $("#surah-grid");
  root.innerHTML = "";
  const f = filter.toLowerCase().trim();
  const items = state.surahs.filter(s =>
    !f || s.name.toLowerCase().includes(f) || String(s.index) === f
  );
  if (items.length === 0) {
    root.innerHTML = '<div class="empty" style="grid-column:1/-1">No matches</div>';
    return;
  }
  for (const s of items) {
    const cell = document.createElement("div");
    cell.className = "surah-cell";
    if (state.selectedSurah && state.selectedSurah.index === s.index) {
      cell.classList.add("selected");
    }
    cell.innerHTML = `
      <div class="surah-en">
        <span class="surah-num">${s.index}</span>
        <span class="surah-name">${escapeHtml(s.name)}</span>
      </div>
      <div class="surah-ar">${escapeHtml(s.ar)}</div>
    `;
    cell.addEventListener("click", () => selectSurah(s));
    root.appendChild(cell);
  }
}

// ---------- Selection: auto-advance through steps ----------
function selectReciter(r) {
  state.selectedReciter = r;
  renderReciters($("#reciter-search").value);
  // Update surah panel subhead to show context
  $("#surah-subhead").textContent = `Reciter: ${r.name}`;
  updatePlayer();
  // Auto-advance to surah step
  setTimeout(() => go("surah"), 180);
}

function selectSurah(s) {
  state.selectedSurah = s;
  renderSurahs($("#surah-search").value);
  updatePlayer();
  // Auto-advance to player step
  setTimeout(() => go("player"), 180);
}

function updatePlayer() {
  const title   = $("#player-title");
  const reciter = $("#player-reciter");
  const arabic  = $("#player-arabic");
  if (state.selectedSurah) {
    title.textContent = `${state.selectedSurah.index}. ${state.selectedSurah.name}`;
    arabic.textContent = state.selectedSurah.ar || "سُورَة";
  } else {
    title.textContent = "No surah selected";
    arabic.textContent = "سُورَة";
  }
  reciter.textContent = state.selectedReciter
    ? state.selectedReciter.name
    : "Choose a reciter and a surah";
  renderPlayPauseButton();
}

function renderPlayPauseButton() {
  const btn = $("#btn-playpause");
  if (!btn) return;
  // Icon shows the NEXT ACTION a tap will perform.
  //   isPlaying === true  → next tap pauses → ⏸ (data-state="playing")
  //   isPlaying === false → next tap plays  → ▶ (data-state="paused")
  // CSS in style.css uses data-state to display exactly one of the two SVGs.
  const playing = state.isPlaying;
  btn.dataset.state = playing ? "playing" : "paused";
  btn.setAttribute("aria-label", playing ? "Pause" : "Play");
}

function setVolumeFill(pct) {
  state.volumePct = Math.max(0, Math.min(100, pct));
  $("#vol-fill").style.width = `${state.volumePct}%`;
}

// ---------- Actions ----------
async function play() {
  if (!state.selectedReciter || !state.selectedSurah) {
    toast("Pick a reciter and a surah first");
    return;
  }
  const body = { reciter: state.selectedReciter.name, surah: state.selectedSurah.name };

  // Optimistic UI: act as if it played, before the server confirms.
  state.nowPlaying = { reciter: body.reciter, surah: body.surah };
  state.isPlaying = true;
  renderPlayPauseButton();
  renderNowBar();
  toast(`▶ ${body.surah}`);

  try {
    const r = await api("/play", { method: "POST", body, silent: true });
    if (r && r.playing) state.nowPlaying = r.playing;
  } catch (e) {
    // Rollback on failure.
    state.nowPlaying = null;
    state.isPlaying = false;
    renderPlayPauseButton();
    renderNowBar();
    toast(e.message, true);
  }
}

function togglePlayPause() {
  // Decision is driven by isPlaying, not nowPlaying:
  //  - nowPlaying tells us WHAT was last loaded (may still be on screen, may
  //    have ended, or stop may have been called server-side meanwhile).
  //  - isPlaying tells us whether we believe audio is currently active.
  // If we're not playing, send a fresh broadcast (play()) — even if there's
  // a nowPlaying value. Re-broadcasting is the only reliable way to bring
  // the player UI back; tapping the pause coord on the prayer-times home
  // screen would land on random UI elements.
  if (!state.isPlaying) {
    // If we don't even have a target picked, play() will toast a hint.
    if (state.nowPlaying && (!state.selectedReciter || !state.selectedSurah)) {
      // Re-select what was last playing so play() can re-broadcast it.
      const r = state.reciters.find(x => x.name === state.nowPlaying.reciter);
      const s = state.surahs.find(x => x.name === state.nowPlaying.surah);
      if (r) state.selectedReciter = r;
      if (s) state.selectedSurah = s;
    }
    play();
    return;
  }
  // We believe audio is playing → pause it. Flip locally now; the server
  // tap will reach the frame momentarily.
  state.isPlaying = false;
  renderPlayPauseButton();
  renderNowBar();
  apiFire("/pause");
}

function nextSurah() {
  // Optimistic: predict the new surah from our local catalog so the user
  // sees the title flip instantly, before the server's broadcast confirms.
  let optimistic = false;
  if (state.nowPlaying && Array.isArray(state.surahs) && state.surahs.length) {
    const idx = state.surahs.findIndex(s => s.name === state.nowPlaying.surah);
    if (idx !== -1) {
      const nxt = state.surahs[(idx + 1) % state.surahs.length];
      state.nowPlaying = { reciter: state.nowPlaying.reciter, surah: nxt.name };
      state.isPlaying = true;
      renderPlayPauseButton();
      renderNowBar();
      optimistic = true;
    }
  }
  apiFire("/next");
  // Reconcile from frame in case we couldn't predict (no nowPlaying yet,
  // or surah name didn't match our catalog). Gives the frame ~600ms to
  // persist the new state.json before we re-read it.
  if (!optimistic) {
    setTimeout(refreshStatus, 600);
  }
}

function prevSurah() {
  let optimistic = false;
  if (state.nowPlaying && Array.isArray(state.surahs) && state.surahs.length) {
    const idx = state.surahs.findIndex(s => s.name === state.nowPlaying.surah);
    if (idx !== -1) {
      const len = state.surahs.length;
      const prv = state.surahs[(idx - 1 + len) % len];
      state.nowPlaying = { reciter: state.nowPlaying.reciter, surah: prv.name };
      state.isPlaying = true;
      renderPlayPauseButton();
      renderNowBar();
      optimistic = true;
    }
  }
  apiFire("/prev");
  if (!optimistic) {
    setTimeout(refreshStatus, 600);
  }
}

// ---- Volume: coalesce rapid taps into a single batched request ----
const VOL_STEP_PCT = 6;       // visual delta per tap
const VOL_FLUSH_MS = 140;     // how long to wait before sending the batch
let _volPending = 0;          // signed integer; +N means up by N, -N means down
let _volTimer = null;

function vol(direction) {
  // 1) Update UI immediately.
  const delta = direction === "up" ? +1 : -1;
  setVolumeFill(state.volumePct + delta * VOL_STEP_PCT);
  _volPending += delta;

  // 2) Coalesce: keep restarting the timer until taps stop coming, then
  //    send one HTTP request with the summed step count.
  clearTimeout(_volTimer);
  _volTimer = setTimeout(flushVolume, VOL_FLUSH_MS);
}

function flushVolume() {
  const pending = _volPending;
  _volPending = 0;
  _volTimer = null;
  if (pending === 0) return;
  const dir = pending > 0 ? "up" : "down";
  const steps = Math.min(30, Math.abs(pending));
  apiFire("/volume", { direction: dir, steps });
}

function stop() {
  // Optimistic close.
  state.nowPlaying = null;
  state.isPlaying = false;
  renderPlayPauseButton();
  renderNowBar();
  toast("⏹ stopped");
  apiFire("/stop");
}

// ---------- Utilities ----------
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

// ---------- Wire-up ----------
function init() {
  $("#btn-back").addEventListener("click", goBack);

  $("#reciter-search").addEventListener("input", e => renderReciters(e.target.value));
  $("#surah-search").addEventListener("input",   e => renderSurahs(e.target.value));

  // Merged play/pause toggle on the player panel — pointerdown for instant feel.
  bindFastTap($("#btn-playpause"), togglePlayPause);
  bindFastTap($("#btn-next"),      nextSurah);
  bindFastTap($("#btn-prev"),      prevSurah);
  bindFastTap($("#btn-stop"),      stop);
  bindFastTap($("#btn-vol-up"),    () => vol("up"));
  bindFastTap($("#btn-vol-down"),  () => vol("down"));

  // Quick-change shortcuts inside the player
  $("#change-reciter").addEventListener("click", () => go("reciter"));
  $("#change-surah").addEventListener("click",   () => go("surah"));

  // Setup overlay
  $("#setup-scan").addEventListener("click", runDiscovery);
  $("#setup-ip-save").addEventListener("click", saveManualIp);

  // Hardware back button on Android
  window.addEventListener("popstate", () => goBack());

  setVolumeFill(state.volumePct);
  updatePlayer();
  renderStep();

  // Gate the main app on having a configured frame.
  bootstrap();
}

// ---------- First-run setup / discovery ----------
async function bootstrap() {
  const setup = $("#setup-overlay");
  // Seed apiBase: if we remembered a working bridge from a previous
  // session AND it differs from the current page origin (e.g. the user
  // launched an installed PWA whose origin is now dead because DHCP
  // moved the frame), prefer the remembered one. Otherwise stay
  // same-origin and the api() rediscovery loop handles the rest.
  const remembered = recallBridge();
  if (remembered && remembered !== location.origin) {
    apiBase = remembered;
  }
  try {
    const cfg = await api("/config");
    // Adopt whichever origin actually answered as our new base of record.
    // If apiBase is empty (same-origin), record the page's own origin so
    // subsequent PWA launches from a dead origin know where to retry.
    if (cfg) {
      const winning = apiBase || location.origin;
      if (winning && /^https?:\/\//.test(winning)) rememberBridge(winning);
    }
    if (cfg.has_frame) {
      setup.hidden = true;
      loadCatalog();
      refreshStatus();
      setInterval(refreshStatus, 15000);
    } else {
      setup.hidden = false;
      // If discovery is already running (kicked off at server startup), reflect that.
      if (cfg.discovery_running) {
        setSetupStatus("Scanning your network for the Athan Frame…", "busy");
        pollDiscovery();
      }
    }
  } catch (e) {
    setup.hidden = false;
    setSetupStatus("Can't reach the bridge: " + e.message, "error");
  }
}

function setSetupStatus(text, kind) {
  const el = $("#setup-status");
  el.hidden = false;
  el.classList.remove("error", "ok");
  if (kind === "error") el.classList.add("error");
  if (kind === "ok")    el.classList.add("ok");
  const spinner = (kind === "busy") ? '<span class="setup-spinner"></span>' : "";
  el.innerHTML = `${spinner}<span>${escapeHtml(text)}</span>`;
}

async function runDiscovery() {
  const btn = $("#setup-scan");
  btn.disabled = true;
  setSetupStatus("Scanning your network… this can take up to 60 seconds.", "busy");
  try {
    const r = await api("/discover", { method: "POST" });
    if (r.ok && r.frame_ip) {
      setSetupStatus(`Found it at ${r.frame_ip}. Connecting…`, "ok");
      setTimeout(finishSetup, 600);
    } else {
      setSetupStatus(
        "No Athan Frame found on this network. Make sure it's powered on and connected to the same Wi-Fi, then try again. " +
        "Or enter the IP manually below.",
        "error"
      );
      btn.disabled = false;
    }
  } catch (e) {
    setSetupStatus("Scan failed: " + e.message, "error");
    btn.disabled = false;
  }
}

async function pollDiscovery() {
  // Server-side discovery is async; poll until it settles.
  while (true) {
    await new Promise(r => setTimeout(r, 1200));
    try {
      const cfg = await api("/config");
      if (cfg.has_frame) {
        setSetupStatus(`Found it at ${cfg.frame_ip}. Connecting…`, "ok");
        setTimeout(finishSetup, 500);
        return;
      }
      if (!cfg.discovery_running) {
        setSetupStatus(
          "No Athan Frame found yet. Tap Scan to try again, or enter the IP manually below.",
          "error"
        );
        return;
      }
    } catch (e) { /* keep polling */ }
  }
}

async function saveManualIp() {
  const ip = $("#setup-ip").value.trim();
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(ip)) {
    setSetupStatus("That doesn't look like a valid IP address.", "error");
    return;
  }
  // The bridge's discovery is the only IP-write path right now.
  // We piggyback on it by passing a hint via query string, but the
  // current backend ignores hints and re-scans. So we just kick off
  // discovery and rely on the user to ensure the frame is reachable.
  // Simpler: tell the user to set FRAME_IP env var if scan keeps failing.
  // For now we POST to a (future) /api/config endpoint; fall back to scan.
  try {
    const r = await fetch(apiUrl("/config"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ frame_ip: ip }),
    });
    if (r.ok) {
      setSetupStatus(`Saved ${ip}. Connecting…`, "ok");
      setTimeout(finishSetup, 500);
    } else {
      // POST /api/config isn't implemented yet -- fall back to a manual scan.
      setSetupStatus("Manual IP not yet supported by this bridge. Running a scan instead…", "busy");
      runDiscovery();
    }
  } catch (e) {
    setSetupStatus(e.message, "error");
  }
}

function finishSetup() {
  $("#setup-overlay").hidden = true;
  loadCatalog();
  refreshStatus();
  setInterval(refreshStatus, 15000);
}

document.addEventListener("DOMContentLoaded", init);
