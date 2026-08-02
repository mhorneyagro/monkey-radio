/**
 * @param {HTMLElement | null} root
 * @param {Record<string, unknown> | null | undefined} data
 */
export function updateNowPlayingStrip(root, data) {
  if (!root) return;

  const statusEl = root.querySelector("[data-strip-status]");
  const titleEl = root.querySelector("[data-strip-title]");

  if (!data?.playing) {
    root.hidden = true;
    return;
  }

  root.hidden = false;

  if (data.phase === "dj" && data.djSegment) {
    if (statusEl) statusEl.textContent = "DJ Monkey";
    if (titleEl) {
      const script = data.djSegment.scriptText ?? "";
      titleEl.textContent =
        script.length > 72 ? `${script.slice(0, 72)}…` : script;
    }
    return;
  }

  if (statusEl) statusEl.textContent = "Now playing";
  if (titleEl) titleEl.textContent = data.track?.title ?? "Untitled";
}

/**
 * @param {HTMLElement | null} root
 * @param {Record<string, unknown> | null | undefined} data
 */
export function updateSongLinkStrip(root, data) {
  if (!root) return;

  const labelEl = root.querySelector("[data-song-link-label]");

  const youtubeUrl =
    data?.phase === "track" && data.track && typeof data.track === "object"
      ? data.track.youtubeUrl
      : null;

  if (!data?.playing || data.phase !== "track" || typeof youtubeUrl !== "string" || !youtubeUrl) {
    root.hidden = true;
    return;
  }

  root.hidden = false;
  if (labelEl) {
    labelEl.textContent = "Take me to this song →";
  }
}

/**
 * @param {Record<string, unknown> | null | undefined} data
 */
export function extractMoodState(data) {
  if (!data?.playing) {
    return { genre: "lofi", energy: 5 };
  }

  let genre = "lofi";
  if (data.phase === "dj") {
    genre =
      (typeof data.mood?.nextGenre === "string" && data.mood.nextGenre) ||
      data.upcomingTrack?.genre ||
      "lofi";
  } else {
    genre = data.track?.genre ?? "lofi";
  }

  const energy =
    typeof data.mood?.energy === "number"
      ? data.mood.energy
      : data.phase === "dj"
        ? 6
        : 5;

  return { genre, energy };
}
