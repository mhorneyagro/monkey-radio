/**
 * @param {HTMLElement | null} root
 * @param {Record<string, unknown> | null | undefined} data
 */
export function updateNowPlayingStrip(root, data) {
  if (!root) return;

  const statusEl = root.querySelector("[data-strip-status]");
  const genreEl = root.querySelector("[data-strip-genre]");
  const titleEl = root.querySelector("[data-strip-title]");

  if (!data?.playing) {
    root.hidden = true;
    return;
  }

  root.hidden = false;

  if (data.phase === "dj" && data.djSegment) {
    if (statusEl) statusEl.textContent = "DJ Monkey";
    if (genreEl) genreEl.textContent = "on air";
    if (titleEl) {
      const script = data.djSegment.scriptText ?? "";
      titleEl.textContent =
        script.length > 72 ? `${script.slice(0, 72)}…` : script;
    }
    return;
  }

  if (statusEl) statusEl.textContent = "Now playing";
  if (genreEl) genreEl.textContent = data.track?.genre ?? "—";
  if (titleEl) titleEl.textContent = data.track?.title ?? "Untitled";
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
