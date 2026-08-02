import { existsSync, unlinkSync } from "node:fs";
import {
  deleteTracksByIds,
  findTracksByTitle,
  getTrackById,
  openDatabase,
  resolveTrackAbsolutePath,
  storageObjectKey,
  type LibraryWorkerConfig,
  type Track,
} from "@monkey-radio/shared";

function describeTrack(track: Track): string {
  const title = track.display_name ?? track.title ?? "Untitled";
  return `${title} (${track.genre}, ${track.id})`;
}

async function deleteFromCdn(
  config: LibraryWorkerConfig,
  filePath: string | null | undefined,
): Promise<boolean> {
  if (!filePath || !config.libraryCdnUrl) return false;

  const bucket = process.env.R2_BUCKET;
  const endpoint = process.env.R2_ENDPOINT;
  const accessKey = process.env.AWS_ACCESS_KEY_ID;
  const secretKey = process.env.AWS_SECRET_ACCESS_KEY;
  if (!bucket || !endpoint || !accessKey || !secretKey) return false;

  const key = storageObjectKey(filePath);
  const { spawn } = await import("node:child_process");
  await new Promise<void>((resolve, reject) => {
    const proc = spawn(
      "aws",
      [
        "s3",
        "rm",
        `s3://${bucket}/${key}`,
        "--endpoint-url",
        endpoint,
        "--region",
        "auto",
      ],
      { stdio: "inherit" },
    );
    proc.on("error", reject);
    proc.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`aws s3 rm exited with code ${code}`));
    });
  });
  return true;
}

export async function removeTrack(
  config: LibraryWorkerConfig,
  options: {
    trackId?: string;
    title?: string;
    dryRun?: boolean;
    skipCdn?: boolean;
  },
): Promise<number> {
  const db = openDatabase(config.databasePath);
  try {
    let tracks: Track[] = [];

    if (options.trackId) {
      const track = getTrackById(db, options.trackId);
      if (!track) {
        throw new Error(`Track not found: ${options.trackId}`);
      }
      tracks = [track];
    } else if (options.title) {
      tracks = findTracksByTitle(db, options.title);
      if (tracks.length === 0) {
        throw new Error(`No tracks matched title query: ${options.title}`);
      }
    } else {
      throw new Error("Provide --id or --title");
    }

    console.log("Matched track(s):");
    for (const track of tracks) {
      console.log(`  - ${describeTrack(track)}`);
    }

    if (options.dryRun) {
      console.log("[dry-run] No changes made.");
      return 0;
    }

    const ids = tracks.map((track) => track.id);
    const removed = deleteTracksByIds(db, ids);
    console.log(`Removed ${removed} track(s) from database.`);

    for (const track of tracks) {
      if (!track.file_path) continue;

      const absolutePath = resolveTrackAbsolutePath(
        config.libraryPath,
        track.file_path,
      );
      if (existsSync(absolutePath)) {
        unlinkSync(absolutePath);
        console.log(`Deleted local file: ${absolutePath}`);
      }

      if (!options.skipCdn) {
        try {
          const deleted = await deleteFromCdn(config, track.file_path);
          if (deleted) {
            console.log(`Deleted CDN object: ${storageObjectKey(track.file_path)}`);
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.warn(`CDN delete skipped/failed: ${message}`);
        }
      }
    }

    return removed;
  } finally {
    db.close();
  }
}
