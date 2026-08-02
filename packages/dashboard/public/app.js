import { createVisualizer } from "./viz.js";
import { createPlayback } from "./playback.js";
import { applyRootLogo } from "./logo.js";
import { initChatPanel } from "./chat.js";
import { initStatusPanel, getAdminHeaders } from "./status.js";
import {
  extractMoodState,
  updateNowPlayingStrip,
} from "./now-playing-strip.js";

const trackAudio = document.getElementById("audio");
const djAudio = document.getElementById("dj-audio");
const nowPlayingStrip = document.getElementById("now-playing-strip");
const playback = createPlayback({ trackAudio, djAudio });

void applyRootLogo(document.querySelector(".stream-logo"), "chrome");

const visualizer = createVisualizer({
  canvas: document.getElementById("stream-viz"),
  audio: trackAudio,
  logoGlow: document.getElementById("stream-logo-glow"),
  container: document.getElementById("stream-canvas-frame"),
  audioHook: () => playback.getAudioHook(),
});

const genreEl = document.getElementById("genre");
const titleEl = document.getElementById("title");
const metaEl = document.getElementById("meta");
const progressBar = document.getElementById("progress-bar");
const timeEl = document.getElementById("time");
const historyList = document.getElementById("history-list");
const djList = document.getElementById("dj-list");
const muteBtn = document.getElementById("mute-btn");
const skipTransitionBtn = document.getElementById("skip-transition-btn");
const volume = document.getElementById("volume");

let lastPhase = null;

function setMuteButtonState(state) {
  if (!muteBtn) return;
  muteBtn.dataset.state = state;
  const labels = {
    mute: "Mute",
    unmute: "Unmute",
    play: "Play",
  };
  muteBtn.setAttribute("aria-label", labels[state] ?? "Mute");
}

function formatTime(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

function updateProgress() {
  const { elapsed, duration } = playback.getPlaybackProgress();
  if (!duration) {
    progressBar.style.width = "0%";
    timeEl.textContent = "0:00 / 0:00";
    return;
  }

  const pct = Math.min(100, (elapsed / duration) * 100);
  progressBar.style.width = `${pct}%`;
  timeEl.textContent = `${formatTime(elapsed)} / ${formatTime(duration)}`;
}

async function tryPlayAudio() {
  try {
    await playback.resume();
    playback.setVolume(Number(volume.value));
    const primary = playback.getPrimaryAudio();
    await primary.play();
    setMuteButtonState(primary.muted ? "unmute" : "mute");
    return true;
  } catch {
    metaEl.textContent = "Click play to start audio";
    setMuteButtonState("play");
    return false;
  }
}

function updateNowPlayingUi(data) {
  if (!data.playing) {
    titleEl.textContent = "Broadcast worker not running";
    metaEl.textContent = "Run: npm run broadcast:start";
    genreEl.textContent = "—";
    lastPhase = null;
    return;
  }

  if (data.phase === "dj" && data.djSegment) {
    genreEl.textContent = "on air";
    titleEl.textContent = data.djSegment.scriptText;
    metaEl.textContent =
      typeof data.mood?.mood === "string"
        ? data.mood.mood
        : "Monkey Radio DJ segment";
    lastPhase = "dj";
    return;
  }

  if (data.track) {
    genreEl.textContent = data.track.genre;
    titleEl.textContent = data.track.title ?? "Untitled";
    metaEl.textContent = data.upcomingDj
      ? "DJ coming up…"
      : `Track ${data.track.id.slice(0, 8)}…`;
    lastPhase = "track";
  }
}

async function loadPlayback(data) {
  updateNowPlayingUi(data);
  updateNowPlayingStrip(nowPlayingStrip, data);
  visualizer.setMood(extractMoodState(data));
  if (skipTransitionBtn) {
    skipTransitionBtn.disabled = !(data.playing && data.phase === "track");
  }
  if (!data.playing) return;

  const result = await playback.applyNowPlaying(data);
  if (result.needsUserGesture) {
    metaEl.textContent = "Click play to start audio";
    setMuteButtonState("play");
  } else {
    setMuteButtonState(trackAudio.muted || djAudio.muted ? "unmute" : "mute");
  }
  updateProgress();
}

async function refreshNowPlaying() {
  const response = await fetch("/api/broadcast/now-playing");
  const data = await response.json();
  await loadPlayback(data);
}

async function refreshHistory() {
  const response = await fetch("/api/playback/recent?limit=10");
  const data = await response.json();

  if (!data.entries?.length) {
    historyList.innerHTML = `<li class="empty">No playback yet</li>`;
    return;
  }

  historyList.innerHTML = data.entries
    .map(
      (entry) => `
      <li>
        <strong>${entry.title ?? entry.track_id ?? "Unknown"}</strong>
        · ${entry.genre ?? "—"} · ${new Date(entry.played_at).toLocaleTimeString()}
      </li>
    `,
    )
    .join("");
}

async function refreshDjHistory() {
  const response = await fetch("/api/dj/recent?limit=5");
  const data = await response.json();

  if (!data.entries?.length) {
    djList.innerHTML = `<li class="empty">No DJ segments yet</li>`;
    return;
  }

  djList.innerHTML = data.entries
    .map(
      (entry) => `
      <li>
        <strong>DJ Monkey</strong>
        · ${new Date(entry.created_at).toLocaleTimeString()}
        <p class="dj-script">${entry.script_text}</p>
      </li>
    `,
    )
    .join("");
}

volume.addEventListener("input", () => {
  playback.setVolume(Number(volume.value));
  trackAudio.muted = false;
  djAudio.muted = false;
  setMuteButtonState("mute");
});

muteBtn.addEventListener("click", async () => {
  if (muteBtn.dataset.state === "play" || !playback.isPlaying()) {
    trackAudio.muted = false;
    djAudio.muted = false;
    await tryPlayAudio();
    await refreshNowPlaying();
    return;
  }

  const nextMuted = !trackAudio.muted;
  trackAudio.muted = nextMuted;
  djAudio.muted = nextMuted;
  setMuteButtonState(nextMuted ? "unmute" : "mute");
  if (!nextMuted) {
    await tryPlayAudio();
  }
});

playback.setVolume(Number(volume.value));
trackAudio.addEventListener("timeupdate", updateProgress);
djAudio.addEventListener("timeupdate", updateProgress);

skipTransitionBtn?.addEventListener("click", async () => {
  skipTransitionBtn.disabled = true;
  try {
    const response = await fetch("/api/broadcast/skip-to-transition", {
      method: "POST",
      headers: getAdminHeaders(),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      metaEl.textContent = data.error ?? "Could not skip track";
      return;
    }
    metaEl.textContent =
      data.mode === "dj_prep"
        ? `Skipped to DJ prep (~${data.secondsRemaining}s left on track)`
        : `Skipped to transition (~${data.secondsRemaining}s left)`;
    await refreshNowPlaying();
  } catch (error) {
    metaEl.textContent = String(error);
  }
});

async function tick() {
  try {
    await Promise.all([
      refreshNowPlaying(),
      refreshHistory(),
      refreshDjHistory(),
    ]);
    updateProgress();
  } catch (error) {
    titleEl.textContent = "Cannot reach dashboard";
    metaEl.textContent = String(error);
  }
}

playback.startTicking();
tick();
setInterval(() => {
  tick();
}, 500);
setInterval(updateProgress, 250);
initChatPanel();
initStatusPanel();
