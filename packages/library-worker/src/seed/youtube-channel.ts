import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import type { GenreId, LibraryWorkerConfig, MonkeyRadioDb } from "@monkey-radio/shared";
import {
  getGenrePrompt,
  insertReadyTrack,
  isValidGenre,
  trackExistsByExternalId,
} from "@monkey-radio/shared";

const execFileAsync = promisify(execFile);

interface FlatPlaylistEntry {
  id?: string;
  title?: string;
  duration?: number;
}

export interface ImportYouTubeChannelOptions {
  channelUrl: string;
  genre: GenreId;
  limit?: number;
  dryRun?: boolean;
}

function normalizeChannelUrl(url: string): string {
  const trimmed = url.trim().replace(/\/$/, "");
  if (trimmed.includes("/videos") || trimmed.includes("/playlists")) {
    return trimmed;
  }
  return `${trimmed}/videos`;
}

function makeYouTubeExternalId(videoId: string): string {
  return `youtube:${videoId}`;
}

async function listChannelVideos(channelUrl: string): Promise<FlatPlaylistEntry[]> {
  const normalized = normalizeChannelUrl(channelUrl);
  const { stdout } = await execFileAsync(
    "yt-dlp",
    ["--flat-playlist", "-j", normalized],
    { maxBuffer: 10 * 1024 * 1024 },
  );

  return stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as FlatPlaylistEntry)
    .filter((entry) => entry.id);
}

async function downloadVideoMp3(
  videoId: string,
  outputPath: string,
): Promise<void> {
  const outputBase = outputPath.replace(/\.mp3$/i, "");
  const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;

  await execFileAsync("yt-dlp", [
    "-x",
    "--audio-format",
    "mp3",
    "--audio-quality",
    "0",
    "--no-playlist",
    "--no-overwrites",
    "-o",
    `${outputBase}.%(ext)s`,
    watchUrl,
  ]);

  if (!existsSync(outputPath)) {
    throw new Error(`Expected MP3 at ${outputPath}`);
  }
}

async function probeDurationSec(filePath: string): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "csv=p=0",
      filePath,
    ]);
    const value = Number(stdout.trim());
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function importYouTubeChannel(
  db: MonkeyRadioDb,
  config: LibraryWorkerConfig,
  options: ImportYouTubeChannelOptions,
): Promise<{ downloaded: number; skipped: number }> {
  if (!isValidGenre(options.genre)) {
    throw new Error(`Invalid genre "${options.genre}"`);
  }

  console.log(`Listing videos from ${normalizeChannelUrl(options.channelUrl)}...`);
  const videos = await listChannelVideos(options.channelUrl);
  const selected = options.limit ? videos.slice(0, options.limit) : videos;

  console.log(`Found ${videos.length} video(s), processing ${selected.length}.`);

  let downloaded = 0;
  let skipped = 0;
  const genreDir = join(config.libraryPath, options.genre);
  mkdirSync(genreDir, { recursive: true });

  for (const video of selected) {
    const videoId = video.id!;
    const externalId = makeYouTubeExternalId(videoId);
    const title = video.title?.trim() || videoId;

    if (trackExistsByExternalId(db, externalId)) {
      console.log(`  skip (already in library): ${title}`);
      skipped++;
      continue;
    }

    const trackId = randomUUID();
    const fileName = `${trackId}.mp3`;
    const absolutePath = join(genreDir, fileName);
    const relativePath = join("library", options.genre, fileName).replace(
      /\\/g,
      "/",
    );

    if (options.dryRun) {
      console.log(`  [dry-run] would download: ${title}`);
      continue;
    }

    try {
      console.log(`  downloading: ${title}`);
      await downloadVideoMp3(videoId, absolutePath);

      const durationSec =
        (await probeDurationSec(absolutePath)) ?? video.duration ?? null;

      insertReadyTrack(db, {
        id: trackId,
        genre: options.genre,
        title,
        prompt: getGenrePrompt(options.genre) ?? options.genre,
        filePath: relativePath,
        durationSec,
        externalId,
        moodTags: {
          source: "youtube",
          external_id: externalId,
          youtube_video_id: videoId,
          youtube_url: `https://www.youtube.com/watch?v=${videoId}`,
          user_owned: true,
        },
      });

      downloaded++;
      console.log(
        `  saved: ${title} (${durationSec ? `${Math.round(durationSec)}s` : "unknown duration"})`,
      );
      await sleep(500);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`  failed: ${title} — ${message}`);
      if (existsSync(absolutePath)) {
        try {
          unlinkSync(absolutePath);
        } catch {
          // ignore cleanup errors
        }
      }
    }
  }

  return { downloaded, skipped };
}

export function resolveImportGenre(genreArg: string): GenreId {
  if (!isValidGenre(genreArg)) {
    throw new Error(
      `Invalid genre "${genreArg}". Valid genres: jazz, synthwave, lofi, ambient, funk, rock`,
    );
  }
  return genreArg;
}
