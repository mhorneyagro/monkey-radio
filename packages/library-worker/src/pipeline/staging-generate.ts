import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { LibraryWorkerConfig } from "@monkey-radio/shared";
import { composeMusic } from "../elevenlabs/music-client.js";
import { suggestRandomGenre } from "../llm/suggest-genre.js";

export interface StagingManifestTrack {
  file: string;
  llmGenre: string;
  musicPrompt: string;
  durationMs: number;
  generatedAt: string;
}

export interface StagingManifest {
  stagingDir: string;
  tracks: StagingManifestTrack[];
  updatedAt: string;
}

function loadManifest(path: string, stagingDir: string): StagingManifest {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as StagingManifest;
  } catch {
    return { stagingDir, tracks: [], updatedAt: new Date().toISOString() };
  }
}

function saveManifest(path: string, manifest: StagingManifest): void {
  manifest.updatedAt = new Date().toISOString();
  writeFileSync(path, JSON.stringify(manifest, null, 2));
}

export interface GenerateStagingOptions {
  count: number;
}

export async function generateToStaging(
  config: LibraryWorkerConfig,
  options: GenerateStagingOptions,
): Promise<{ generated: number; stagingDir: string }> {
  if (!config.elevenLabsApiKey) {
    throw new Error("ELEVENLABS_API_KEY is required for music generation");
  }
  if (!config.openaiApiKey) {
    throw new Error("OPENAI_API_KEY is required for random genre selection");
  }

  mkdirSync(config.stagingPath, { recursive: true });
  const manifestPath = join(config.stagingPath, "manifest.json");
  const manifest = loadManifest(manifestPath, config.stagingPath);

  let generated = 0;

  for (let i = 0; i < options.count; i++) {
    console.log(`\n[${i + 1}/${options.count}] Asking LLM for a random genre...`);
    const suggestion = await suggestRandomGenre({
      openaiApiKey: config.openaiApiKey,
      llmModel: config.llmModel,
    });

    console.log(`Genre: ${suggestion.genre}`);
    console.log(`Prompt: ${suggestion.prompt}`);
    console.log("Generating with ElevenLabs Music API...");

    const composed = await composeMusic({
      apiKey: config.elevenLabsApiKey,
      prompt: suggestion.prompt,
      musicLengthMs: config.musicLengthMs,
      modelId: config.musicModelId,
      forceInstrumental: config.preferInstrumental,
    });

    const fileName = `${randomUUID()}.mp3`;
    const filePath = join(config.stagingPath, fileName);
    writeFileSync(filePath, composed.audio);

    const entry: StagingManifestTrack = {
      file: fileName,
      llmGenre: suggestion.genre,
      musicPrompt: suggestion.prompt,
      durationMs: composed.durationMs,
      generatedAt: new Date().toISOString(),
    };

    manifest.tracks.push(entry);
    saveManifest(manifestPath, manifest);

    generated++;
    console.log(`Saved → ${filePath} (${Math.round(composed.audio.length / 1024)} KB)`);
  }

  console.log(`\nDone — ${generated} track(s) in ${config.stagingPath}`);
  console.log("Next step:");
  console.log(`  npm run library:process-staging`);

  return { generated, stagingDir: config.stagingPath };
}
