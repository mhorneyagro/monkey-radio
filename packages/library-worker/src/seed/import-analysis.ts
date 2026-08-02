import { randomUUID } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync } from "node:fs";
import { basename, join } from "node:path";
import type { LibraryWorkerConfig, MonkeyRadioDb } from "@monkey-radio/shared";
import {
  buildSearchText,
  deleteTemporaryReadyTracks,
  deleteNonUserReadyTracks,
  deriveEnergyValence,
  getGenrePrompt,
  insertReadyTrack,
  resolveTrackAbsolutePath,
  trackExistsByExternalId,
} from "@monkey-radio/shared";

interface AnalysisTrack {
  file: string;
  youtubeId: string | null;
  durationSec: number;
  bpm: number;
  key: string;
  suggestedGenre: string;
  moods: Array<{ label: string; score: number }>;
  monkeyRadioGenre: {
    genre: string;
    confidence: number;
  };
}

interface AnalysisFile {
  inputDir: string;
  tracks: AnalysisTrack[];
}

function loadAnalysis(path: string): AnalysisFile {
  return JSON.parse(readFileSync(path, "utf8")) as AnalysisFile;
}

function cleanTitle(filename: string): string {
  const withoutExt = basename(filename, ".mp3");
  const withoutId = withoutExt.replace(/\s*\[[A-Za-z0-9_-]{11}\]\s*$/, "");
  const parts = withoutId.split(/[：:]/);
  return parts[0]?.trim() || withoutId.trim();
}

function resolveTrackGenre(
  track: AnalysisTrack,
  llmGenre: string | null,
): string {
  if (llmGenre) return llmGenre;
  return track.monkeyRadioGenre?.genre ?? track.suggestedGenre ?? "unknown";
}

function makeYouTubeExternalId(videoId: string): string {
  return `youtube:${videoId}`;
}

function makeGeneratedExternalId(fileName: string): string {
  return `generated:${fileName}`;
}

interface StagingManifestTrack {
  file: string;
  llmGenre: string;
  musicPrompt: string;
}

interface NamesFileTrack {
  file: string;
  displayName: string;
  llmGenre?: string;
}

function loadNamesFile(inputDir: string): Map<string, NamesFileTrack> {
  const namesPath = join(inputDir, "names.json");
  if (!existsSync(namesPath)) return new Map();

  try {
    const names = JSON.parse(readFileSync(namesPath, "utf8")) as {
      tracks?: NamesFileTrack[];
    };
    return new Map((names.tracks ?? []).map((track) => [track.file, track]));
  } catch {
    return new Map();
  }
}

function loadStagingManifest(inputDir: string): Map<string, StagingManifestTrack> {
  const manifestPath = join(inputDir, "manifest.json");
  if (!existsSync(manifestPath)) return new Map();

  try {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      tracks?: StagingManifestTrack[];
    };
    return new Map(
      (manifest.tracks ?? []).map((track) => [track.file, track]),
    );
  } catch {
    return new Map();
  }
}

export interface ImportAnalysisOptions {
  analysisPath: string;
  replaceTemporary?: boolean;
  dryRun?: boolean;
}

