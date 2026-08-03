import type {
  BroadcastWorkerConfig,
  MonkeyRadioDb,
  Track,
  TrackSelectionHints,
} from "@monkey-radio/shared";
import {
  findTracks,
  getAllReadyTracks,
  getRecentlyPlayedTrackIds,
} from "@monkey-radio/shared";

const MIN_RANDOM_POOL = 15;
const MIN_HINT_POOL = 5;

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export interface SelectNextTrackOptions {
  excludeTrackId?: string;
  hints?: TrackSelectionHints;
  preferredStyle?: string;
}

function hasTrackHints(hints?: TrackSelectionHints): boolean {
  if (!hints) return false;
  return Boolean(
    hints.llmGenre || hints.nameContains || hints.mood || hints.energyLevel,
  );
}

export function selectNextTrack(
  db: MonkeyRadioDb,
  config: BroadcastWorkerConfig,
  options: SelectNextTrackOptions = {},
): Track {
  const allReady = getAllReadyTracks(db);
  if (allReady.length === 0) {
    throw new Error("No ready tracks in library");
  }

  const replayLimit = Math.min(
    config.avoidReplayLimit,
    Math.max(0, allReady.length - MIN_RANDOM_POOL),
  );
  const recent = new Set(getRecentlyPlayedTrackIds(db, replayLimit));
  if (options.excludeTrackId) recent.add(options.excludeTrackId);

  const excludeIds = [...recent];
  const style = options.hints?.llmGenre ?? options.preferredStyle;

  if (style || hasTrackHints(options.hints)) {
    const matched = findTracks(db, {
      llmGenre: style,
      nameContains: options.hints?.nameContains,
      moodContains: options.hints?.mood,
      energyLevel: options.hints?.energyLevel,
      excludeIds,
      limit: 20,
    });

    if (matched.length >= MIN_HINT_POOL) {
      return shuffle(matched)[0];
    }

    if (matched.length > 0) {
      console.log(
        `[playlist] hint pool too small (${matched.length} for "${style ?? "hints"}"), using full library`,
      );
    }
  }

  const candidates = allReady.filter((t) => !recent.has(t.id));
  const pool = candidates.length > 0 ? candidates : allReady;

  return shuffle(pool)[0];
}

export function trackStyle(track: Track): string {
  return track.llm_genre ?? track.genre;
}
