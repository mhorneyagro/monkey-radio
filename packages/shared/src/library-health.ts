import type { MonkeyRadioDb } from "./db.js";
import { getReadyTrackCount, getReadyTrackCountByGenre } from "./db.js";
import { getAllGenreIds } from "./genres.js";

export interface LibraryHealthOptions {
  /** @deprecated Only used by legacy per-genre health checks. */
  requireAllGenres?: boolean;
}

export interface LibraryHealthResult {
  ok: boolean;
  deficits: Record<string, number>;
  readyCounts: Record<string, number>;
  totalReady?: number;
}

/** Legacy per-genre health — used by library:health with fixed genres. */
export function checkLibraryHealth(
  db: MonkeyRadioDb,
  minPerGenre = 10,
  options: LibraryHealthOptions = {},
): LibraryHealthResult {
  const requireAllGenres = options.requireAllGenres ?? true;
  const readyCounts = getReadyTrackCountByGenre(db);
  const deficits: Record<string, number> = {};

  for (const genre of getAllGenreIds()) {
    const count = readyCounts[genre] ?? 0;
    if (!requireAllGenres && count === 0) continue;
    if (count < minPerGenre) {
      deficits[genre] = minPerGenre - count;
    }
  }

  return {
    ok: Object.keys(deficits).length === 0,
    deficits,
    readyCounts,
    totalReady: getReadyTrackCount(db),
  };
}

/** Broadcast-ready check — minimum total tracks in the library. */
export function checkLibraryReady(
  db: MonkeyRadioDb,
  minTracks = 1,
): LibraryHealthResult {
  const totalReady = getReadyTrackCount(db);
  const ok = totalReady >= minTracks;

  return {
    ok,
    deficits: ok ? {} : { library: minTracks - totalReady },
    readyCounts: {},
    totalReady,
  };
}
