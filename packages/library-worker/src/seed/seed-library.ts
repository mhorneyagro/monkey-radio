import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { GenreId, LibraryWorkerConfig, MonkeyRadioDb } from "@monkey-radio/shared";
import {
  getAllGenreIds,
  getGenrePrompt,
  getReadyTrackCountByGenre,
  insertReadyTrack,
  isValidGenre,
  trackExistsByExternalId,
} from "@monkey-radio/shared";
import {
  getArchiveDownloadUrl,
  getArchiveMetadata,
  getArchiveQueryForGenre,
  makeArchiveExternalId,
  searchArchiveItems,
} from "./internet-archive.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function downloadMp3(url: string, destPath: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Download failed (${response.status}): ${url}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  writeFileSync(destPath, buffer);
}

export interface SeedLibraryOptions {
  tracksPerGenre: number;
  genres?: GenreId[];
  skipExisting?: boolean;
}

export async function seedLibraryFromArchive(
  db: MonkeyRadioDb,
  config: LibraryWorkerConfig,
  options: SeedLibraryOptions,
): Promise<void> {
  const genres = options.genres ?? getAllGenreIds();
  const readyCounts = getReadyTrackCountByGenre(db);

  for (const genre of genres) {
    const existing = readyCounts[genre] ?? 0;
    if (options.skipExisting !== false && existing >= options.tracksPerGenre) {
      console.log(
        `[${genre}] already has ${existing} ready tracks — skipping`,
      );
      continue;
    }

    const needed = options.tracksPerGenre - existing;
    console.log(`[${genre}] seeding ${needed} track(s) from Internet Archive...`);

    let downloaded = 0;
    let page = 1;

    while (downloaded < needed && page <= 10) {
      const items = await searchArchiveItems(getArchiveQueryForGenre(genre), page);
      if (items.length === 0) break;

      for (const item of items) {
        if (downloaded >= needed) break;

        const metadata = await getArchiveMetadata(item.identifier);
        if (!metadata) continue;

        for (const file of metadata.files) {
          if (downloaded >= needed) break;

          const externalId = makeArchiveExternalId(
            metadata.identifier,
            file.name,
          );
          if (trackExistsByExternalId(db, externalId)) continue;

          const trackId = randomUUID();
          const genreDir = join(config.libraryPath, genre);
          mkdirSync(genreDir, { recursive: true });

          const fileName = `${trackId}.mp3`;
          const absolutePath = join(genreDir, fileName);
          const relativePath = join("library", genre, fileName).replace(/\\/g, "/");
          const downloadUrl = getArchiveDownloadUrl(
            metadata.identifier,
            file.name,
          );

          try {
            await downloadMp3(downloadUrl, absolutePath);
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error);
            console.error(`  skip ${file.name}: ${message}`);
            continue;
          }

          const title = `${metadata.title} — ${file.name.replace(/\.mp3$/i, "")}`;
          insertReadyTrack(db, {
            id: trackId,
            genre,
            title,
            prompt: getGenrePrompt(genre) ?? genre,
            filePath: relativePath,
            durationSec: file.length,
            externalId,
            moodTags: {
              source: "internet-archive",
              external_id: externalId,
              archive_identifier: metadata.identifier,
              archive_filename: file.name,
              license: "various-cc-check-archive-item",
              temporary: true,
            },
          });

          downloaded++;
          console.log(`  [${genre}] ${downloaded}/${needed} — ${title}`);
          await sleep(300);
        }
      }

      page++;
    }

    if (downloaded < needed) {
      console.warn(
        `[${genre}] only seeded ${downloaded}/${needed} tracks — try again or add another source`,
      );
    }
  }
}

export function resolveSeedGenres(genreArg?: string): GenreId[] {
  if (!genreArg) return getAllGenreIds();
  if (!isValidGenre(genreArg)) {
    throw new Error(
      `Invalid genre "${genreArg}". Valid genres: ${getAllGenreIds().join(", ")}`,
    );
  }
  return [genreArg];
}
