import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { LibraryWorkerConfig } from "@monkey-radio/shared";
import { openDatabase } from "@monkey-radio/shared";
import { importFromAnalysis } from "../seed/import-analysis.js";
import { nameTracksFromAnalysis } from "./name-tracks.js";

export interface ProcessStagingOptions {
  stagingDir?: string;
  skipAnalyze?: boolean;
  skipNaming?: boolean;
  replaceTemporary?: boolean;
  forceNames?: boolean;
  dryRun?: boolean;
}

function runAnalyze(repoRoot: string, stagingDir: string): void {
  const analysisPath = join(stagingDir, "analysis.json");
  const scriptPath = join(repoRoot, "scripts/analyze-audio.py");
  console.log(`Running audio analysis on ${stagingDir}...`);

  const result = spawnSync(
    "python3",
    [scriptPath, stagingDir, "-o", analysisPath],
    { stdio: "inherit", cwd: repoRoot },
  );

  if (result.status !== 0) {
    throw new Error("Audio analysis failed");
  }
}

export async function processStaging(
  repoRoot: string,
  config: LibraryWorkerConfig,
  options: ProcessStagingOptions = {},
): Promise<void> {
  const stagingDir = resolve(repoRoot, options.stagingDir ?? config.stagingPath);
  const analysisPath = join(stagingDir, "analysis.json");

  if (!existsSync(stagingDir)) {
    throw new Error(`Staging directory not found: ${stagingDir}`);
  }

  if (!options.skipAnalyze && !existsSync(analysisPath)) {
    runAnalyze(repoRoot, stagingDir);
  }

  if (!existsSync(analysisPath)) {
    throw new Error(
      `analysis.json not found at ${analysisPath}. Run: npm run analyze:audio -- ${stagingDir}`,
    );
  }

  if (!options.skipNaming) {
    await nameTracksFromAnalysis(config, {
      analysisPath,
      databasePath: config.databasePath,
      force: options.forceNames,
    });
  }

  const db = openDatabase(config.databasePath);
  const result = importFromAnalysis(db, config, {
    analysisPath,
    replaceTemporary: options.replaceTemporary,
    dryRun: options.dryRun,
  });
  db.close();

  console.log(
    `\nImport complete: ${result.imported} imported, ${result.removed} removed, ${result.skipped} skipped.`,
  );
}
