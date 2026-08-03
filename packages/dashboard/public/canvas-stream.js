/**
 * Production stream canvas — auto-starts audio without user gesture.
 * Used by stream-worker (headless Chromium + ffmpeg capture).
 */
import { createVisualizer } from "./viz.js";
import { createPlayback } from "./playback.js";
import { applyRootLogo } from "./logo.js";
import { extractMoodState, updateNowPlayingStrip } from "./now-playing-strip.js";

const canvas = document.getElementById("viz");
const trackAudio = document.getElementById("audio");
const djAudio = document.getElementById("dj-audio");
const logoGlow = document.getElementById("logo-glow");
const nowPlayingStrip = document.getElementById("now-playing-strip");
const container = document.querySelector(".youtube-canvas");

void applyRootLogo(document.querySelector(".logo"), "chrome");

const playback = createPlayback({ trackAudio, djAudio });
const visualizer = createVisualizer({
  canvas,
  audio: trackAudio,
  logoGlow,
  container,
  audioHook: () => playback.getAudioHook(),
});

window.__STREAM_READY__ = false;
window.__STREAM_LITE__ = true;

function unmuteAudioElements() {
  for (const el of [trackAudio, djAudio]) {
    el.muted = false;
    el.volume = 1;
  }
}

async function syncPlayback() {
  await playback.resume();
  unmuteAudioElements();
  playback.setVolume(1);
  const primary = playback.getPrimaryAudio();
  try {
    await primary.play();
    window.__STREAM_READY__ = true;
    return true;
  } catch (error) {
    console.warn("[stream] autoplay blocked, retrying…", error);
    return false;
  }
}

async function refreshNowPlaying() {
  const response = await fetch("/api/broadcast/now-playing?audioOrigin=local");
  const data = await response.json();

  updateNowPlayingStrip(nowPlayingStrip, data);
  visualizer.setMood(extractMoodState(data));

  if (!data.playing) return;

  const result = await playback.applyNowPlaying(data);
  unmuteAudioElements();
  await playback.resume();

  const primary = playback.getPrimaryAudio();
  if (primary.paused && !primary.ended) {
    try {
      await primary.play();
    } catch (error) {
      console.warn("[stream] play failed", error);
    }
  }

  if (!window.__STREAM_READY__) {
    const played = await syncPlayback();
    if (!played && !result.needsUserGesture) {
      await syncPlayback();
    }
  } else if (playback.isPlaying()) {
    window.__STREAM_READY__ = true;
  }
}

playback.startTicking();
await refreshNowPlaying();
setInterval(refreshNowPlaying, 500);

async function keepAudioAlive() {
  try {
    await playback.resume();
    unmuteAudioElements();
    playback.setVolume(1);

    const response = await fetch("/api/broadcast/now-playing?audioOrigin=local");
    const data = await response.json();
    if (!data.playing) return;

    const { audioContext } = playback.getAudioHook();
    const primary = playback.getPrimaryAudio();
    const stalled =
      primary.paused ||
      primary.ended ||
      audioContext.state === "suspended" ||
      !playback.isPlaying();

    if (!stalled) return;

    console.warn("[stream] audio stalled — recovering playback");
    await playback.applyNowPlaying(data);
    try {
      await primary.play();
      window.__STREAM_READY__ = true;
    } catch (error) {
      console.warn("[stream] keepalive play failed", error);
    }
  } catch (error) {
    console.warn("[stream] keepalive failed", error);
  }
}

// Chromium can suspend Web Audio after long runtime; recover without a full redeploy.
setInterval(() => void keepAudioAlive(), 15_000);

// Retry autoplay until stream worker sees __STREAM_READY__
const readyInterval = setInterval(async () => {
  if (window.__STREAM_READY__) {
    clearInterval(readyInterval);
    return;
  }
  unmuteAudioElements();
  await refreshNowPlaying();
  await syncPlayback();
}, 2000);
