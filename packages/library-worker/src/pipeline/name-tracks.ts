import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { LibraryWorkerConfig, MonkeyRadioDb } from "@monkey-radio/shared";
import { displayNameExists, openDatabase } from "@monkey-radio/shared";
import { generateTrackName } from "../llm/name-track.js";

interface AnalysisTrack {
  file: string;
  bpm: number;
  key: string;
  moods: Array<{ label: string; score: number }>;
  monkeyRadioGenre: { genre: string };
}

interface AnalysisFile {
  inputDir: string;
  tracks: AnalysisTrack[];
}

interface ManifestTrack {
  file: string;
  llmGenre: string;
  musicPrompt: string;
}

export interface NamesFileTrack {
  file: string;
  displayName: string;
  llmGenre: string;
}

export interface NamesFile {
  inputDir: string;
  tracks: NamesFileTrack[];
  updatedAt: string;
}

function loadJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function loadManifest(inputDir: string): Map<string, ManifestTrack> {
  const manifestPath = join(inputDir, "manifest.json");
  try {
    const manifest = loadJson<{ tracks?: ManifestTrack[] }>(manifestPath);
    return new Map((manifest.tracks ?? []).map((track) => [track.file, track]));
  } catch {
    return new Map();
  }
}

function loadNames(path: string, inputDir: string): NamesFile {
  try {
    return loadJson<NamesFile>(path);
  } catch {
    return { inputDir, tracks: [], updatedAt: new Date().toISOString() };
  }
}

function saveNames(path: string, names: NamesFile): void {
  names.updatedAt = new Date().toISOString();
  writeFileSync(path, JSON.stringify(names, null, 2));
}

export interface NameTracksOptions {
  analysisPath: string;
  databasePath?: string;
  force?: boolean;
}

export async function nameTracksFromAnalysis(
  config: LibraryWorkerConfig,
  options: NameTracksOptions,
): Promise<{ named: number; skipped: number; namesPath: string }> {
  if (!config.openaiApiKey) {
    throw new Error("OPENAI_API_KEY is required for track naming");
  }

  const analysis = loadJson<AnalysisFile>(options.analysisPath);
  const inputDir = analysis.inputDir;
  const namesPath = join(inputDir, "names.json");
  const manifest = loadManifest(inputDir);
  const names = loadNames(namesPath, inputDir);
  const existingByFile = new Map(names.tracks.map((track) => [track.file, track]));

  const db = options.databasePath
    ? openDatabase(options.databasePath)
    : null;

  let named = 0;
  let skipped = 0;

  for (const track of analysis.tracks) {
    const existing = existingByFile.get(track.file);
    if (existing && !options.force) {
      skipped++;
      continue;
    }

    const stagingMeta = manifest.get(track.file);
    const llmGenre = stagingMeta?.llmGenre ?? track.monkeyRadioGenre.genre;
    const musicPrompt = stagingMeta?.musicPrompt ?? llmGenre;
    const moodLabels = track.moods.slice(0, 5).map((m) => m.label);

    const takenNames = [
      ...names.tracks.map((entry) => entry.displayName),
      ...(db
        ? (db
            .prepare(`SELECT display_name, title FROM tracks WHERE status = 'ready'`)
            .all() as Array<{ display_name: string | null; title: string | null }>)
            .flatMap((row) => [row.display_name, row.title])
            .filter((value): value is string => Boolean(value))
        : []),
    ];

    console.log(`Naming ${track.file} (${llmGenre})...`);
    let displayName = await generateTrackName(
      {
        file: track.file,
        llmGenre,
        musicPrompt,
        bpm: track.bpm,
        key: track.key,
        moods: moodLabels,
        monkeyRadioGenre: track.monkeyRadioGenre.genre,
      },
      {
        openaiApiKey: config.openaiApiKey,
        llmModel: config.llmModel,
        existingNames: takenNames,
      },
    );

    if (db) {
      let attempt = 0;
      while (displayNameExists(db, displayName) && attempt < 3) {
        attempt++;
        displayName = await generateTrackName(
          {
            file: track.file,
            llmGenre,
            musicPrompt,
            bpm: track.bpm,
            key: track.key,
            moods: moodLabels,
            monkeyRadioGenre: track.monkeyRadioGenre.genre,
          },
          {
            openaiApiKey: config.openaiApiKey,
            llmModel: config.llmModel,
            existingNames: [...takenNames, displayName],
          },
        );
      }
    }

    const entry: NamesFileTrack = {
      file: track.file,
      displayName,
      llmGenre,
    };

    const index = names.tracks.findIndex((item) => item.file === track.file);
    if (index >= 0) {
      names.tracks[index] = entry;
    } else {
      names.tracks.push(entry);
    }

    saveNames(namesPath, names);
    named++;
    console.log(`  → "${displayName}"`);
  }

  db?.close();

  console.log(`\nDone — ${named} named, ${skipped} skipped`);
  console.log(`Names saved to ${namesPath}`);

  return { named, skipped, namesPath };
}
