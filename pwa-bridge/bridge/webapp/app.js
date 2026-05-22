// athanframe PWA — guided 3-step flow: Reciter → Surah → Player.
// Talks to the local FastAPI bridge at the same origin.

const API = "/api";

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
  setDot("busy");
  try {
    const r = await fetch(`${API}${path}`, init);
    if (!r.ok) {
      const text = await r.text().catch(() => "");
      throw new Error(`HTTP ${r.status} ${text || r.statusText}`);
    }
    setDot("connected");
    return await r.json();
  } catch (e) {
    setDot("error");
    throw e;
  }
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
  if (onClick) b.addEventListener("click", onClick);
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
  try {
    const r = await api("/play", { method: "POST", body });
    state.nowPlaying = r.playing;
    state.isPlaying = true;
    toast(`▶ ${r.playing.surah}`);
    renderPlayPauseButton();
    renderNowBar();
  } catch (e) {
    toast(e.message, true);
  }
}

async function togglePlayPause() {
  // If nothing has been started yet, fire a fresh play (broadcast).
  if (!state.nowPlaying) {
    return play();
  }
  // Otherwise just toggle via the pause endpoint (UI tap).
  try {
    await api("/pause", { method: "POST" });
    state.isPlaying = !state.isPlaying;
    // Toast describes what just happened (the action that was performed).
    toast(state.isPlaying ? "▶ playing" : "⏸ paused");
    renderPlayPauseButton();
    renderNowBar();
  } catch (e) {
    toast(e.message, true);
  }
}

async function simple(path, label) {
  try {
    await api(path, { method: "POST" });
    if (label) toast(label);
  } catch (e) {
    toast(e.message, true);
  }
}

async function vol(direction) {
  try {
    await api("/volume", { method: "POST", body: { direction, steps: 2 } });
    setVolumeFill(state.volumePct + (direction === "up" ? 8 : -8));
  } catch (e) {
    toast(e.message, true);
  }
}

async function stop() {
  try {
    await api("/stop", { method: "POST" });
    state.nowPlaying = null;
    state.isPlaying = false;
    toast("⏹ stopped");
    renderPlayPauseButton();
    renderNowBar();
  } catch (e) {
    toast(e.message, true);
  }
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

  // Merged play/pause toggle on the player panel
  $("#btn-playpause").addEventListener("click", togglePlayPause);
  $("#btn-next").addEventListener("click", () => simple("/next", "⏭"));
  $("#btn-prev").addEventListener("click", () => simple("/prev", "⏮"));
  $("#btn-stop").addEventListener("click", stop);
  $("#btn-vol-up").addEventListener("click",   () => vol("up"));
  $("#btn-vol-down").addEventListener("click", () => vol("down"));

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
  try {
    const cfg = await api("/config");
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
    const r = await fetch(API + "/config", {
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
