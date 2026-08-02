/**
 * Smooth radio playback: track fade-out overlapping DJ, instant next track.
 *
 * @param {{ trackAudio: HTMLAudioElement, djAudio: HTMLAudioElement }} options
 */
export function createPlayback({ trackAudio, djAudio }) {
  let audioContext = null;
  let analyser = null;
  let trackGain = null;
  let djGain = null;
  let masterGain = null;
  let fadeOutSec = 5;
  let masterVolume = 0.85;
  let tickTimer = null;
  let playbackState = null;
  let applyChain = Promise.resolve();
  let lastApplySignature = null;
  let syncedSignature = null;

  let loadedTrackKey = null;
  let loadedDjKey = null;
  let prefetchedTrackUrl = null;
  let prefetchedDjUrl = null;

  function ensureAudioGraph() {
    if (audioContext) return;

    audioContext = new AudioContext();
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.82;
    analyser.minDecibels = -90;
    analyser.maxDecibels = -10;

    masterGain = audioContext.createGain();
    trackGain = audioContext.createGain();
    djGain = audioContext.createGain();

    const trackSource = audioContext.createMediaElementSource(trackAudio);
    const djSource = audioContext.createMediaElementSource(djAudio);

    trackSource.connect(trackGain);
    djSource.connect(djGain);
    trackGain.connect(analyser);
    djGain.connect(analyser);
    analyser.connect(masterGain);
    masterGain.connect(audioContext.destination);

    masterGain.gain.value = masterVolume;
    trackGain.gain.value = 1;
    djGain.gain.value = 0;
  }

  function absoluteUrl(url) {
    return new URL(url, window.location.origin).href;
  }

  function buildApplySignature(data) {
    if (!data?.playing) return "offline";
    if (data.phase === "track" && data.track) {
      return `track:${data.track.id}:${data.track.startedAt ?? ""}`;
    }
    if (data.phase === "dj" && data.djSegment) {
      const outgoingId = data.outgoingTrack?.id ?? "none";
      return `dj:${data.djSegment.id}:${data.djSegment.startedAt ?? ""}:${outgoingId}`;
    }
    return "unknown";
  }

  function prefetch(url) {
    if (!url) return;
    const absolute = absoluteUrl(url);
    if (prefetchedTrackUrl === absolute || prefetchedDjUrl === absolute) return;

    const link = document.createElement("link");
    link.rel = "prefetch";
    link.as = "audio";
    link.href = absolute;
    document.head.appendChild(link);

    const probe = new Audio();
    probe.crossOrigin = "anonymous";
    probe.preload = "auto";
    probe.src = absolute;

    if (url.includes("/api/audio/dj/")) {
      prefetchedDjUrl = absolute;
    } else {
      prefetchedTrackUrl = absolute;
    }
  }

  function computeSyncOffset(startedAtIso, durationSec) {
    const startedAtMs = new Date(startedAtIso).getTime();
    return Math.min(
      Math.max(0, durationSec - 0.05),
      Math.max(0, (Date.now() - startedAtMs) / 1000),
    );
  }

  async function waitForMetadata(audioEl) {
    if (audioEl.readyState >= 1) return;
    await new Promise((resolve) => {
      audioEl.addEventListener("loadedmetadata", resolve, { once: true });
    });
  }

  async function syncElement(audioEl, startedAtIso, durationSec, force = false) {
    if (!startedAtIso || !durationSec) return;

    await waitForMetadata(audioEl);

    const offset = computeSyncOffset(startedAtIso, durationSec);
    if (force || Math.abs(audioEl.currentTime - offset) > 1.25) {
      audioEl.currentTime = offset;
    }
  }

  async function loadTrack(url, key) {
    const absolute = absoluteUrl(url);
    if (loadedTrackKey !== key) {
      trackAudio.crossOrigin = "anonymous";
      trackAudio.src = url;
      loadedTrackKey = key;
      await trackAudio.load();
    }
    return absolute;
  }

  async function loadDj(url, key) {
    const absolute = absoluteUrl(url);
    if (loadedDjKey !== key) {
      djAudio.crossOrigin = "anonymous";
      djAudio.src = url;
      loadedDjKey = key;
      await djAudio.load();
    }
    return absolute;
  }

  async function playElement(audioEl) {
    if (!audioEl.paused && !audioEl.ended) {
      return true;
    }

    try {
      await audioEl.play();
      return true;
    } catch {
      return false;
    }
  }

  function fadeTrackGain(nowMs) {
    if (!playbackState?.outgoingFade) {
      trackGain.gain.value = playbackState?.phase === "track" ? 1 : 0;
      return;
    }

    const { fadeStartedAtMs, fadeOutMs } = playbackState.outgoingFade;
    const elapsed = nowMs - fadeStartedAtMs;
    if (elapsed <= 0) {
      trackGain.gain.value = 1;
      return;
    }

    const progress = Math.min(1, elapsed / fadeOutMs);
    trackGain.gain.value = Math.max(0, 1 - progress);
  }

  function updateUpcomingMetadata(data) {
    if (!playbackState) return;

    if (data.phase === "track") {
      playbackState.upcomingTrack = data.upcomingTrack ?? null;
      playbackState.upcomingDj = data.upcomingDj ?? null;
      return;
    }

    if (data.phase === "dj") {
      playbackState.upcomingTrack = data.upcomingTrack ?? null;
      playbackState.upcomingDj = null;
    }
  }

  async function startNextTrack(nowMs) {
    const next = playbackState?.upcomingTrack;
    if (!next?.audioUrl) return false;

    await loadTrack(next.audioUrl, `track:${next.id}`);
    trackAudio.currentTime = 0;
    trackGain.gain.value = 1;
    djGain.gain.value = 0;

    const played = await playElement(trackAudio);
    if (!played) return false;

    const signature = `track:${next.id}:local`;
    playbackState = {
      phase: "track",
      primary: "track",
      track: {
        id: next.id,
        startedAtMs: nowMs,
        durationSec: next.durationSec ?? 0,
      },
      dj: null,
      upcomingTrack: null,
      upcomingDj: null,
      outgoingFade: null,
    };
    loadedDjKey = null;
    lastApplySignature = signature;
    syncedSignature = signature;
    return true;
  }

  async function applyNowPlayingInner(data) {
    if (!data?.playing) {
      playbackState = null;
      lastApplySignature = "offline";
      syncedSignature = null;
      return { needsUserGesture: false };
    }

    ensureAudioGraph();
    fadeOutSec = data.timing?.fadeOutSec ?? 5;

    const signature = buildApplySignature(data);
    if (signature === lastApplySignature && playbackState) {
      updateUpcomingMetadata(data);
      return { needsUserGesture: false };
    }

    lastApplySignature = signature;
    const nowMs = Date.now();
    const shouldSync = syncedSignature !== signature;

    if (data.phase === "track" && data.track) {
      if (playbackState?.phase === "dj" && playbackState.dj) {
        updateUpcomingMetadata(data);
        return { needsUserGesture: false };
      }

      const trackKey = `track:${data.track.id}`;
      await loadTrack(data.audioUrl, trackKey);
      if (shouldSync) {
        await syncElement(
          trackAudio,
          data.track.startedAt,
          data.track.durationSec ?? 0,
          true,
        );
        syncedSignature = signature;
      }

      trackGain.gain.value = 1;
      djGain.gain.value = 0;

      const played = await playElement(trackAudio);
      playbackState = {
        phase: "track",
        primary: "track",
        track: {
          id: data.track.id,
          startedAtMs: data.track.startedAt
            ? new Date(data.track.startedAt).getTime()
            : nowMs,
          durationSec: data.track.durationSec ?? 0,
        },
        dj: null,
        upcomingTrack: data.upcomingTrack ?? null,
        upcomingDj: data.upcomingDj ?? null,
        outgoingFade: null,
      };

      if (data.upcomingDj?.audioUrl) prefetch(data.upcomingDj.audioUrl);
      if (data.upcomingTrack?.audioUrl) prefetch(data.upcomingTrack.audioUrl);

      return { needsUserGesture: !played };
    }

    if (data.phase === "dj" && data.djSegment) {
      if (
        playbackState?.phase === "track" &&
        playbackState.dj &&
        playbackState.dj.id === data.djSegment.id
      ) {
        updateUpcomingMetadata(data);
        fadeTrackGain(nowMs);
        return { needsUserGesture: false };
      }

      const djKey = `dj:${data.djSegment.id}`;
      await loadDj(data.audioUrl, djKey);
      if (shouldSync) {
        await syncElement(
          djAudio,
          data.djSegment.startedAt,
          data.djSegment.durationSec ?? 0,
          true,
        );
      }
      djGain.gain.value = 1;

      let outgoingFade = null;
      if (data.outgoingTrack?.fadeStartedAt && fadeOutSec > 0) {
        const fadeStartedAtMs = new Date(
          data.outgoingTrack.fadeStartedAt,
        ).getTime();
        const fadeOutMs = (data.outgoingTrack.fadeOutSec ?? fadeOutSec) * 1000;
        const fadeEndMs = fadeStartedAtMs + fadeOutMs;

        if (nowMs < fadeEndMs + 250) {
          const trackKey = `track:${data.outgoingTrack.id}`;
          await loadTrack(data.outgoingTrack.audioUrl, trackKey);
          if (shouldSync) {
            await syncElement(
              trackAudio,
              data.outgoingTrack.startedAt,
              data.outgoingTrack.durationSec ?? 0,
              true,
            );
          }
          await playElement(trackAudio);
          outgoingFade = { fadeStartedAtMs, fadeOutMs };
        } else {
          trackGain.gain.value = 0;
        }
      } else {
        trackGain.gain.value = 0;
      }

      if (shouldSync) {
        syncedSignature = signature;
      }

      fadeTrackGain(nowMs);
      const played = await playElement(djAudio);

      const djStartedAtMs = data.djSegment.startedAt
        ? new Date(data.djSegment.startedAt).getTime()
        : nowMs;

      playbackState = {
        phase: "dj",
        primary: "dj",
        track: data.outgoingTrack
          ? {
              id: data.outgoingTrack.id,
              startedAtMs: data.outgoingTrack.startedAt
                ? new Date(data.outgoingTrack.startedAt).getTime()
                : nowMs,
              durationSec: data.outgoingTrack.durationSec ?? 0,
            }
          : null,
        dj: {
          id: data.djSegment.id,
          startedAtMs: djStartedAtMs,
          durationSec: data.djSegment.durationSec ?? 0,
        },
        upcomingTrack: data.upcomingTrack ?? null,
        upcomingDj: null,
        outgoingFade,
      };

      if (data.upcomingTrack?.audioUrl) prefetch(data.upcomingTrack.audioUrl);

      return { needsUserGesture: !played };
    }

    return { needsUserGesture: false };
  }

  function applyNowPlaying(data) {
    applyChain = applyChain
      .then(() => applyNowPlayingInner(data))
      .catch((error) => {
        console.error("[playback] applyNowPlaying failed", error);
        return { needsUserGesture: false };
      });
    return applyChain;
  }

  async function tickLocalTransitions() {
    if (!playbackState) return;

    ensureAudioGraph();
    const nowMs = Date.now();

    if (playbackState.phase === "track" && playbackState.upcomingDj?.startsAt) {
      const startsAtMs = new Date(playbackState.upcomingDj.startsAt).getTime();
      const fadeOutMs = fadeOutSec * 1000;

      if (nowMs >= startsAtMs - 50) {
        if (playbackState.upcomingDj.audioUrl) {
          await loadDj(
            playbackState.upcomingDj.audioUrl,
            `dj:${playbackState.upcomingDj.id}`,
          );
          djAudio.currentTime = 0;
          djGain.gain.value = 1;
          await playElement(djAudio);
        }

        playbackState.outgoingFade = { fadeStartedAtMs: startsAtMs, fadeOutMs };
        playbackState.phase = "dj";
        playbackState.primary = "dj";
        playbackState.dj = {
          id: playbackState.upcomingDj.id,
          startedAtMs: startsAtMs,
          durationSec: playbackState.upcomingDj.durationSec ?? 0,
        };
        playbackState.upcomingDj = null;
        lastApplySignature = `dj:${playbackState.dj.id}:local:none`;
      }
    }

    fadeTrackGain(nowMs);

    if (playbackState.phase === "dj" && playbackState.dj) {
      const djEndMs =
        playbackState.dj.startedAtMs +
        playbackState.dj.durationSec * 1000;
      if (nowMs >= djEndMs - 80 && playbackState.upcomingTrack) {
        await startNextTrack(nowMs);
      }
    }
  }

  function startTicking() {
    if (tickTimer) return;
    tickTimer = window.setInterval(() => {
      void tickLocalTransitions();
    }, 100);
  }

  function stopTicking() {
    if (!tickTimer) return;
    window.clearInterval(tickTimer);
    tickTimer = null;
  }

  async function resume() {
    ensureAudioGraph();
    if (audioContext.state === "suspended") {
      await audioContext.resume();
    }
  }

  function setVolume(value) {
    masterVolume = value;
    if (masterGain) {
      masterGain.gain.value = value;
    } else {
      trackAudio.volume = value;
      djAudio.volume = value;
    }
  }

  function getPrimaryAudio() {
    if (!playbackState) return trackAudio;
    return playbackState.primary === "dj" ? djAudio : trackAudio;
  }

  function getPlaybackProgress() {
    if (!playbackState) {
      return { elapsed: 0, duration: 0, label: "track" };
    }

    const nowMs = Date.now();
    if (playbackState.phase === "dj" && playbackState.dj) {
      const elapsed = Math.max(
        djAudio.currentTime,
        (nowMs - playbackState.dj.startedAtMs) / 1000,
      );
      return {
        elapsed: Math.min(playbackState.dj.durationSec, elapsed),
        duration: playbackState.dj.durationSec,
        label: "dj",
      };
    }

    if (playbackState.track) {
      const elapsed = Math.max(
        trackAudio.currentTime,
        (nowMs - playbackState.track.startedAtMs) / 1000,
      );
      return {
        elapsed: Math.min(playbackState.track.durationSec, elapsed),
        duration: playbackState.track.durationSec,
        label: "track",
      };
    }

    return { elapsed: 0, duration: 0, label: "track" };
  }

  function getAudioHook() {
    ensureAudioGraph();
    return { audioContext, analyser };
  }

  function isPlaying() {
    const primary = getPrimaryAudio();
    return Boolean(primary && !primary.paused && !primary.ended);
  }

  return {
    applyNowPlaying,
    resume,
    setVolume,
    getPrimaryAudio,
    getPlaybackProgress,
    getAudioHook,
    isPlaying,
    startTicking,
    stopTicking,
  };
}
