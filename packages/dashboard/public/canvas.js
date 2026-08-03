import { createVisualizer } from "./viz.js";
import { createPlayback } from "./playback.js";
import { applyRootLogo } from "./logo.js";
import {
  extractMoodState,
  updateNowPlayingStrip,
} from "./now-playing-strip.js";
import { startAudienceTipToasts } from "./audience-tips.js";

const canvas = document.getElementById("viz");
const trackAudio = document.getElementById("audio");
const djAudio = document.getElementById("dj-audio");
const logoGlow = document.getElementById("logo-glow");
const startOverlay = document.getElementById("start-overlay");
const nowPlayingStrip = document.getElementById("now-playing-strip");
const tipToast = document.getElementById("tip-toast");
const container = document.querySelector(".youtube-canvas");

void applyRootLogo(document.querySelector(".logo"), "chrome");

startAudienceTipToasts(tipToast);

const playback = createPlayback({ trackAudio, djAudio });
const visualizer = createVisualizer({
  canvas,
  audio: trackAudio,
  logoGlow,
  container,
  audioHook: () => playback.getAudioHook(),
});

async function tryPlayAudio() {
  try {
    await playback.resume();
    await playback.getPrimaryAudio().play();
    startOverlay?.classList.add("hidden");
    return true;
  } catch {
    startOverlay?.classList.remove("hidden");
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
  if (result.needsUserGesture) {
    startOverlay?.classList.remove("hidden");
  } else {
    startOverlay?.classList.add("hidden");
  }
}

startOverlay?.addEventListener("click", async () => {
  await tryPlayAudio();
  await refreshNowPlaying();
});

playback.startTicking();
refreshNowPlaying();
setInterval(refreshNowPlaying, 500);
