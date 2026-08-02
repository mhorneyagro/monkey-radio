import { mkdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { LibraryWorkerConfig, MonkeyRadioDb } from "@monkey-radio/shared";
import { updateTrack } from "@monkey-radio/shared";
import type { SunoTrack } from "../suno/client.js";

function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
}

function writeMockMp3(filePath: string): void {
  // Minimal valid-ish MP3 frame header for placeholder files in mock mode
  const header = Buffer.from([
    0xff, 0xfb, 0x90, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  ]);
  writeFileSync(filePath, header);
}

export async function downloadTrack(
  db: MonkeyRadioDb,
  config: LibraryWorkerConfig,
  params: {
    trackId: string;
    genre: string;
    sunoTrack: SunoTrack;
  },
): Promise<string> {
  const genreDir = join(config.libraryPath, params.genre);
  ensureDir(genreDir);

  const fileName = `${params.trackId}.mp3`;
  const finalPath = join(genreDir, fileName);
  const tempPath = `${finalPath}.tmp`;
  const relativePath = join("library", params.genre, fileName).replace(/\\/g, "/");

  if (params.sunoTrack.audioUrl.startsWith("mock://")) {
    writeMockMp3(tempPath);
  } else {
    const response = await fetch(params.sunoTrack.audioUrl);
    if (!response.ok) {
      throw new Error(
        `Download failed (${response.status}) for track ${params.sunoTrack.id}`,
      );
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    writeFileSync(tempPath, buffer);
  }

  renameSync(tempPath, finalPath);

  const now = new Date().toISOString();
  updateTrack(db, params.trackId, {
    suno_track_id: params.sunoTrack.id,
    title: params.sunoTrack.title,
    file_path: relativePath,
    duration_sec: params.sunoTrack.duration || null,
    mood_tags: JSON.stringify({ plan_tier: "pro" }),
    status: "ready",
    generated_at: now,
    error: null,
  });

  return relativePath;
}

export function cleanupTempFile(tempPath: string): void {
  try {
    unlinkSync(tempPath);
  } catch {
    // ignore missing temp file
  }
}
