/**
 * Production stream canvas — auto-starts audio without user gesture.
 * Used by stream-worker (headless Chromium + ffmpeg capture).
 */
import { createVisualizer } from "./viz.js";
import { createPlayback } from "./playback.js";
import { applyRootLogo } from "./logo.js";
import {
  extractMoodState,
  updateNowPlayingStrip,
} from "./now-playing-strip.js";

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
  const response = await fetch("/api/broadcast/now-playing");
  const data = await response.json();

  updateNowPlayingStrip(nowPlayingStrip, data);
  visualizer.setMood(extractMoodState(data));

  if (!data.playing) return;

  const result = await playback.applyNowPlaying(data);
  if (!window.__STREAM_READY__) {
    const played = await syncPlayback();
    if (!played && !result.needsUserGesture) {
      await syncPlayback();
    }
  }
}

playback.startTicking();
await refreshNowPlaying();
setInterval(refreshNowPlaying, 500);

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
