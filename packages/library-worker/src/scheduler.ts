import { randomUUID } from "node:crypto";
import type { GenreId, LibraryWorkerConfig, MonkeyRadioDb } from "@monkey-radio/shared";
import {
  GENRES,
  getAllGenreIds,
  getReadyTrackCountByGenre,
  getTrackCountsByGenreAndStatus,
  insertGenerationJob,
  insertTrack,
  isValidGenre,
} from "@monkey-radio/shared";
import { processQueue } from "./queue.js";
import type { SunoProvider } from "./suno/client.js";

export interface FillLibraryOptions {
  tracksPerGenre: number;
  genres?: GenreId[];
  /** Skip genres already at target (default true). */
  skipExisting?: boolean;
}

function getInFlightTrackCountByGenre(
  db: MonkeyRadioDb,
): Record<string, number> {
  const byStatus = getTrackCountsByGenreAndStatus(db);
  const counts: Record<string, number> = {};

  for (const [genre, statuses] of Object.entries(byStatus)) {
    const pending = statuses.pending ?? 0;
    if (pending > 0) counts[genre] = pending;
  }

  return counts;
}

export async function fillLibrary(
  db: MonkeyRadioDb,
  provider: SunoProvider,
  config: LibraryWorkerConfig,
  options: FillLibraryOptions,
): Promise<void> {
  const genres = options.genres ?? getAllGenreIds();
  const readyCounts = getReadyTrackCountByGenre(db);
  const inFlightCounts = getInFlightTrackCountByGenre(db);
  let enqueued = 0;

  for (const genre of genres) {
    const genreDef = GENRES.find((g) => g.id === genre);
    if (!genreDef) continue;

    const ready = readyCounts[genre] ?? 0;
    const inFlight = inFlightCounts[genre] ?? 0;

    if (options.skipExisting !== false && ready >= options.tracksPerGenre) {
      console.log(
        `[${genre}] already has ${ready} ready track(s) — skipping`,
      );
      continue;
    }

    const needed = Math.max(
      0,
      options.tracksPerGenre - ready - inFlight,
    );
    if (needed === 0) {
      console.log(
        `[${genre}] ${ready} ready + ${inFlight} in-flight — at target`,
      );
      continue;
    }

    console.log(`[${genre}] enqueuing ${needed} generation job(s)...`);

    for (let i = 0; i < needed; i++) {
      const trackId = randomUUID();
      const jobId = randomUUID();

      insertTrack(db, {
        id: trackId,
        genre: genreDef.id,
        prompt: genreDef.prompt,
        status: "pending",
      });

      insertGenerationJob(db, {
        id: jobId,
        genre: genreDef.id,
        prompt: genreDef.prompt,
        trackId,
        status: "queued",
      });

      enqueued++;
    }
  }

  if (enqueued === 0) {
    console.log("Nothing to enqueue — library already meets targets.");
    return;
  }

  console.log(
    `Enqueued ${enqueued} generation job(s) across ${genres.length} genre(s)`,
  );

  await processQueue(db, provider, config);
}

export function resolveGenres(genreArg?: string): GenreId[] {
  if (!genreArg) return getAllGenreIds();
  if (!isValidGenre(genreArg)) {
    throw new Error(
      `Invalid genre "${genreArg}". Valid genres: ${getAllGenreIds().join(", ")}`,
    );
  }
  return [genreArg];
}
