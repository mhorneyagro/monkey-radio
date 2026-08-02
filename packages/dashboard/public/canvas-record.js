import { createVisualizer } from "./viz.js";
import { applyRootLogo } from "./logo.js";
import { updateNowPlayingStrip } from "./now-playing-strip.js";

const canvas = document.getElementById("viz");
const audio = document.getElementById("audio");
const logoGlow = document.getElementById("logo-glow");
const nowPlayingStrip = document.getElementById("now-playing-strip");
const container = document.querySelector(".youtube-canvas");

void applyRootLogo(document.querySelector(".logo"), "chrome");

const visualizer = createVisualizer({
  canvas,
  audio,
  logoGlow,
  container,
});

function trackIdFromPath() {
  const match = window.location.pathname.match(/\/canvas\/record\/([^/]+)/);
  return match?.[1] ?? null;
}

function moodEnergy(track) {
  if (typeof track.energy === "number") {
    return Math.max(1, Math.min(10, Math.round(track.energy * 10)));
  }
  return 5;
}

function failRecording(message) {
  window.__RECORDING_ERROR__ = message;
  window.__RECORDING_DONE__ = true;
  console.error("[record]", message);
}

function waitForCanPlay(element, timeoutMs = 12_000) {
  if (element.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error("Audio load timeout"));
    }, timeoutMs);

    function cleanup() {
      window.clearTimeout(timer);
      element.removeEventListener("canplay", onReady);
      element.removeEventListener("error", onError);
    }

    function onReady() {
      cleanup();
      resolve();
    }

    function onError() {
      cleanup();
      const message =
        element.error?.message ??
        "Failed to load because no supported source was found.";
      reject(new Error(message));
    }

    element.addEventListener("canplay", onReady, { once: true });
    element.addEventListener("error", onError, { once: true });
  });
}

function scheduleRecordingDone(fallbackSec) {
  const fromElement =
    Number.isFinite(audio.duration) && audio.duration > 0
      ? audio.duration
      : fallbackSec;
  const durationMs = Math.max(1, fromElement) * 1000 + 250;

  window.setTimeout(() => {
    window.__RECORDING_DONE__ = true;
  }, durationMs);
}

function markRecordingStarted(fallbackSec) {
  window.__RECORDING_SYNC_MS__ = performance.now();
  window.__RECORDING_STARTED__ = true;
  scheduleRecordingDone(fallbackSec);
}

async function startSyncedPlayback(fallbackSec) {
  await visualizer.resume();

  await new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error("Audio play timeout"));
    }, 8000);

    function cleanup() {
      window.clearTimeout(timeout);
      audio.removeEventListener("playing", onPlaying);
      audio.removeEventListener("error", onError);
    }

    function onPlaying() {
      cleanup();
      markRecordingStarted(fallbackSec);
      resolve();
    }

    function onError() {
      cleanup();
      reject(
        new Error(
          audio.error?.message ??
            "Failed to load because no supported source was found.",
        ),
      );
    }

    audio.addEventListener("playing", onPlaying, { once: true });
    audio.addEventListener("error", onError, { once: true });
    void audio.play().catch((error) => {
      cleanup();
      reject(error);
    });
  });
}

async function startRecording() {
  window.__RECORDING_PAGE_START_MS__ = performance.now();

  const trackId = trackIdFromPath();
  if (!trackId) {
    failRecording("Missing track id in URL");
    return;
  }

  try {
    const response = await fetch(`/api/tracks/${trackId}/record`);
    if (!response.ok) {
      failRecording(`Track API failed (${response.status})`);
      return;
    }

    const data = await response.json();
    const track = data.track;
    const fallbackSec = track.durationSec ?? 120;
    const playback = {
      playing: true,
      phase: "track",
      track: {
        title: track.title,
        genre: track.genre,
      },
      mood: {
        energy: moodEnergy(track),
      },
    };

    updateNowPlayingStrip(nowPlayingStrip, playback);
    visualizer.setMood({
      genre: track.genre,
      energy: moodEnergy(track),
    });

    audio.src = new URL(data.audioUrl, window.location.origin).href;
    audio.load();

    let audioReady = false;
    try {
      await waitForCanPlay(audio);
      audioReady = true;
    } catch (error) {
      console.warn(
        "[record] audio preview unavailable — capturing timed visualizer only",
        error,
      );
    }

    if (audioReady) {
      try {
        await startSyncedPlayback(fallbackSec);
      } catch (error) {
        console.warn(
          "[record] autoplay blocked — visualizer will run without live audio analysis",
          error,
        );
        markRecordingStarted(fallbackSec);
      }
    } else {
      markRecordingStarted(fallbackSec);
    }
  } catch (error) {
    failRecording(error instanceof Error ? error.message : String(error));
  }
}

window.__RECORDING_DONE__ = false;
window.__RECORDING_STARTED__ = false;
window.__RECORDING_ERROR__ = null;
window.__RECORDING_SYNC_MS__ = 0;
window.__RECORDING_PAGE_START_MS__ = 0;

void startRecording();