export function importFromAnalysis(
  db: MonkeyRadioDb,
  config: LibraryWorkerConfig,
  options: ImportAnalysisOptions,
): { imported: number; removed: number; skipped: number } {
  const analysis = loadAnalysis(options.analysisPath);
  const inputDir = analysis.inputDir;

  let removed = 0;
  if (options.replaceTemporary) {
    if (options.dryRun) {
      console.log("[dry-run] would remove temporary Internet Archive tracks");
      console.log("[dry-run] would remove non-user (mock) tracks");
    } else {
      removed += deleteTemporaryReadyTracks(db);
      removed += deleteNonUserReadyTracks(db);
      console.log(`Removed ${removed} old track(s) from library`);
    }
  }

  let imported = 0;
  let skipped = 0;
  const stagingManifest = loadStagingManifest(inputDir);
  const namesFile = loadNamesFile(inputDir);

  for (const track of analysis.tracks) {
    const sourcePath = join(inputDir, track.file);
    if (!existsSync(sourcePath)) {
      console.warn(`  skip (file missing): ${track.file}`);
      skipped++;
      continue;
    }

    const stagingMeta = stagingManifest.get(track.file);
    const nameMeta = namesFile.get(track.file);
    const youtubeId = track.youtubeId;
    const externalId = youtubeId
      ? makeYouTubeExternalId(youtubeId)
      : makeGeneratedExternalId(track.file);

    if (trackExistsByExternalId(db, externalId)) {
      const label = nameMeta?.displayName ?? stagingMeta?.llmGenre ?? cleanTitle(track.file);
      console.log(`  skip (already imported): ${label}`);
      skipped++;
      continue;
    }

    const llmGenre = nameMeta?.llmGenre ?? stagingMeta?.llmGenre ?? null;
    const genre = resolveTrackGenre(track, llmGenre);
    const displayName =
      nameMeta?.displayName ?? stagingMeta?.llmGenre ?? cleanTitle(track.file);
    const prompt = stagingMeta?.musicPrompt ?? getGenrePrompt(genre) ?? genre;
    const moodLabels = track.moods.slice(0, 5).map((m) => m.label);
    const { energy, valence } = deriveEnergyValence(track.moods);
    const youtubeUrl = youtubeId
      ? `https://www.youtube.com/watch?v=${youtubeId}`
      : null;
    const searchText = buildSearchText({
      displayName,
      title: displayName,
      genre,
      llmGenre,
      prompt,
      moods: moodLabels,
      bpm: track.bpm,
      musicalKey: track.key,
    });

    if (options.dryRun) {
      console.log(`  [dry-run] ${displayName} → ${genre}`);
      imported++;
      continue;
    }

    const trackId = randomUUID();
    const trackDir = join(config.libraryPath, "tracks");
    mkdirSync(trackDir, { recursive: true });

    const fileName = `${trackId}.mp3`;
    const absolutePath = join(trackDir, fileName);
    const relativePath = join("library", "tracks", fileName).replace(/\\/g, "/");

    copyFileSync(sourcePath, absolutePath);

    insertReadyTrack(db, {
      id: trackId,
      genre,
      title: displayName,
      displayName,
      youtubeUrl,
      llmGenre,
      prompt,
      filePath: relativePath,
      durationSec: track.durationSec,
      externalId,
      bpm: track.bpm,
      musicalKey: track.key,
      energy,
      valence,
      searchText,
      moodTags: {
        source: youtubeId ? "youtube" : "elevenlabs",
        external_id: externalId,
        ...(youtubeId
          ? {
              youtube_video_id: youtubeId,
              youtube_url: youtubeUrl,
              user_owned: true,
            }
          : {}),
        llm_genre: llmGenre,
        bpm: track.bpm,
        key: track.key,
        moods: moodLabels,
        energy,
        valence,
        analyzed_genre: track.monkeyRadioGenre?.genre,
        analyzed_confidence: track.monkeyRadioGenre?.confidence,
      },
    });

    imported++;
    console.log(`  imported: ${displayName} → ${genre} (${Math.round(track.durationSec)}s)`);
  }

  if (options.replaceTemporary && !options.dryRun) {
    removeUnreferencedLibraryFiles(db, config);
  }

  return { imported, removed, skipped };
}

export function removeUnreferencedLibraryFiles(
  db: MonkeyRadioDb,
  config: LibraryWorkerConfig,
): number {
  const referenced = new Set(
    (
      db
        .prepare(`SELECT file_path FROM tracks WHERE file_path IS NOT NULL`)
        .all() as Array<{ file_path: string }>
    ).map((row) => resolveTrackAbsolutePath(config.libraryPath, row.file_path)),
  );

  let removed = 0;
  const libraryRoot = config.libraryPath;
  if (!existsSync(libraryRoot)) return 0;

  for (const file of walkMp3Files(libraryRoot)) {
    if (!referenced.has(file)) {
      unlinkSync(file);
      removed++;
    }
  }

  if (removed > 0) {
    console.log(`Removed ${removed} unreferenced MP3 file(s) from disk`);
  }

  return removed;
}

function walkMp3Files(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkMp3Files(fullPath));
    } else if (entry.isFile() && entry.name.endsWith(".mp3")) {
      results.push(fullPath);
    }
  }
  return results;
}
